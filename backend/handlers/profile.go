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
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"backend/tracking"

	"github.com/truearken/valclient/valclient"
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
	if len(overview.RankActs) > 0 || len(overview.LastDeltas) > 0 {
		overview.RankSource = "cache"
	}
	if err := h.applyLiveMMRToOverview(r, db, overview, puuid); err != nil {
		overview.RankError = err.Error()
	} else {
		overview.RankSource = "live"
		overview.LastLiveRankRefreshedAt = time.Now().UnixMilli()
	}
	overview.Puuid = puuid
	overview.Region = region
	h.returnAny(w, overview)
}

func (h *Handler) applyLiveMMRToOverview(r *http.Request, db *sql.DB, overview *tracking.Overview, puuid string) error {
	val, err := h.getClient(r)
	if err != nil || val == nil || val.Player == nil {
		if err != nil {
			return fmt.Errorf("rank refresh unavailable: %w", err)
		}
		return fmt.Errorf("rank refresh unavailable: Riot session is missing")
	}
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, puuid)
	var live playerMMRResponse
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &live); err != nil {
		fallbackErr := hydrateCompetitiveUpdates(db, val, overview, puuid)
		if fallbackErr == nil {
			return nil
		}
		if strings.Contains(err.Error(), "status 429") || strings.Contains(fallbackErr.Error(), "status 429") {
			return fmt.Errorf("rank refresh is temporarily rate limited by Riot; cached history will remain visible")
		}
		slog.Warn("rank history refresh failed",
			"region", val.Region,
			"shard", val.Shard,
			"puuid_length", len(val.Player.Uuid),
			"player_mmr", riotFailureReason(err),
			"competitive_updates", riotFailureReason(fallbackErr))
		return fmt.Errorf("rank history unavailable: player MMR failed (%s); competitive updates failed (%s)",
			riotFailureReason(err), riotFailureReason(fallbackErr))
	}
	if _, ok := live.QueueSkills["competitive"]; !ok {
		if fallbackErr := hydrateCompetitiveUpdates(db, val, overview, puuid); fallbackErr != nil {
			slog.Warn("rank history missing from player MMR and competitive updates",
				"region", val.Region,
				"shard", val.Shard,
				"puuid_length", len(val.Player.Uuid),
				"competitive_updates", riotFailureReason(fallbackErr))
			return fmt.Errorf("rank history unavailable: Riot returned no competitive MMR data; competitive updates failed (%s)",
				riotFailureReason(fallbackErr))
		}
		return nil
	}
	mergeLiveMMR(overview, live)
	if err := tracking.CacheRankActs(db, puuid, overview.RankActs); err != nil {
		return fmt.Errorf("cache rank history: %w", err)
	}
	return nil
}

func riotFailureReason(err error) string {
	if err == nil {
		return "unknown error"
	}
	text := err.Error()
	for _, status := range []string{"401", "403", "404", "429"} {
		if strings.Contains(text, "status "+status) {
			return "HTTP " + status
		}
	}
	if strings.Contains(text, "no competitive updates") {
		return "no competitive matches returned"
	}
	return text
}

type competitiveUpdatesResponse struct {
	Matches []struct {
		MatchID                  string `json:"MatchID"`
		SeasonID                 string `json:"SeasonID"`
		MatchStartTime           int64  `json:"MatchStartTime"`
		TierAfterUpdate          int    `json:"TierAfterUpdate"`
		TierBeforeUpdate         int    `json:"TierBeforeUpdate"`
		RankedRatingAfterUpdate  int    `json:"RankedRatingAfterUpdate"`
		RankedRatingBeforeUpdate int    `json:"RankedRatingBeforeUpdate"`
		RankedRatingEarned       int    `json:"RankedRatingEarned"`
		AFKPenalty               int    `json:"AFKPenalty"`
	} `json:"Matches"`
}

func (response competitiveUpdatesResponse) snapshots(puuid string) []tracking.RRSnapshot {
	snapshots := make([]tracking.RRSnapshot, 0, len(response.Matches))
	for _, match := range response.Matches {
		if match.MatchID == "" || match.SeasonID == "" {
			continue
		}
		snapshots = append(snapshots, tracking.RRSnapshot{
			Puuid:          puuid,
			MatchID:        match.MatchID,
			SeasonID:       match.SeasonID,
			TierBefore:     match.TierBeforeUpdate,
			TierAfter:      match.TierAfterUpdate,
			RRBefore:       match.RankedRatingBeforeUpdate,
			RRAfter:        match.RankedRatingAfterUpdate,
			RREarned:       match.RankedRatingEarned,
			AFKPenalty:     match.AFKPenalty,
			MatchStartTime: match.MatchStartTime,
		})
	}
	return snapshots
}

