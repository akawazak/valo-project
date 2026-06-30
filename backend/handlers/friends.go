package handlers

import (
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

// Cached lockfile snapshot to avoid re-reading the file on every poll.
type lockfileCache struct {
	mu       sync.RWMutex
	path     string
	port     string
	password string
	readAt   time.Time
}

var riotLockfileCache = &lockfileCache{}

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

// GetSocialStatus returns friend presence from token-authenticated XMPP,
// falling back to the local Riot Client chat API when remote chat is unavailable.
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
		remoteProbe = remoteSocialProbe{
			Status: remoteResp.RemoteStatus,
			Host:   remoteResp.RemoteChatHost,
			Port:   remoteResp.RemoteChatPort,
			Error:  remoteResp.Error,
		}
		if remoteResp.Status == "ok" || remoteResp.RemoteStatus == "connecting" || remoteResp.RemoteStatus == "live" {
			h.returnAny(w, remoteResp)
			return
		}
		if remoteOnly {
			h.returnAny(w, remoteResp)
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
	h.returnAny(w, resp)
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
	client := &http.Client{
		Timeout: 4 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	// 1) Friends list.
	friendsURL := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/friends", port)
	friends, err := doLocalChatRequest(client, friendsURL, auth, func(body []byte) (localFriendsResponse, error) {
		var out localFriendsResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if err != nil {
		return SocialStatusResponse{}, fmt.Errorf("friends list failed: %s", err.Error())
	}

	// 2) Presences (may include the local player; we'll filter).
	presencesURL := fmt.Sprintf("https://127.0.0.1:%s/chat/v4/presences", port)
	presences, err := doLocalChatRequest(client, presencesURL, auth, func(body []byte) (localPresencesResponse, error) {
		var out localPresencesResponse
		err := json.Unmarshal(body, &out)
		return out, err
	})
	if err != nil {
		// Continue with friends only - UI can still show the roster.
		presences = localPresencesResponse{}
	}

	return buildLocalSocialResponse(friends, presences, "local"), nil
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
		if p.Puuid != "" {
			presencesByPuuid[p.Puuid] = p
		}
	}

	out := make([]SocialPresence, 0, len(friends.Friends))
	onlineCount := 0
	inGameCount := 0
	for _, f := range friends.Friends {
		if f.PUUID == "" {
			continue
		}
		presence, ok := presencesByPuuid[f.PUUID]
		if !ok {
			// No presence means the friend is offline.
			out = append(out, SocialPresence{
				Puuid: f.PUUID,
				Name:  friendDisplayName(f.GameName, f.GameTag, f.PUUID),
				State: "offline",
			})
			continue
		}
		if productIsActive(presence.Product) {
			onlineCount++
			if strings.EqualFold(presence.Product, "valorant") {
				inGameCount++
			}
		}
		out = append(out, normalizeChatPresence(presence, map[string]string{
			f.PUUID: friendDisplayName(f.GameName, f.GameTag, f.PUUID),
		}))
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
		Puuid:   entry.Puuid,
		Product: entry.Product,
		Name:    resolvePresenceName(entry, nameByPuuid),
	}
	if rawPrivate := entry.Private; rawPrivate != "" {
		if decoded, err := base64.StdEncoding.DecodeString(rawPrivate); err == nil {
			var private map[string]any
			if json.Unmarshal(decoded, &private) == nil {
				p.State = firstString(private, "sessionLoopState", "SessionLoopState")
				p.QueueID = firstString(private, "queueId", "QueueID")
				p.CardID = firstString(private, "playerCardId", "PlayerCardID")
				if mpd, ok := private["matchPresenceData"].(map[string]any); ok {
					p.State = firstNonEmpty(firstString(mpd, "sessionLoopState", "SessionLoopState"), p.State)
					p.QueueID = firstNonEmpty(firstString(mpd, "queueId", "QueueID"), p.QueueID)
					p.CardID = firstNonEmpty(firstString(mpd, "playerCardId", "PlayerCardID"), p.CardID)
				}
			}
		}
	}
	if p.State == "" && p.Product != "" {
		p.State = "online"
	}
	return p
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

func productIsActive(product string) bool {
	switch strings.ToLower(product) {
	case "valorant", "league_of_legends", "riotclient", "product":
		return true
	default:
		return product != ""
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
