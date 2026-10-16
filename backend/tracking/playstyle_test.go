package tracking

import "testing"

func playstyleLobby() map[string]*playerLine {
	return map[string]*playerLine{
		"me": {team: "Blue", rounds: 1}, "a1": {team: "Blue", rounds: 1}, "a2": {team: "Blue", rounds: 1},
		"e1": {team: "Red", rounds: 1}, "e2": {team: "Red", rounds: 1}, "e3": {team: "Red", rounds: 1},
	}
}

func TestScoreRoundCountsEntryTradesKastAndClutch(t *testing.T) {
	match := playstyleLobby()
	kills := []playKill{
		{at: 1000, killer: "e1", victim: "a1"},                             // e1 opens
		{at: 3000, killer: "me", victim: "e1", assistants: []string{"a2"}}, // me trades a1 within 5s
		{at: 9000, killer: "e2", victim: "a2"},                             // me now alone against e2, e3
		{at: 20000, killer: "me", victim: "e2"},
	}
	scoreRound(match, kills, "Blue") // defused: Blue wins with e3 alive
	if match["e1"].firstKills != 1 || match["me"].firstKills != 0 || match["a1"].firstDeaths != 1 {
		t.Fatalf("openings: e1 kills=%d me kills=%d a1 deaths=%d", match["e1"].firstKills, match["me"].firstKills, match["a1"].firstDeaths)
	}
	if match["me"].trades != 1 {
		t.Fatalf("trades = %d, want 1", match["me"].trades)
	}
	// a1 died but was traded, a2 assisted, me, e1 and e2 got kills, e3 survived.
	for subject, want := range map[string]int{"me": 1, "a1": 1, "a2": 1, "e1": 1, "e2": 1, "e3": 1} {
		if got := match[subject].kastRounds; got != want {
			t.Errorf("%s KAST rounds = %d, want %d", subject, got, want)
		}
	}
	if match["me"].clutchTries != 1 || match["me"].clutchWins != 1 {
		t.Fatalf("clutch = %d/%d, want 1/1 (round won by defuse)", match["me"].clutchWins, match["me"].clutchTries)
	}
}

func TestScoreRoundLateKillIsNotATrade(t *testing.T) {
	match := playstyleLobby()
	scoreRound(match, []playKill{{at: 1000, killer: "e1", victim: "a1"}, {at: 9000, killer: "me", victim: "e1"}}, "Red")
	if match["me"].trades != 0 || match["a1"].kastRounds != 0 {
		t.Fatalf("trade counted after 8s: trades=%d a1 KAST=%d", match["me"].trades, match["a1"].kastRounds)
	}
}

func TestAxisScoreRanksAgainstLobby(t *testing.T) {
	lobby := playstyleLobby()
	for subject, damage := range map[string]int{"me": 300, "a1": 100, "a2": 120, "e1": 140, "e2": 160, "e3": 400} {
		lobby[subject].damage = damage
		lobby[subject].hs, lobby[subject].body = 1, 3
	}
	lines := map[string]map[string]*playerLine{"m1": lobby}
	// ADR: 4 of 5 below; HS: all tied (half each) -> (0.8 + 0.5) / 2 = 65.
	if score, _, _ := axisScore(lines, "me", []string{"m1"}, "aim"); score != 65 {
		t.Fatalf("aim = %d, want 65", score)
	}
	lobby["me"].clutchTries, lobby["me"].clutchWins = 4, 2
	lobby["e1"].clutchTries, lobby["e1"].clutchWins = 4, 1
	if score, mine, avg := axisScore(lines, "me", []string{"m1"}, "clutch"); score != 100 || mine != 50 || avg != 25 {
		t.Fatalf("clutch = %d (%v vs %v), want 100 (50 vs 25)", score, mine, avg)
	}
}