func hydrateCompetitiveUpdates(db *sql.DB, val *valclient.ValClient, overview *tracking.Overview, puuid string) error {
	var response competitiveUpdatesResponse
	const pageSize = 20
	const maxMatches = 200
	for start := 0; start < maxMatches; start += pageSize {
		apiURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/mmr/v1/players/%s/competitiveupdates?startIndex=%d&endIndex=%d&queue=competitive",
			val.Shard,
			puuid,
			start,
			start+pageSize,
		)
		var page competitiveUpdatesResponse
		if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &page); err != nil {
			if len(response.Matches) > 0 && isCompetitiveUpdatesEnd(err) {
				break
			}
			return err
		}
		response.Matches = append(response.Matches, page.Matches...)
		if len(page.Matches) < pageSize {
			break
		}
	}
	snapshots := response.snapshots(puuid)
	if len(snapshots) == 0 {
		return fmt.Errorf("Riot returned no competitive updates")
	}
	for _, snapshot := range snapshots {
		if err := tracking.InsertRRSnapshotIfAbsent(db, snapshot); err != nil {
			return err
		}
	}

	allSnapshots, err := tracking.GetRRSnapshots(db, puuid, "")
	if err != nil {
		return err
	}
	overview.RankActs = mergeRankActs(
		tracking.RankActsFromSnapshots(allSnapshots),
		overview.RankActs,
		overview.CurrentSeasonID,
	)
	overview.LastDeltas = overview.LastDeltas[:0]
	for i := len(allSnapshots) - 1; i >= 0 && len(overview.LastDeltas) < 5; i-- {
		overview.LastDeltas = append(overview.LastDeltas, allSnapshots[i])
	}
	for _, act := range overview.RankActs {
		if act.PeakRank > overview.PeakRank.CompetitiveTier {
			overview.PeakRank.CompetitiveTier = act.PeakRank
			overview.PeakRank.SeasonID = act.SeasonID
		}
		if act.SeasonID == overview.CurrentSeasonID {
			overview.CurrentRank.CompetitiveTier = act.FinalRank
			overview.CurrentRank.RankedRating = act.RankedRating
			overview.CurrentRank.NumberOfGames = act.Games
			overview.CurrentRank.NumberOfWins = act.Wins
		}
	}
	return nil
}

func isCompetitiveUpdatesEnd(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToUpper(err.Error())
	return strings.Contains(message, "BAD_PARAMETER") ||
		strings.Contains(message, "INVALID_INDICES")
}

func mergeRankActs(preferred, fallback []tracking.RankActSummary, currentSeasonID string) []tracking.RankActSummary {
	acts := make([]tracking.RankActSummary, 0, len(preferred)+len(fallback))
	seen := make(map[string]struct{}, len(preferred)+len(fallback))
	for _, source := range [][]tracking.RankActSummary{preferred, fallback} {
		for _, act := range source {
			if act.SeasonID == "" {
				continue
			}
			if _, exists := seen[act.SeasonID]; exists {
				continue
			}
			seen[act.SeasonID] = struct{}{}
			acts = append(acts, act)
		}
	}
	sort.SliceStable(acts, func(i, j int) bool {
		if acts[i].SeasonID == currentSeasonID {
			return true
		}
		if acts[j].SeasonID == currentSeasonID {
			return false
		}
		return acts[i].SeasonID > acts[j].SeasonID
	})
	if len(acts) > 8 {
		acts = acts[:8]
	}
	return acts
}

type playerMMRResponse struct {
	LatestCompetitiveUpdate struct {
		SeasonID                string `json:"SeasonID"`
		TierAfterUpdate         int    `json:"TierAfterUpdate"`
		RankedRatingAfterUpdate int    `json:"RankedRatingAfterUpdate"`
	} `json:"LatestCompetitiveUpdate"`
	QueueSkills map[string]struct {
		SeasonalInfoBySeasonID map[string]struct {
			NumberOfWins    int            `json:"NumberOfWins"`
			NumberOfGames   int            `json:"NumberOfGames"`
			CompetitiveTier int            `json:"CompetitiveTier"`
			RankedRating    int            `json:"RankedRating"`
			WinsByTier      map[string]int `json:"WinsByTier"`
		} `json:"SeasonalInfoBySeasonID"`
	} `json:"QueueSkills"`
}

