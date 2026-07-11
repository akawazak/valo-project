package handlers

import (
	"backend/tracking"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
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
}

type LivePlayer struct {
	Puuid           string `json:"puuid"`
	Name            string `json:"name"`
	AgentID         string `json:"agentId"`
	SelectionState  string `json:"selectionState"` // "selected", "locked", "none"
	AccountLevel    int    `json:"accountLevel"`
	CardID          string `json:"cardId"`
	IsLocal         bool   `json:"isLocal"`
	CompetitiveTier int    `json:"competitiveTier"`
	RankedRating    int    `json:"rankedRating"`
	PeakTier        int    `json:"peakTier,omitempty"`
	PeakRankName    string `json:"peakRankName,omitempty"`
	PartyGroup      string `json:"partyGroup,omitempty"`
	PartyConfidence string `json:"partyConfidence,omitempty"`
	TeamID          string `json:"teamId,omitempty"`
}

type likelyStackCache struct {
	Groups         [][]string
	ScannedPlayers map[string]struct{}
	ExpiresAt      time.Time
	RetryCount     int
}

// likelyStackScanResult distinguishes "no premade found" from a scan that
// could not examine every candidate because Riot returned an error. The former
// can be cached for the match; the latter deserves a small, bounded retry.
type likelyStackScanResult struct {
	Groups   [][]string
	Complete bool
}

type liveRankCache struct {
	Players    map[string]liveRankSnapshot
	Attempted  map[string]struct{}
	ExpiresAt  time.Time
	RetryAfter time.Time
	RetryCount int
}

type liveRankSnapshot struct {
	CompetitiveTier int
	RankedRating    int
	PeakTier        int
}

type liveRankLookupResult struct {
	Responded map[string]struct{}
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

func getCoreGameMatch(c *valclient.ValClient, matchID string) (*CoreGameMatchResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/matches/{matchId}", "{matchId}", matchID)
	resp := new(CoreGameMatchResponse)
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
	response := h.fetchLiveMatch(val, source)
	if response.Phase == "none" && source == "remote" && val.Player != nil {
		if local := h.localClientForPuuid(val.Player.Uuid); local != nil {
			if fallback := h.fetchLiveMatch(local, "local"); fallback.Phase != "none" || response.Error != "" {
				response = fallback
			}
		}
	}
	h.returnAny(w, response)
}

// RefreshLiveMatchRanks fetches Riot's current-act MMR for the identifiable
// players in the active match. Unlike the normal live-match poll, it never
// reads the local tracking cache for current rank data.
func (h *Handler) RefreshLiveMatchRanks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatch(val, source)
	if response.Phase == "none" {
		h.returnAny(w, response)
		return
	}
	ranks := h.refreshLiveMatchRanks(val, &response)
	h.storeLiveRanks(response.MatchID, &response, ranks)
	h.returnAny(w, response)
}

// ScanLiveMatchLikelyStacks identifies repeated premades from completed match
// history. It is intentionally manual: live core-game data does not expose
// every party ID, so this endpoint never presents a heuristic as a fact.
func (h *Handler) ScanLiveMatchLikelyStacks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatch(val, source)
	if response.Phase == "none" {
		h.returnAny(w, response)
		return
	}
	// A prior automatic scan may only have completed the ally side. A manual
	// rescan must always make a fresh request so it can fill in enemy results.
	result := scanLikelyStackGroups(val, &response)
	h.storeLikelyStacks(response.MatchID, result, &response)
	h.applyCachedLikelyStacks(&response)
	h.returnAny(w, response)
}

func (h *Handler) lookupLikelyStacks(matchID string) ([][]string, bool) {
	if matchID == "" {
		return nil, false
	}
	h.likelyStacksMu.RLock()
	cached, ok := h.likelyStacks[matchID]
	h.likelyStacksMu.RUnlock()
	return cached.Groups, ok && time.Now().Before(cached.ExpiresAt)
}

