package handlers

import (
	"backend/tracking"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/truearken/valclient/valclient"
)

// Chat presence payload used by the local chat server (chat/v4/presences).
type chatPresenceEntry struct {
	Puuid      string `json:"puuid"`
	Product    string `json:"product"`
	GameName   string `json:"game_name"`
	GameTag    string `json:"game_tag"`
	GameMagic  string `json:"game_magic"`
	TimeStamp  int64  `json:"timeStamp"`
	Private    string `json:"private"`
	State      string `json:"state"`
	Name       string `json:"name"`
	AccountID  string `json:"account_id"`
	Platform   string `json:"platform"`
	PlayerName string `json:"playerName"`
}

// Friends list payload from the local chat server (chat/v4/friends).
type localFriendsResponse struct {
	Friends []struct {
		PUUID          string  `json:"puuid"`
		GameName       string  `json:"game_name"`
		GameTag        string  `json:"game_tag"`
		Name           string  `json:"name"`
		Note           string  `json:"note"`
		Pid            string  `json:"pid"`
		Region         string  `json:"region"`
		LastOnlineTs   *int64  `json:"last_online_ts"`
		ActivePlatform *string `json:"activePlatform"`
	} `json:"friends"`
}

type localPresencesResponse struct {
	Presences []chatPresenceEntry `json:"presences"`
}

type localFriendRequestsResponse struct {
	Requests []struct {
		PUUID        string `json:"puuid"`
		GameName     string `json:"game_name"`
		GameTag      string `json:"game_tag"`
		Name         string `json:"name"`
		Subscription string `json:"subscription"`
	} `json:"requests"`
}

type localChatSessionResponse struct {
	PUUID string `json:"puuid"`
}

// Cached lockfile snapshot to avoid re-reading the file on every poll.
type lockfileCache struct {
	mu       sync.RWMutex
	path     string
	port     string
	password string
	readAt   time.Time
}

var riotLockfileCache = &lockfileCache{}

var localChatHTTPClient = &http.Client{
	Timeout: 4 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		MaxIdleConnsPerHost: 2,
		IdleConnTimeout:     30 * time.Second,
	},
}

type riotClientConfigResponse struct {
	Chat struct {
		Affinities map[string]string `json:"affinities"`
		Port       int               `json:"port"`
	} `json:"chat"`
}

type remoteSocialProbe struct {
	Status string
	Host   string
	Port   int
	Error  string
}

// GetSocialStatus keeps the selected account authoritative. A token-authenticated
// account never falls through to a different account in the local Riot Client.
func (h *Handler) GetSocialStatus(w http.ResponseWriter, r *http.Request) {
	remoteOnly := strings.EqualFold(r.URL.Query().Get("remoteOnly"), "true")
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		h.returnAny(w, SocialStatusResponse{Status: "unavailable", Source: "remote", Error: err.Error()})
		return
	}

	remoteProbe := remoteSocialProbe{Status: "missing"}
	if remoteOnly && !hasRemoteAuth {
		h.returnAny(w, SocialStatusResponse{
			Status:       "unavailable",
			Source:       "remote",
			RemoteStatus: "missing",
			Error:        "Riot access token is missing. Refresh or reconnect this account.",
		})
		return
	}
	if hasRemoteAuth {
		remoteResp := fetchRemoteSocialStatus(remoteAuth)
		h.enrichRemoteSocialNames(remoteAuth, &remoteResp)
		h.enrichSocialCards(&remoteResp)
		remoteProbe = remoteSocialProbe{
			Status: remoteResp.RemoteStatus,
			Host:   remoteResp.RemoteChatHost,
			Port:   remoteResp.RemoteChatPort,
			Error:  remoteResp.Error,
		}
		if remoteResp.Status == "ok" && remoteResp.RemoteStatus == "live" {
			h.attachSocialHistory(remoteAuth.Puuid, &remoteResp)
		}
		h.returnAny(w, remoteResp)
		return
	}
	selected := selectedAccountPuuid(r)
	if selected != "" {
		localSession, sessionErr := h.fetchLocalChatSession()
		if sessionErr != nil || !strings.EqualFold(localSession.PUUID, selected) {
			h.returnAny(w, SocialStatusResponse{Status: "unavailable", Source: "remote", RemoteStatus: "missing", Error: "The selected Riot account is not connected remotely. Refresh or reconnect it."})
			return
		}
	}

	resp, err := h.fetchLocalSocialStatus()
	if err != nil {
		source := "remote"
		if !hasRemoteAuth {
			source = "local"
		}
		h.returnAny(w, SocialStatusResponse{
			Status:         "unavailable",
			Source:         source,
			RemoteStatus:   remoteProbe.Status,
			RemoteChatHost: remoteProbe.Host,
			RemoteChatPort: remoteProbe.Port,
			Error:          joinSocialErrors(remoteProbe.Error, err.Error()),
		})
		return
	}
	resp.RemoteStatus = remoteProbe.Status
	resp.RemoteChatHost = remoteProbe.Host
	resp.RemoteChatPort = remoteProbe.Port
	h.enrichSocialCards(&resp)
	account := ""
	if session, sessionErr := h.fetchLocalChatSession(); sessionErr == nil {
		account = session.PUUID
	}
	h.attachSocialHistory(account, &resp)
	h.returnAny(w, resp)
}

