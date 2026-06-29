package handlers

import (
	"encoding/json"
	"testing"

	"backend/tracking"
)

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
