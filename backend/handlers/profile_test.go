package handlers

import (
	"encoding/json"
	"errors"
	"testing"

	"backend/tracking"
)

func TestRiotFailureReasonKeepsRankErrorsActionable(t *testing.T) {
	if got := riotFailureReason(errors.New(`Riot API returned status 404: {"message":"resource not found"}`)); got != "HTTP 404" {
		t.Fatalf("status reason = %q", got)
	}
	if got := riotFailureReason(errors.New("Riot returned no competitive updates")); got != "no competitive matches returned" {
		t.Fatalf("empty history reason = %q", got)
	}
}

func TestMergeLiveMMRUsesDocumentedSeasonFields(t *testing.T) {
	var live playerMMRResponse
	if err := json.Unmarshal([]byte(`{
		"LatestCompetitiveUpdate": {
			"SeasonID": "current-act",
			"TierAfterUpdate": 0,
			"RankedRatingAfterUpdate": 0
		},
		"QueueSkills": {
			"competitive": {
				"SeasonalInfoBySeasonID": {
					"current-act": {
						"NumberOfWins": 2,
						"NumberOfGames": 5,
						"CompetitiveTier": 12,
						"RankedRating": 44,
						"WinsByTier": {"11": 1, "12": 1}
					},
					"previous-act": {
						"NumberOfWins": 18,
						"NumberOfGames": 32,
						"CompetitiveTier": 15,
						"RankedRating": 63,
						"WinsByTier": {"15": 8, "16": 3, "17": 1}
					}
				}
			}
		}
	}`), &live); err != nil {
		t.Fatal(err)
	}

	overview := &tracking.Overview{}
	mergeLiveMMR(overview, live)

	if overview.CurrentSeasonID != "current-act" ||
		overview.CurrentRank.CompetitiveTier != 12 ||
		overview.CurrentRank.RankedRating != 44 ||
		overview.CurrentRank.NumberOfWins != 2 ||
		overview.CurrentRank.NumberOfGames != 5 {
		t.Fatalf("current rank was not populated from seasonal info: %+v", overview.CurrentRank)
	}
	if overview.PeakRank.CompetitiveTier != 17 || overview.PeakRank.SeasonID != "previous-act" {
		t.Fatalf("peak rank = %+v, want tier 17 from previous-act", overview.PeakRank)
	}
	if len(overview.RankActs) != 2 || overview.RankActs[0].SeasonID != "current-act" ||
		overview.RankActs[1].PeakRank != 17 || overview.RankActs[1].FinalRank != 15 {
		t.Fatalf("rank acts were not populated correctly: %+v", overview.RankActs)
	}
}

func TestMergeLiveMMRDoesNotMakePreviousActCurrent(t *testing.T) {
	var live playerMMRResponse
	if err := json.Unmarshal([]byte(`{
		"LatestCompetitiveUpdate": {
			"SeasonID": "previous-act",
			"TierAfterUpdate": 16,
			"RankedRatingAfterUpdate": 63
		},
		"QueueSkills": {
			"competitive": {
				"SeasonalInfoBySeasonID": {
					"previous-act": {
						"NumberOfWins": 18,
						"NumberOfGames": 32,
						"CompetitiveTier": 16,
						"RankedRating": 63,
						"WinsByTier": {"16": 5}
					}
				}
			}
		}
	}`), &live); err != nil {
		t.Fatal(err)
	}

	overview := &tracking.Overview{CurrentSeasonID: "current-unranked"}
	mergeLiveMMR(overview, live)

	if overview.CurrentSeasonID != "current-unranked" ||
		overview.CurrentRank.CompetitiveTier != 0 ||
		overview.CurrentRank.RankedRating != 0 {
		t.Fatalf("previous act became current: season=%q rank=%+v", overview.CurrentSeasonID, overview.CurrentRank)
	}
	if len(overview.RankActs) != 1 || overview.RankActs[0].SeasonID != "previous-act" {
		t.Fatalf("previous act was not retained in history: %+v", overview.RankActs)
	}
}

func TestCompetitiveUpdatesBecomeRRSnapshots(t *testing.T) {
	var response competitiveUpdatesResponse
	if err := json.Unmarshal([]byte(`{
		"Matches": [{
			"MatchID": "match-1",
			"SeasonID": "act-1",
			"MatchStartTime": 1234,
			"TierBeforeUpdate": 14,
			"TierAfterUpdate": 15,
			"RankedRatingBeforeUpdate": 92,
			"RankedRatingAfterUpdate": 12,
			"RankedRatingEarned": 20,
			"AFKPenalty": 0
		}]
	}`), &response); err != nil {
		t.Fatal(err)
	}

	snapshots := response.snapshots("player-1")
	if len(snapshots) != 1 {
		t.Fatalf("snapshots = %#v", snapshots)
	}
	got := snapshots[0]
	if got.Puuid != "player-1" || got.SeasonID != "act-1" || got.TierAfter != 15 || got.RRAfter != 12 || got.RREarned != 20 {
		t.Fatalf("unexpected snapshot: %#v", got)
	}
}
