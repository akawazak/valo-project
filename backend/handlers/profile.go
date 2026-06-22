package handlers

// profile.go — implements the 8 /v1/profile/* endpoints described in
// valovault/.mavis/plans/tracking-design.md §2.
//
// All endpoints share the same remote-auth headers used by
// /v1/storefront and /v1/career/mmr
// (X-Riot-Access-Token, X-Riot-Entitlements-JWT, X-Riot-Puuid,
// X-Riot-Region). The puuid may be passed in the request headers OR
// in the ?puuid= query / JSON body — the header value takes
// precedence. 400 if no puuid is supplied.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend/tracking"
)

// profilePuuid extracts the puuid from the request, preferring the
// ?puuid= query parameter over the X-Riot-Puuid header. Returns "" if
// neither is set.
func profilePuuid(r *http.Request) string {
	if v := strings.TrimSpace(r.URL.Query().Get("puuid")); v != "" {
		return strings.ToLower(v)
	}
	if v := strings.TrimSpace(r.Header.Get("X-Riot-Puuid")); v != "" {
		return strings.ToLower(v)
	}
	return ""
}

// profileRegion extracts the region from the request, preferring the
// ?region= query parameter over the X-Riot-Region header. Defaults to
// "na" if neither is set.
func profileRegion(r *http.Request) string {
	if v := strings.TrimSpace(r.URL.Query().Get("region")); v != "" {
		return v
	}
	if v := strings.TrimSpace(r.Header.Get("X-Riot-Region")); v != "" {
		return v
	}
	return "na"
}

// requireProfileAuth returns (puuid, region, ok). If ok is false the
// handler has already written a 400 response. We require the puuid
// (per design doc §2) but tolerate a missing region (default "na").
func (h *Handler) requireProfileAuth(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	puuid := profilePuuid(r)
	if puuid == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":   "missing_puuid",
			"message": "X-Riot-Puuid header or ?puuid= query parameter is required",
		})
		return "", "", false
	}
	return puuid, profileRegion(r), true
}

// GetProfileOverview — `GET /v1/profile/overview` (design doc §2.1).
// Returns current rank, RR, peak, level, last 5 RR deltas, and
// season summary.
func (h *Handler) GetProfileOverview(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}

	overview, err := tracking.GetOverview(db, puuid)
	if err != nil {
		h.returnError(w, err)
		return
	}
	h.applyLiveMMRToOverview(r, overview, puuid)
	overview.Puuid = puuid
	overview.Region = region
	h.returnAny(w, overview)
}

