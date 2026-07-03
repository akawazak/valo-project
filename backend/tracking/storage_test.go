package tracking

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPruneAndClearMatchCachePreserveRankHistory(t *testing.T) {
	db, err := OpenTrackingDB(filepath.Join(t.TempDir(), "tracking"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	old := time.Now().AddDate(0, 0, -60).UnixMilli()
	if _, err := db.Exec(`
		INSERT INTO matches
			(matchID, queueID, mapID, gameMode, gameStartMillis, seasonId, rawJsonPath, cachedAt, accountPuuid)
		VALUES ('old', 'competitive', 'map', 'mode', ?, 'act', '', ?, 'player');
		INSERT INTO match_players (matchID, subject, teamId, characterId)
		VALUES ('old', 'player', 'Blue', 'agent');
		INSERT INTO sync_state (puuid, lastSyncedAt) VALUES ('player', ?);
		INSERT INTO rr_snapshots (puuid, matchID, seasonId, matchStartTime)
		VALUES ('player', 'rank-only', 'act', ?);
	`, old, old, old, old); err != nil {
		t.Fatal(err)
	}

	removed, err := PruneMatchesBefore(db, time.Now().AddDate(0, 0, -30).UnixMilli())
	if err != nil || removed != 1 {
		t.Fatalf("prune removed=%d err=%v", removed, err)
	}
	if count, _ := CountCachedMatches(db); count != 0 {
		t.Fatalf("cached matches after prune = %d", count)
	}
	var rankRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM rr_snapshots`).Scan(&rankRows); err != nil || rankRows != 1 {
		t.Fatalf("rank snapshots after prune = %d err=%v", rankRows, err)
	}
	if err := ClearMatchCache(db); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM rr_snapshots`).Scan(&rankRows); err != nil || rankRows != 1 {
		t.Fatalf("rank snapshots after clear = %d err=%v", rankRows, err)
	}
}

func TestGetLatestPlayerCards(t *testing.T) {
	db, err := OpenTrackingDB(filepath.Join(t.TempDir(), "tracking"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`
		INSERT INTO matches
			(matchID, queueID, mapID, gameMode, gameStartMillis, seasonId, rawJsonPath, cachedAt, accountPuuid)
		VALUES
			('old', 'unrated', 'map', 'mode', 1, 'act', '', 1, 'owner'),
			('new', 'unrated', 'map', 'mode', 2, 'act', '', 2, 'owner');
		INSERT INTO match_players (matchID, subject, teamId, characterId, playerCardId)
		VALUES
			('old', 'friend', 'Blue', 'agent', 'old-card'),
			('new', 'friend', 'Blue', 'agent', 'new-card'),
			('new', 'other', 'Blue', 'agent', 'other-card');
	`); err != nil {
		t.Fatal(err)
	}

	cards, err := GetLatestPlayerCards(db, []string{"FRIEND", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if cards["friend"] != "new-card" || cards["other"] != "" {
		t.Fatalf("unexpected cards: %#v", cards)
	}
}
