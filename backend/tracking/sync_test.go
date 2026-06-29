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
	if state.LastHistoryEndIndex != 20 {
		t.Fatalf("last history end index = %d, want 20", state.LastHistoryEndIndex)
	}
	if len(requested) != 3 {
		t.Fatalf("requested urls = %d, want 3: %#v", len(requested), requested)
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
	}
}
