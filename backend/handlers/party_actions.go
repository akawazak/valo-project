package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/truearken/valclient/valclient"
)

// Party actions are single, user-clicked versions of what the Riot client's own
// party buttons do. Nothing here repeats, schedules or chains requests. Before
// every action the party is read fresh and the request is refused unless the
// real client would allow it: the right phase, the right member, a queue Riot
// lists as eligible, and no active queue restriction.

type PartyActionRequest struct {
	Action  string `json:"action"`
	QueueID string `json:"queueId,omitempty"`
	Name    string `json:"name,omitempty"`
	Tag     string `json:"tag,omitempty"`
}

type partyCall struct {
	method string
	path   string // appended to /parties/v1/parties/{partyId}
	body   any
}

var errPartyAction = errors.New("party action refused")

var (
	riotNamePattern = regexp.MustCompile(`^[\p{L}\p{N} ._-]{3,16}$`)
	riotTagPattern  = regexp.MustCompile(`^[\p{L}\p{N}]{3,5}$`)
	queueIDPattern  = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)
)

func refuse(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errPartyAction, fmt.Sprintf(format, args...))
}

// planPartyAction checks one action against the party as Riot reports it now
// and returns the single Riot request to make, or the reason it is refused.
func planPartyAction(details *partyDetailsResponse, localPuuid string, req PartyActionRequest) (partyCall, error) {
	if details == nil {
		return partyCall{}, refuse("you are not in a party")
	}
	state := strings.ToUpper(details.State)
	var local *struct {
		owner bool
		ready bool
	}
	for _, member := range details.Members {
		if strings.EqualFold(member.Subject, localPuuid) {
			local = &struct {
				owner bool
				ready bool
			}{member.IsOwner, member.IsReady}
		}
	}
	if local == nil {
		return partyCall{}, refuse("your account is not in this party")
	}
	inLobby := state == "" || state == "DEFAULT"

	switch req.Action {
	case "ready", "unready":
		if !inLobby {
			return partyCall{}, refuse("you can only change ready while the party is in the lobby")
		}
		return partyCall{http.MethodPost, "/members/" + url.PathEscape(localPuuid) + "/setReady", map[string]bool{"ready": req.Action == "ready"}}, nil

	case "queue":
		if !inLobby {
			return partyCall{}, refuse("the queue can only be changed in the lobby")
		}
		if !local.owner {
			return partyCall{}, refuse("only the party leader can change the queue")
		}
		if !queueIDPattern.MatchString(req.QueueID) || !slices.Contains(details.EligibleQueues, req.QueueID) {
			return partyCall{}, refuse("Riot does not list that queue as available for this party")
		}
		return partyCall{http.MethodPost, "/queue", map[string]string{"queueId": req.QueueID}}, nil

	case "start":
		if !inLobby {
			return partyCall{}, refuse("the party is not in the lobby")
		}
		if !local.owner {
			return partyCall{}, refuse("only the party leader can start the queue")
		}
		if details.RestrictedSeconds > 0 {
			return partyCall{}, refuse("Riot has a queue restriction on this party right now")
		}
		queue := details.MatchmakingData.QueueID
		if queue == "" || !slices.Contains(details.EligibleQueues, queue) {
			return partyCall{}, refuse("the selected queue is not available for this party")
		}
		for _, member := range details.Members {
			if !member.IsReady {
				return partyCall{}, refuse("everyone in the party has to be ready first")
			}
		}
		return partyCall{http.MethodPost, "/matchmaking/join", nil}, nil

	case "cancel":
		if state != "MATCHMAKING" {
			return partyCall{}, refuse("the party is not in a queue")
		}
		if !local.owner {
			return partyCall{}, refuse("only the party leader can cancel the queue")
		}
		return partyCall{http.MethodPost, "/matchmaking/leave", nil}, nil

	case "open", "close":
		if !inLobby {
			return partyCall{}, refuse("the party can only be opened or closed in the lobby")
		}
		if !local.owner {
			return partyCall{}, refuse("only the party leader can open or close the party")
		}
		value := "OPEN"
		if req.Action == "close" {
			value = "CLOSED"
		}
		return partyCall{http.MethodPost, "/accessibility", map[string]string{"accessibility": value}}, nil

	case "invite":
		if !inLobby {
			return partyCall{}, refuse("invites can only be sent from the lobby")
		}
		if len(details.Members) >= 5 {
			return partyCall{}, refuse("the party is full")
		}
		name, tag := strings.TrimSpace(req.Name), strings.TrimSpace(strings.TrimPrefix(req.Tag, "#"))
		if !riotNamePattern.MatchString(name) || !riotTagPattern.MatchString(tag) {
			return partyCall{}, refuse("enter a Riot ID like Name#TAG")
		}
		return partyCall{http.MethodPost, "/invites/name/" + url.PathEscape(name) + "/tag/" + url.PathEscape(tag), nil}, nil
	}
	return partyCall{}, refuse("unknown party action")
}

