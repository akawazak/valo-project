package handlers

import (
	"backend/tracking"
	"fmt"
	"net/http"
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
	TeamID                 string                       `json:"teamId,omitempty"`
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

// RefreshLiveMatchRanks is deliberately manual. Normal live polling remains
// cache-only; this action performs current MMR lookups only when the user asks.
func (h *Handler) RefreshLiveMatchRanks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	response := h.fetchLiveMatch(val, source)
	if response.Phase != "none" {
		refreshLivePlayerRanks(val, &response)
	}
	h.returnAny(w, response)
}

// ScanLiveMatchLikelyStacks preserves the explicit rescan action while using
// only the durable completed-match cache. It never spends Riot requests.
func (h *Handler) ScanLiveMatchLikelyStacks(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getLiveMatchClient(r)
	if err != nil || val == nil {
		h.returnAny(w, LiveMatchResponse{Phase: "none", Error: errString(err)})
		return
	}
	h.returnAny(w, h.fetchLiveMatch(val, source))
}

func refreshLivePlayerRanks(val *valclient.ValClient, response *LiveMatchResponse) {
	if val == nil || response == nil {
		return
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

	type result struct {
		player   *LivePlayer
		tier     int
		rr       int
		peakTier int
	}
	results := make(chan result, 10)
	workers := make(chan struct{}, 2)
	seen := make(map[string]struct{})
	var group sync.WaitGroup
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
			group.Add(1)
			go func(player *LivePlayer) {
				defer group.Done()
				workers <- struct{}{}
				defer func() { <-workers }()
				url := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, player.Puuid)
				var mmr playerMMRResponse
				if runRiotJSON(http.MethodGet, url, val.Header, nil, &mmr) != nil {
					return
				}
				tier, rr, peakTier := livePlayerRankFromMMR(mmr, seasonID)
				results <- result{player: player, tier: tier, rr: rr, peakTier: peakTier}
			}(player)
		}
	}
	go func() {
		group.Wait()
		close(results)
	}()
	for item := range results {
		if item.tier > 0 {
			item.player.CompetitiveTier = item.tier
			item.player.RankedRating = item.rr
		}
		if item.peakTier > 0 {
			item.player.PeakTier = item.peakTier
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
	prePlayer, err := val.GetPreGamePlayer()
	if err == nil && prePlayer != nil {
		preMatch, err := val.GetPreGameMatch()
		if err == nil && preMatch != nil {
			response := h.buildPregameResponse(val, preMatch)
			h.markCurrentParty(val, &response)
			h.fillLiveQueueID(val, &response)
			h.enrichLiveFromCache(&response)
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
			h.fillLiveQueueID(val, &response)
			h.enrichLiveScore(val, source, &response)
			h.enrichLiveFromCache(&response)
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

func enrichKnownPlayerNames(response *LiveMatchResponse, names map[string]string) {
	if response == nil {
		return
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.IsLocal || player.Name != "Player" {
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
