package handlers

import (
	"backend/riothttp"
	"backend/tracking"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/truearken/valclient/valclient"
)

type LiveMatchResponse struct {
	Phase          string        `json:"phase"` // "pregame", "coregame", "none"
	MatchID        string        `json:"matchId"`
	MapID          string        `json:"mapId"`
	QueueID        string        `json:"queueId"`
	ModeID         string        `json:"modeId,omitempty"`
	AllyScore      int           `json:"allyScore"`
	EnemyScore     int           `json:"enemyScore"`
	ScoreAvailable bool          `json:"scoreAvailable"`
	TimeLeft       int           `json:"timeLeft"`
	AllyTeam       []*LivePlayer `json:"allyTeam"`
	EnemyTeam      []*LivePlayer `json:"enemyTeam"`
	Source         string        `json:"source,omitempty"` // "local" or "remote"
	Error          string        `json:"error,omitempty"`
	RetryAt        int64         `json:"retryAt,omitempty"`
	Stale          bool          `json:"stale,omitempty"`
}

type LivePlayer struct {
	Puuid                  string                       `json:"puuid"`
	Name                   string                       `json:"name"`
	AgentID                string                       `json:"agentId"`
	SelectionState         string                       `json:"selectionState"` // "selected", "locked", "none"
	AccountLevel           int                          `json:"accountLevel"`
	CardID                 string                       `json:"cardId"`
	IsLocal                bool                         `json:"isLocal"`
	CompetitiveTier        int                          `json:"competitiveTier"`
	RankedRating           int                          `json:"rankedRating,omitempty"`
	PeakTier               int                          `json:"peakTier,omitempty"`
	PartyGroup             string                       `json:"partyGroup,omitempty"`
	HistoryPartyGroup      string                       `json:"historyPartyGroup,omitempty"`
	HistoryPartyMatches    int                          `json:"historyPartyMatches,omitempty"`
	HistoryPartyLastSeenAt int64                        `json:"historyPartyLastSeenAt,omitempty"`
	CachedEvidence         *tracking.LivePlayerEvidence `json:"cachedEvidence,omitempty"`
	// Encounters is the viewer's cached history with this player.
	Encounters *tracking.Encounter `json:"encounters,omitempty"`
	TeamID     string              `json:"teamId,omitempty"`
}

type liveMatchCacheEntry struct {
	Response      LiveMatchResponse
	ExpiresAt     time.Time
	LastSuccessAt time.Time
}

type CoreGamePlayerResponse struct {
	Subject string `json:"Subject"`
	MatchID string `json:"MatchID"`
}

type CoreGameMatchResponse struct {
	MatchID string `json:"MatchID"`
	Players []struct {
		Subject        string `json:"Subject"`
		TeamID         string `json:"TeamID"` // "Blue" or "Red"
		CharacterID    string `json:"CharacterID"`
		PlayerIdentity struct {
			Subject          string `json:"Subject"`
			PlayerCardID     string `json:"PlayerCardID"`
			PlayerTitleID    string `json:"PlayerTitleID"`
			AccountLevel     int    `json:"AccountLevel"`
			HideAccountLevel bool   `json:"HideAccountLevel"`
			Incognito        bool   `json:"Incognito"`
		} `json:"PlayerIdentity"`
	} `json:"Players"`
	MapID   string `json:"MapID"`
	ModeID  string `json:"ModeID"`
	QueueID string `json:"QueueID"`
}