func (h *Handler) storeLikelyStacks(matchID string, result likelyStackScanResult, response *LiveMatchResponse) {
	if matchID == "" || response == nil {
		return
	}
	h.likelyStacksMu.Lock()
	cached := h.likelyStacks[matchID]
	if cached.ScannedPlayers == nil {
		cached.ScannedPlayers = make(map[string]struct{})
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.Puuid != "" {
				cached.ScannedPlayers[strings.ToLower(player.Puuid)] = struct{}{}
			}
		}
	}
	if len(result.Groups) > 0 {
		cached.Groups = appendUniqueLikelyStackGroups(cached.Groups, result.Groups)
	}
	expiresIn := 45 * time.Minute
	if !result.Complete && cached.RetryCount < 2 {
		// Network spikes and 429s used to look exactly like a completed scan.
		// Retry twice, then back off to avoid turning a bad connection into a
		// constant stream of Riot requests.
		cached.RetryCount++
		expiresIn = 25 * time.Second
	}
	cached.ExpiresAt = time.Now().Add(expiresIn)
	h.likelyStacks[matchID] = cached
	h.likelyStacksMu.Unlock()
}

func appendUniqueLikelyStackGroups(existing, incoming [][]string) [][]string {
	seen := make(map[string]struct{}, len(existing))
	keyFor := func(group []string) string {
		members := make([]string, 0, len(group))
		for _, member := range group {
			if member != "" {
				members = append(members, strings.ToLower(member))
			}
		}
		sort.Strings(members)
		return strings.Join(members, ",")
	}
	for _, group := range existing {
		seen[keyFor(group)] = struct{}{}
	}
	for _, group := range incoming {
		key := keyFor(group)
		if key == "" {
			continue
		}
		if _, found := seen[key]; found {
			continue
		}
		seen[key] = struct{}{}
		existing = append(existing, group)
	}
	return existing
}

func (h *Handler) hasUnscannedLikelyPlayers(matchID string, response *LiveMatchResponse) bool {
	if response == nil {
		return false
	}
	h.likelyStacksMu.RLock()
	cached, ok := h.likelyStacks[matchID]
	h.likelyStacksMu.RUnlock()
	if !ok || time.Now().After(cached.ExpiresAt) {
		return true
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.Puuid != "" {
				if _, scanned := cached.ScannedPlayers[strings.ToLower(player.Puuid)]; !scanned {
					return true
				}
			}
		}
	}
	return false
}

func (h *Handler) applyCachedLikelyStacks(response *LiveMatchResponse) {
	if response == nil {
		return
	}
	if groups, ok := h.lookupLikelyStacks(response.MatchID); ok {
		applyLikelyStackGroups(response, groups)
	}
}

func (h *Handler) storeLiveRanks(matchID string, response *LiveMatchResponse, lookup liveRankLookupResult) {
	if matchID == "" || response == nil {
		return
	}
	players := make(map[string]liveRankSnapshot)
	attempted := make(map[string]struct{})
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			key := strings.ToLower(player.Puuid)
			if _, responded := lookup.Responded[key]; responded {
				attempted[key] = struct{}{}
			}
			if player.CompetitiveTier > 0 || player.PeakTier > 0 {
				players[key] = liveRankSnapshot{
					CompetitiveTier: player.CompetitiveTier,
					RankedRating:    player.RankedRating,
					PeakTier:        player.PeakTier,
				}
			}
		}
	}
	if len(attempted) == 0 {
		return
	}
	h.liveRanksMu.Lock()
	cached := h.liveRanks[matchID]
	if cached.Players == nil {
		cached.Players = make(map[string]liveRankSnapshot)
	}
	if cached.Attempted == nil {
		cached.Attempted = make(map[string]struct{})
	}
	for key, rank := range players {
		cached.Players[key] = rank
	}
	for key := range attempted {
		cached.Attempted[key] = struct{}{}
	}
	allResponded := true
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			if _, responded := lookup.Responded[strings.ToLower(player.Puuid)]; !responded {
				allResponded = false
				break
			}
		}
	}
	if allResponded {
		cached.RetryAfter = time.Time{}
		cached.RetryCount = 0
	} else if cached.RetryCount < 2 {
		cached.RetryCount++
		cached.RetryAfter = time.Now().Add(25 * time.Second)
	} else {
		cached.RetryAfter = time.Now().Add(2 * time.Minute)
	}
	cached.ExpiresAt = time.Now().Add(45 * time.Minute)
	h.liveRanks[matchID] = cached
	h.liveRanksMu.Unlock()
}

