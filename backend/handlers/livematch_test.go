package handlers

import (
	"encoding/base64"
	"testing"
	"time"
)

func TestLiveRankFromMMRKeepsPreviousActOutOfCurrentRank(t *testing.T) {
	var mmr playerMMRResponse
	mmr.LatestCompetitiveUpdate.SeasonID = "previous-act"
	mmr.LatestCompetitiveUpdate.TierAfterUpdate = 17
	mmr.LatestCompetitiveUpdate.RankedRatingAfterUpdate = 42
	mmr.QueueSkills = map[string]struct {
		SeasonalInfoBySeasonID map[string]struct {
			NumberOfWins    int            `json:"NumberOfWins"`
			NumberOfGames   int            `json:"NumberOfGames"`
			CompetitiveTier int            `json:"CompetitiveTier"`
			RankedRating    int            `json:"RankedRating"`
			WinsByTier      map[string]int `json:"WinsByTier"`
		} `json:"SeasonalInfoBySeasonID"`
	}{
		"competitive": {
			SeasonalInfoBySeasonID: map[string]struct {
				NumberOfWins    int            `json:"NumberOfWins"`
				NumberOfGames   int            `json:"NumberOfGames"`
				CompetitiveTier int            `json:"CompetitiveTier"`
				RankedRating    int            `json:"RankedRating"`
				WinsByTier      map[string]int `json:"WinsByTier"`
			}{
				"older-act": {CompetitiveTier: 14, WinsByTier: map[string]int{"19": 1}},
			},
		},
	}

	tier, rr, peak := liveRankFromMMR(mmr, "missing-current-act")
	if tier != 0 || rr != 0 || peak != 19 {
		t.Fatalf("rank result = (%d, %d, %d), want unranked current act and peak 19", tier, rr, peak)
	}
}

func TestNormalizeChatPresenceReadsLiveScore(t *testing.T) {
	payload := `{"sessionLoopState":"INGAME","partyOwnerMatchScoreAllyTeam":7,"partyOwnerMatchScoreEnemyTeam":"5"}`
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:   "local-player",
		Product: "valorant",
		Private: base64.StdEncoding.EncodeToString([]byte(payload)),
	}, nil)
	if !presence.ScoreAvailable || presence.AllyScore != 7 || presence.EnemyScore != 5 {
		t.Fatalf("unexpected score presence: %#v", presence)
	}
}

func TestNormalizeChatPresenceReadsNestedLiveScore(t *testing.T) {
	presence := normalizeChatPresence(chatPresenceEntry{
		Product: "valorant",
		Private: `{"matchPresenceData":{"partyOwnerMatchScoreAllyTeam":0,"partyOwnerMatchScoreEnemyTeam":1}}`,
	}, nil)
	if !presence.ScoreAvailable || presence.AllyScore != 0 || presence.EnemyScore != 1 {
		t.Fatalf("unexpected nested score presence: %#v", presence)
	}
}

func TestMarkPartyMembersUsesOpaqueGroup(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam:  []*LivePlayer{{Puuid: "local"}, {Puuid: "friend"}, {Puuid: "solo"}},
		EnemyTeam: []*LivePlayer{{Puuid: "enemy"}},
	}

	markPartyMembers(response, []string{"LOCAL", "FRIEND"}, "your-party")

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("confirmed party members were not grouped")
	}
	if response.AllyTeam[2].PartyGroup != "" || response.EnemyTeam[0].PartyGroup != "" {
		t.Fatal("unconfirmed players must not be guessed into a party")
	}
}

func TestEnrichKnownPlayerNamesOnlyRevealsKnownPrivatePlayers(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam: []*LivePlayer{
			{Puuid: "party-friend", Name: "Agent"},
			{Puuid: "stranger", Name: "Agent"},
			{Puuid: "public", Name: "Already#Known"},
		},
		EnemyTeam: []*LivePlayer{{Puuid: "friend-enemy", Name: "Enemy"}},
	}

	enrichKnownPlayerNames(response, map[string]string{
		"party-friend": "Party#One",
		"friend-enemy": "Friend#Two",
		"stranger":     "Player",
		"public":       "Wrong#Name",
	})

	if response.AllyTeam[0].Name != "Party#One" || response.EnemyTeam[0].Name != "Friend#Two" {
		t.Fatal("known party/friend identities were not restored")
	}
	if response.AllyTeam[1].Name != "Agent" || response.AllyTeam[2].Name != "Already#Known" {
		t.Fatal("unknown or already-public identities must stay unchanged")
	}
}