func (h *Handler) applyLiveMMRToOverview(r *http.Request, overview *tracking.Overview, puuid string) {
	val, err := h.getClient(r)
	if err != nil || val == nil || val.Player == nil {
		return
	}
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, puuid)
	var live struct {
		LatestCompetitiveUpdate struct {
			SeasonID                string `json:"SeasonID"`
			TierAfterUpdate         int    `json:"TierAfterUpdate"`
			RankedRatingAfterUpdate int    `json:"RankedRatingAfterUpdate"`
		} `json:"LatestCompetitiveUpdate"`
		QueueSkills map[string]struct {
			TotalGamesWon            int `json:"TotalGamesWon"`
			RankedRating             int `json:"RankedRating"`
			CurrentSeasonGamesPlayed int `json:"CurrentSeasonGamesPlayed"`
			SeasonalInfoBySeasonID   map[string]struct {
				TotalWins        int `json:"TotalWins"`
				NumberOfGames    int `json:"NumberOfGames"`
				RankedRating     int `json:"RankedRating"`
				RankedRatingPeak int `json:"RankedRatingPeak"`
				PeakRank         int `json:"PeakRank"`
				FinalRank        int `json:"FinalRank"`
			} `json:"SeasonalInfoBySeasonID"`
		} `json:"QueueSkills"`
	}
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &live); err != nil {
		return
	}

	// 1. Process the latest competitive update first (regardless of current act queue skills)
	if live.LatestCompetitiveUpdate.SeasonID != "" {
		overview.CurrentSeasonID = live.LatestCompetitiveUpdate.SeasonID
	}
	if live.LatestCompetitiveUpdate.TierAfterUpdate > 0 {
		overview.CurrentRank.CompetitiveTier = live.LatestCompetitiveUpdate.TierAfterUpdate
		overview.CurrentRank.RankedRating = live.LatestCompetitiveUpdate.RankedRatingAfterUpdate
	}

	// 2. Set static tier name fallbacks if needed, using last known tier
	if overview.CurrentRank.CompetitiveTier > 0 {
		if overview.CurrentRank.TierName == "" || strings.EqualFold(overview.CurrentRank.TierName, "unranked") {
			overview.CurrentRank.TierName = fmt.Sprintf("Tier %d", overview.CurrentRank.CompetitiveTier)
		}
	}
	if overview.PeakRank.CompetitiveTier > 0 && overview.PeakRank.TierName == "" {
		overview.PeakRank.TierName = fmt.Sprintf("Tier %d", overview.PeakRank.CompetitiveTier)
	}

	// 3. Fallback early if no competitive queue skills are found in current act
	comp, ok := live.QueueSkills["competitive"]
	if !ok {
		return
	}

	// 4. Overwrite/merge with specific current-act queue statistics
	if comp.RankedRating > 0 {
		overview.CurrentRank.RankedRating = comp.RankedRating
	}
	if comp.TotalGamesWon > 0 {
		overview.CurrentRank.NumberOfWins = comp.TotalGamesWon
	}
	if comp.CurrentSeasonGamesPlayed > 0 {
		overview.CurrentRank.NumberOfGames = comp.CurrentSeasonGamesPlayed
	}

	seasonID := overview.CurrentSeasonID
	if seasonID == "" && len(comp.SeasonalInfoBySeasonID) == 1 {
		for id := range comp.SeasonalInfoBySeasonID {
			seasonID = id
		}
	}
	if season, ok := comp.SeasonalInfoBySeasonID[seasonID]; ok {
		if season.NumberOfGames > 0 {
			overview.CurrentRank.NumberOfGames = season.NumberOfGames
		}
		if season.TotalWins > 0 {
			overview.CurrentRank.NumberOfWins = season.TotalWins
		}
		if season.RankedRating > 0 {
			overview.CurrentRank.RankedRating = season.RankedRating
		}
		// Keep the cached non-zero RR if the seasonal payload reports 0
		// (e.g. just-reset episode). Never overwrite a real value with 0.
		if overview.CurrentRank.CompetitiveTier == 0 && season.FinalRank > 0 {
			overview.CurrentRank.CompetitiveTier = season.FinalRank
		}
		if season.PeakRank > overview.PeakRank.CompetitiveTier {
			overview.PeakRank.CompetitiveTier = season.PeakRank
			overview.PeakRank.SeasonID = seasonID
		}
	}

	// Refresh fallback tier names again after seasonal update
	if overview.CurrentRank.CompetitiveTier > 0 {
		if overview.CurrentRank.TierName == "" || strings.EqualFold(overview.CurrentRank.TierName, "unranked") {
			overview.CurrentRank.TierName = fmt.Sprintf("Tier %d", overview.CurrentRank.CompetitiveTier)
		}
	}
	if overview.PeakRank.CompetitiveTier > 0 && overview.PeakRank.TierName == "" {
		overview.PeakRank.TierName = fmt.Sprintf("Tier %d", overview.PeakRank.CompetitiveTier)
	}

	acts := make([]tracking.RankActSummary, 0, len(comp.SeasonalInfoBySeasonID))
	for id, season := range comp.SeasonalInfoBySeasonID {
		acts = append(acts, tracking.RankActSummary{
			SeasonID:     id,
			Wins:         season.TotalWins,
			Games:        season.NumberOfGames,
			RankedRating: season.RankedRating,
			PeakRank:     season.PeakRank,
			FinalRank:    season.FinalRank,
		})
	}
	sort.SliceStable(acts, func(i, j int) bool {
		if acts[i].SeasonID == seasonID {
			return true
		}
		if acts[j].SeasonID == seasonID {
			return false
		}
		return acts[i].SeasonID > acts[j].SeasonID
	})
	if len(acts) > 8 {
		acts = acts[:8]
	}
	overview.RankActs = acts
}

// GetRRHistory — `GET /v1/profile/rr-history` (design doc §2.2).
// Returns the full RR snapshot series for the line graph.
func (h *Handler) GetRRHistory(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}
	seasonID := strings.TrimSpace(r.URL.Query().Get("seasonId"))

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	snaps, err := tracking.GetRRSnapshots(db, puuid, seasonID)
	if err != nil {
		h.returnError(w, err)
		return
	}

	type rrHistoryResponse struct {
		Puuid     string                `json:"puuid"`
		Region    string                `json:"region"`
		SeasonID  string                `json:"seasonId"`
		Snapshots []tracking.RRSnapshot `json:"snapshots"`
	}
	h.returnAny(w, &rrHistoryResponse{
		Puuid:     puuid,
		Region:    region,
		SeasonID:  seasonID,
		Snapshots: snaps,
	})
}

// GetAgentStats — `GET /v1/profile/agent-stats` (design doc §2.3).
// Returns per-agent rows sorted by matches desc.
func (h *Handler) GetAgentStats(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}
	queue := strings.TrimSpace(r.URL.Query().Get("queue"))
	if queue == "" {
		queue = "all"
	}

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	stats, err := tracking.GetAgentStats(db, puuid, queue)
	if err != nil {
		h.returnError(w, err)
		return
	}

	type agentStatsResponse struct {
		Puuid  string               `json:"puuid"`
		Region string               `json:"region"`
		Queue  string               `json:"queue"`
		Agents []tracking.AgentStat `json:"agents"`
	}
	h.returnAny(w, &agentStatsResponse{
		Puuid:  puuid,
		Region: region,
		Queue:  queue,
		Agents: stats,
	})
}