func (h *Handler) hasUnattemptedLiveRanks(matchID string, response *LiveMatchResponse) bool {
	if response == nil {
		return false
	}
	h.liveRanksMu.RLock()
	cached, ok := h.liveRanks[matchID]
	h.liveRanksMu.RUnlock()
	if !ok || time.Now().After(cached.ExpiresAt) {
		return true
	}
	missingPlayer := false
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.Puuid != "" {
				if _, attempted := cached.Attempted[strings.ToLower(player.Puuid)]; !attempted {
					missingPlayer = true
					break
				}
			}
		}
	}
	return missingPlayer && (cached.RetryAfter.IsZero() || time.Now().After(cached.RetryAfter))
}

func (h *Handler) applyCachedLiveRanks(response *LiveMatchResponse) {
	if response == nil || response.MatchID == "" {
		return
	}
	h.liveRanksMu.RLock()
	cached, ok := h.liveRanks[response.MatchID]
	h.liveRanksMu.RUnlock()
	if !ok || time.Now().After(cached.ExpiresAt) {
		return
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil {
				continue
			}
			if rank, found := cached.Players[strings.ToLower(player.Puuid)]; found {
				player.CompetitiveTier = rank.CompetitiveTier
				player.RankedRating = rank.RankedRating
				player.PeakTier = max(player.PeakTier, rank.PeakTier)
			}
		}
	}
}

// queueLiveMatchExtras runs the expensive live enrichments in the background.
// Ranks and history scanning deliberately do not run together: the two tasks
// otherwise create a burst of Riot requests that makes automatic lookup less
// reliable than the same actions started manually from the UI.
func (h *Handler) queueLiveMatchExtras(val *valclient.ValClient, response *LiveMatchResponse) {
	if val == nil || response == nil || (response.Phase != "pregame" && response.Phase != "coregame") || response.MatchID == "" {
		return
	}
	matchID := response.MatchID
	ranksNeeded := h.hasUnattemptedLiveRanks(matchID, response)
	stacksNeeded := h.hasUnscannedLikelyPlayers(matchID, response)
	h.liveExtrasMu.Lock()
	_, ranksRunning := h.liveRanksInFlight[matchID]
	_, stacksRunning := h.likelyStacksInFlight[matchID]
	startRanks := !ranksRunning && ranksNeeded
	if !ranksRunning && ranksNeeded {
		h.liveRanksInFlight[matchID] = struct{}{}
	}
	// Let the rank lookup finish before the history scan begins. The next live
	// poll will pick up the scan, while cached rank data is already available.
	if !stacksRunning && stacksNeeded && !ranksRunning && !startRanks {
		h.likelyStacksInFlight[matchID] = struct{}{}
	}
	startStacks := !stacksRunning && stacksNeeded && !ranksRunning && !startRanks
	h.liveExtrasMu.Unlock()

	if startRanks {
		snapshot := cloneLiveMatchResponse(response)
		go func() {
			defer func() {
				h.liveExtrasMu.Lock()
				delete(h.liveRanksInFlight, matchID)
				h.liveExtrasMu.Unlock()
			}()
			ranks := h.refreshLiveMatchRanks(val, &snapshot)
			h.storeLiveRanks(matchID, &snapshot, ranks)
		}()
	}
	if startStacks {
		snapshot := cloneLiveMatchResponse(response)
		go func() {
			defer func() {
				h.liveExtrasMu.Lock()
				delete(h.likelyStacksInFlight, matchID)
				h.liveExtrasMu.Unlock()
			}()
			h.storeLikelyStacks(matchID, scanLikelyStackGroups(val, &snapshot), &snapshot)
		}()
	}
}

func cloneLiveMatchResponse(response *LiveMatchResponse) LiveMatchResponse {
	clone := *response
	cloneTeam := func(team []*LivePlayer) []*LivePlayer {
		out := make([]*LivePlayer, 0, len(team))
		for _, player := range team {
			if player == nil {
				out = append(out, nil)
				continue
			}
			copy := *player
			out = append(out, &copy)
		}
		return out
	}
	clone.AllyTeam = cloneTeam(response.AllyTeam)
	clone.EnemyTeam = cloneTeam(response.EnemyTeam)
	return clone
}