func TestMarkKnownPartyGroupsPreservesYourParty(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam: []*LivePlayer{
			{Puuid: "local", PartyGroup: "your-party"},
			{Puuid: "friend-a"},
			{Puuid: "friend-b"},
		},
	}
	markKnownPartyGroups(response, map[string]string{
		"local":    "party-other",
		"friend-a": "party-known",
		"friend-b": "party-known",
	})
	if response.AllyTeam[0].PartyGroup != "your-party" {
		t.Fatal("presence grouping replaced the signed-in player's confirmed party")
	}
	if response.AllyTeam[1].PartyGroup != "party-known" || response.AllyTeam[2].PartyGroup != "party-known" {
		t.Fatal("known friend premade was not grouped")
	}
}

func TestAnonymousPartyGroupDoesNotExposeRiotPartyID(t *testing.T) {
	raw := "12345678-1234-1234-1234-123456789abc"
	group := anonymousPartyGroup(raw)
	if group == "" || group == raw {
		t.Fatalf("party group was not anonymized: %q", group)
	}
	if anonymousPartyGroup("") != "" {
		t.Fatal("empty party ID must stay ungrouped")
	}
}

func TestApplyLikelyStackGroupsDoesNotReplaceConfirmedParty(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam: []*LivePlayer{
			{Puuid: "local", PartyGroup: "your-party"},
			{Puuid: "friend", PartyGroup: "your-party"},
			{Puuid: "random-a"},
			{Puuid: "random-b"},
		},
	}

	applyLikelyStackGroups(response, [][]string{{"random-a", "random-b"}, {"local", "friend"}})

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("likely-stack scan replaced confirmed party membership")
	}
	for _, player := range response.AllyTeam[2:] {
		if player.PartyGroup != "likely-stack-1" || player.PartyConfidence != "likely" {
			t.Fatalf("likely stack was not labelled correctly: %+v", player)
		}
	}
}

func TestApplyLikelyStackGroupsCompletesPartialPresenceGroup(t *testing.T) {
	response := &LiveMatchResponse{EnemyTeam: []*LivePlayer{
		{Puuid: "enemy-a", PartyGroup: "party-known"},
		{Puuid: "enemy-b"},
	}}
	applyLikelyStackGroups(response, [][]string{{"enemy-a", "enemy-b"}})
	if response.EnemyTeam[0].PartyGroup != "party-known" || response.EnemyTeam[1].PartyGroup != "party-known" {
		t.Fatalf("partial presence party was not completed: %#v", response.EnemyTeam)
	}
}

func TestLiveRankRetryWaitsThenRetriesMissingPlayer(t *testing.T) {
	h := NewHandler(nil)
	response := &LiveMatchResponse{AllyTeam: []*LivePlayer{{Puuid: "player-a"}}}
	h.liveRanks["match"] = liveRankCache{
		Attempted:  map[string]struct{}{},
		ExpiresAt:  time.Now().Add(time.Minute),
		RetryAfter: time.Now().Add(time.Minute),
	}
	if h.hasUnattemptedLiveRanks("match", response) {
		t.Fatal("a failed lookup retried before its backoff elapsed")
	}
	cached := h.liveRanks["match"]
	cached.RetryAfter = time.Now().Add(-time.Second)
	h.liveRanks["match"] = cached
	if !h.hasUnattemptedLiveRanks("match", response) {
		t.Fatal("a failed lookup was cached as permanently attempted")
	}
}

func TestLookupCachedLiveRankUsesFreshestOverlayRank(t *testing.T) {
	h := NewHandler(nil)
	h.liveRanks["old-match"] = liveRankCache{
		Players: map[string]liveRankSnapshot{
			"player-a": {CompetitiveTier: 10, RankedRating: 12, PeakTier: 11},
		},
		ExpiresAt: time.Now().Add(time.Hour),
		UpdatedAt: time.Now().Add(-time.Minute),
	}
	h.liveRanks["new-match"] = liveRankCache{
		Players: map[string]liveRankSnapshot{
			"player-a": {CompetitiveTier: 18, RankedRating: 44, PeakTier: 20},
		},
		ExpiresAt: time.Now().Add(time.Hour),
		UpdatedAt: time.Now(),
	}

	rank, ok := h.lookupCachedLiveRank("PLAYER-A")
	if !ok {
		t.Fatal("fresh live rank was not found")
	}
	if rank.CompetitiveTier != 18 || rank.RankedRating != 44 || rank.PeakTier != 20 {
		t.Fatalf("cached rank = %+v, want newest overlay rank", rank)
	}
}

func TestIsTrainingMode(t *testing.T) {
	for _, modeID := range []string{"/Game/GameModes/Training/TrainingGameMode", "OpenRange", "practice-range"} {
		if !isTrainingMode(modeID) {
			t.Fatalf("training mode was not recognized: %q", modeID)
		}
	}
	if isTrainingMode("/Game/GameModes/Bomb/BombGameMode") {
		t.Fatal("standard mode was incorrectly recognized as training")
	}
}
