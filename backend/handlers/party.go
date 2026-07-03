package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/truearken/valclient/valclient"
)

type PartyResponse struct {
	Phase   string         `json:"phase"`
	PartyID string         `json:"partyId,omitempty"`
	QueueID string         `json:"queueId,omitempty"`
	Members []*PartyMember `json:"members,omitempty"`
	Source  string         `json:"source,omitempty"`
	Error   string         `json:"error,omitempty"`
}

type PartyMember struct {
	Puuid           string `json:"puuid"`
	Name            string `json:"name"`
	IsLocal         bool   `json:"isLocal"`
	IsOwner         bool   `json:"isOwner"`
	IsReady         bool   `json:"isReady"`
	AccountLevel    int    `json:"accountLevel"`
	CardID          string `json:"cardId"`
	CompetitiveTier int    `json:"competitiveTier"`
}

type currentPartyPlayerResponse struct {
	// Subject is the PUUID the response is actually about. Riot's
	// /parties/v1/players/{puuid} endpoint is auth-scoped to the
	// local user — when we query someone else's PUUID the server
	// may still return the local user's party record. The Subject
	// in the body lets us detect that case and drop the result,
	// otherwise we'd mark every teammate of the local user as
	// "in your party" and surface a phantom 5-stack.
	Subject        string `json:"Subject"`
	CurrentPartyID string `json:"CurrentPartyID"`
}

type partyDetailsResponse struct {
	ID              string `json:"ID"`
	PartyID         string `json:"PartyID"`
	QueueID         string `json:"QueueID"`
	State           string `json:"State"`
	PreviousState   string `json:"PreviousState"`
	MatchmakingData struct {
		QueueID string `json:"QueueID"`
	} `json:"MatchmakingData"`
	Members []struct {
		Subject         string `json:"Subject"`
		CompetitiveTier int    `json:"CompetitiveTier"`
		IsOwner         bool   `json:"IsOwner"`
		IsReady         bool   `json:"IsReady"`
		PlayerIdentity  struct {
			Subject      string `json:"Subject"`
			PlayerCardID string `json:"PlayerCardID"`
			AccountLevel int    `json:"AccountLevel"`
			Incognito    bool   `json:"Incognito"`
		} `json:"PlayerIdentity"`
	} `json:"Members"`
}

func (h *Handler) GetParty(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getPartyClient(r)
	if err != nil || val == nil {
		h.returnAny(w, PartyResponse{Phase: "error", Error: errString(err)})
		return
	}

	response, err := h.fetchPartyResponse(val, source)
	if err != nil && source == "remote" {
		if local := h.localClientForPuuid(val.Player.Uuid); local != nil {
			source = "local"
			response, err = h.fetchPartyResponse(local, "local")
		}
	}
	// Some valid OAuth sessions can query party state but still report no
	// party. When the same account is actively running in the Riot client,
	// verify that result locally before declaring the player solo.
	if err == nil && source == "remote" && response.Phase == "none" {
		if local := h.localClientForPuuid(val.Player.Uuid); local != nil {
			if localResponse, localErr := h.fetchPartyResponse(local, "local"); localErr == nil && localResponse.Phase != "none" {
				response = localResponse
				source = "local"
			}
		}
	}
	if err != nil {
		slog.Warn("party refresh failed",
			"source", source,
			"region", val.Region,
			"shard", val.Shard,
			"puuid_length", len(val.Player.Uuid),
			"client_version", val.Header.Get("X-Riot-ClientVersion"),
			"reason", riotFailureReason(err))
		h.returnAny(w, PartyResponse{Phase: "error", Source: source, Error: err.Error()})
		return
	}
	h.returnAny(w, response)
}

