package tracking

import (
	"encoding/json"
	"testing"
)

func TestScoreDuoRoundTradesFirstDeathsAndAssists(t *testing.T) {
	kills := []playKill{
		{at: 1000, killer: "enemy-a", victim: "me"},                           // first death of the round
		{at: 2500, killer: "mate", victim: "enemy-a"},                         // mate trades me 1.5s later
		{at: 4000, killer: "me-not", victim: "enemy-b"},                       // unrelated
		{at: 9000, killer: "enemy-c", victim: "mate"},                         // mate dies
		{at: 15000, killer: "x", victim: "enemy-c"},                           // too late and not me
		{at: 16000, killer: "mate-ghost", victim: "enemy-d", assistants: nil}, // unrelated
	}
	r := scoreDuoRound(kills, "me", "mate")
	if r.myDeaths != 1 || r.mateDeaths != 1 {
		t.Fatalf("deaths = %d/%d", r.myDeaths, r.mateDeaths)
	}
	if len(r.theyTraded) != 1 || r.theyTraded[0] != 1500 || len(r.youTraded) != 0 {
		t.Fatalf("trades = %+v / %+v", r.theyTraded, r.youTraded)
	}
	if r.firstDeath != "me" || !r.firstCovered {
		t.Fatalf("first death = %q covered=%v", r.firstDeath, r.firstCovered)
	}

	assisted := scoreDuoRound([]playKill{
		{at: 100, killer: "me", victim: "e1", assistants: []string{"mate"}},
		{at: 200, killer: "mate", victim: "e2", assistants: []string{"me", "other"}},
		{at: 300, killer: "e3", victim: "mate"},
		{at: 5400, killer: "me", victim: "e3"}, // 5.1s: outside the trade window
	}, "me", "mate")
	if assisted.theyAssisted != 1 || assisted.youAssisted != 1 || len(assisted.youTraded) != 0 || assisted.firstDeath != "e1" {
		t.Fatalf("assists/late trade = %+v", assisted)
	}
}

func TestComputeDuoChemistryOnlyCountsSharedParties(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	const puuid = "mate-local"
	insert := func(matchID string, start int64, blueWon bool, duoParty string, mode ...string) {
		t.Helper()
		fixture := matchFixtureWithParty(puuid)
		info := fixture["matchInfo"].(map[string]any)
		info["matchId"] = matchID
		info["gameMode"] = "/Game/GameModes/Bomb/BombGameMode.BombGameMode_C"
		if len(mode) == 1 {
			info["gameMode"] = mode[0]
		}
		info["gameStartMillis"] = start
		teams := fixture["teams"].([]map[string]any)
		teams[0]["won"] = blueWon
		teams[1]["won"] = !blueWon
		fixture["players"].([]map[string]any)[1]["partyId"] = duoParty
		raw, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertMatchDetails(db, appDir, matchID, puuid, raw, nil); err != nil {
			t.Fatal(err)
		}
	}
	insert("d1", 1, true, "party-123")
	insert("d2", 2, false, "party-123")
	insert("d3", 3, true, "party-other")
	insert("d4", 4, true, "party-123", "/Game/GameModes/Skirmish/SkirmishGameMode.SkirmishGameMode_C") // side mode: left out

	duo, err := ComputeDuoChemistry(db, puuid, "DUO-PLAYER", "")
	if err != nil {
		t.Fatal(err)
	}
	if duo.Games != 2 || duo.Decided != 2 || duo.Wins != 1 {
		t.Fatalf("games = %+v", duo)
	}
	if len(duo.Recent) != 2 || duo.Recent[0].MatchID != "d2" {
		t.Fatalf("recent = %+v", duo.Recent)
	}
	if len(duo.Pairings) != 1 || duo.Pairings[0].Games != 2 || duo.Pairings[0].Wins != 1 {
		t.Fatalf("pairings = %+v", duo.Pairings)
	}
	partners, err := ListDuoPartners(db, puuid, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(partners) != 1 || partners[0].Subject != "duo-player" || partners[0].Games != 2 || partners[0].Wins != 1 || partners[0].GameName != "Duo" {
		t.Fatalf("partners = %+v", partners)
	}
	if _, err := ComputeDuoChemistry(db, puuid, puuid, ""); err == nil {
		t.Fatal("same player should be rejected")
	}
}