func getCoreGamePlayer(c *valclient.ValClient) (*CoreGamePlayerResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/players/{puuid}")
	resp := new(CoreGamePlayerResponse)
	if err := runRiotJSON(http.MethodGet, url, c.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func getLivePregamePlayer(c *valclient.ValClient) (*valclient.GetPreGamePlayerResponse, error) {
	apiURL := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/pregame/v1/players/{puuid}")
	response := new(valclient.GetPreGamePlayerResponse)
	if err := runRiotJSON(http.MethodGet, apiURL, c.Header, nil, response); err != nil {
		return nil, err
	}
	return response, nil
}

func getCoreGameMatch(c *valclient.ValClient, matchID string) (*CoreGameMatchResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/matches/{matchId}", "{matchId}", matchID)
	resp := new(CoreGameMatchResponse)
	if err := runRiotJSON(http.MethodGet, url, c.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func getPreGameMatchByID(c *valclient.ValClient, matchID string) (*valclient.GetPreGameMatchResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/pregame/v1/matches/{matchId}", "{matchId}", matchID)
	resp := new(valclient.GetPreGameMatchResponse)
	if err := runRiotJSON(http.MethodGet, url, c.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (h *Handler) GetLiveMatch(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatchCached(val, source)
	if response.Phase == "none" && response.RetryAt == 0 && source == "remote" && val.Player != nil {
		if local := h.localClientForPuuid(val.Player.Uuid); local != nil {
			if fallback := h.fetchLiveMatchCached(local, "local"); fallback.Phase != "none" || response.Error != "" {
				response = fallback
			}
		}
	}
	h.returnAny(w, response)
}

// RefreshLiveMatchRanks is deliberately manual. Normal live polling remains
// cache-only; this action performs current MMR lookups only when the user asks.
func (h *Handler) RefreshLiveMatchRanks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatchCached(val, source)
	if response.Phase != "none" && response.RetryAt <= time.Now().UnixMilli() {
		refreshLivePlayerRanks(val, &response)
		h.storeLiveMatchCache(val, source, response)
	}
	h.returnAny(w, response)
}

// ScanLiveMatchLikelyStacks is deliberately manual. It checks one small recent
// history page per visible player, persists a bounded number of shared matches,
// then lets the normal cache evidence confirm actual Riot party IDs.
func (h *Handler) ScanLiveMatchLikelyStacks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatchCached(val, source)
	if response.Phase != "none" && response.RetryAt <= time.Now().UnixMilli() {
		response.Error = ""
		if scanErr := h.scanLiveMatchLikelyStacks(val, &response); scanErr != nil {
			response.Error = scanErr.Error()
			var apiErr *riothttp.APIError
			if errors.As(scanErr, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
				delay := apiErr.RetryAfter
				if delay <= 0 {
					delay = 30 * time.Second
				}
				response.RetryAt = time.Now().Add(delay).UnixMilli()
			}
		}
		h.enrichLiveFromCache(&response)
		h.storeLiveMatchCache(val, source, response)
	}
	h.returnAny(w, response)
}

type liveHistoryItem struct {
	MatchID string `json:"MatchID"`
}

type liveHistoryResponse struct {
	History []liveHistoryItem `json:"History"`
}

type sharedHistoryCandidate struct {
	MatchID     string
	PlayerCount int
	BestIndex   int
}

func rankSharedHistoryCandidates(team []*LivePlayer, histories map[string][]string) []sharedHistoryCandidate {
	type candidateCount struct {
		players   int
		bestIndex int
	}
	counts := make(map[string]candidateCount)
	for _, player := range team {
		if player == nil || player.Puuid == "" || player.PartyGroup == "your-party" {
			continue
		}
		seen := make(map[string]struct{})
		for index, matchID := range histories[strings.ToLower(player.Puuid)] {
			if matchID == "" {
				continue
			}
			if _, duplicate := seen[matchID]; duplicate {
				continue
			}
			seen[matchID] = struct{}{}
			count := counts[matchID]
			count.players++
			if count.players == 1 || index < count.bestIndex {
				count.bestIndex = index
			}
			counts[matchID] = count
		}
	}
	candidates := make([]sharedHistoryCandidate, 0, len(counts))
	for matchID, count := range counts {
		if count.players >= 2 {
			candidates = append(candidates, sharedHistoryCandidate{
				MatchID:     matchID,
				PlayerCount: count.players,
				BestIndex:   count.bestIndex,
			})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].PlayerCount != candidates[j].PlayerCount {
			return candidates[i].PlayerCount > candidates[j].PlayerCount
		}
		if candidates[i].BestIndex != candidates[j].BestIndex {
			return candidates[i].BestIndex < candidates[j].BestIndex
		}
		return candidates[i].MatchID < candidates[j].MatchID
	})
	return candidates
}

func interleaveSharedCandidates(teams ...[]sharedHistoryCandidate) []sharedHistoryCandidate {
	const maxDetails = 4
	selected := make([]sharedHistoryCandidate, 0, maxDetails)
	seen := make(map[string]struct{}, maxDetails)
	for index := 0; len(selected) < maxDetails; index++ {
		added := false
		for _, candidates := range teams {
			if index >= len(candidates) {
				continue
			}
			added = true
			candidate := candidates[index]
			if _, duplicate := seen[candidate.MatchID]; duplicate {
				continue
			}
			seen[candidate.MatchID] = struct{}{}
			selected = append(selected, candidate)
			if len(selected) == maxDetails {
				break
			}
		}
		if !added {
			break
		}
	}
	return selected
}

func fetchRecentLiveHistory(val *valclient.ValClient, puuid string) ([]string, error) {
	apiURL := fmt.Sprintf(
		"https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=0&endIndex=10",
		val.Shard,
		url.PathEscape(puuid),
	)
	var response liveHistoryResponse
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &response); err != nil {
		return nil, err
	}
	matchIDs := make([]string, 0, len(response.History))
	for _, item := range response.History {
		if item.MatchID != "" {
			matchIDs = append(matchIDs, item.MatchID)
		}
	}
	return matchIDs, nil
}

func (h *Handler) scanLiveMatchLikelyStacks(val *valclient.ValClient, response *LiveMatchResponse) error {
	if val == nil || val.Player == nil || response == nil {
		return nil
	}
	db, err := h.trackingDB()
	if err != nil {
		return fmt.Errorf("open match cache: %w", err)
	}

	histories := make(map[string][]string)
	var firstErr error
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" || player.PartyGroup == "your-party" {
				continue
			}
			key := strings.ToLower(player.Puuid)
			if _, fetched := histories[key]; fetched {
				continue
			}
			matchIDs, fetchErr := fetchRecentLiveHistory(val, player.Puuid)
			if fetchErr != nil {
				if strings.Contains(fetchErr.Error(), "status 429") {
					return fmt.Errorf("Riot rate limit reached; saved party evidence is still shown: %w", fetchErr)
				}
				if firstErr == nil {
					firstErr = fetchErr
				}
				continue
			}
			histories[key] = matchIDs
		}
	}

	candidates := interleaveSharedCandidates(
		rankSharedHistoryCandidates(response.AllyTeam, histories),
		rankSharedHistoryCandidates(response.EnemyTeam, histories),
	)
	for _, candidate := range candidates {
		cached, cacheErr := tracking.GetMatchFromCache(db, candidate.MatchID, "")
		if cacheErr != nil {
			return cacheErr
		}
		if cached != nil {
			continue
		}
		apiURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/match-details/v1/matches/%s",
			val.Shard,
			url.PathEscape(candidate.MatchID),
		)
		raw, fetchErr := runRiotRaw(http.MethodGet, apiURL, val.Header, nil)
		if fetchErr != nil {
			if strings.Contains(fetchErr.Error(), "status 429") {
				return fmt.Errorf("Riot rate limit reached; matches saved before the limit are still shown: %w", fetchErr)
			}
			if firstErr == nil {
				firstErr = fetchErr
			}
			continue
		}
		if insertErr := tracking.InsertMatchDetails(db, h.trackingAppDir, candidate.MatchID, val.Player.Uuid, raw, nil); insertErr != nil && firstErr == nil {
			firstErr = insertErr
		}
	}

	seenPlayers := make(map[string]struct{})
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			puuid := strings.ToLower(player.Puuid)
			if _, seen := seenPlayers[puuid]; seen {
				continue
			}
			seenPlayers[puuid] = struct{}{}
			if aggregateErr := tracking.RecomputeAggregates(db, puuid); aggregateErr != nil && firstErr == nil {
				firstErr = aggregateErr
			}
		}
	}
	if firstErr != nil {
		return fmt.Errorf("likely-stack scan incomplete: %w", firstErr)
	}
	return nil
}

