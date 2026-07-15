package tracking

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestSyncManagerStartFetchesAndCachesMatch(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "1d5787db-3672-5dc1-a379-21e0db115d40"
	requested := map[string]int{}
	fetch := func(method, apiURL string, body []byte) ([]byte, error) {
		if method != "GET" {
			return nil, fmt.Errorf("unexpected method %s", method)
		}
		requested[apiURL]++
		switch {
		case strings.Contains(apiURL, "/match-history/v1/history/"):
			if !strings.Contains(apiURL, "startIndex=0&endIndex=20") {
				return nil, fmt.Errorf("unexpected history page: %s", apiURL)
			}
			return json.Marshal(map[string]any{
				"Total": 1,
				"History": []map[string]any{
					{"MatchID": "match-1", "GameStartTime": int64(1700000000000), "QueueID": "competitive"},
				},
			})
		case strings.Contains(apiURL, "/match-details/v1/matches/match-1"):
			return json.Marshal(matchFixture(puuid))
		case strings.Contains(apiURL, "/mmr/v1/players/"):
			return json.Marshal(map[string]any{
				"Matches": []map[string]any{
					{
						"MatchID":                  "match-1",
						"SeasonID":                 "season-1",
						"MatchStartTime":           int64(1700000000000),
						"TierBeforeUpdate":         14,
						"TierAfterUpdate":          15,
						"RankedRatingBeforeUpdate": 44,
						"RankedRatingAfterUpdate":  62,
						"RankedRatingEarned":       18,
						"AFKPenalty":               0,
					},
				},
			})
		default:
			return nil, fmt.Errorf("unexpected url %s", apiURL)
		}
	}

	manager := NewSyncManager(db, fetch, appDir)
	done := make(chan error, 1)
	manager.SetDoneCallback(func(donePuuid string, runErr error) {
		if donePuuid != puuid {
			done <- fmt.Errorf("done puuid = %s", donePuuid)
			return
		}
		done <- runErr
	})

	started, err := manager.Start(puuid, "eu")
	if err != nil {
		t.Fatal(err)
	}
	if !started {
		t.Fatal("sync did not start")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("sync did not finish")
	}
	if manager.InFlight(puuid) {
		t.Fatal("sync remained in flight")
	}

	matches, err := ListCachedMatches(db, puuid, "", 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("cached matches = %d, want 1", len(matches))
	}
	if !matches[0].Win || matches[0].LocalPlayer.TeamID != "Blue" {
		t.Fatalf("bad local result: win=%v team=%s", matches[0].Win, matches[0].LocalPlayer.TeamID)
	}

	snaps, err := GetRRSnapshots(db, puuid, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(snaps) != 1 || snaps[0].RREarned != 18 {
		t.Fatalf("bad rr snapshots: %+v", snaps)
	}
	state, err := GetSyncState(db, puuid)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastHistoryEndIndex != -1 || state.LastCompetitiveEndIndex != -1 {
		t.Fatalf("history cursors = %d/%d, want -1/-1", state.LastHistoryEndIndex, state.LastCompetitiveEndIndex)
	}
	if len(requested) != 4 {
		t.Fatalf("requested urls = %d, want 4: %#v", len(requested), requested)
	}
}

func TestFetchHistoryLaneTreatsFirstPage404AsEmptyHistory(t *testing.T) {
	manager := &SyncManager{fetchRiot: func(string, string, []byte) ([]byte, error) {
		return nil, fmt.Errorf(`Riot API returned status 404: {"errorCode":"RESOURCE_NOT_FOUND"}`)
	}}

	history, next, err := manager.fetchHistoryLane("new-player", "eu", "", 0, 1000)
	if err != nil || len(history) != 0 || next != -1 {
		t.Fatalf("new account history = %#v, next %d, err %v", history, next, err)
	}
}

func TestSyncManagerBoundsHistoryWorkForLargeCaches(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "large-cache-player"
	if _, err := db.Exec(`
		INSERT INTO matches
			(matchID, queueID, mapID, gameMode, gameStartMillis, seasonId, rawJsonPath, cachedAt, accountPuuid)
		VALUES ('cached', 'competitive', 'map', 'mode', 1, 'season', '', 1, ?);
		INSERT INTO sync_state
			(puuid, lastSyncedAt, lastHistoryEndIndex, lastCompetitiveEndIndex)
		VALUES (?, 1, 220, 180)
	`, puuid, puuid); err != nil {
		t.Fatal(err)
	}

	historyRequests := 0
	fetch := func(method, apiURL string, _ []byte) ([]byte, error) {
		switch {
		case strings.Contains(apiURL, "/match-history/"):
			historyRequests++
			total := 400
			if strings.Contains(apiURL, "queue=competitive") {
				total = 200
			}
			history := make([]map[string]any, 20)
			for i := range history {
				history[i] = map[string]any{"MatchID": "cached"}
			}
			return json.Marshal(map[string]any{"Total": total, "History": history})
		case strings.Contains(apiURL, "/competitiveupdates"):
			return json.Marshal(map[string]any{"Matches": []any{}})
		default:
			return nil, fmt.Errorf("unexpected request %s %s", method, apiURL)
		}
	}

	manager := NewSyncManager(db, fetch, appDir)
	if err := manager.runOnce(puuid, "eu", false); err != nil {
		t.Fatal(err)
	}
	if historyRequests != 4 {
		t.Fatalf("history requests = %d, want 4", historyRequests)
	}
	state, err := GetSyncState(db, puuid)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastHistoryEndIndex != 240 || state.LastCompetitiveEndIndex != 20 {
		t.Fatalf("history cursors = %d/%d, want 240/20", state.LastHistoryEndIndex, state.LastCompetitiveEndIndex)
	}
}

func TestSyncManagerPublishesCompletedDetailBatchTogether(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "progressive-player"
	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	nameResolutionStarted := make(chan struct{})
	releaseNameResolution := make(chan struct{})
	nameResolutionCalls := 0
	fetch := func(method, apiURL string, _ []byte) ([]byte, error) {
		switch {
		case strings.Contains(apiURL, "/match-history/"):
			return json.Marshal(map[string]any{
				"Total": 2,
				"History": []map[string]any{
					{"MatchID": "progressive-1"},
					{"MatchID": "progressive-2"},
				},
			})
		case strings.Contains(apiURL, "/match-details/v1/matches/progressive-1"):
			fixture := matchFixture(puuid)
			fixture["matchInfo"].(map[string]any)["matchId"] = "progressive-1"
			return json.Marshal(fixture)
		case strings.Contains(apiURL, "/match-details/v1/matches/progressive-2"):
			close(secondStarted)
			<-releaseSecond
			fixture := matchFixture(puuid)
			fixture["matchInfo"].(map[string]any)["matchId"] = "progressive-2"
			return json.Marshal(fixture)
		case strings.Contains(apiURL, "/name-service/"):
			nameResolutionCalls++
			if nameResolutionCalls == 1 {
				close(nameResolutionStarted)
				<-releaseNameResolution
			}
			return json.Marshal([]any{})
		case strings.Contains(apiURL, "/competitiveupdates"):
			return json.Marshal(map[string]any{
				"Matches": []map[string]any{{
					"MatchID":                  "progressive-1",
					"SeasonID":                 "season-1",
					"MatchStartTime":           int64(1700000000000),
					"TierBeforeUpdate":         14,
					"TierAfterUpdate":          15,
					"RankedRatingBeforeUpdate": 44,
					"RankedRatingAfterUpdate":  62,
					"RankedRatingEarned":       18,
				}},
			})
		default:
			return nil, fmt.Errorf("unexpected request %s %s", method, apiURL)
		}
	}

	manager := NewSyncManager(db, fetch, appDir)
	done := make(chan error, 1)
	go func() { done <- manager.runOnce(puuid, "eu", false) }()

	select {
	case <-secondStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("second detail request did not start")
	}
	matches, err := ListCachedMatches(db, puuid, "", 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("matches visible before batch completed = %+v, want none", matches)
	}

	close(releaseSecond)
	select {
	case <-nameResolutionStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("name resolution did not start after detail batch")
	}
	matches, err = ListCachedMatches(db, puuid, "", 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 2 || matches[0].RREarned != 18 {
		t.Fatalf("completed batch = %+v, want 2 matches with RR already populated", matches)
	}
	close(releaseNameResolution)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSyncManagerRetriesIncompleteNameResolutionSameRun(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "retry-name-player"
	nameRequests := 0
	fetch := func(method, apiURL string, _ []byte) ([]byte, error) {
		switch {
		case strings.Contains(apiURL, "/match-history/"):
			return json.Marshal(map[string]any{
				"Total":   1,
				"History": []map[string]any{{"MatchID": "retry-name-match"}},
			})
		case strings.Contains(apiURL, "/match-details/v1/matches/retry-name-match"):
			fixture := matchFixture(puuid)
			fixture["matchInfo"].(map[string]any)["matchId"] = "retry-name-match"
			return json.Marshal(fixture)
		case strings.Contains(apiURL, "/name-service/"):
			nameRequests++
			if nameRequests == 1 {
				return nil, fmt.Errorf("temporary name-service failure")
			}
			return json.Marshal([]map[string]any{
				{"Subject": puuid, "GameName": "Recovered", "TagLine": "ONE"},
				{"Subject": "enemy", "GameName": "RecoveredEnemy", "TagLine": "TWO"},
			})
		case strings.Contains(apiURL, "/competitiveupdates"):
			return json.Marshal(map[string]any{"Matches": []any{}})
		default:
			return nil, fmt.Errorf("unexpected request %s %s", method, apiURL)
		}
	}

	manager := NewSyncManager(db, fetch, appDir)
	if err := manager.runOnce(puuid, "eu", false); err != nil {
		t.Fatal(err)
	}
	if nameRequests != 2 {
		t.Fatalf("name-service requests = %d, want 2", nameRequests)
	}

	rows, err := db.Query(`SELECT gameName, tagLine FROM match_players WHERE matchID = ? ORDER BY subject`, "retry-name-match")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var gameName, tagLine string
		if err := rows.Scan(&gameName, &tagLine); err != nil {
			t.Fatal(err)
		}
		got[gameName] = tagLine
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if got["Recovered"] != "ONE" || got["RecoveredEnemy"] != "TWO" {
		t.Fatalf("resolved identities = %#v", got)
	}
}

func TestSyncManagerRecoversRankedMatchBuriedOutsideGeneralHistory(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "rank-history-player"
	fetch := func(method, apiURL string, body []byte) ([]byte, error) {
		switch {
		case strings.Contains(apiURL, "/match-history/v1/history/") && strings.Contains(apiURL, "queue=competitive"):
			return json.Marshal(map[string]any{
				"Total": 1,
				"History": []map[string]any{
					{"MatchID": "old-ranked", "GameStartTime": int64(1700000000000), "QueueID": "competitive"},
				},
			})
		case strings.Contains(apiURL, "/match-history/v1/history/"):
			return json.Marshal(map[string]any{
				"Total": 1,
				"History": []map[string]any{
					{"MatchID": "recent-swiftplay", "GameStartTime": int64(1800000000000), "QueueID": "swiftplay"},
				},
			})
		case strings.Contains(apiURL, "/match-details/v1/matches/old-ranked"):
			fixture := matchFixture(puuid)
			fixture["matchInfo"].(map[string]any)["matchId"] = "old-ranked"
			return json.Marshal(fixture)
		case strings.Contains(apiURL, "/match-details/v1/matches/recent-swiftplay"):
			fixture := matchFixture(puuid)
			info := fixture["matchInfo"].(map[string]any)
			info["matchId"] = "recent-swiftplay"
			info["queueID"] = "swiftplay"
			info["isRanked"] = false
			return json.Marshal(fixture)
		case strings.Contains(apiURL, "/competitiveupdates"):
			return json.Marshal(map[string]any{"Matches": []any{}})
		default:
			return nil, fmt.Errorf("unexpected request %s %s", method, apiURL)
		}
	}

	manager := NewSyncManager(db, fetch, appDir)
	if err := manager.runOnce(puuid, "eu", false); err != nil {
		t.Fatal(err)
	}
	acts, err := RankActsFromCachedMatches(db, puuid)
	if err != nil {
		t.Fatal(err)
	}
	if len(acts) != 1 || acts[0].SeasonID != "season-1" || acts[0].PeakRank != 15 {
		t.Fatalf("recovered acts = %+v", acts)
	}
}

func TestListCachedMatchesIncludesQueuedPartyMembers(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	const puuid = "party-local"
	raw, err := json.Marshal(matchFixtureWithParty(puuid))
	if err != nil {
		t.Fatal(err)
	}
	if err := InsertMatchDetails(db, appDir, "party-match", puuid, raw, nil); err != nil {
		t.Fatal(err)
	}

	matches, err := ListCachedMatches(db, puuid, "", 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("matches = %d, want 1", len(matches))
	}
	if matches[0].LocalPlayer.PartyID != "party-123" {
		t.Fatalf("party id = %q, want party-123", matches[0].LocalPlayer.PartyID)
	}
	if len(matches[0].PartyMembers) != 1 {
		t.Fatalf("party members = %d, want 1", len(matches[0].PartyMembers))
	}
	if got := matches[0].PartyMembers[0].GameName; got != "Duo" {
		t.Fatalf("party member name = %q, want Duo", got)
	}
	detail, err := GetMatchFromCache(db, "party-match", puuid)
	if err != nil {
		t.Fatal(err)
	}
	if detail == nil || len(detail.Players) != 3 {
		t.Fatalf("cached detail = %+v, want 3 players", detail)
	}
	if len(detail.Rounds) != 1 || detail.Rounds[0].WinningTeam != "Blue" || detail.Rounds[0].PlantSite != "A" {
		t.Fatalf("cached rounds = %+v, want persisted Blue A-site round", detail.Rounds)
	}
	partyIDs := map[string]string{}
	for _, player := range detail.Players {
		partyIDs[player.Subject] = player.PartyID
	}
	if partyIDs[puuid] != "party-123" || partyIDs["duo-player"] != "party-123" || partyIDs["solo-player"] != "party-999" {
		t.Fatalf("cached detail party IDs = %#v", partyIDs)
	}
	selected, err := ListCachedMatchesFiltered(db, puuid, "swiftplay", "season-1", 0, 10)
	if err != nil || len(selected) != 1 {
		t.Fatalf("selected act matches = %d, err = %v; want 1", len(selected), err)
	}
	other, err := ListCachedMatchesFiltered(db, puuid, "", "season-2", 0, 10)
	if err != nil || len(other) != 0 {
		t.Fatalf("other act matches = %d, err = %v; want 0", len(other), err)
	}
}

func TestGetMatchFromCacheFocusesOnlyRequestedPlayer(t *testing.T) {
	appDir := t.TempDir()
	db, err := OpenTrackingDB(appDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	raw, err := json.Marshal(matchFixtureWithParty("first-account"))
	if err != nil {
		t.Fatal(err)
	}
	if err := InsertMatchDetails(db, appDir, "party-match", "first-account", raw, nil); err != nil {
		t.Fatal(err)
	}

	match, err := GetMatchFromCache(db, "party-match", "duo-player")
	if err != nil {
		t.Fatal(err)
	}
	for _, player := range match.Players {
		wantLocal := player.Subject == "duo-player"
		if player.IsLocal != wantLocal {
			t.Fatalf("player %q local=%v, want %v", player.Subject, player.IsLocal, wantLocal)
		}
	}
}

func matchFixture(puuid string) map[string]any {
	return map[string]any{
		"matchInfo": map[string]any{
			"matchId":          "match-1",
			"mapId":            "map-1",
			"queueID":          "competitive",
			"gameMode":         "bomb",
			"isRanked":         true,
			"gameStartMillis":  int64(1700000000000),
			"seasonId":         "season-1",
			"gameLengthMillis": 2100000,
			"completionState":  "Completed",
		},
		"teams": []map[string]any{
			{"teamId": "Blue", "won": true, "roundsWon": 13},
			{"teamId": "Red", "won": false, "roundsWon": 7},
		},
		"players": []map[string]any{
			{
				"subject":         puuid,
				"teamId":          "Blue",
				"characterId":     "agent-1",
				"accountLevel":    321,
				"competitiveTier": 15,
				"stats": map[string]any{
					"score":        5200,
					"roundsPlayed": 20,
					"kills":        18,
					"deaths":       12,
					"assists":      6,
				},
			},
			{
				"subject":         "enemy",
				"teamId":          "Red",
				"characterId":     "agent-2",
				"accountLevel":    99,
				"competitiveTier": 14,
				"stats": map[string]any{
					"score":        4100,
					"roundsPlayed": 20,
					"kills":        14,
					"deaths":       17,
					"assists":      3,
				},
			},
		},
		"roundResults": []map[string]any{
			{
				"roundNum":        0,
				"winningTeam":     "Blue",
				"roundResult":     "Bomb defused",
				"roundCeremony":   "CeremonyDefault",
				"bombPlanter":     "enemy",
				"bombDefuser":     puuid,
				"plantRoundTime":  42000,
				"plantSite":       "A",
				"defuseRoundTime": 73000,
				"playerStats": []map[string]any{
					{
						"subject": puuid,
						"damage": []map[string]any{
							{"receiver": "enemy", "damage": 156, "headshots": 1, "bodyshots": 2, "legshots": 0},
						},
					},
				},
			},
		},
	}
}

func matchFixtureWithParty(puuid string) map[string]any {
	return map[string]any{
		"matchInfo": map[string]any{
			"matchId":          "party-match",
			"mapId":            "map-2",
			"queueID":          "swiftplay",
			"gameMode":         "bomb",
			"isRanked":         false,
			"gameStartMillis":  int64(1700001000000),
			"seasonId":         "season-1",
			"gameLengthMillis": 900000,
			"completionState":  "Completed",
		},
		"teams": []map[string]any{
			{"teamId": "Blue", "won": true, "roundsWon": 5},
			{"teamId": "Red", "won": false, "roundsWon": 2},
		},
		"players": []map[string]any{
			{
				"subject":         puuid,
				"teamId":          "Blue",
				"partyId":         "party-123",
				"gameName":        "Local",
				"tagLine":         "VV",
				"characterId":     "agent-1",
				"accountLevel":    57,
				"competitiveTier": 0,
				"stats": map[string]any{
					"score":        1400,
					"roundsPlayed": 7,
					"kills":        6,
					"deaths":       1,
					"assists":      5,
				},
			},
			{
				"subject":         "duo-player",
				"teamId":          "Blue",
				"partyId":         "party-123",
				"gameName":        "Duo",
				"tagLine":         "PAL",
				"characterId":     "agent-2",
				"accountLevel":    60,
				"competitiveTier": 0,
				"stats": map[string]any{
					"score":        1200,
					"roundsPlayed": 7,
					"kills":        5,
					"deaths":       2,
					"assists":      4,
				},
			},
			{
				"subject":         "solo-player",
				"teamId":          "Blue",
				"partyId":         "party-999",
				"gameName":        "Solo",
				"tagLine":         "LFG",
				"characterId":     "agent-3",
				"accountLevel":    61,
				"competitiveTier": 0,
				"stats": map[string]any{
					"score":        900,
					"roundsPlayed": 7,
					"kills":        3,
					"deaths":       3,
					"assists":      1,
				},
			},
		},
		"roundResults": []map[string]any{
			{
				"roundNum":      0,
				"winningTeam":   "Blue",
				"roundResult":   "Bomb defused",
				"roundCeremony": "CeremonyDefault",
				"bombPlanter":   "solo-player",
				"bombDefuser":   puuid,
				"plantSite":     "A",
				"playerStats":   []map[string]any{},
			},
		},
	}
}