func (h *Handler) fetchPartyResponse(val *valclient.ValClient, source string) (PartyResponse, error) {
	current, err := getCurrentParty(val)
	if err != nil {
		if isExpectedNoPartyError(err) {
			return PartyResponse{Phase: "none", Source: source}, nil
		}
		return PartyResponse{}, err
	}
	if current == nil || current.CurrentPartyID == "" {
		return PartyResponse{Phase: "none", Source: source}, nil
	}

	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil {
		return PartyResponse{}, err
	}

	return h.buildPartyResponse(val, source, details), nil
}

func (h *Handler) localClientForPuuid(puuid string) *valclient.ValClient {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.Val != nil && h.Val.Player != nil && strings.EqualFold(h.Val.Player.Uuid, puuid) {
		return h.Val
	}
	return nil
}

func (h *Handler) getPartyClient(r *http.Request) (*valclient.ValClient, string, error) {
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		return nil, "", err
	}
	if hasRemoteAuth {
		shard := getShardFromRegion(remoteAuth.Region)
		region := strings.ToLower(remoteAuth.Region)
		if region == "" {
			region = shard
		}
		return &valclient.ValClient{
			Shard:  valclient.Shard(shard),
			Region: valclient.Region(region),
			Player: &valclient.ValClientPlayer{Uuid: remoteAuth.Puuid},
			Header: buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken),
		}, "remote", nil
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.Val != nil {
		return h.Val, "local", nil
	}
	return nil, "", fmt.Errorf("authentication required: please log in first")
}

func getCurrentParty(val *valclient.ValClient) (*currentPartyPlayerResponse, error) {
	if val == nil || val.Player == nil || val.Player.Uuid == "" {
		return &currentPartyPlayerResponse{}, nil
	}
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/parties/v1/players/{puuid}", "{puuid}", val.Player.Uuid)
	resp := new(currentPartyPlayerResponse)
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func getPartyDetails(val *valclient.ValClient, partyID string) (*partyDetailsResponse, error) {
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/parties/v1/parties/{partyId}", "{partyId}", partyID)
	resp := new(partyDetailsResponse)
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (h *Handler) buildPartyResponse(val *valclient.ValClient, source string, details *partyDetailsResponse) PartyResponse {
	phase := partyPhase(details.State)
	localPuuid := ""
	if val.Player != nil {
		localPuuid = val.Player.Uuid
	}
	partyID := details.ID
	if partyID == "" {
		partyID = details.PartyID
	}
	resp := PartyResponse{
		Phase:   phase,
		PartyID: partyID,
		QueueID: details.MatchmakingData.QueueID,
		Source:  source,
		Members: make([]*PartyMember, 0, len(details.Members)),
	}

	for _, member := range details.Members {
		name := h.getPlayerNameCached(val, member.Subject)
		accountLevel := member.PlayerIdentity.AccountLevel
		cardID := member.PlayerIdentity.PlayerCardID
		if accountLevel == 0 && member.Subject != "" && member.PlayerIdentity.Subject == "" {
			accountLevel = 0
		}
		resp.Members = append(resp.Members, &PartyMember{
			Puuid:           member.Subject,
			Name:            name,
			IsLocal:         member.Subject == localPuuid,
			IsOwner:         member.IsOwner,
			IsReady:         member.IsReady,
			AccountLevel:    accountLevel,
			CardID:          cardID,
			CompetitiveTier: member.CompetitiveTier,
		})
	}
	return resp
}

func partyPhase(state string) string {
	switch strings.ToUpper(state) {
	case "MATCHMAKING":
		return "matchmaking"
	case "PREGAME":
		return "pregame"
	case "INGAME", "COREGAME":
		return "coregame"
	case "", "DEFAULT", "CUSTOM_GAME_SETUP":
		return "party"
	default:
		return "party"
	}
}

func isExpectedNoPartyError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "resource not found") ||
		strings.Contains(text, "not found") ||
		strings.Contains(text, "404") ||
		(strings.Contains(text, "status 400") &&
			(strings.Contains(text, "bad_parameter") || strings.Contains(text, "bad parameter used as input"))) ||
		strings.Contains(text, "player not in party")
}