func liveMatchCacheTTL(phase string) time.Duration {
	switch phase {
	case "pregame":
		return 8 * time.Second
	case "coregame":
		return 20 * time.Second
	default:
		return 15 * time.Second
	}
}

func liveMatchCacheKey(val *valclient.ValClient, source string) string {
	if val == nil || val.Player == nil {
		return source
	}
	return source + ":" + strings.ToLower(val.Player.Uuid)
}

// fetchLiveMatchCached serializes cache misses. One global lock is enough for
// the app's single active account; split it per account only if concurrent
// multi-account live polling is ever added.
func (h *Handler) fetchLiveMatchCached(val *valclient.ValClient, source string) LiveMatchResponse {
	key := liveMatchCacheKey(val, source)
	h.liveMatchMu.Lock()
	defer h.liveMatchMu.Unlock()
	if h.liveMatchCache == nil {
		h.liveMatchCache = make(map[string]liveMatchCacheEntry)
	}
	if cached, ok := h.liveMatchCache[key]; ok && time.Now().Before(cached.ExpiresAt) {
		response := cloneLiveMatchResponse(&cached.Response)
		if response.RetryAt > time.Now().UnixMilli() {
			if response.Stale && time.Since(cached.LastSuccessAt) >= 2*time.Minute {
				return LiveMatchResponse{Phase: "none", Source: source, Error: response.Error, RetryAt: response.RetryAt}
			}
			return response
		}
		clearCachedLiveEvidence(&response)
		h.enrichLiveFromCache(&response)
		if response.Phase == "coregame" {
			h.enrichLiveScore(val, source, &response)
		}
		return response
	}
	response := h.fetchLiveMatch(val, source)
	entry := nextLiveMatchCacheEntry(h.liveMatchCache[key], response, time.Now())
	h.liveMatchCache[key] = entry
	return cloneLiveMatchResponse(&entry.Response)
}

