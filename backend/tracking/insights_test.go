package tracking

import (
	"encoding/json"
	"testing"
)

func TestClutchAttemptFindsLastSurvivor(t *testing.T) {
	roster := map[string]string{"me": "Blue", "a1": "Blue", "a2": "Blue", "e1": "Red", "e2": "Red", "e3": "Red"}
	cases := []struct {
		name  string
		kills []insightKill
		want  bool
		size  int
	}{
		{"teammates die first, two enemies left", []insightKill{{"e1", "a1"}, {"me", "e1"}, {"e2", "a2"}}, true, 2},
		{"player dies before teammates", []insightKill{{"e1", "me"}, {"e2", "a1"}}, false, 0},
		{"enemies all dead before last teammate falls", []insightKill{{"me", "e1"}, {"me", "e2"}, {"me", "e3"}}, false, 0},
		{"duplicate death events are ignored", []insightKill{{"e1", "a1"}, {"e1", "a1"}, {"e2", "a2"}}, true, 3},
	}
	for _, tc := range cases {
		got, size := clutchAttempt(roster, "me", "Blue", tc.kills)
		if got != tc.want || size != tc.size {
			t.Errorf("%s: got (%v, %d), want (%v, %d)", tc.name, got, size, tc.want, tc.size)
		}
	}
	// Two-player teams are skirmish-style duels, not clutches.
	small := map[string]string{"me": "Blue", "a1": "Blue", "e1": "Red", "e2": "Red"}
	if got, _ := clutchAttempt(small, "me", "Blue", []insightKill{{"e1", "a1"}}); got {
		t.Error("2v2 counted as a clutch")
	}
}

func TestBuyBracketThresholds(t *testing.T) {
	for avg, want := range map[float64]string{800: "eco", 1599: "eco", 1600: "force", 3599: "force", 3600: "full", 4700: "full"} {
		if got := buyBracket(avg); got != want {
			t.Errorf("buyBracket(%v) = %s, want %s", avg, got, want)
		}
	}
}

func TestSessionFormTracksStreaksAndSessions(t *testing.T) {
	hour := int64(60 * 60 * 1000)
	matches := []insightMatch{
		{start: 0, decided: true, won: false},
		{start: hour / 2, decided: true, won: false},
		{start: hour, decided: true, won: true}, // after two losses
		{start: hour + hour/2, decided: false},  // deathmatch: skipped
		{start: 10 * hour, decided: true, won: true},
	}
	form := sessionForm(matches)
	if form.Sessions != 2 || form.Decided != 4 || form.Wins != 2 {
		t.Fatalf("form = %+v", form)
	}
	if form.AfterTwoLosses != (RoundTally{Attempts: 1, Wins: 1}) {
		t.Fatalf("after two losses = %+v", form.AfterTwoLosses)
	}
	if form.ByGame[0] != (RoundTally{Attempts: 2, Wins: 1}) || form.ByGame[2] != (RoundTally{Attempts: 1, Wins: 1}) {
		t.Fatalf("by game = %+v", form.ByGame)
	}
}

func TestGetEncountersSplitsTeammatesAndOpponents(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "enc-local"
	insert := func(matchID string, start int64, duoTeam string, blueWon bool) {
		t.Helper()
		fixture := matchFixtureWithParty(puuid)
		info := fixture["matchInfo"].(map[string]any)
		info["matchId"] = matchID
		info["gameStartMillis"] = start
		teams := fixture["teams"].([]map[string]any)
		teams[0]["won"] = blueWon
		teams[1]["won"] = !blueWon
		fixture["players"].([]map[string]any)[1]["teamId"] = duoTeam
		raw, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertMatchDetails(db, appDir, matchID, puuid, raw, nil); err != nil {
			t.Fatal(err)
		}
	}
	insert("e1", 10, "Blue", true) // teammates, won
	insert("e2", 20, "Blue", false)
	insert("e3", 30, "Red", true) // opponents, local Blue won
	got, err := GetEncounters(db, puuid, []string{"DUO-PLAYER", puuid, "stranger"})
	if err != nil {
		t.Fatal(err)
	}
	want := Encounter{With: 2, WithWins: 1, Against: 1, AgainstWins: 1, LastPlayedAt: 30}
	if len(got) != 1 || got["duo-player"] != want {
		t.Fatalf("encounters = %+v, want duo-player %+v", got, want)
	}
}