// One action per account at a time, at most one every 1.2 seconds and 20 a
// minute, so a stuck button or double click can never flood Riot.
type partyActionLimiter struct {
	mu     sync.Mutex
	recent map[string][]time.Time
	busy   map[string]bool
}

var partyLimiter = &partyActionLimiter{recent: map[string][]time.Time{}, busy: map[string]bool{}}

func (l *partyActionLimiter) acquire(key string, now time.Time) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.busy[key] {
		return refuse("another party action is still running")
	}
	kept := l.recent[key][:0]
	for _, at := range l.recent[key] {
		if now.Sub(at) < time.Minute {
			kept = append(kept, at)
		}
	}
	if len(kept) > 0 && now.Sub(kept[len(kept)-1]) < 1200*time.Millisecond {
		l.recent[key] = kept
		return refuse("wait a moment before the next party action")
	}
	if len(kept) >= 20 {
		l.recent[key] = kept
		return refuse("too many party actions in the last minute")
	}
	l.recent[key] = append(kept, now)
	l.busy[key] = true
	return nil
}

func (l *partyActionLimiter) release(key string) {
	l.mu.Lock()
	delete(l.busy, key)
	l.mu.Unlock()
}

// partyActionCall makes the Riot request; tests replace it.
var partyActionCall = func(val *valclient.ValClient, method, apiURL string, body any) error {
	headers := val.Header.Clone()
	if body != nil {
		headers.Set("Content-Type", "application/json")
	}
	return runRiotJSON(method, apiURL, headers, body, nil)
}

// PostPartyAction handles POST /v1/party/action and returns the party as Riot reports it afterwards.
func (h *Handler) PostPartyAction(w http.ResponseWriter, r *http.Request) {
	var req PartyActionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		writePartyActionError(w, http.StatusBadRequest, "The party action could not be read.")
		return
	}
	val, source, err := h.getPartyClient(r)
	if err != nil || val == nil || val.Player == nil || val.Player.Uuid == "" {
		writePartyActionError(w, http.StatusUnauthorized, "Connect the Riot account to control the party.")
		return
	}
	key := strings.ToLower(val.Player.Uuid)
	if err := partyLimiter.acquire(key, time.Now()); err != nil {
		writePartyActionError(w, http.StatusTooManyRequests, partyRefusalText(err))
		return
	}
	defer partyLimiter.release(key)

	current, err := getCurrentParty(val)
	if err != nil || current == nil || current.CurrentPartyID == "" {
		writePartyActionError(w, http.StatusConflict, "You are not in a party right now.")
		return
	}
	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil {
		writePartyActionError(w, http.StatusBadGateway, "Riot did not return the party. Try again.")
		return
	}
	call, err := planPartyAction(details, val.Player.Uuid, req)
	if err != nil {
		writePartyActionError(w, http.StatusConflict, partyRefusalText(err))
		return
	}
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/parties/v1/parties/{partyId}", "{partyId}", url.PathEscape(current.CurrentPartyID)) + call.path
	if err := partyActionCall(val, call.method, apiURL, call.body); err != nil {
		slog.Warn("party action failed", "action", req.Action, "source", source, "reason", riotFailureReason(err))
		writePartyActionError(w, http.StatusBadGateway, riotPartyMessage(err))
		return
	}
	slog.Info("party action", "action", req.Action, "source", source)
	response, err := h.fetchPartyResponse(val, source)
	if err != nil {
		h.returnAny(w, PartyResponse{Phase: "error", Source: source, Error: "The action went through, but the party could not be refreshed."})
		return
	}
	h.returnAny(w, response)
}

func partyRefusalText(err error) string {
	text := strings.TrimPrefix(err.Error(), errPartyAction.Error()+": ")
	if text == "" {
		return "That party action is not available."
	}
	return strings.ToUpper(text[:1]) + text[1:] + "."
}

// riotPartyMessage keeps Riot's own message when it sends one, without echoing tokens or URLs.
func riotPartyMessage(err error) string {
	text := err.Error()
	if start := strings.Index(text, "{"); start >= 0 {
		var upstream struct {
			Message   string `json:"message"`
			ErrorCode string `json:"errorCode"`
		}
		if json.Unmarshal([]byte(text[start:]), &upstream) == nil && upstream.Message != "" {
			return "Riot refused it: " + upstream.Message
		}
	}
	return "Riot did not accept the party action. Try it in VALORANT."
}

func writePartyActionError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