// Failed reads are not evidence that a match ended. Keep a recent roster while
// backing off, but expire it after two minutes so an old game cannot linger.
func nextLiveMatchCacheEntry(previous liveMatchCacheEntry, response LiveMatchResponse, now time.Time) liveMatchCacheEntry {
	lastSuccess := previous.LastSuccessAt
	if response.Phase == "none" && response.Error != "" && response.RetryAt > 0 && previous.Response.Phase != "none" && previous.Response.MatchID != "" && now.Sub(lastSuccess) < 2*time.Minute {
		failure := response
		response = cloneLiveMatchResponse(&previous.Response)
		response.Error, response.RetryAt, response.Stale = failure.Error, failure.RetryAt, true
		response.TimeLeft = 0
		response.ScoreAvailable = false
	} else if response.Phase != "none" && !response.Stale {
		lastSuccess = now
	}
	expiresAt := now.Add(liveMatchCacheTTL(response.Phase))
	if response.RetryAt > 0 {
		expiresAt = time.UnixMilli(response.RetryAt)
	}
	return liveMatchCacheEntry{Response: cloneLiveMatchResponse(&response), ExpiresAt: expiresAt, LastSuccessAt: lastSuccess}
}

func (h *Handler) storeLiveMatchCache(val *valclient.ValClient, source string, response LiveMatchResponse) {
	h.liveMatchMu.Lock()
	defer h.liveMatchMu.Unlock()
	if h.liveMatchCache == nil {
		h.liveMatchCache = make(map[string]liveMatchCacheEntry)
	}
	key := liveMatchCacheKey(val, source)
	h.liveMatchCache[key] = nextLiveMatchCacheEntry(h.liveMatchCache[key], response, time.Now())
}

func cloneLiveMatchResponse(response *LiveMatchResponse) LiveMatchResponse {
	if response == nil {
		return LiveMatchResponse{}
	}
	clone := *response
	cloneTeam := func(team []*LivePlayer) []*LivePlayer {
		out := make([]*LivePlayer, len(team))
		for index, player := range team {
			if player != nil {
				copy := *player
				if player.CachedEvidence != nil {
					evidence := *player.CachedEvidence
					copy.CachedEvidence = &evidence
				}
				if player.Encounters != nil {
					encounters := *player.Encounters
					copy.Encounters = &encounters
				}
				out[index] = &copy
			}
		}
		return out
	}
	clone.AllyTeam = cloneTeam(response.AllyTeam)
	clone.EnemyTeam = cloneTeam(response.EnemyTeam)
	return clone
}

func clearCachedLiveEvidence(response *LiveMatchResponse) {
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil {
				player.CachedEvidence = nil
				player.Encounters = nil
				player.HistoryPartyGroup = ""
				player.HistoryPartyMatches = 0
				player.HistoryPartyLastSeenAt = 0
			}
		}
	}
}

func refreshLivePlayerRanks(val *valclient.ValClient, response *LiveMatchResponse) {
	if val == nil || response == nil {
		return
	}
	seasonID := ""
	var content valclient.GetContentResponse
	contentURL := val.BuildUrl("https://shared.{shard}.a.pvp.net/content-service/v3/content")
	if err := runRiotJSON(http.MethodGet, contentURL, val.Header, nil, &content); err == nil {
		for _, season := range content.Seasons {
			if season.IsActive && strings.EqualFold(string(season.Type), "act") {
				seasonID = season.ID
				break
			}
		}
	} else {
		var apiErr *riothttp.APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
			failure := liveMatchFailure(response.Source, err)
			response.Error, response.RetryAt = failure.Error, failure.RetryAt
			return
		}
	}

	seen := make(map[string]struct{})
	response.Error = ""
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			key := strings.ToLower(player.Puuid)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			url := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, player.Puuid)
			var mmr playerMMRResponse
			if err := runRiotJSON(http.MethodGet, url, val.Header, nil, &mmr); err != nil {
				failure := liveMatchFailure(response.Source, err)
				response.Error = "Some ranks could not be refreshed."
				if failure.RetryAt > 0 {
					response.Error, response.RetryAt = failure.Error, failure.RetryAt
					return
				}
				continue
			}
			tier, rr, peakTier := livePlayerRankFromMMR(mmr, seasonID)
			if tier > 0 {
				player.CompetitiveTier, player.RankedRating = tier, rr
			}
			if peakTier > 0 {
				player.PeakTier = peakTier
			}
		}
	}
}

