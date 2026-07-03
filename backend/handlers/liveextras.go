package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/truearken/valclient/valclient"
)

type LiveLoadoutsResponse struct {
	Phase         string              `json:"phase"`
	MatchID       string              `json:"matchId,omitempty"`
	Source        string              `json:"source,omitempty"`
	LoadoutsValid *bool               `json:"loadoutsValid,omitempty"`
	Players       []LiveLoadoutPlayer `json:"players,omitempty"`
	Error         string              `json:"error,omitempty"`
}

type LiveLoadoutPlayer struct {
	Puuid    string   `json:"puuid,omitempty"`
	SkinIDs  []string `json:"skinIds,omitempty"`
	GunCount int      `json:"gunCount"`
}

type AccountHealthResponse struct {
	Source    string                  `json:"source,omitempty"`
	Services  map[string]ServiceProbe `json:"services"`
	Penalties PenaltiesProbe          `json:"penalties"`
	Error     string                  `json:"error,omitempty"`
}

type ServiceProbe struct {
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type PenaltiesProbe struct {
	Status string `json:"status"`
	Count  int    `json:"count"`
	Detail string `json:"detail,omitempty"`
}

type SocialStatusResponse struct {
	Status         string           `json:"status"`
	Source         string           `json:"source,omitempty"`
	RemoteStatus   string           `json:"remoteStatus,omitempty"`
	RemoteChatHost string           `json:"remoteChatHost,omitempty"`
	RemoteChatPort int              `json:"remoteChatPort,omitempty"`
	FriendCount    int              `json:"friendCount"`
	OnlineCount    int              `json:"onlineCount"`
	InGameCount    int              `json:"inGameCount"`
	Presences      []SocialPresence `json:"presences,omitempty"`
	Error          string           `json:"error,omitempty"`
}

type SocialPresence struct {
	Puuid    string `json:"puuid,omitempty"`
	Name     string `json:"name,omitempty"`
	Product  string `json:"product,omitempty"`
	State    string `json:"state,omitempty"`
	QueueID  string `json:"queueId,omitempty"`
	CardID   string `json:"cardId,omitempty"`
	Platform string `json:"platform,omitempty"`
}

func (h *Handler) GetLiveLoadouts(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getPartyClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveLoadoutsResponse{Phase: "error", Error: errString(err)})
		return
	}
	if phase, matchID := r.URL.Query().Get("phase"), r.URL.Query().Get("matchId"); matchID != "" && (phase == "pregame" || phase == "coregame") {
		h.returnAny(w, h.fetchLiveLoadouts(val, phase, matchID, source))
		return
	}

	prePlayer, preErr := val.GetPreGamePlayer()
	if preErr == nil && prePlayer != nil {
		preMatch, err := val.GetPreGameMatch()
		if err == nil && preMatch != nil && preMatch.ID != "" {
			resp := h.fetchLiveLoadouts(val, "pregame", preMatch.ID, source)
			h.returnAny(w, resp)
			return
		}
	}

	corePlayer, coreErr := getCoreGamePlayer(val)
	if coreErr == nil && corePlayer != nil && corePlayer.MatchID != "" {
		resp := h.fetchLiveLoadouts(val, "coregame", corePlayer.MatchID, source)
		h.returnAny(w, resp)
		return
	}

	h.returnAny(w, LiveLoadoutsResponse{
		Phase:  "none",
		Source: source,
		Error:  fmt.Sprintf("pregame: %s; coregame: %s", errString(preErr), errString(coreErr)),
	})
}

func (h *Handler) fetchLiveLoadouts(val *valclient.ValClient, phase, matchID, source string) LiveLoadoutsResponse {
	endpoint := "pregame/v1"
	if phase == "coregame" {
		endpoint = "core-game/v1"
	}
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/{endpoint}/matches/{matchId}/loadouts", "{endpoint}", endpoint, "{matchId}", matchID)
	var raw map[string]any
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &raw); err != nil {
		return LiveLoadoutsResponse{Phase: "error", MatchID: matchID, Source: source, Error: err.Error()}
	}
	valid := boolFromAny(raw["LoadoutsValid"])
	if valid == nil {
		valid = boolFromAny(raw["loadoutsValid"])
	}
	return LiveLoadoutsResponse{
		Phase:         phase,
		MatchID:       matchID,
		Source:        source,
		LoadoutsValid: valid,
		Players:       normalizeLoadoutPlayers(raw),
	}
}

func normalizeLoadoutPlayers(raw map[string]any) []LiveLoadoutPlayer {
	var entries []any
	if arr, ok := raw["Loadouts"].([]any); ok {
		entries = arr
	} else if arr, ok := raw["loadouts"].([]any); ok {
		entries = arr
	}
	players := make([]LiveLoadoutPlayer, 0, len(entries))
	for _, entry := range entries {
		m, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		loadout, _ := m["Loadout"].(map[string]any)
		if loadout == nil {
			loadout, _ = m["loadout"].(map[string]any)
		}
		if loadout == nil {
			loadout = m
		}
		items := firstMap(loadout, "Items", "items")
		skins := uniqueStrings(collectStringFields(items, "ID"))
		puuid := firstString(loadout, "Subject", "subject")
		if puuid == "" {
			puuid = firstString(m, "Subject", "subject")
		}
		players = append(players, LiveLoadoutPlayer{
			Puuid:    puuid,
			SkinIDs:  skins,
			GunCount: len(items),
		})
	}
	return players
}

