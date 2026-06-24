package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/truearken/valclient/valclient"
	"golang.org/x/sync/errgroup"
)

// GetLivePlayerStats — `GET /v1/live/player-stats?puuid=<puuid>&agent=<agentUuid>`.
//
// Returns the player's last-N-match record on the chosen agent
// (matches, wins, winrate, kd, kda). Used by the live match overlay
// to render a one-line stat under each player's chosen agent.
//
// Heavy path (first call per puuid+agent):
//   1. GET /match-history/v1/history/{puuid}?startIndex=0&endIndex=10
//   2. For each returned match, GET /match-details/v1/matches/{id}
//      (parallel, capped at 5 concurrent).
//   3. For each detail, find the row matching puuid, check the
//      characterId == agent (case-insensitive), and count wins by
//      comparing the player's TeamID to the winning team.
//
// Result is cached in-memory by `<puuid>:<agentLower>` for the
// lifetime of the process. Failures are also cached as a
// zero-value with Loaded=false so we don't hammer Riot when the
// profile is private or the auth context lacks access.
func (h *Handler) GetLivePlayerStats(w http.ResponseWriter, r *http.Request) {
	puuid := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("puuid")))
	agent := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("agent")))
	if puuid == "" || agent == "" {
		h.returnError(w, fmt.Errorf("missing puuid or agent query parameter"))
		return
	}

	cacheKey := puuid + ":" + agent
	if cached, ok := h.lookupPlayerStats(cacheKey); ok {
		h.returnAny(w, cached)
		return
	}

	val, _, err := h.getLiveMatchClient(r)
	stats := CachedPlayerStats{Loaded: false}
	if err == nil && val != nil {
		stats = computeAgentStats(val, puuid, agent)
	}
	h.storePlayerStats(cacheKey, stats)
	h.returnAny(w, stats)
}

func (h *Handler) lookupPlayerStats(key string) (CachedPlayerStats, bool) {
	h.playerStatsMu.RLock()
	defer h.playerStatsMu.RUnlock()
	v, ok := h.playerStatsCache[key]
	return v, ok
}

func (h *Handler) storePlayerStats(key string, v CachedPlayerStats) {
	h.playerStatsMu.Lock()
	defer h.playerStatsMu.Unlock()
	h.playerStatsCache[key] = v
}

// computeAgentStats runs the match-history + match-details pipeline
// and returns aggregate stats for (puuid, agent). Errors are swallowed
// into a Loaded=false result so the frontend can degrade gracefully.
func computeAgentStats(val *valclient.ValClient, puuid, agent string) CachedPlayerStats {
	if val == nil || val.Shard == "" {
		return CachedPlayerStats{Loaded: false}
	}

	// 1. Pull recent match IDs.
	historyURL := fmt.Sprintf(
		"https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=0&endIndex=10",
		val.Shard, puuid,
	)
	var histResp struct {
		History []struct {
			MatchID string `json:"MatchID"`
		} `json:"History"`
	}
	if err := runRiotJSON(http.MethodGet, historyURL, val.Header, nil, &histResp); err != nil {
		return CachedPlayerStats{Loaded: false}
	}
	if len(histResp.History) == 0 {
		// Empty history is a legitimate "no data" state, not an error.
		return CachedPlayerStats{Loaded: true}
	}

	// 2. Fetch each match's details in parallel (cap 5 concurrent).
	type detailResult struct {
		raw json.RawMessage
	}
	results := make([]detailResult, len(histResp.History))
	var mu sync.Mutex
	var eg errgroup.Group
	eg.SetLimit(5)
	for i, h := range histResp.History {
		i, id := i, h.MatchID
		eg.Go(func() error {
			if id == "" {
				return nil
			}
			apiURL := fmt.Sprintf(
				"https://pd.%s.a.pvp.net/match-details/v1/matches/%s",
				val.Shard, id,
			)
			var raw json.RawMessage
			if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &raw); err != nil {
				return nil // skip failures silently
			}
			mu.Lock()
			results[i] = detailResult{raw: raw}
			mu.Unlock()
			return nil
		})
	}
	_ = eg.Wait()

	// 3. Tally stats for the (puuid, agent) pair.
	var matches, wins, kills, deaths, assists int
	for _, r := range results {
		if len(r.raw) == 0 {
			continue
		}
		var parsed struct {
			Players []struct {
				Subject     string `json:"subject"`
				CharacterID string `json:"characterId"`
				TeamID      string `json:"teamId"`
				Stats       struct {
					Kills   int `json:"kills"`
					Deaths  int `json:"deaths"`
					Assists int `json:"assists"`
				} `json:"stats"`
			} `json:"players"`
			Teams []struct {
				TeamID    string `json:"teamId"`
				Won       bool   `json:"won"`
				RoundsWon int    `json:"roundsWon"`
				RoundsLost int   `json:"roundsLost"`
			} `json:"teams"`
		}
		if err := json.Unmarshal(r.raw, &parsed); err != nil {
			continue
		}
		// Find this player.
		var me *struct {
			Subject     string `json:"subject"`
			CharacterID string `json:"characterId"`
			TeamID      string `json:"teamId"`
			Stats       struct {
				Kills   int `json:"kills"`
				Deaths  int `json:"deaths"`
				Assists int `json:"assists"`
			} `json:"stats"`
		}
		for i := range parsed.Players {
			if strings.EqualFold(parsed.Players[i].Subject, puuid) {
				me = &parsed.Players[i]
				break
			}
		}
		if me == nil {
			continue
		}
		if !strings.EqualFold(me.CharacterID, agent) {
			continue
		}
		// Player was on this agent this match.
		matches++
		kills += me.Stats.Kills
		deaths += me.Stats.Deaths
		assists += me.Stats.Assists

		// Did this player's team win?
		for _, t := range parsed.Teams {
			if strings.EqualFold(t.TeamID, me.TeamID) {
				// Prefer explicit `won`; fall back to rounds comparison.
				if t.Won {
					wins++
				} else if t.RoundsWon > t.RoundsLost && (t.RoundsWon+t.RoundsLost) > 0 {
					wins++
				}
				break
			}
		}
	}

	if matches == 0 {
		return CachedPlayerStats{Loaded: true}
	}

	return CachedPlayerStats{
		Matches: matches,
		Wins:    wins,
		Winrate: statsPct(wins, matches),
		KD:      statsRatio(kills, deaths),
		KDA:     statsRatio(kills+assists, deaths),
		Loaded:  true,
	}
}

// statsPct and statsRatio are local copies of the helpers in
// tracking/db.go. profile.go uses lowercase versions in its own
// file; we prefix ours to avoid clashing if they ever get promoted
// to package-level.
func statsPct(num, denom int) float64 {
	if denom <= 0 {
		return 0
	}
	return float64(int(float64(num)/float64(denom)*1000+0.5)) / 10
}

func statsRatio(num, denom int) float64 {
	d := denom
	if d <= 0 {
		d = 1
	}
	r := float64(num) / float64(d)
	return float64(int(r*100+0.5)) / 100
}