func livePlayerRankFromMMR(mmr playerMMRResponse, seasonID string) (tier, rr, peakTier int) {
	competitive, ok := mmr.QueueSkills["competitive"]
	if !ok {
		return 0, 0, 0
	}
	for _, season := range competitive.SeasonalInfoBySeasonID {
		peakTier = max(peakTier, season.CompetitiveTier)
		for tierText, wins := range season.WinsByTier {
			if parsed, err := strconv.Atoi(tierText); err == nil && wins > 0 {
				peakTier = max(peakTier, parsed)
			}
		}
	}
	if seasonID != "" {
		season, found := competitiveSeason(competitive.SeasonalInfoBySeasonID, seasonID)
		if !found || season.NumberOfGames <= 0 || season.CompetitiveTier <= 0 {
			return 0, 0, peakTier
		}
		return season.CompetitiveTier, season.RankedRating, peakTier
	}
	if latest := mmr.LatestCompetitiveUpdate; latest.TierAfterUpdate > 0 {
		return latest.TierAfterUpdate, latest.RankedRatingAfterUpdate, peakTier
	}
	return 0, 0, peakTier
}

func (h *Handler) fetchLiveMatch(val *valclient.ValClient, source string) LiveMatchResponse {
	// 1. Try Pregame first
	prePlayer, pregameErr := getLivePregamePlayer(val)
	if pregameErr == nil && prePlayer != nil {
		preMatch, matchErr := getPreGameMatchByID(val, prePlayer.MatchID)
		pregameErr = matchErr
		if matchErr == nil && preMatch != nil {
			response := h.buildPregameResponse(val, preMatch)
			h.enrichLiveParty(val, &response)
			h.enrichLiveFromCache(&response)
			response.Source = source
			return response
		}
	}
	var pregameAPIError *riothttp.APIError
	if errors.As(pregameErr, &pregameAPIError) && pregameAPIError.StatusCode == http.StatusTooManyRequests {
		return liveMatchFailure(source, pregameErr)
	}

	// 2. Try Coregame next
	corePlayer, coregameErr := getCoreGamePlayer(val)
	if coregameErr == nil && corePlayer != nil {
		coreMatch, matchErr := getCoreGameMatch(val, corePlayer.MatchID)
		coregameErr = matchErr
		if matchErr == nil && coreMatch != nil {
			response := h.buildCoregameResponse(val, coreMatch)
			h.enrichLiveParty(val, &response)
			h.enrichLiveScore(val, source, &response)
			h.enrichLiveFromCache(&response)
			response.Source = source
			return response
		}
	}

	// 3. None
	if failure := liveMatchFailure(source, coregameErr); failure.Error != "" {
		return failure
	}
	return liveMatchFailure(source, pregameErr)
}

func liveMatchFailure(source string, err error) LiveMatchResponse {
	response := LiveMatchResponse{Phase: "none", Source: source}
	if err == nil {
		return response
	}
	var apiErr *riothttp.APIError
	if errors.As(err, &apiErr) {
		if apiErr.StatusCode == http.StatusNotFound {
			return response
		}
		if apiErr.StatusCode == http.StatusTooManyRequests {
			delay := apiErr.RetryAfter
			if delay <= 0 {
				delay = 30 * time.Second
			}
			response.Error = "Riot is limiting live requests. Retrying automatically."
			response.RetryAt = time.Now().Add(delay).UnixMilli()
			return response
		}
	}
	response.Error = "Live match information is temporarily unavailable. Retrying automatically."
	response.RetryAt = time.Now().Add(15 * time.Second).UnixMilli()
	return response
}

