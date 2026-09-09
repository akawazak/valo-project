package tracking

import (
	"path/filepath"
	"testing"
	"time"
)

func TestLiveEvidenceUsesBoundedCachedHistory(t *testing.T) {
	db, err := OpenTrackingDB(filepath.Join(t.TempDir(), "tracking"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now()
	for index, row := range []struct {
		id, agent, team              string
		tier, kills, deaths, assists int
		blueWon                      bool
	}{
		{"one", "jett", "Blue", 15, 20, 10, 4, true},
		{"two", "jett", "Red", 16, 8, 12, 3, true},
		{"three", "sage", "Blue", 18, 12, 8, 9, true},
	} {
		started := now.Add(time.Duration(index-3) * time.Hour).UnixMilli()
		if _, err = db.Exec(`INSERT INTO matches
			(matchID, queueID, mapID, gameMode, isRanked, gameStartMillis, seasonId, blueWins, rawJsonPath, cachedAt, accountPuuid)
			VALUES (?, 'competitive', 'map', 'mode', 1, ?, 'act', ?, '', ?, 'viewer')`, row.id, started, row.blueWon, started); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO match_players
			(matchID, subject, teamId, characterId, competitiveTier, kills, deaths, assists)
			VALUES (?, 'player', ?, ?, ?, ?, ?, ?)`, row.id, row.team, row.agent, row.tier, row.kills, row.deaths, row.assists); err != nil {
			t.Fatal(err)
		}
	}

	evidence, err := GetLivePlayerEvidence(db, "PLAYER", "JETT")
	if err != nil {
		t.Fatal(err)
	}
	if evidence.Matches != 2 || evidence.Wins != 1 || evidence.Kills != 28 || evidence.Deaths != 22 {
		t.Fatalf("unexpected agent sample: %#v", evidence)
	}
	if evidence.LatestTier != 18 || evidence.PeakTier != 18 || evidence.CacheUpdatedAt == 0 {
		t.Fatalf("unexpected rank/cache evidence: %#v", evidence)
	}
}

func TestCachedPartyGroupsUseExactPriorPartyWithoutExposingID(t *testing.T) {
	db, err := OpenTrackingDB(filepath.Join(t.TempDir(), "tracking"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now()
	for index, id := range []string{"one", "two"} {
		started := now.Add(time.Duration(index-2) * time.Hour).UnixMilli()
		if _, err = db.Exec(`INSERT INTO matches
			(matchID, queueID, mapID, gameMode, gameStartMillis, seasonId, rawJsonPath, cachedAt, accountPuuid)
			VALUES (?, 'unrated', 'map', 'mode', ?, 'act', '', ?, 'viewer')`, id, started, started); err != nil {
			t.Fatal(err)
		}
		for _, player := range []string{"alpha", "bravo", "solo"} {
			party := ""
			if player != "solo" {
				party = "raw-riot-party-id"
			}
			if _, err = db.Exec(`INSERT INTO match_players (matchID, subject, teamId, partyId, characterId)
				VALUES (?, ?, 'Blue', ?, 'agent')`, id, player, party); err != nil {
				t.Fatal(err)
			}
		}
	}

	groups, err := GetCachedPartyGroups(db, []string{"ALPHA", "bravo", "solo"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].Matches != 2 || len(groups[0].Players) != 2 {
		t.Fatalf("unexpected prior party evidence: %#v", groups)
	}
}