func (h *Handler) NotifySocialChanged() {
	h.socialMu.Lock()
	defer h.socialMu.Unlock()
	if h.socialSubscribers == nil {
		h.socialSubscribers = make(map[chan struct{}]struct{})
	}
	for ch := range h.socialSubscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (h *Handler) SocialEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	local := make(chan struct{}, 1)
	h.socialMu.Lock()
	if h.socialSubscribers == nil {
		h.socialSubscribers = make(map[chan struct{}]struct{})
	}
	h.socialSubscribers[local] = struct{}{}
	h.socialMu.Unlock()
	defer func() { h.socialMu.Lock(); delete(h.socialSubscribers, local); h.socialMu.Unlock() }()
	remote, unsubscribe := remoteSocialHub.subscribe()
	defer unsubscribe()
	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-local:
			fmt.Fprint(w, "event: social\ndata: {}\n\n")
			flusher.Flush()
		case <-remote:
			fmt.Fprint(w, "event: social\ndata: {}\n\n")
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func (h *Handler) enrichSocialCards(response *SocialStatusResponse) {
	if response == nil || len(response.Presences) == 0 {
		return
	}
	missing := make([]string, 0, len(response.Presences))
	for _, presence := range response.Presences {
		if presence.CardID == "" && presence.Puuid != "" {
			missing = append(missing, presence.Puuid)
		}
	}
	if len(missing) == 0 {
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		return
	}
	cards, err := tracking.GetLatestPlayerCards(db, missing)
	if err != nil {
		return
	}
	for i := range response.Presences {
		if response.Presences[i].CardID == "" {
			response.Presences[i].CardID = cards[strings.ToLower(response.Presences[i].Puuid)]
		}
	}
}

func (h *Handler) enrichRemoteSocialNames(auth *remoteAuthHeaders, response *SocialStatusResponse) {
	if auth == nil || response == nil || len(response.Presences) == 0 {
		return
	}

	names := make(map[string]string, len(response.Presences))
	missing := make([]string, 0, len(response.Presences))
	h.namesMu.RLock()
	for _, presence := range response.Presences {
		puuid := strings.ToLower(presence.Puuid)
		if name := h.namesCache[puuid]; name != "" {
			names[puuid] = name
		} else if presence.Name == "" || strings.HasPrefix(presence.Name, "Player ") || strings.HasPrefix(presence.Name, "Unknown") {
			missing = append(missing, puuid)
		}
	}
	h.namesMu.RUnlock()

	if len(missing) > 0 {
		val := &valclient.ValClient{
			Shard:  valclient.Shard(getShardFromRegion(auth.Region)),
			Region: valclient.Region(strings.ToLower(auth.Region)),
			Player: &valclient.ValClientPlayer{Uuid: auth.Puuid},
			Header: buildRiotHeaders(auth.AccessToken, auth.EntitlementsToken),
		}
		if resolved, err := val.GetNames(missing); err == nil {
			h.namesMu.Lock()
			if h.namesCache == nil {
				h.namesCache = make(map[string]string)
			}
			for _, player := range resolved {
				name := friendDisplayName(player.GameName, player.TagLine, "")
				if name == "Unknown friend" {
					name = player.DisplayName
				}
				if name != "" {
					puuid := strings.ToLower(player.Subject)
					names[puuid] = name
					h.namesCache[puuid] = name
				}
			}
			h.namesMu.Unlock()
		}
	}

	for i := range response.Presences {
		if name := names[strings.ToLower(response.Presences[i].Puuid)]; name != "" {
			response.Presences[i].Name = name
		}
	}
}

func (h *Handler) probeRemoteSocial(remoteAuth *remoteAuthHeaders) remoteSocialProbe {
	req, err := http.NewRequest(http.MethodGet, "https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client", nil)
	if err != nil {
		return remoteSocialProbe{Status: "error", Error: err.Error()}
	}
	headers := buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken)
	for k, vs := range headers {
		for _, v := range vs {
			req.Header.Set(k, v)
		}
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return remoteSocialProbe{Status: "error", Error: "token chat config failed: " + err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return remoteSocialProbe{Status: "error", Error: fmt.Sprintf("token chat config returned %d: %s", resp.StatusCode, string(bodyBytes))}
	}
	var cfg map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return remoteSocialProbe{Status: "error", Error: "decode token chat config failed: " + err.Error()}
	}
	affinities, port := extractChatConfig(cfg)
	host := pickChatHost(affinities, remoteAuth.Region)
	if host == "" {
		return remoteSocialProbe{Status: "error", Port: port, Error: "token chat config did not include a usable chat affinity"}
	}
	return remoteSocialProbe{Status: "config", Host: host, Port: port}
}

