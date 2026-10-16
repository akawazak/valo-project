package tracking

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestListPlayedQueuesReturnsCachedQueuesWithLatestGameMode(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "queue-local"
	insert := func(matchID, queueID, gameMode string, start int64) {
		t.Helper()
		fixture := matchFixtureWithParty(puuid)
		info := fixture["matchInfo"].(map[string]any)
		info["matchId"] = matchID
		info["queueID"] = queueID
		info["gameMode"] = gameMode
		info["gameStartMillis"] = start
		raw, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertMatchDetails(db, appDir, matchID, puuid, raw, nil); err != nil {
			t.Fatal(err)
		}
	}
	insert("m1", "skirmish", "/Game/GameModes/Skirmish/Old.Old_C", 1)
	insert("m2", "skirmish", "/Game/GameModes/Skirmish/New.New_C", 2)
	insert("m3", "retake", "/Game/GameModes/FortCollins/FortCollins.FortCollins_C", 3)
	insert("m4", "", "/Game/GameModes/Bomb/Bomb.Bomb_C", 4)

	queues, err := ListPlayedQueues(db, puuid)
	if err != nil {
		t.Fatal(err)
	}
	if len(queues) != 2 {
		t.Fatalf("queues = %+v, want skirmish and retake only", queues)
	}
	if queues[0].QueueID != "skirmish" || queues[0].Matches != 2 || queues[0].GameMode != "/Game/GameModes/Skirmish/New.New_C" {
		t.Fatalf("first queue = %+v", queues[0])
	}
	if queues[1].QueueID != "retake" || queues[1].Matches != 1 {
		t.Fatalf("second queue = %+v", queues[1])
	}
}

func TestCaptureRawMatchWritesPayloadOnlyWhenEnabled(t *testing.T) {
	dir := t.TempDir()
	captureRawMatch("disabled", []byte(`{}`))
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("capture wrote files while disabled: %v", entries)
	}

	t.Setenv(RawCaptureDirEnv, dir)
	captureRawMatch("../escape/match-1", []byte(`{"matchInfo":{}}`))
	got, err := os.ReadFile(filepath.Join(dir, "match-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"matchInfo":{}}` {
		t.Fatalf("captured = %s", got)
	}
}

