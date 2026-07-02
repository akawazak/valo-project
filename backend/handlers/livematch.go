package handlers

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/truearken/valclient/valclient"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

type LiveMatchResponse struct {
	Phase       string        `json:"phase"` // "pregame", "coregame", "none"
	MatchID     string        `json:"matchId"`
	MapID       string        `json:"mapId"`
	QueueID     string        `json:"queueId"`
	TimeLeft    int           `json:"timeLeft"`
	AllyScore   *int          `json:"allyScore,omitempty"`
	EnemyScore  *int          `json:"enemyScore,omitempty"`
	ScoreSource string        `json:"scoreSource,omitempty"`
	AllyTeam    []*LivePlayer `json:"allyTeam"`
	EnemyTeam   []*LivePlayer `json:"enemyTeam"`
	Source      string        `json:"source,omitempty"` // "local" or "remote"
	Error       string        `json:"error,omitempty"`
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
	PartyGroup      string `json:"partyGroup,omitempty"`
	TeamID          string `json:"teamId,omitempty"`
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

func (h *Handler) fetchLiveMatch(val *valclient.ValClient, source string) LiveMatchResponse {
	// 1. Try Pregame first
	prePlayer, err := val.GetPreGamePlayer()
	if err == nil && prePlayer != nil {
		preMatch, err := val.GetPreGameMatch()
		if err == nil && preMatch != nil {
			response := h.buildPregameResponse(val, preMatch)
			h.markCurrentParty(val, &response)
			h.fillLiveQueueID(val, &response)
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
			h.fillLiveScore(val, &response)
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

func (h *Handler) fillLiveScore(val *valclient.ValClient, response *LiveMatchResponse) {
	if val == nil || val.Player == nil || response == nil || response.Phase != "coregame" {
		return
	}
	localTeam := ""
	for _, player := range response.AllyTeam {
		if player != nil && player.IsLocal {
			localTeam = player.TeamID
			break
		}
	}
	port, password, err := readRiotLockfile()
	if err != nil {
		return
	}
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte("riot:"+password))
	presences, err := doLocalChatRequest(
		localChatHTTPClient,
		fmt.Sprintf("https://127.0.0.1:%s/chat/v4/presences", port),
		auth,
		func(body []byte) (localPresencesResponse, error) {
			var out localPresencesResponse
			err := json.Unmarshal(body, &out)
			return out, err
		},
	)
	if err != nil {
		return
	}
	for _, presence := range presences.Presences {
		if !strings.EqualFold(presence.Puuid, val.Player.Uuid) {
			continue
		}
		ally, enemy, ok := scoreFromPresencePrivate(presence.Private, localTeam)
		if ok {
			response.AllyScore = &ally
			response.EnemyScore = &enemy
			response.ScoreSource = "local-presence"
		}
		return
	}
}

func scoreFromPresencePrivate(encoded, localTeam string) (int, int, bool) {
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return 0, 0, false
	}
	var private map[string]any
	if json.Unmarshal(raw, &private) != nil {
		return 0, 0, false
	}
	data, ok := private["matchPresenceData"].(map[string]any)
	if !ok {
		return 0, 0, false
	}
	allyRaw, allyOK := data["partyOwnerMatchScoreAllyTeam"]
	enemyRaw, enemyOK := data["partyOwnerMatchScoreEnemyTeam"]
	if !allyOK || !enemyOK {
		return 0, 0, false
	}
	ally, enemy := intFromAny(allyRaw), intFromAny(enemyRaw)
	ownerTeam := firstString(data, "partyOwnerMatchCurrentTeam")
	if ownerTeam != "" && localTeam != "" && !strings.EqualFold(ownerTeam, localTeam) {
		ally, enemy = enemy, ally
	}
	return ally, enemy, true
}

// markCurrentParty labels only the signed-in player's own party. Live match
// payloads do not expose every premade, so unknown groups stay unlabelled.
// Raw Riot party IDs never leave the backend.
func (h *Handler) markCurrentParty(val *valclient.ValClient, response *LiveMatchResponse) {
	// Kept for compatibility with non-live-match callers; the live
	// overlay uses markAllParties instead.
	current, err := getCurrentParty(val)
	if err != nil || current == nil || current.CurrentPartyID == "" {
		return
	}
	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil || details == nil || len(details.Members) < 2 {
		return
	}
	members := make([]string, 0, len(details.Members))
	for _, member := range details.Members {
		members = append(members, member.Subject)
	}
	markPartyMembers(response, members, "your-party")
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil && player.PartyGroup == "your-party" && !player.IsLocal && (player.Name == "Agent" || player.Name == "Enemy") {
				player.Name = h.getPlayerNameCached(val, player.Puuid)
			}
		}
	}
}

