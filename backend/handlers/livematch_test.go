package handlers

import (
	"encoding/base64"
	"testing"
	"time"
)

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

func TestEnrichKnownPlayerNamesPreservesRiotPrivacyPlaceholders(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam: []*LivePlayer{
			{Puuid: "party-friend", Name: "Player"},
			{Puuid: "hidden-party-friend", Name: "Agent", PartyGroup: "your-party"},
			{Puuid: "stranger", Name: "Agent"},
			{Puuid: "public", Name: "Already#Known"},
		},
		EnemyTeam: []*LivePlayer{{Puuid: "friend-enemy", Name: "Enemy"}},
	}

	enrichKnownPlayerNames(response, map[string]string{
		"party-friend":        "Party#One",
		"hidden-party-friend": "HiddenDuo#Two",
		"friend-enemy":        "Friend#Two",
		"stranger":            "Player",
		"public":              "Wrong#Name",
	})

	if response.AllyTeam[0].Name != "Party#One" {
		t.Fatal("confirmed party identity was not restored")
	}
	if response.AllyTeam[1].Name != "HiddenDuo#Two" {
		t.Fatal("confirmed hidden party identity was not restored")
	}
	if response.AllyTeam[2].Name != "Agent" || response.AllyTeam[3].Name != "Already#Known" || response.EnemyTeam[0].Name != "Enemy" {
		t.Fatal("Riot privacy placeholders or already-public identities were changed")
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

func TestLiveMatchCacheTTL(t *testing.T) {
	if got := liveMatchCacheTTL("pregame"); got != 8*time.Second {
		t.Fatalf("pregame cache TTL = %s", got)
	}
	if got := liveMatchCacheTTL("coregame"); got != 20*time.Second {
		t.Fatalf("coregame cache TTL = %s", got)
	}
	if got := liveMatchCacheTTL("none"); got != 15*time.Second {
		t.Fatalf("inactive cache TTL = %s", got)
	}
}

func TestRankSharedHistoryCandidatesRequiresTeammates(t *testing.T) {
	team := []*LivePlayer{
		{Puuid: "alpha"},
		{Puuid: "bravo"},
		{Puuid: "charlie"},
		{Puuid: "current-party", PartyGroup: "your-party"},
	}
	histories := map[string][]string{
		"alpha":         {"solo", "shared-two", "shared-three"},
		"bravo":         {"shared-two", "shared-three"},
		"charlie":       {"shared-three"},
		"current-party": {"shared-three"},
	}

	candidates := rankSharedHistoryCandidates(team, histories)
	if len(candidates) != 2 {
		t.Fatalf("expected 2 shared candidates, got %#v", candidates)
	}
	if candidates[0].MatchID != "shared-three" || candidates[0].PlayerCount != 3 {
		t.Fatalf("three-player candidate was not prioritized: %#v", candidates)
	}
	if candidates[1].MatchID != "shared-two" || candidates[1].PlayerCount != 2 {
		t.Fatalf("two-player candidate missing: %#v", candidates)
	}
}

func TestInterleaveSharedCandidatesKeepsBothTeams(t *testing.T) {
	allies := []sharedHistoryCandidate{{MatchID: "ally-1"}, {MatchID: "ally-2"}, {MatchID: "ally-3"}}
	enemies := []sharedHistoryCandidate{{MatchID: "enemy-1"}, {MatchID: "enemy-2"}, {MatchID: "enemy-3"}}

	selected := interleaveSharedCandidates(allies, enemies)
	got := []string{selected[0].MatchID, selected[1].MatchID, selected[2].MatchID, selected[3].MatchID}
	want := []string{"ally-1", "enemy-1", "ally-2", "enemy-2"}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("candidate order = %#v, want %#v", got, want)
		}
	}
}