func TestListFrequentTeammatesCountsSharedPartiesAndWins(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "mate-local"
	insert := func(matchID string, start int64, blueWon bool, duoParty string) {
		t.Helper()
		fixture := matchFixtureWithParty(puuid)
		info := fixture["matchInfo"].(map[string]any)
		info["matchId"] = matchID
		info["gameStartMillis"] = start
		teams := fixture["teams"].([]map[string]any)
		teams[0]["won"] = blueWon
		teams[1]["won"] = !blueWon
		players := fixture["players"].([]map[string]any)
		players[1]["partyId"] = duoParty
		raw, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertMatchDetails(db, appDir, matchID, puuid, raw, nil); err != nil {
			t.Fatal(err)
		}
	}
	// The local player and "duo-player" share party-123 in three matches and
	// win two of them; in the fourth the duo queued separately.
	insert("t1", 1, true, "party-123")
	insert("t2", 2, false, "party-123")
	insert("t3", 3, true, "party-123")
	insert("t4", 4, true, "party-other")

	mates, err := ListFrequentTeammates(db, puuid, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(mates) != 1 {
		t.Fatalf("mates = %+v, want only duo-player", mates)
	}
	got := mates[0]
	if got.Subject != "duo-player" || got.Games != 3 || got.Decided != 3 || got.Wins != 2 || got.LastPlayed != 3 {
		t.Fatalf("mate = %+v", got)
	}
	if got.GameName != "Duo" || got.TagLine != "PAL" || got.CharacterID != "agent-2" {
		t.Fatalf("identity = %+v", got)
	}
}

func TestListCachedMatchesRanksDeathmatchPlacement(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "dm-local"
	fixture := matchFixtureWithParty(puuid)
	info := fixture["matchInfo"].(map[string]any)
	info["matchId"] = "dm-1"
	info["queueID"] = "deathmatch"
	info["gameMode"] = "/Game/GameModes/Deathmatch/DeathmatchGameMode.DeathmatchGameMode_C"
	players := fixture["players"].([]map[string]any)
	stats := func(kills, score int) map[string]any {
		return map[string]any{"score": score, "roundsPlayed": 1, "kills": kills, "deaths": 10, "assists": 0}
	}
	// The local player ties the third player on kills but has the higher
	// score, so only the 40-kill winner places above them.
	players[0]["stats"] = stats(31, 9000)
	players[1]["stats"] = stats(40, 12000)
	third := map[string]any{"subject": "dm-third", "teamId": "Red", "partyId": "solo", "characterId": "agent-3", "stats": stats(31, 8000)}
	fixture["players"] = append(players, third)
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := InsertMatchDetails(db, appDir, "dm-1", puuid, raw, nil); err != nil {
		t.Fatal(err)
	}

	matches, err := ListCachedMatches(db, puuid, "", 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("matches = %+v", matches)
	}
	got := matches[0]
	wantCount := len(fixture["players"].([]map[string]any))
	if got.Placement != 2 || got.PlayerCount != wantCount || got.BestOtherKills != 40 {
		t.Fatalf("placement = %d of %d (best other %d), want 2 of %d (40)", got.Placement, got.PlayerCount, got.BestOtherKills, wantCount)
	}
}

func TestNumberedTeamResultsGiveGauntletWins(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "gauntlet-local"
	insert := func(matchID string, start int64, localWins bool) {
		t.Helper()
		fixture := matchFixtureWithParty(puuid)
		info := fixture["matchInfo"].(map[string]any)
		info["matchId"] = matchID
		info["gameStartMillis"] = start
		info["queueID"] = "abilitydraftarena"
		players := fixture["players"].([]map[string]any)
		for i := range players {
			players[i]["teamId"] = "Team_2"
		}
		players[0]["teamId"] = "Team_1"
		players[1]["teamId"] = "Team_1"
		fixture["teams"] = []map[string]any{
			{"teamId": "Team_1", "won": localWins, "tempR": map[bool]int{true: 1, false: 3}[localWins], "roundsPlayed": 16},
			{"teamId": "Team_2", "won": !localWins, "tempR": map[bool]int{true: 2, false: 1}[localWins], "roundsPlayed": 16},
			{"teamId": "Team_3", "won": false, "tempR": map[bool]int{true: 3, false: 2}[localWins], "roundsPlayed": 16},
		}
		raw, err := json.Marshal(fixture)
		if err != nil {
			t.Fatal(err)
		}
		if err := InsertMatchDetails(db, appDir, matchID, puuid, raw, nil); err != nil {
			t.Fatal(err)
		}
	}
	insert("g-win", 2, true)
	insert("g-loss", 1, false)

	var stored int
	if err := db.QueryRow(`SELECT COUNT(*) FROM match_teams WHERE matchID = 'g-win'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != 3 {
		t.Fatalf("stored teams = %d, want 3", stored)
	}

	matches, err := ListCachedMatches(db, puuid, "", 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 {
		t.Fatalf("matches = %+v", matches)
	}
	if matches[0].TeamPlacement != 1 || matches[1].TeamPlacement != 3 {
		t.Fatalf("placements = %d, %d, want 1 and 3", matches[0].TeamPlacement, matches[1].TeamPlacement)
	}
	if !matches[0].Win || matches[0].TeamCount != 3 {
		t.Fatalf("g-win summary = win %v teams %d, want win with 3 teams", matches[0].Win, matches[0].TeamCount)
	}
	if matches[1].Win || matches[1].TeamCount != 3 {
		t.Fatalf("g-loss summary = win %v teams %d, want loss with 3 teams", matches[1].Win, matches[1].TeamCount)
	}
}

func TestMatchDetailsKeepRiotMVPBehaviorAndPenalties(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "extras-local"
	fixture := matchFixtureWithParty(puuid)
	info := fixture["matchInfo"].(map[string]any)
	info["matchId"] = "extras-1"
	info["isEarlyCompletion"] = true
	info["partyRRPenalties"] = map[string]any{"party-123": 4.0}
	players := fixture["players"].([]map[string]any)
	players[0]["behaviorFactors"] = map[string]any{
		"afkRounds": 1.0, "stayedInSpawnRounds": 2.0, "friendlyFireOutgoing": 35.4,
		"friendlyFireIncoming": 12.0, "selfDamage": 50.0, "collisions": 0.03,
	}
	fixture["teams"] = []map[string]any{
		{"teamId": "Blue", "won": true, "roundsWon": 5, "tempR": 1, "mvp": puuid},
		{"teamId": "Red", "won": false, "roundsWon": 2, "tempR": 2, "mvp": "someone-else"},
	}
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := InsertMatchDetails(db, appDir, "extras-1", puuid, raw, nil); err != nil {
		t.Fatal(err)
	}

	cache, err := GetMatchFromCache(db, "extras-1", puuid)
	if err != nil || cache == nil {
		t.Fatalf("cache = %v, err = %v", cache, err)
	}
	if cache.Match.EarlyCompletion != 1 || cache.Match.AnalyticsVersion != CurrentAnalyticsVersion {
		t.Fatalf("match row = %+v", cache.Match)
	}
	var local PlayerRow
	for _, p := range cache.Players {
		if p.IsLocal {
			local = p
		}
	}
	want := PlayerBehavior{AFKRounds: 1, StayedInSpawnRounds: 2, FriendlyFireOutgoing: 35, FriendlyFireIncoming: 12, SelfDamage: 50}
	if local.Behavior != want || local.PartyRRPenalty != 4 {
		t.Fatalf("local behavior = %+v penalty %d, want %+v penalty 4", local.Behavior, local.PartyRRPenalty, want)
	}
	if len(cache.Teams) != 2 || cache.Teams[0].MVP != puuid {
		t.Fatalf("teams = %+v, want Blue MVP %s", cache.Teams, puuid)
	}
}