func mergeLiveMMR(overview *tracking.Overview, live playerMMRResponse) {
	if overview == nil {
		return
	}

	latest := live.LatestCompetitiveUpdate
	seasonID := overview.CurrentSeasonID
	if seasonID == "" {
		seasonID = latest.SeasonID
		overview.CurrentSeasonID = seasonID
	}
	if latest.SeasonID == seasonID && latest.TierAfterUpdate > 0 {
		overview.CurrentRank.CompetitiveTier = latest.TierAfterUpdate
		overview.CurrentRank.RankedRating = latest.RankedRatingAfterUpdate
	}

	comp, ok := live.QueueSkills["competitive"]
	if !ok {
		return
	}

	if seasonID == "" && len(comp.SeasonalInfoBySeasonID) == 1 {
		for id := range comp.SeasonalInfoBySeasonID {
			seasonID = id
			overview.CurrentSeasonID = id
		}
	}

	if season, ok := comp.SeasonalInfoBySeasonID[seasonID]; ok {
		overview.CurrentRank.NumberOfGames = season.NumberOfGames
		overview.CurrentRank.NumberOfWins = season.NumberOfWins
		overview.CurrentRank.CompetitiveTier = season.CompetitiveTier
		if season.CompetitiveTier == 0 {
			overview.CurrentRank.TierName = "Unranked"
		}
		overview.CurrentRank.RankedRating = season.RankedRating
	}

	acts := make([]tracking.RankActSummary, 0, len(comp.SeasonalInfoBySeasonID))
	for id, season := range comp.SeasonalInfoBySeasonID {
		peak := season.CompetitiveTier
		for tier, wins := range season.WinsByTier {
			parsed, err := strconv.Atoi(tier)
			if err == nil && wins > 0 && parsed > peak {
				peak = parsed
			}
		}
		if peak > overview.PeakRank.CompetitiveTier {
			overview.PeakRank.CompetitiveTier = peak
			overview.PeakRank.SeasonID = id
		}
		acts = append(acts, tracking.RankActSummary{
			SeasonID:     id,
			Wins:         season.NumberOfWins,
			Games:        season.NumberOfGames,
			RankedRating: season.RankedRating,
			PeakRank:     peak,
			FinalRank:    season.CompetitiveTier,
		})
	}
	acts = mergeRankActs(acts, overview.RankActs, seasonID)
	if len(acts) > 0 {
		overview.RankActs = acts
	}

	if overview.CurrentRank.CompetitiveTier > 0 &&
		(overview.CurrentRank.TierName == "" || strings.EqualFold(overview.CurrentRank.TierName, "unranked")) {
		overview.CurrentRank.TierName = fmt.Sprintf("Tier %d", overview.CurrentRank.CompetitiveTier)
	}
	if overview.PeakRank.CompetitiveTier > 0 && overview.PeakRank.TierName == "" {
		overview.PeakRank.TierName = fmt.Sprintf("Tier %d", overview.PeakRank.CompetitiveTier)
	}
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
	source := "rr"
	if len(snaps) == 0 {
		snaps, err = tracking.RankCheckpointsFromCachedMatches(db, puuid)
		if err != nil {
			h.returnError(w, err)
			return
		}
		if seasonID != "" {
			filtered := snaps[:0]
			for _, snapshot := range snaps {
				if snapshot.SeasonID == seasonID {
					filtered = append(filtered, snapshot)
				}
			}
			snaps = filtered
		}
		source = "tier"
	}

	type rrHistoryResponse struct {
		Puuid     string                `json:"puuid"`
		Region    string                `json:"region"`
		SeasonID  string                `json:"seasonId"`
		Source    string                `json:"source"`
		Snapshots []tracking.RRSnapshot `json:"snapshots"`
	}
	h.returnAny(w, &rrHistoryResponse{
		Puuid:     puuid,
		Region:    region,
		SeasonID:  seasonID,
		Source:    source,
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
			Subject:         p.Subject,
			TeamID:          p.TeamID,
			PartyID:         p.PartyID,
			GameName:        p.GameName,
			TagLine:         p.TagLine,
			PlayerCardID:    p.PlayerCardID,
			PlayerTitleID:   p.PlayerTitleID,
			CharacterID:     p.CharacterID,
			Kills:           p.Kills,
			Deaths:          p.Deaths,
			Assists:         p.Assists,
			Score:           p.Score,
			Headshots:       p.Headshots,
			Bodyshots:       p.Bodyshots,
			Legshots:        p.Legshots,
			DamageDealt:     p.DamageDealt,
			RoundsPlayed:    p.RoundsPlayed,
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
		// HS% = headshots / (headshots + bodyshots + legshots).
		// Riot's "Headshots" field counts ALL head-hit damage events,
		// not just headshot kills, so dividing by kills was wrong.
		// Total shots across all zones is the correct denominator
		// and matches the in-game HS% number exactly.
		totalShots := ps.Headshots + ps.Bodyshots + ps.Legshots
		ps.HSPct = round1(float64(ps.Headshots) / float64(maxInt(totalShots, 1)) * 100.0)
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
	started, err := sm.StartWithOptions(puuid, region, force)
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
