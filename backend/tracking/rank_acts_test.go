package tracking

import "testing"

func TestRankActsFromSnapshotsBuildsNewestActFirst(t *testing.T) {
	acts := RankActsFromSnapshots([]RRSnapshot{
		{SeasonID: "old", TierAfter: 15, RRAfter: 40, RREarned: 18, MatchStartTime: 10},
		{SeasonID: "old", TierBefore: 15, TierAfter: 16, RRAfter: 12, RREarned: 22, MatchStartTime: 20},
		{SeasonID: "new", TierAfter: 17, RRAfter: 55, RREarned: -17, MatchStartTime: 30},
	})

	if len(acts) != 2 || acts[0].SeasonID != "new" {
		t.Fatalf("unexpected act order: %#v", acts)
	}
	if acts[1].Games != 2 || acts[1].Wins != 2 || acts[1].PeakRank != 16 ||
		acts[1].FinalRank != 16 || acts[1].RankedRating != 12 {
		t.Fatalf("unexpected old act summary: %#v", acts[1])
	}
}

func TestRankActsFromCachedMatchesRecoversPeakAndFinalTier(t *testing.T) {
	db, err := OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, row := range []struct {
		match, season, team string
		started, tier       int
		blueWon             bool
	}{
		{"old-1", "act-old", "Blue", 100, 18, true},
		{"old-2", "act-old", "Red", 200, 17, false},
		{"new-1", "act-new", "Blue", 300, 21, true},
	} {
		_, err = db.Exec(`INSERT INTO matches
			(matchID, queueID, mapID, gameMode, isRanked, gameStartMillis, seasonId, blueWins, rawJsonPath, cachedAt, accountPuuid)
			VALUES (?, 'competitive', 'map', 'mode', 1, ?, ?, ?, '', ?, 'viewer')`, row.match, row.started, row.season, row.blueWon, row.started)
		if err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(`INSERT INTO match_players (matchID, subject, teamId, characterId, competitiveTier)
			VALUES (?, 'viewer', ?, 'agent', ?)`, row.match, row.team, row.tier)
		if err != nil {
			t.Fatal(err)
		}
	}

	acts, err := RankActsFromCachedMatches(db, "VIEWER")
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 2 || acts[0].SeasonID != "act-new" || acts[1].PeakRank != 18 || acts[1].FinalRank != 17 {
		t.Fatalf("unexpected cached acts: %#v", acts)
	}
}

func TestRankActsCacheRoundTrip(t *testing.T) {
	db, err := OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	want := []RankActSummary{
		{SeasonID: "new", Wins: 8, Games: 14, RankedRating: 37, PeakRank: 21, FinalRank: 20},
		{SeasonID: "old", Wins: 10, Games: 18, RankedRating: 64, PeakRank: 18, FinalRank: 18},
	}
	if err := CacheRankActs(db, "PLAYER", want); err != nil {
		t.Fatal(err)
	}
	got, err := GetCachedRankActs(db, "player")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("cached acts mismatch: got %#v want %#v", got, want)
	}
}