// fetchLocalSocialStatus reads the Riot lockfile and queries the local
// chat server (127.0.0.1:{port}).
func (h *Handler) fetchLocalSocialStatus() (SocialStatusResponse, error) {
	port, password, err := readRiotLockfile()
	if err != nil {
		return SocialStatusResponse{}, fmt.Errorf("local riot client not running: %s", err.Error())
	}

	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("riot:%s", password)))
	// 1) Friends list.
	friendsURL := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/friends", port)
	friends, err := doLocalChatRequest(localChatHTTPClient, friendsURL, auth, func(body []byte) (localFriendsResponse, error) {
		var out localFriendsResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if err != nil {
		return SocialStatusResponse{}, fmt.Errorf("friends list failed: %s", err.Error())
	}

	// 2) Presences (may include the local player; we'll filter).
	presencesURL := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/presences", port)
	presences, err := doLocalChatRequest(localChatHTTPClient, presencesURL, auth, func(body []byte) (localPresencesResponse, error) {
		var out localPresencesResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if err != nil {
		// Continue with friends only - UI can still show the roster.
		presences = localPresencesResponse{}
	}

	result := buildLocalSocialResponse(friends, presences, "local")
	result.RosterComplete = true
	requestsURL := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/friendrequests", port)
	requests, requestErr := doLocalChatRequest(localChatHTTPClient, requestsURL, auth, func(body []byte) (localFriendRequestsResponse, error) {
		var out localFriendRequestsResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if requestErr == nil {
		result.RequestsComplete = true
		for _, request := range requests.Requests {
			direction := ""
			switch strings.ToLower(strings.TrimSpace(request.Subscription)) {
			case "pending_in":
				direction = "incoming"
			case "pending_out":
				direction = "outgoing"
			}
			puuid := strings.ToLower(strings.TrimSpace(request.PUUID))
			if puuid == "" || direction == "" {
				continue
			}
			result.Requests = append(result.Requests, SocialFriendRequest{Puuid: puuid, Name: firstNonEmpty(friendDisplayName(request.GameName, request.GameTag, puuid), request.Name), Direction: direction})
		}
	}
	return result, nil
}

func (h *Handler) fetchLocalChatSession() (localChatSessionResponse, error) {
	port, password, err := readRiotLockfile()
	if err != nil {
		return localChatSessionResponse{}, err
	}
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("riot:%s", password)))
	url := fmt.Sprintf("https://127.0.0.1:%s/chat/v1/session", port)
	return doLocalChatRequest(localChatHTTPClient, url, auth, func(body []byte) (localChatSessionResponse, error) {
		var out localChatSessionResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
}

// fetchLocalPlayerPresence reads just the signed-in player's chat presence.
// It is a small local request used while a core-game match is active; score
// values are published by the Riot client inside this encrypted-local API's
// VALORANT presence payload.
func (h *Handler) fetchLocalPlayerPresence(puuid string) (SocialPresence, bool) {
	port, password, err := readRiotLockfile()
	if err != nil {
		return SocialPresence{}, false
	}
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("riot:%s", password)))
	url := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/presences", port)
	presences, err := doLocalChatRequest(localChatHTTPClient, url, auth, func(body []byte) (localPresencesResponse, error) {
		var out localPresencesResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if err != nil {
		return SocialPresence{}, false
	}
	for _, entry := range presences.Presences {
		if strings.EqualFold(entry.Puuid, puuid) {
			return normalizeChatPresence(entry, nil), true
		}
	}
	return SocialPresence{}, false
}

func doLocalChatRequest[T any](client *http.Client, url, auth string, decode func([]byte) (T, error)) (T, error) {
	var zero T
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return zero, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return zero, fmt.Errorf("status %d: %s", resp.StatusCode, string(bodyBytes))
	}
	bodyBytes, _ := io.ReadAll(resp.Body)
	out, err := decode(bodyBytes)
	if err != nil {
		return zero, fmt.Errorf("decode failed: %s", err.Error())
	}
	return out, nil
}

// buildLocalSocialResponse normalizes the local /chat/v4 responses into
// the frontend's SocialStatusResponse shape. Offline friends (no
// matching presence entry) get state="offline" so the UI's collapsible
// dropdown has something to show.
func buildLocalSocialResponse(friends localFriendsResponse, presences localPresencesResponse, source string) SocialStatusResponse {
	presencesByPuuid := make(map[string]chatPresenceEntry, len(presences.Presences))
	for _, p := range presences.Presences {
		puuid := strings.ToLower(strings.TrimSpace(p.Puuid))
		current, exists := presencesByPuuid[puuid]
		if puuid != "" && (!exists || !strings.EqualFold(current.Product, "valorant") ||
			(strings.EqualFold(p.Product, "valorant") && current.Private == "" && p.Private != "")) {
			p.Puuid = puuid
			presencesByPuuid[puuid] = p
		}
	}

	out := make([]SocialPresence, 0, len(friends.Friends))
	seenFriends := make(map[string]struct{}, len(friends.Friends))
	onlineCount := 0
	inGameCount := 0
	for _, f := range friends.Friends {
		puuid := strings.ToLower(strings.TrimSpace(f.PUUID))
		if puuid == "" {
			continue
		}
		if _, exists := seenFriends[puuid]; exists {
			continue
		}
		seenFriends[puuid] = struct{}{}
		presence, ok := presencesByPuuid[puuid]
		if !ok {
			fallback := SocialPresence{Puuid: puuid, Name: friendDisplayName(f.GameName, f.GameTag, puuid), State: "offline"}
			if f.ActivePlatform != nil && isDesktopPlatform(*f.ActivePlatform) {
				fallback.Product = "riotclient"
				fallback.Platform = *f.ActivePlatform
				fallback.State = "online"
				onlineCount++
			}
			out = append(out, fallback)
			continue
		}
		normalized := normalizeChatPresence(presence, map[string]string{
			puuid: friendDisplayName(f.GameName, f.GameTag, puuid),
		})
		if socialPresenceIsActive(normalized) {
			onlineCount++
			if socialPresenceIsInGame(normalized) {
				inGameCount++
			}
		}
		out = append(out, normalized)
	}

	return SocialStatusResponse{
		Status:      "ok",
		Source:      source,
		FriendCount: len(friends.Friends),
		OnlineCount: onlineCount,
		InGameCount: inGameCount,
		Presences:   out,
	}
}

func isDesktopPlatform(platform string) bool {
	platform = strings.ToLower(strings.TrimSpace(platform))
	return strings.Contains(platform, "pc") || strings.Contains(platform, "windows") || strings.Contains(platform, "desktop")
}

func extractChatConfig(cfg map[string]any) (map[string]string, int) {
	affinities := mapStringString(cfg["chat.affinities"])
	port := intFromAny(cfg["chat.port"])
	if chat, ok := cfg["chat"].(map[string]any); ok {
		if len(affinities) == 0 {
			affinities = mapStringString(chat["affinities"])
		}
		if port == 0 {
			port = intFromAny(chat["port"])
		}
	}
	return affinities, port
}

func mapStringString(v any) map[string]string {
	switch m := v.(type) {
	case map[string]string:
		return m
	case map[string]any:
		out := make(map[string]string, len(m))
		for k, val := range m {
			if s := strings.TrimSpace(fmt.Sprint(val)); s != "" && s != "<nil>" {
				out[strings.ToLower(strings.TrimSpace(k))] = s
			}
		}
		return out
	default:
		return nil
	}
}

func intFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(strings.TrimSpace(n))
		return i
	default:
		return 0
	}
}

func pickChatHost(affinities map[string]string, region string) string {
	if len(affinities) == 0 {
		return ""
	}
	region = strings.ToLower(strings.TrimSpace(region))
	for _, key := range []string{region, getShardFromRegion(region), "live"} {
		if host := strings.TrimSpace(affinities[key]); host != "" {
			return host
		}
	}
	for _, host := range affinities {
		if strings.TrimSpace(host) != "" {
			return host
		}
	}
	return ""
}

func joinSocialErrors(remoteErr, localErr string) string {
	if remoteErr == "" {
		return localErr
	}
	if localErr == "" {
		return remoteErr
	}
	return remoteErr + "; local fallback failed: " + localErr
}

// readRiotLockfile reads the local Valorant lockfile to get the chat
// server port and basic-auth password. Path follows the convention at
// %LocalAppData%\Riot Games\Riot Client\Config\lockfile.
func readRiotLockfile() (port, password string, err error) {
	riotLockfileCache.mu.RLock()
	if time.Since(riotLockfileCache.readAt) < 2*time.Second && riotLockfileCache.port != "" {
		port := riotLockfileCache.port
		password := riotLockfileCache.password
		riotLockfileCache.mu.RUnlock()
		return port, password, nil
	}
	riotLockfileCache.mu.RUnlock()

	path, err := locateRiotLockfile()
	if err != nil {
		return "", "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("read lockfile: %s", err.Error())
	}
	// Format: name:pid:port:password:protocol
	parts := strings.Split(string(data), ":")
	if len(parts) < 4 {
		return "", "", fmt.Errorf("lockfile format unexpected (%d fields)", len(parts))
	}
	port = strings.TrimSpace(parts[2])
	password = strings.TrimSpace(parts[3])

	riotLockfileCache.mu.Lock()
	riotLockfileCache.path = path
	riotLockfileCache.port = port
	riotLockfileCache.password = password
	riotLockfileCache.readAt = time.Now()
	riotLockfileCache.mu.Unlock()

	return port, password, nil
}

// locateRiotLockfile finds the lockfile in the standard Riot Client
// install location. Honors %LocalAppData% and common fallbacks.
func locateRiotLockfile() (string, error) {
	candidates := []string{}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		candidates = append(candidates, filepath.Join(localAppData, "Riot Games", "Riot Client", "Config", "lockfile"))
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		candidates = append(candidates,
			filepath.Join(home, "AppData", "Local", "Riot Games", "Riot Client", "Config", "lockfile"),
		)
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("lockfile not found in: %s", strings.Join(candidates, "; "))
}

func normalizeChatPresence(entry chatPresenceEntry, nameByPuuid map[string]string) SocialPresence {
	p := SocialPresence{
		Puuid:        entry.Puuid,
		Product:      strings.ToLower(entry.Product),
		Name:         resolvePresenceName(entry, nameByPuuid),
		State:        entry.State,
		Availability: strings.ToLower(strings.TrimSpace(entry.State)),
		Platform:     entry.Platform,
	}
	if rawPrivate := entry.Private; rawPrivate != "" {
		if private, ok := decodePresencePayload(rawPrivate); ok {
			p.State = firstString(private, "sessionLoopState", "SessionLoopState")
			p.QueueID = firstString(private, "queueId", "QueueID")
			p.PartyState = firstString(private, "partyState", "PartyState")
			p.PartySize = intFromAny(private["partySize"])
			p.MaxPartySize = intFromAny(private["maxPartySize"])
			p.CardID = firstString(private, "playerCardId", "PlayerCardID")
			p.PartyGroup = anonymousPartyGroup(firstString(private, "partyId", "PartyID", "partyID"))
			p.AllyScore, p.EnemyScore, p.ScoreAvailable = presenceMatchScore(private)
			if mpd, ok := private["matchPresenceData"].(map[string]any); ok {
				p.State = firstNonEmpty(firstString(mpd, "sessionLoopState", "SessionLoopState"), p.State)
				p.QueueID = firstNonEmpty(firstString(mpd, "queueId", "QueueID"), p.QueueID)
				p.PartyState = firstNonEmpty(firstString(mpd, "partyState", "PartyState"), p.PartyState)
				if size := intFromAny(mpd["partySize"]); size > 0 {
					p.PartySize = size
				}
				if size := intFromAny(mpd["maxPartySize"]); size > 0 {
					p.MaxPartySize = size
				}
				p.CardID = firstNonEmpty(firstString(mpd, "playerCardId", "PlayerCardID"), p.CardID)
				p.PartyGroup = firstNonEmpty(anonymousPartyGroup(firstString(mpd, "partyId", "PartyID", "partyID")), p.PartyGroup)
				if ally, enemy, ok := presenceMatchScore(mpd); ok {
					p.AllyScore, p.EnemyScore, p.ScoreAvailable = ally, enemy, true
				}
			}
		}
	}
	if p.State == "" && p.Product != "" {
		p.State = "online"
	}
	if p.Product == "" && !strings.EqualFold(p.State, "offline") {
		p.Product = "riot_chat"
	}
	if !socialPresenceIsActive(p) {
		p.State = "offline"
	}
	return p
}

func presenceMatchScore(payload map[string]any) (int, int, bool) {
	ally, allyOK := payload["partyOwnerMatchScoreAllyTeam"]
	enemy, enemyOK := payload["partyOwnerMatchScoreEnemyTeam"]
	if !allyOK || !enemyOK {
		return 0, 0, false
	}
	return intFromAny(ally), intFromAny(enemy), true
}

func decodePresencePayload(raw string) (map[string]any, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, false
	}
	decodeJSON := func(data []byte) (map[string]any, bool) {
		var payload map[string]any
		if json.Unmarshal(data, &payload) != nil {
			return nil, false
		}
		return payload, true
	}
	if strings.HasPrefix(raw, "{") {
		return decodeJSON([]byte(raw))
	}
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		if decoded, err := encoding.DecodeString(raw); err == nil {
			if payload, ok := decodeJSON(decoded); ok {
				return payload, true
			}
		}
	}
	return nil, false
}