func (h *Handler) GetAccountHealth(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getPartyClient(r)
	if err != nil || val == nil {
		h.returnAny(w, AccountHealthResponse{
			Services:  map[string]ServiceProbe{},
			Penalties: PenaltiesProbe{Status: "unavailable", Detail: errString(err)},
			Error:     errString(err),
		})
		return
	}

	resp := AccountHealthResponse{
		Source:    source,
		Services:  map[string]ServiceProbe{},
		Penalties: h.fetchPenalties(val),
	}

	config, err := val.GetConfig()
	if err != nil {
		resp.Services["config"] = ServiceProbe{Status: "unavailable", Detail: err.Error()}
		h.returnAny(w, resp)
		return
	}

	flags := config.Collapsed
	resp.Services["config"] = ServiceProbe{Status: "ok", Detail: "Riot config loaded"}
	resp.Services["friends"] = probeFromFlag(flags.FriendsEnabled, "Friends enabled")
	resp.Services["party"] = probeFromFlag(flags.PartyInvitesEnabled, "Party invites enabled")
	resp.Services["store"] = probeFromFlag(flags.MainMenuBarStoreEnabled, "Store enabled")
	resp.Services["matchmaking"] = probeFromFlag(flags.QueueStatusEnabled, "Queue status enabled")
	resp.Services["restrictions"] = probeFromFlag(flags.RestrictionsV2FetchEnabled, "Restrictions v2 enabled")
	if flags.ServiceTickerMessage != "" {
		resp.Services["ticker"] = ServiceProbe{Status: strings.ToLower(flags.ServiceTickerSeverity), Detail: flags.ServiceTickerMessage}
	} else {
		resp.Services["ticker"] = ServiceProbe{Status: "ok", Detail: "No active Riot ticker message"}
	}
	if flags.PlatformFaultedLevel != "" && flags.PlatformFaultedLevel != "0" {
		resp.Services["platform"] = ServiceProbe{Status: "warn", Detail: "Platform fault level " + flags.PlatformFaultedLevel}
	} else {
		resp.Services["platform"] = ServiceProbe{Status: "ok", Detail: "No platform fault flag"}
	}
	h.returnAny(w, resp)
}

func (h *Handler) fetchPenalties(val *valclient.ValClient) PenaltiesProbe {
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/restrictions/v3/penalties", val.Shard)
	var raw map[string]any
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &raw); err != nil {
		return PenaltiesProbe{Status: "unavailable", Detail: err.Error()}
	}
	count := countPenaltyEntries(raw)
	if count == 0 {
		return PenaltiesProbe{Status: "clear", Detail: "No active penalties"}
	}
	return PenaltiesProbe{Status: "warn", Count: count, Detail: fmt.Sprintf("%d active penalty records", count)}
}

func normalizePresences(raw map[string]any) []SocialPresence {
	var entries []any
	if arr, ok := raw["presences"].([]any); ok {
		entries = arr
	} else if arr, ok := raw["Presences"].([]any); ok {
		entries = arr
	}
	out := make([]SocialPresence, 0, min(len(entries), 12))
	for _, entry := range entries {
		m, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		p := SocialPresence{
			Puuid:   firstString(m, "puuid", "PUUID", "Puuid"),
			Name:    displayNameFromPresence(m),
			Product: firstString(m, "product", "Product"),
		}
		if rawPrivate := firstString(m, "private", "Private"); rawPrivate != "" {
			if decoded, err := base64.StdEncoding.DecodeString(rawPrivate); err == nil {
				var private map[string]any
				if json.Unmarshal(decoded, &private) == nil {
					if mpd, ok := private["matchPresenceData"].(map[string]any); ok {
						p.State = firstString(mpd, "sessionLoopState", "SessionLoopState")
						p.QueueID = firstString(mpd, "queueId", "QueueID")
						p.CardID = firstString(mpd, "playerCardId", "PlayerCardID")
					}
					if p.CardID == "" {
						p.CardID = firstString(private, "playerCardId", "PlayerCardID")
					}
				}
			}
		}
		out = append(out, p)
		if len(out) >= 12 {
			break
		}
	}
	return out
}

func displayNameFromPresence(m map[string]any) string {
	gameName := firstString(m, "game_name", "gameName", "GameName")
	tag := firstString(m, "game_tag", "gameTag", "TagLine")
	if gameName != "" && tag != "" {
		return gameName + "#" + tag
	}
	return firstString(m, "name", "displayName", "DisplayName")
}

func probeFromFlag(flag, detail string) ServiceProbe {
	switch strings.ToLower(flag) {
	case "true", "1", "enabled":
		return ServiceProbe{Status: "ok", Detail: detail}
	case "":
		return ServiceProbe{Status: "unknown", Detail: "Riot did not return this flag"}
	default:
		return ServiceProbe{Status: "warn", Detail: detail + " is " + flag}
	}
}

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
	}
	return ""
}

func boolFromAny(v any) *bool {
	if b, ok := v.(bool); ok {
		return &b
	}
	return nil
}

func firstMap(m map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if value, ok := m[key].(map[string]any); ok {
			return value
		}
	}
	return nil
}

func collectStringFields(v any, keys ...string) []string {
	wanted := map[string]struct{}{}
	for _, key := range keys {
		wanted[strings.ToLower(key)] = struct{}{}
	}
	var out []string
	var walk func(any)
	walk = func(x any) {
		switch typed := x.(type) {
		case map[string]any:
			for k, v := range typed {
				if _, ok := wanted[strings.ToLower(k)]; ok {
					if s, ok := v.(string); ok && s != "" {
						out = append(out, s)
					}
				}
				walk(v)
			}
		case []any:
			for _, item := range typed {
				walk(item)
			}
		}
	}
	walk(v)
	return out
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return out
}

func countPenaltyEntries(raw map[string]any) int {
	for _, key := range []string{"Penalties", "penalties", "Restrictions", "restrictions"} {
		if arr, ok := raw[key].([]any); ok {
			return len(arr)
		}
	}
	return 0
}