// markAllParties fans out across every player in the live match and
// groups them by their CurrentPartyID. Same-party players share an
// opaque group key (e.g. "your-party", "party-2", "party-3") which
// the frontend renders as a colored strip and a stack label.
//
// Caching follows the agent-select countdown pattern: the per-match
// fan-out is run exactly once when a new matchId is observed, and
// the resulting puuid->group map is reused for every subsequent
// poll until the match changes. This caps Riot traffic at 10
// lookups per match instead of 10 lookups every 5 seconds.
//
// Solo-queued players get no PartyGroup (Riot returns an empty
// CurrentPartyID for them) and stay unlabelled, which matches the
// "do not infer unknown parties" rule in the Handoff doc.
func (h *Handler) markAllParties(val *valclient.ValClient, response *LiveMatchResponse) {
	if response == nil || response.MatchID == "" {
		return
	}

	// Fast path: same matchId, use cached group map. This works
	// even without a val client — the cache is the source of truth
	// after the first fan-out.
	h.partyCacheMu.RLock()
	cached, ok := h.partyCache[response.MatchID]
	h.partyCacheMu.RUnlock()
	if ok {
		applyPartyMap(response, cached)
		return
	}

	if val == nil {
		return
	}

	puuidSet := collectLivePuuids(response)
	if len(puuidSet) == 0 {
		return
	}
	puuids := make([]string, 0, len(puuidSet))
	for puuid := range puuidSet {
		puuids = append(puuids, puuid)
	}

	// Slow path: fan out across all 10 players in parallel, then group the
	// completed results. Assigning keys after the fan-out ensures the local
	// party is always "your-party" regardless of response order.
	playerToParty := make(map[string]string, len(puuids))
	localPuuid := ""
	if val.Player != nil {
		localPuuid = val.Player.Uuid
	}

	var (
		mu sync.Mutex
		wg sync.WaitGroup
	)
	for _, puuid := range puuids {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			resp, err := getCurrentPartyByPuuid(val, p)
			if err != nil || resp == nil {
				return
			}
			partyID, ok := trustedPartyLookup(resp, p)
			if !ok {
				return
			}
			mu.Lock()
			playerToParty[p] = partyID
			mu.Unlock()
		}(puuid)
	}
	wg.Wait()
	groupMap := buildPartyGroupMap(playerToParty, localPuuid)

	h.partyCacheMu.Lock()
	h.partyCache[response.MatchID] = groupMap
	h.partyCacheMu.Unlock()

	applyPartyMap(response, groupMap)
}

func buildPartyGroupMap(playerToParty map[string]string, localPuuid string) map[string]string {
	localPartyID := ""
	for puuid, partyID := range playerToParty {
		if strings.EqualFold(puuid, localPuuid) {
			localPartyID = partyID
			break
		}
	}

	partyIDs := make(map[string]struct{})
	for _, partyID := range playerToParty {
		if partyID != "" && partyID != localPartyID {
			partyIDs[partyID] = struct{}{}
		}
	}
	sortedPartyIDs := make([]string, 0, len(partyIDs))
	for partyID := range partyIDs {
		sortedPartyIDs = append(sortedPartyIDs, partyID)
	}
	sort.Strings(sortedPartyIDs)

	partyToKey := make(map[string]string, len(sortedPartyIDs)+1)
	if localPartyID != "" {
		partyToKey[localPartyID] = "your-party"
	}
	for i, partyID := range sortedPartyIDs {
		partyToKey[partyID] = "party-" + strconv.Itoa(i+1)
	}

	groupMap := make(map[string]string, len(playerToParty))
	for puuid, partyID := range playerToParty {
		if key := partyToKey[partyID]; key != "" {
			groupMap[puuid] = key
		}
	}
	return groupMap
}

// trustedPartyLookup returns the CurrentPartyID only when the response
// is unambiguously about the queried player. Two guard rails:
//
//  1. Empty CurrentPartyID means solo queue — no party.
//  2. Subject must match the queried PUUID. Riot's
//     /parties/v1/players/{puuid} endpoint is auth-scoped to the local
//     user, so a query for someone else's PUUID can come back with the
//     local user's party record (Subject = local user). Treating that
//     as a hit would falsely stamp every teammate of the local user as
//     "your-party" and surface a phantom 5-stack in the live overlay.
//
// Returns (partyID, true) when the result is trustworthy, ("", false)
// otherwise. The caller should skip marking in the false case.
func trustedPartyLookup(resp *currentPartyPlayerResponse, queriedPuuid string) (string, bool) {
	if resp == nil || resp.CurrentPartyID == "" {
		return "", false
	}
	if !strings.EqualFold(resp.Subject, queriedPuuid) {
		return "", false
	}
	return resp.CurrentPartyID, true
}

// applyPartyMap stamps the cached opaque group keys onto every player
// in the response. Players missing from the map stay unlabelled.
func applyPartyMap(response *LiveMatchResponse, groupMap map[string]string) {
	if len(groupMap) == 0 {
		return
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil {
				continue
			}
			if key, ok := groupMap[player.Puuid]; ok && key != "" {
				player.PartyGroup = key
			}
		}
	}
}

func collectLivePuuids(response *LiveMatchResponse) map[string]struct{} {
	seen := make(map[string]struct{})
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player == nil || player.Puuid == "" {
				continue
			}
			seen[player.Puuid] = struct{}{}
		}
	}
	return seen
}

func markPartyMembers(response *LiveMatchResponse, memberPuuids []string, key string) {
	members := make(map[string]struct{}, len(memberPuuids))
	for _, puuid := range memberPuuids {
		members[puuid] = struct{}{}
	}
	for _, team := range [][]*LivePlayer{response.AllyTeam, response.EnemyTeam} {
		for _, player := range team {
			if player != nil {
				if _, ok := members[player.Puuid]; ok {
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
