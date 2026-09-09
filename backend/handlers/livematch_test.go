package handlers

import (
	"encoding/base64"
	"testing"
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

	if response.AllyTeam[0].Name != "Party#One" {
		t.Fatal("confirmed party identity was not restored")
	}
	if response.AllyTeam[1].Name != "Agent" || response.AllyTeam[2].Name != "Already#Known" || response.EnemyTeam[0].Name != "Enemy" {
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