// enrichLiveFromCache adds only persistent match-history evidence. It never
// calls Riot, so the five-second live-match poll cannot create request bursts
// or consume rate limit. Confirmed current-party fields stay separate from
// prior-party evidence.
func (h *Handler) enrichLiveFromCache(response *LiveMatchResponse) {
	if response == nil || response.Phase == "none" {
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		return
	}
	players := append(append([]*LivePlayer{}, response.AllyTeam...), response.EnemyTeam...)
	byPuuid := make(map[string]*LivePlayer, len(players))
	puuids := make([]string, 0, len(players))
	for _, player := range players {
		if player == nil {
			continue
		}
		puuid := strings.ToLower(strings.TrimSpace(player.Puuid))
		if puuid == "" {
			continue
		}
		byPuuid[puuid] = player
		puuids = append(puuids, puuid)
		if evidence, evidenceErr := tracking.GetLivePlayerEvidence(db, puuid, player.AgentID); evidenceErr == nil {
			if player.CompetitiveTier <= 0 && evidence.LatestTier > 0 {
				player.CompetitiveTier = evidence.LatestTier
			}
			if evidence.LatestTier > 0 || evidence.PeakTier > 0 || evidence.Matches > 0 {
				player.CachedEvidence = &evidence
			}
		}
	}

	local := ""
	for _, player := range players {
		if player != nil && player.IsLocal {
			local = strings.ToLower(player.Puuid)
		}
	}
	if encounters, encounterErr := tracking.GetEncounters(db, local, puuids); encounterErr == nil {
		for puuid, encounter := range encounters {
			if player := byPuuid[puuid]; player != nil {
				encounter := encounter
				player.Encounters = &encounter
			}
		}
	}

	groups, err := tracking.GetCachedPartyGroups(db, puuids, time.Now())
	if err != nil {
		return
	}
	assigned := make(map[string]struct{}, len(players))
	groupIndex := 0
	for _, group := range groups {
		members := make([]*LivePlayer, 0, len(group.Players))
		for _, puuid := range group.Players {
			player := byPuuid[puuid]
			if player == nil {
				continue
			}
			if _, exists := assigned[puuid]; exists {
				continue
			}
			members = append(members, player)
		}
		if len(members) < 2 {
			continue
		}
		groupIndex++
		key := fmt.Sprintf("history-%d", groupIndex)
		for _, player := range members {
			puuid := strings.ToLower(player.Puuid)
			assigned[puuid] = struct{}{}
			player.HistoryPartyGroup = key
			player.HistoryPartyMatches = group.Matches
			player.HistoryPartyLastSeenAt = group.LastSeenAt
		}
	}
}

// enrichLiveScore reads the score the Riot client publishes in the signed-in
// player's VALORANT presence. Core-game payloads do not provide a score.
func (h *Handler) enrichLiveScore(val *valclient.ValClient, source string, response *LiveMatchResponse) {
	if val == nil || val.Player == nil || response == nil || response.Phase != "coregame" {
		return
	}
	if source == "remote" {
		auth := &remoteAuthHeaders{
			AccessToken:       strings.TrimPrefix(val.Header.Get("Authorization"), "Bearer "),
			EntitlementsToken: val.Header.Get("X-Riot-Entitlements-JWT"),
			Puuid:             val.Player.Uuid,
			Region:            string(val.Region),
		}
		if social := fetchRemoteSocialStatus(auth); social.SelfPresence != nil {
			applyPresenceScore(response, *social.SelfPresence)
		}
	}
	if response.ScoreAvailable {
		return
	}
	if presence, ok := h.fetchLocalPlayerPresence(val.Player.Uuid); ok {
		applyPresenceScore(response, presence)
	}
}

func applyPresenceScore(response *LiveMatchResponse, presence SocialPresence) {
	if response == nil || !presence.ScoreAvailable {
		return
	}
	response.AllyScore = presence.AllyScore
	response.EnemyScore = presence.EnemyScore
	response.ScoreAvailable = true
}

// enrichLiveParty fills the queue and labels only the signed-in player's own
// party from one party snapshot. Current MMR refreshes stay manual because a
// POST per party member on every live poll is expensive and rate-limit prone.
func (h *Handler) enrichLiveParty(val *valclient.ValClient, response *LiveMatchResponse) {
	if response == nil {
		return
	}
	if response.QueueID == "" && isTrainingMode(response.ModeID) {
		response.QueueID = "training"
		return
	}
	current, err := getCurrentParty(val)
	if err != nil || current == nil || current.CurrentPartyID == "" {
		return
	}
	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil || details == nil {
		return
	}
	if response.QueueID == "" {
		response.QueueID = details.MatchmakingData.QueueID
		if response.QueueID == "" {
			response.QueueID = details.QueueID
		}
	}
	if len(details.Members) < 2 {
		return
	}
	members := make([]string, 0, len(details.Members))
	tiers := make(map[string]int, len(details.Members))
	for _, member := range details.Members {
		members = append(members, member.Subject)
		tiers[strings.ToLower(member.Subject)] = member.CompetitiveTier
	}
	markPartyMembers(response, members, "your-party")
	// Riot's incognito flag hides strangers. A confirmed member of the signed-in
	// player's own party can still be resolved through the party-scoped session.
	h.enrichLivePlayerNames(val, response)
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.CompetitiveTier <= 0 {
				player.CompetitiveTier = tiers[strings.ToLower(player.Puuid)]
			}
		}
	}
}

