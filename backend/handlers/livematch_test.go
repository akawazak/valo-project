package handlers

import "testing"

func TestMarkPartyMembersUsesOpaqueGroup(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam:  []*LivePlayer{{Puuid: "local"}, {Puuid: "friend"}, {Puuid: "solo"}},
		EnemyTeam: []*LivePlayer{{Puuid: "enemy"}},
	}

	markPartyMembers(response, []string{"local", "friend"})

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("confirmed party members were not grouped")
	}
	if response.AllyTeam[2].PartyGroup != "" || response.EnemyTeam[0].PartyGroup != "" {
		t.Fatal("unconfirmed players must not be guessed into a party")
	}
}
