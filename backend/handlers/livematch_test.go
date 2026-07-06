package handlers

import "testing"

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