func enrichKnownPlayerNames(response *LiveMatchResponse, names map[string]string) {
	if response == nil {
		return
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.IsLocal || (player.Name != "Player" && !(player.Name == "Agent" && player.PartyGroup == "your-party")) {
				continue
			}
			if name := names[strings.ToLower(player.Puuid)]; name != "" && name != "Player" {
				player.Name = name
			}
		}
	}
}

func markPartyMembers(response *LiveMatchResponse, memberPuuids []string, key string) {
	members := make(map[string]struct{}, len(memberPuuids))
	for _, puuid := range memberPuuids {
		members[strings.ToLower(puuid)] = struct{}{}
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil {
				if _, ok := members[strings.ToLower(player.Puuid)]; ok {
					player.PartyGroup = key
				}
			}
		}
	}
}

func isTrainingMode(modeID string) bool {
	modeID = strings.ToLower(modeID)
	return strings.Contains(modeID, "training") || strings.Contains(modeID, "range")
}

func errString(err error) string {
	if err == nil {
		return "none"
	}
	return err.Error()
}

func (h *Handler) getLiveMatchClient(r *http.Request) (*valclient.ValClient, string, error) {
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		return nil, "", err
	}

	if hasRemoteAuth {
		shard := getShardFromRegion(remoteAuth.Region)
		region := remoteAuth.Region
		if region == "" {
			region = shard
		}
		return &valclient.ValClient{
			Shard:  valclient.Shard(shard),
			Region: valclient.Region(region),
			Player: &valclient.ValClientPlayer{Uuid: remoteAuth.Puuid},
			Header: remoteClientHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken),
		}, "remote", nil
	}

	h.mu.RLock()
	localVal := h.Val
	h.mu.RUnlock()
	if localVal != nil {
		selected := selectedAccountPuuid(r)
		if selected != "" && (localVal.Player == nil || !strings.EqualFold(localVal.Player.Uuid, selected)) {
			return nil, "", fmt.Errorf("authentication required: the selected Riot account is not available locally")
		}
		if _, helpErr := localVal.GetHelp(); helpErr == nil {
			return localVal, "local", nil
		}
	}

	return nil, "", fmt.Errorf("authentication required: please log in first")
}

func (h *Handler) getPlayerNameCached(val *valclient.ValClient, puuid string) string {
	key := strings.ToLower(puuid)
	h.namesMu.RLock()
	name, ok := h.namesCache[key]
	h.namesMu.RUnlock()
	if ok {
		return name
	}

	names, err := val.GetNames([]string{puuid})
	if err == nil && len(names) > 0 {
		resolved := fmt.Sprintf("%s#%s", names[0].GameName, names[0].TagLine)
		h.namesMu.Lock()
		if h.namesCache == nil {
			h.namesCache = make(map[string]string)
		}
		h.namesCache[key] = resolved
		h.namesMu.Unlock()
		return resolved
	}
	return "Player"
}

func (h *Handler) enrichLivePlayerNames(val *valclient.ValClient, response *LiveMatchResponse) {
	if val == nil || response == nil {
		return
	}
	players := append(append([]*LivePlayer{}, response.AllyTeam...), response.EnemyTeam...)
	missing := make([]string, 0, len(players))
	seen := make(map[string]struct{}, len(players))
	h.namesMu.RLock()
	for _, player := range players {
		if player == nil || player.Puuid == "" || (player.Name != "Player" && !(player.Name == "Agent" && player.PartyGroup == "your-party")) {
			continue
		}
		key := strings.ToLower(player.Puuid)
		if cached := h.namesCache[key]; cached != "" {
			player.Name = cached
			continue
		}
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			missing = append(missing, player.Puuid)
		}
	}
	h.namesMu.RUnlock()
	if len(missing) == 0 {
		return
	}
	names, err := val.GetNames(missing)
	if err != nil {
		return
	}
	resolved := make(map[string]string, len(names))
	for _, identity := range names {
		name := fmt.Sprintf("%s#%s", identity.GameName, identity.TagLine)
		resolved[strings.ToLower(identity.Subject)] = name
	}
	h.namesMu.Lock()
	if h.namesCache == nil {
		h.namesCache = make(map[string]string)
	}
	for puuid, name := range resolved {
		h.namesCache[puuid] = name
	}
	h.namesMu.Unlock()
	enrichKnownPlayerNames(response, resolved)
}