func anonymousPartyGroup(partyID string) string {
	partyID = strings.TrimSpace(partyID)
	if partyID == "" || partyID == "00000000-0000-0000-0000-000000000000" {
		return ""
	}
	sum := sha256.Sum256([]byte(partyID))
	return fmt.Sprintf("party-%x", sum[:6])
}

func resolvePresenceName(entry chatPresenceEntry, nameByPuuid map[string]string) string {
	if entry.Puuid != "" {
		if cached, ok := nameByPuuid[entry.Puuid]; ok && cached != "" {
			return cached
		}
	}
	gameName := firstNonEmpty(entry.GameName, entry.PlayerName, entry.Name)
	tag := firstNonEmpty(entry.GameTag)
	if gameName == "" {
		return ""
	}
	if tag != "" {
		return gameName + "#" + tag
	}
	return gameName
}

func friendDisplayName(gameName, tag, _ string) string {
	if gameName != "" && tag != "" {
		return gameName + "#" + tag
	}
	if gameName != "" {
		return gameName
	}
	return "Unknown friend"
}

func socialPresenceIsActive(p SocialPresence) bool {
	if strings.EqualFold(p.Product, "valorant") {
		return true
	}
	if p.Product != "" && strings.EqualFold(p.Availability, "mobile") {
		return true
	}
	platform := strings.ToLower(p.Platform)
	return strings.Contains(platform, "pc") || strings.Contains(platform, "windows") || strings.Contains(platform, "desktop")
}

func socialPresenceIsInGame(p SocialPresence) bool {
	state := strings.ToLower(p.State)
	return p.QueueID != "" || strings.Contains(state, "ingame") || strings.Contains(state, "pregame") || strings.Contains(state, "match")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