func scanLikelyStackGroups(val *valclient.ValClient, response *LiveMatchResponse) likelyStackScanResult {
	if val == nil || response == nil {
		return likelyStackScanResult{}
	}
	var groups [][]string
	complete := true
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		players := make([]*LivePlayer, 0, len(team))
		for _, player := range team {
			// A social presence may provide a group for only one visible
			// player. Keep that player in the scan; otherwise the incomplete
			// presence hint prevents us from confirming their current duo.
			if player != nil && player.Puuid != "" && player.PartyGroup != "your-party" {
				players = append(players, player)
			}
		}
		teamResult := scanTeamLikelyStacks(val, players)
		groups = append(groups, teamResult.Groups...)
		complete = complete && teamResult.Complete
	}
	return likelyStackScanResult{Groups: groups, Complete: complete}
}

func scanTeamLikelyStacks(val *valclient.ValClient, players []*LivePlayer) likelyStackScanResult {
	if len(players) < 2 {
		return likelyStackScanResult{Complete: true}
	}
	// One recent-history request per identifiable player (five at most per
	// team). We only retrieve match details where two current teammates share
	// a match ID, keeping the expensive step small.
	histories := make([][]string, len(players))
	var wg sync.WaitGroup
	var failuresMu sync.Mutex
	complete := true
	sem := make(chan struct{}, 4)
	for i, player := range players {
		wg.Add(1)
		go func(index int, puuid string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			url := fmt.Sprintf("https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=0&endIndex=25", val.Shard, puuid)
			var history struct {
				History []struct {
					MatchID string `json:"MatchID"`
				} `json:"History"`
			}
			if runRiotJSON(http.MethodGet, url, val.Header, nil, &history) != nil {
				failuresMu.Lock()
				complete = false
				failuresMu.Unlock()
				return
			}
			for _, entry := range history.History {
				if entry.MatchID != "" {
					histories[index] = append(histories[index], entry.MatchID)
				}
			}
		}(i, player.Puuid)
	}
	wg.Wait()

	participants := make(map[string]map[string]struct{})
	matchPriority := make(map[string]int)
	for index, history := range histories {
		for position, matchID := range history {
			if participants[matchID] == nil {
				participants[matchID] = make(map[string]struct{})
			}
			participants[matchID][strings.ToLower(players[index].Puuid)] = struct{}{}
			if previous, ok := matchPriority[matchID]; !ok || position < previous {
				matchPriority[matchID] = position
			}
		}
	}

	var groups [][]string
	type sharedMatch struct {
		id           string
		participants map[string]struct{}
		priority     int
	}
	candidates := make([]sharedMatch, 0, len(participants))
	for matchID, present := range participants {
		if len(present) >= 2 {
			candidates = append(candidates, sharedMatch{id: matchID, participants: present, priority: matchPriority[matchID]})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if len(candidates[i].participants) != len(candidates[j].participants) {
			return len(candidates[i].participants) > len(candidates[j].participants)
		}
		return candidates[i].priority < candidates[j].priority
	})
	if len(candidates) > 12 {
		candidates = candidates[:12]
	}
	for _, candidate := range candidates {
		matchID, present := candidate.id, candidate.participants
		url := fmt.Sprintf("https://pd.%s.a.pvp.net/match-details/v1/matches/%s", val.Shard, matchID)
		var details struct {
			Players []struct {
				Subject string `json:"subject"`
				PartyID string `json:"partyId"`
			} `json:"players"`
		}
		if runRiotJSON(http.MethodGet, url, val.Header, nil, &details) != nil {
			complete = false
			continue
		}
		byParty := make(map[string][]string)
		for _, player := range details.Players {
			key := strings.ToLower(player.Subject)
			if player.PartyID != "" {
				if _, currentTeammate := present[key]; currentTeammate {
					byParty[player.PartyID] = append(byParty[player.PartyID], key)
				}
			}
		}
		for _, group := range byParty {
			if len(group) > 1 {
				groups = append(groups, group)
			}
		}
	}
	return likelyStackScanResult{Groups: groups, Complete: complete}
}