func (h *Handler) buildPregameResponse(val *valclient.ValClient, match *valclient.GetPreGameMatchResponse) LiveMatchResponse {
	resp := LiveMatchResponse{
		Phase:    "pregame",
		MatchID:  match.ID,
		MapID:    match.MapID,
		QueueID:  match.QueueID,
		TimeLeft: match.PhaseTimeRemainingNS / 1000000000,
	}

	if match.AllyTeam != nil {
		resp.AllyTeam = make([]*LivePlayer, len(match.AllyTeam.Players))
		for i := range match.AllyTeam.Players {
			pStruct := match.AllyTeam.Players[i]

			selection := "none"
			if pStruct.CharacterSelectionState == valclient.CharacterSelectionStateLocked {
				selection = "locked"
			} else if pStruct.CharacterSelectionState != "" {
				selection = "selected"
			}

			lp := &LivePlayer{
				Puuid:           pStruct.Subject,
				AgentID:         pStruct.CharacterID,
				SelectionState:  selection,
				AccountLevel:    pStruct.PlayerIdentity.AccountLevel,
				CardID:          pStruct.PlayerIdentity.PlayerCardID,
				IsLocal:         pStruct.Subject == val.Player.Uuid,
				CompetitiveTier: pStruct.CompetitiveTier,
			}

			if pStruct.PlayerIdentity.Incognito && pStruct.Subject != val.Player.Uuid {
				lp.Name = "Agent"
			} else {
				lp.Name = "Player"
			}
			resp.AllyTeam[i] = lp
		}
	}

	// Resolve Enemy Team (obfuscated in pregame competitive)
	if match.EnemyTeam != nil && len(match.EnemyTeam.Players) > 0 {
		resp.EnemyTeam = make([]*LivePlayer, len(match.EnemyTeam.Players))
		for i := range match.EnemyTeam.Players {
			pStruct := match.EnemyTeam.Players[i]

			selection := "none"
			if pStruct.CharacterSelectionState == valclient.CharacterSelectionStateLocked {
				selection = "locked"
			} else if pStruct.CharacterSelectionState != "" {
				selection = "selected"
			}

			lp := &LivePlayer{
				Puuid:          "", // Hide PUUID
				Name:           "Enemy",
				AgentID:        pStruct.CharacterID,
				SelectionState: selection,
				AccountLevel:   0,
				CardID:         "",
				IsLocal:        false,
			}
			resp.EnemyTeam[i] = lp
		}
	} else if match.EnemyTeamSize > 0 {
		// Populate placeholders if individual enemy array isn't returned
		resp.EnemyTeam = make([]*LivePlayer, match.EnemyTeamSize)
		for i := 0; i < match.EnemyTeamSize; i++ {
			selection := "none"
			if i < match.EnemyTeamLockCount {
				selection = "locked"
			}
			resp.EnemyTeam[i] = &LivePlayer{
				Puuid:          "",
				Name:           fmt.Sprintf("Enemy %d", i+1),
				AgentID:        "",
				SelectionState: selection,
				AccountLevel:   0,
				CardID:         "",
				IsLocal:        false,
			}
		}
	}

	h.enrichLivePlayerNames(val, &resp)
	return resp
}

func (h *Handler) buildCoregameResponse(val *valclient.ValClient, match *CoreGameMatchResponse) LiveMatchResponse {
	resp := LiveMatchResponse{
		Phase:     "coregame",
		MatchID:   match.MatchID,
		MapID:     match.MapID,
		QueueID:   match.QueueID,
		ModeID:    match.ModeID,
		AllyTeam:  make([]*LivePlayer, 0),
		EnemyTeam: make([]*LivePlayer, 0),
	}

	// Find local player's team
	localTeam := ""
	for _, p := range match.Players {
		if p.Subject == val.Player.Uuid {
			localTeam = p.TeamID
			break
		}
	}

	for i := range match.Players {
		playerInfo := match.Players[i]

		lp := &LivePlayer{
			Puuid:          playerInfo.Subject,
			AgentID:        playerInfo.CharacterID,
			SelectionState: "locked", // In game all are locked
			AccountLevel:   playerInfo.PlayerIdentity.AccountLevel,
			CardID:         playerInfo.PlayerIdentity.PlayerCardID,
			IsLocal:        playerInfo.Subject == val.Player.Uuid,
			TeamID:         playerInfo.TeamID,
		}

		if playerInfo.PlayerIdentity.Incognito && playerInfo.Subject != val.Player.Uuid {
			lp.Name = "Agent"
		} else {
			lp.Name = "Player"
		}

		if playerInfo.TeamID == localTeam {
			resp.AllyTeam = append(resp.AllyTeam, lp)
		} else {
			resp.EnemyTeam = append(resp.EnemyTeam, lp)
		}
	}
	h.enrichLivePlayerNames(val, &resp)
	return resp
}