// GetMapStats — `GET /v1/profile/map-stats` (design doc §2.4).
func (h *Handler) GetMapStats(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}
	queue := strings.TrimSpace(r.URL.Query().Get("queue"))
	if queue == "" {
		queue = "all"
	}

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	stats, err := tracking.GetMapStats(db, puuid, queue)
	if err != nil {
		h.returnError(w, err)
		return
	}

	type mapStatsResponse struct {
		Puuid  string             `json:"puuid"`
		Region string             `json:"region"`
		Queue  string             `json:"queue"`
		Maps   []tracking.MapStat `json:"maps"`
	}
	h.returnAny(w, &mapStatsResponse{
		Puuid:  puuid,
		Region: region,
		Queue:  queue,
		Maps:   stats,
	})
}

// countCachedMatches returns the total row count in `match_players` for the
// given puuid. Used to populate the `total` field of the
// match-history response. Matches db.go's `subject` index.
func countCachedMatches(db *sql.DB, puuid string) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM match_players WHERE subject = ?`, strings.ToLower(puuid)).Scan(&n)
	return n, err
}

// GetProfileMatchHistory — `GET /v1/profile/match-history`
// (design doc §2.5). Sourced from local cache only.
func (h *Handler) GetProfileMatchHistory(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}

	startIndex := 0
	if v := r.URL.Query().Get("startIndex"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			startIndex = n
		}
	}
	endIndex := 20
	if v := r.URL.Query().Get("endIndex"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > startIndex {
			endIndex = n
		}
	}
	queue := strings.TrimSpace(r.URL.Query().Get("queue"))

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	matches, err := tracking.ListCachedMatches(db, puuid, queue, startIndex, endIndex)
	if err != nil {
		h.returnError(w, err)
		return
	}
	total, err := countCachedMatches(db, puuid)
	if err != nil {
		h.returnError(w, err)
		return
	}

	type matchHistoryResponse struct {
		Puuid      string                  `json:"puuid"`
		Region     string                  `json:"region"`
		StartIndex int                     `json:"startIndex"`
		EndIndex   int                     `json:"endIndex"`
		Total      int                     `json:"total"`
		Queue      string                  `json:"queue"`
		Matches    []tracking.MatchSummary `json:"matches"`
	}
	h.returnAny(w, &matchHistoryResponse{
		Puuid:      puuid,
		Region:     region,
		StartIndex: startIndex,
		EndIndex:   endIndex,
		Total:      total,
		Queue:      queue,
		Matches:    matches,
	})
}

// buildMatchDetails converts a cached MatchCache into the
// API-shaped MatchDetails response, including per-row derived stats
// (KD/KDA/ADR/ACS/HS%) and the servedFrom tag.
func buildMatchDetails(cache *tracking.MatchCache) *tracking.MatchDetails {
	out := &tracking.MatchDetails{
		MatchID: cache.Match.MatchID,
		MatchInfo: tracking.MatchInfo{
			MatchID:          cache.Match.MatchID,
			MapID:            cache.Match.MapID,
			GameStartMillis:  cache.Match.GameStartMillis,
			GameLengthMillis: cache.Match.GameLengthMillis,
			IsRanked:         cache.Match.IsRanked == 1,
			QueueID:          cache.Match.QueueID,
			GameMode:         cache.Match.GameMode,
			SeasonID:         cache.Match.SeasonID,
			CompletionState:  cache.Match.CompletionState,
			BlueRoundsWon:    cache.Match.BlueRoundsWon,
			RedRoundsWon:     cache.Match.RedRoundsWon,
			BlueWins:         cache.Match.BlueWins == 1,
		},
		Players:    make([]tracking.PlayerStats, 0, len(cache.Players)),
		ServedFrom: "cache",
	}
	for _, p := range cache.Players {
		ps := tracking.PlayerStats{
			Subject:      p.Subject,
			TeamID:       p.TeamID,
			GameName:     p.GameName,
			TagLine:      p.TagLine,
			CharacterID:  p.CharacterID,
			Kills:        p.Kills,
			Deaths:       p.Deaths,
			Assists:      p.Assists,
			Score:        p.Score,
			Headshots:    p.Headshots,
			Bodyshots:    p.Bodyshots,
			Legshots:     p.Legshots,
			DamageDealt:  p.DamageDealt,
			RoundsPlayed: p.RoundsPlayed,
			IsLocal:         p.IsLocal,
			CompetitiveTier: p.CompetitiveTier,
		}
		if ps.RoundsPlayed < 1 {
			ps.RoundsPlayed = 1
		}
		if ps.Kills < 0 {
			ps.Kills = 0
		}
		ps.ADR = round1(float64(ps.DamageDealt) / float64(ps.RoundsPlayed))
		ps.ACS = round1(float64(ps.Score) / float64(ps.RoundsPlayed))
		ps.HSPct = round1(float64(ps.Headshots) / float64(maxInt(ps.Kills, 1)) * 100.0)
		ps.KD = ratio(ps.Kills, ps.Deaths)
		ps.KDA = ratio(ps.Kills+ps.Assists, ps.Deaths)
		out.Players = append(out.Players, ps)
	}
	return out
}

// GetProfileMatchDetails — `GET /v1/profile/match-details/:matchID`
// (design doc §2.6). Returns full match details (from cache, or
// one-shot live fetch + cache).
func (h *Handler) GetProfileMatchDetails(w http.ResponseWriter, r *http.Request) {
	puuid, _, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}

	// ServeMux registers a prefix "/v1/profile/match-details/";
	// the remainder of the path is the match ID.
	const matchPrefix = "/v1/profile/match-details/"
	matchID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, matchPrefix))
	if matchID == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":   "missing_match_id",
			"message": "matchID path segment is required",
		})
		return
	}
	if decoded, err := url.PathUnescape(matchID); err == nil {
		matchID = decoded
	}

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	cache, err := tracking.GetMatchFromCache(db, matchID, puuid)
	if err != nil {
		h.returnError(w, err)
		return
	}
	if cache == nil {
		// Cache miss: surface a clean 404 JSON instead of an empty
		// 200 so the frontend can render the "no data" state.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":   "not_found",
			"message": "match not in cache; run a sync first",
		})
		return
	}
	h.returnAny(w, buildMatchDetails(cache))
}

// PostProfileSync — `POST /v1/profile/sync` (design doc §2.7).
// Triggers a background sync of new matches from Riot into the local
// DB. Returns 200 {"started": true} on success, 202
// {"started": false, "inFlight": true} when a sync is already in
// flight, and supports `?force=true` to bypass the in-flight check.
func (h *Handler) PostProfileSync(w http.ResponseWriter, r *http.Request) {
	puuid, region, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}
	force := strings.EqualFold(r.URL.Query().Get("force"), "true")

	if !force && h.isSyncInFlight(puuid) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"started":  false,
			"inFlight": true,
		})
		return
	}

	// Mark in-flight BEFORE calling Start so a rapid double-click
	// can't slip past the check. force=true re-arms the flag.
	if !force {
		if !h.markSyncInFlight(puuid) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"started":  false,
				"inFlight": true,
			})
			return
		}
	} else {
		// Re-arm: clear the existing flag (if any) and mark fresh.
		h.unmarkSyncInFlight(puuid)
		h.markSyncInFlight(puuid)
	}

	sm, err := h.trackingSyncManagerForRequest(r)
	if err != nil {
		h.unmarkSyncInFlight(puuid)
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	sm.SetDoneCallback(func(donePuuid string, runErr error) {
		h.setSyncLastError(donePuuid, runErr)
		h.unmarkSyncInFlight(donePuuid)
	})
	started, err := sm.Start(puuid, region)
	if err != nil {
		h.unmarkSyncInFlight(puuid)
		h.returnError(w, err)
		return
	}
	if !started {
		h.unmarkSyncInFlight(puuid)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"started":  false,
			"inFlight": true,
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"started":   true,
		"startedAt": time.Now().UnixMilli(),
	})
}

// GetProfileSyncStatus — `GET /v1/profile/sync-status`
// (design doc §2.8). Returns lastSyncedAt, inFlight, totalMatches.
func (h *Handler) GetProfileSyncStatus(w http.ResponseWriter, r *http.Request) {
	puuid, _, ok := h.requireProfileAuth(w, r)
	if !ok {
		return
	}

	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, fmt.Errorf("open tracking DB: %w", err))
		return
	}
	state, err := tracking.GetSyncState(db, puuid)
	if err != nil {
		h.returnError(w, err)
		return
	}
	total, err := countCachedMatches(db, puuid)
	if err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, &tracking.SyncStatus{
		Puuid:        puuid,
		LastSyncedAt: state.LastSyncedAt,
		InFlight:     h.isSyncInFlight(puuid),
		TotalMatches: total,
		LastError:    h.syncLastErrorFor(puuid),
	})
}

// --- small numeric helpers (mirror db.go so profile.go can compute
// derived stats without importing db.go's unexported helpers) ---

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func ratio(num, denom int) float64 {
	d := denom
	if d <= 0 {
		d = 1
	}
	r := float64(num) / float64(d)
	return float64(int(r*100+0.5)) / 100
}