func applyLikelyStackGroups(response *LiveMatchResponse, groups [][]string) {
	if response == nil {
		return
	}
	for index, members := range groups {
		memberSet := make(map[string]struct{}, len(members))
		for _, puuid := range members {
			memberSet[strings.ToLower(puuid)] = struct{}{}
		}
		groupKey := fmt.Sprintf("likely-stack-%d", index+1)
		hasYourPartyMember := false
		for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
			for _, player := range team {
				if player == nil {
					continue
				}
				if _, found := memberSet[strings.ToLower(player.Puuid)]; found {
					if player.PartyGroup == "your-party" {
						hasYourPartyMember = true
					}
					if player.PartyGroup != "" && player.PartyGroup != "your-party" {
						groupKey = player.PartyGroup
					}
				}
			}
		}
		if hasYourPartyMember {
			continue
		}
		for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
			for _, player := range team {
				if player == nil {
					continue
				}
				if _, found := memberSet[strings.ToLower(player.Puuid)]; found {
					if player.PartyGroup == "" {
						player.PartyGroup = groupKey
					}
					if strings.HasPrefix(groupKey, "likely-stack-") {
						player.PartyConfidence = "likely"
					}
				}
			}
		}
	}
}

func (h *Handler) refreshLiveMatchRanks(val *valclient.ValClient, response *LiveMatchResponse) liveRankLookupResult {
	lookup := liveRankLookupResult{Responded: make(map[string]struct{})}
	if val == nil || response == nil {
		return lookup
	}
	seasonID := ""
	if content, err := val.GetContent(); err == nil && content != nil {
		for _, season := range content.Seasons {
			if season.IsActive && strings.EqualFold(string(season.Type), "act") {
				seasonID = season.ID
				break
			}
		}
	}

	type rankResult struct {
		player    *LivePlayer
		tier      int
		rr        int
		peakTier  int
		responded bool
	}
	results := make(chan rankResult, 10)
	var wg sync.WaitGroup
	// The automatic scan can contain ten players. Keep this modest so it does
	// not compete with the live-match poll or trigger a burst of MMR requests.
	sem := make(chan struct{}, 3)
	seen := make(map[string]struct{})
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
			wg.Add(1)
			go func(player *LivePlayer) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()
				// BuildUrl substitutes the signed-in player's PUUID before it
				// processes additional replacements. Build this URL directly so
				// every player receives their own MMR rather than the local one.
				url := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, player.Puuid)
				var mmr playerMMRResponse
				if err := runRiotJSON(http.MethodGet, url, val.Header, nil, &mmr); err != nil {
					return
				}
				tier, rr, peakTier := liveRankFromMMR(mmr, seasonID)
				results <- rankResult{player: player, tier: tier, rr: rr, peakTier: peakTier, responded: true}
			}(player)
		}
	}
	go func() {
		wg.Wait()
		close(results)
	}()
	for result := range results {
		if result.responded {
			lookup.Responded[strings.ToLower(result.player.Puuid)] = struct{}{}
		}
		if result.tier > 0 || result.peakTier > 0 {
			result.player.CompetitiveTier = result.tier
			result.player.RankedRating = result.rr
			result.player.PeakTier = max(result.player.PeakTier, result.peakTier)
		}
	}
	return lookup
}

func liveRankFromMMR(mmr playerMMRResponse, seasonID string) (tier, rr, peakTier int) {
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
	for _, candidate := range []string{seasonID, tracking.NormalizeSeasonID(mmr.LatestCompetitiveUpdate.SeasonID)} {
		if candidate == "" {
			continue
		}
		if season, found := competitive.SeasonalInfoBySeasonID[candidate]; found && season.CompetitiveTier > 0 {
			return season.CompetitiveTier, season.RankedRating, peakTier
		}
	}
	if latest := mmr.LatestCompetitiveUpdate; latest.TierAfterUpdate > 0 {
		return latest.TierAfterUpdate, latest.RankedRatingAfterUpdate, peakTier
	}
	return 0, 0, peakTier
}

