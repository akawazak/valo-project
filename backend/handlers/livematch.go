package handlers

import (
	"fmt"
	"github.com/truearken/valclient/valclient"
	"net/http"
	"sync"
)

type LiveMatchResponse struct {
	Phase     string        `json:"phase"` // "pregame", "coregame", "none"
	MatchID   string        `json:"matchId"`
	MapID     string        `json:"mapId"`
	QueueID   string        `json:"queueId"`
	TimeLeft  int           `json:"timeLeft"`
	AllyTeam  []*LivePlayer `json:"allyTeam"`
	EnemyTeam []*LivePlayer `json:"enemyTeam"`
	Source    string        `json:"source,omitempty"` // "local" or "remote"
	Error     string        `json:"error,omitempty"`
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
	QueueID string `json:"QueueID"`
}

func getCoreGamePlayer(c *valclient.ValClient) (*CoreGamePlayerResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/players/{puuid}")
	resp := new(CoreGamePlayerResponse)
	if err := c.RunRequest(http.MethodGet, url, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func getCoreGameMatch(c *valclient.ValClient, matchID string) (*CoreGameMatchResponse, error) {
	url := c.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/matches/{matchId}", "{matchId}", matchID)
	resp := new(CoreGameMatchResponse)
	if err := c.RunRequest(http.MethodGet, url, nil, resp); err != nil {
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

	// 1. Try Pregame first
	prePlayer, err := val.GetPreGamePlayer()
	if err == nil && prePlayer != nil {
		preMatch, err := val.GetPreGameMatch()
		if err == nil && preMatch != nil {
			response := h.buildPregameResponse(val, preMatch)
			h.fillLiveQueueID(val, &response)
			response.Source = source
			h.returnAny(w, response)
			return
		}
	}
	pregameErr := err

	// 2. Try Coregame next
	corePlayer, err := getCoreGamePlayer(val)
	if err == nil && corePlayer != nil {
		coreMatch, err := getCoreGameMatch(val, corePlayer.MatchID)
		if err == nil && coreMatch != nil {
			response := h.buildCoregameResponse(val, coreMatch)
			h.fillLiveQueueID(val, &response)
			response.Source = source
			h.returnAny(w, response)
			return
		}
	}
	coregameErr := err

	// 3. None
	h.returnAny(w, LiveMatchResponse{
		Phase:  "none",
		Source: source,
		Error:  fmt.Sprintf("pregame: %s; coregame: %s", errString(pregameErr), errString(coregameErr)),
	})
}

func (h *Handler) fillLiveQueueID(val *valclient.ValClient, response *LiveMatchResponse) {
	if response == nil || response.QueueID != "" {
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

	h.mu.RLock()
	localVal := h.Val
	h.mu.RUnlock()
	if localVal != nil {
		if !hasRemoteAuth || localVal.Player != nil && localVal.Player.Uuid == remoteAuth.Puuid {
			if _, helpErr := localVal.GetHelp(); helpErr == nil {
				return localVal, "local", nil
			}
		}
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

func (h *Handler) getPlayerMmrCached(val *valclient.ValClient, puuid string) (int, int) {
	h.mmrMu.RLock()
	cached, ok := h.mmrCache[puuid]
	h.mmrMu.RUnlock()
	if ok {
		return cached.Tier, cached.RR
	}

	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/players/%s", val.Shard, puuid)
	var live struct {
		LatestCompetitiveUpdate struct {
			TierAfterUpdate         int `json:"TierAfterUpdate"`
			RankedRatingAfterUpdate int `json:"RankedRatingAfterUpdate"`
		} `json:"LatestCompetitiveUpdate"`
	}
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, &live); err == nil {
		tier := live.LatestCompetitiveUpdate.TierAfterUpdate
		rr := live.LatestCompetitiveUpdate.RankedRatingAfterUpdate
		h.mmrMu.Lock()
		h.mmrCache[puuid] = CachedMMR{Tier: tier, RR: rr}
		h.mmrMu.Unlock()
		return tier, rr
	}
	return 0, 0
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
					Puuid:          pStruct.Subject,
					AgentID:        pStruct.CharacterID,
					SelectionState: selection,
					AccountLevel:   pStruct.PlayerIdentity.AccountLevel,
					CardID:         pStruct.PlayerIdentity.PlayerCardID,
					IsLocal:        pStruct.Subject == val.Player.Uuid,
				}

				if pStruct.PlayerIdentity.Incognito {
					lp.Name = "Agent"
				} else {
					lp.Name = h.getPlayerNameCached(val, pStruct.Subject)
				}

				// Get MMR
				tier, rr := h.getPlayerMmrCached(val, pStruct.Subject)
				lp.CompetitiveTier = tier
				lp.RankedRating = rr

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
			}

			if playerInfo.PlayerIdentity.Incognito && playerInfo.Subject != val.Player.Uuid {
				lp.Name = "Agent"
			} else {
				lp.Name = h.getPlayerNameCached(val, playerInfo.Subject)
			}

			// Get MMR
			tier, rr := h.getPlayerMmrCached(val, playerInfo.Subject)
			lp.CompetitiveTier = tier
			lp.RankedRating = rr

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