func (h *Handler) fetchLiveMatch(val *valclient.ValClient, source string) LiveMatchResponse {
	// 1. Try Pregame first
	prePlayer, err := val.GetPreGamePlayer()
	if err == nil && prePlayer != nil {
		preMatch, err := val.GetPreGameMatch()
		if err == nil && preMatch != nil {
			response := h.buildPregameResponse(val, preMatch)
			h.markCurrentParty(val, &response)
			h.enrichFriendNames(val, source, &response)
			h.enrichLiveRanks(&response)
			h.fillLiveQueueID(val, &response)
			h.applyCachedLikelyStacks(&response)
			h.applyCachedLiveRanks(&response)
			h.queueLiveMatchExtras(val, &response)
			response.Source = source
			return response
		}
	}
	pregameErr := err

	// 2. Try Coregame next
	corePlayer, err := getCoreGamePlayer(val)
	if err == nil && corePlayer != nil {
		coreMatch, err := getCoreGameMatch(val, corePlayer.MatchID)
		if err == nil && coreMatch != nil {
			response := h.buildCoregameResponse(val, coreMatch)
			h.markCurrentParty(val, &response)
			h.enrichFriendNames(val, source, &response)
			h.enrichLiveRanks(&response)
			h.fillLiveQueueID(val, &response)
			h.enrichLiveScore(val, source, &response)
			h.applyCachedLikelyStacks(&response)
			h.applyCachedLiveRanks(&response)
			h.queueLiveMatchExtras(val, &response)
			response.Source = source
			return response
		}
	}
	coregameErr := err

	// 3. None
	return LiveMatchResponse{
		Phase:  "none",
		Source: source,
		Error:  fmt.Sprintf("pregame: %s; coregame: %s", errString(pregameErr), errString(coregameErr)),
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

// markCurrentParty labels only the signed-in player's own party. Live match
// payloads do not expose every premade, so unknown groups stay unlabelled.
// Raw Riot party IDs never leave the backend.
func (h *Handler) markCurrentParty(val *valclient.ValClient, response *LiveMatchResponse) {
	current, err := getCurrentParty(val)
	if err != nil || current == nil || current.CurrentPartyID == "" {
		return
	}
	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil || details == nil || len(details.Members) < 2 {
		return
	}
	details = h.refreshPartyCompetitiveTiers(val, current.CurrentPartyID, details)
	members := make([]string, 0, len(details.Members))
	names := make(map[string]string, len(details.Members))
	tiers := make(map[string]int, len(details.Members))
	for _, member := range details.Members {
		members = append(members, member.Subject)
		names[strings.ToLower(member.Subject)] = h.getPlayerNameCached(val, member.Subject)
		tiers[strings.ToLower(member.Subject)] = member.CompetitiveTier
	}
	markPartyMembers(response, members, "your-party")
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.CompetitiveTier <= 0 {
				player.CompetitiveTier = tiers[strings.ToLower(player.Puuid)]
			}
		}
	}
	enrichKnownPlayerNames(response, names)
}

func (h *Handler) enrichFriendNames(val *valclient.ValClient, source string, response *LiveMatchResponse) {
	if val == nil || val.Player == nil || response == nil {
		return
	}
	var social SocialStatusResponse
	if source == "local" {
		local, err := h.fetchLocalSocialStatus()
		if err != nil {
			return
		}
		social = local
	} else {
		auth := &remoteAuthHeaders{
			AccessToken:       strings.TrimPrefix(val.Header.Get("Authorization"), "Bearer "),
			EntitlementsToken: val.Header.Get("X-Riot-Entitlements-JWT"),
			Puuid:             val.Player.Uuid,
			Region:            string(val.Region),
		}
		social = fetchRemoteSocialStatus(auth)
		h.enrichRemoteSocialNames(auth, &social)
	}
	names := make(map[string]string, len(social.Presences))
	partyGroups := make(map[string]string, len(social.Presences))
	for _, presence := range social.Presences {
		if presence.Puuid != "" && presence.Name != "" {
			names[strings.ToLower(presence.Puuid)] = presence.Name
		}
		if presence.Puuid != "" && presence.PartyGroup != "" {
			partyGroups[strings.ToLower(presence.Puuid)] = presence.PartyGroup
		}
	}
	enrichKnownPlayerNames(response, names)
	markKnownPartyGroups(response, partyGroups)
}

func markKnownPartyGroups(response *LiveMatchResponse, groups map[string]string) {
	if response == nil {
		return
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.PartyGroup == "" {
				player.PartyGroup = groups[strings.ToLower(player.Puuid)]
			}
		}
	}
}

func (h *Handler) enrichLiveRanks(response *LiveMatchResponse) {
	if response == nil {
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		return
	}
	seen := make(map[string]struct{})
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			key := strings.ToLower(player.Puuid)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			overview, err := tracking.GetOverview(db, player.Puuid)
			if err != nil || overview == nil {
				continue
			}
			for _, updateTeam := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
				for _, update := range updateTeam {
					if update == nil || !strings.EqualFold(update.Puuid, player.Puuid) {
						continue
					}
					if update.CompetitiveTier <= 0 && overview.CurrentRank.CompetitiveTier > 0 {
						update.CompetitiveTier = overview.CurrentRank.CompetitiveTier
						update.RankedRating = overview.CurrentRank.RankedRating
					}
					if overview.PeakRank.CompetitiveTier > 0 {
						update.PeakTier = overview.PeakRank.CompetitiveTier
						update.PeakRankName = overview.PeakRank.TierName
					}
				}
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
			if player == nil || player.IsLocal || (player.Name != "Agent" && player.Name != "Enemy") {
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

func (h *Handler) fillLiveQueueID(val *valclient.ValClient, response *LiveMatchResponse) {
	if response == nil || response.QueueID != "" {
		return
	}
	// Core-game exposes ModeID rather than QueueID. The Range has no normal
	// queue, so never overwrite it with the last party queue (often Swiftplay).
	if isTrainingMode(response.ModeID) {
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
	if details.MatchmakingData.QueueID != "" {
		response.QueueID = details.MatchmakingData.QueueID
		return
	}
	if details.QueueID != "" {
		response.QueueID = details.QueueID
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
			Header: buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken),
		}, "remote", nil
	}

	h.mu.RLock()
	localVal := h.Val
	h.mu.RUnlock()
	if localVal != nil {
		if _, helpErr := localVal.GetHelp(); helpErr == nil {
			return localVal, "local", nil
		}
	}

	return nil, "", fmt.Errorf("authentication required: please log in first")
}

func (h *Handler) getPlayerNameCached(val *valclient.ValClient, puuid string) string {
	h.namesMu.RLock()
	name, ok := h.namesCache[puuid]
	h.namesMu.RUnlock()
	if ok {
		return name
	}

	names, err := val.GetNames([]string{puuid})
	if err == nil && len(names) > 0 {
		resolved := fmt.Sprintf("%s#%s", names[0].GameName, names[0].TagLine)
		h.namesMu.Lock()
		h.namesCache[puuid] = resolved
		h.namesMu.Unlock()
		return resolved
	}
	return "Player"
}

func (h *Handler) buildPregameResponse(val *valclient.ValClient, match *valclient.GetPreGameMatchResponse) LiveMatchResponse {
	resp := LiveMatchResponse{
		Phase:    "pregame",
		MatchID:  match.ID,
		MapID:    match.MapID,
		QueueID:  match.QueueID,
		TimeLeft: match.PhaseTimeRemainingNS / 1000000000,
	}

	var wg sync.WaitGroup
	var mu sync.Mutex

	// Resolve Ally Team in parallel
	if match.AllyTeam != nil {
		resp.AllyTeam = make([]*LivePlayer, len(match.AllyTeam.Players))
		for i := range match.AllyTeam.Players {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				pStruct := match.AllyTeam.Players[index]

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

				if pStruct.PlayerIdentity.Incognito {
					lp.Name = "Agent"
				} else {
					lp.Name = h.getPlayerNameCached(val, pStruct.Subject)
				}

				mu.Lock()
				resp.AllyTeam[index] = lp
				mu.Unlock()
			}(i)
		}
	}

	// Resolve Enemy Team (obfuscated in pregame competitive)
	if match.EnemyTeam != nil && len(match.EnemyTeam.Players) > 0 {
		resp.EnemyTeam = make([]*LivePlayer, len(match.EnemyTeam.Players))
		for i := range match.EnemyTeam.Players {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				pStruct := match.EnemyTeam.Players[index]

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
				mu.Lock()
				resp.EnemyTeam[index] = lp
				mu.Unlock()
			}(i)
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

	wg.Wait()
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

	var wg sync.WaitGroup
	var mu sync.Mutex

	for i := range match.Players {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			playerInfo := match.Players[index]

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
				lp.Name = h.getPlayerNameCached(val, playerInfo.Subject)
			}

			mu.Lock()
			if playerInfo.TeamID == localTeam {
				resp.AllyTeam = append(resp.AllyTeam, lp)
			} else {
				resp.EnemyTeam = append(resp.EnemyTeam, lp)
			}
			mu.Unlock()
		}(i)
	}

	wg.Wait()
	return resp
}
