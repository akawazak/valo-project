package handlers

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"backend/tracking"
)

func TestCachedOverlayRankDoesNotRankUnplacedCurrentAct(t *testing.T) {
	h := NewHandler(nil)
	h.liveRanks["live-match"] = liveRankCache{
		Players: map[string]liveRankSnapshot{
			"player-1": {CompetitiveTier: 18, RankedRating: 14, PeakTier: 18},
		},
		ExpiresAt: time.Now().Add(time.Hour),
		UpdatedAt: time.Now(),
	}
	overview := &tracking.Overview{
		CurrentRank: tracking.CurrentRank{TierName: "Unranked"},
	}

	if h.applyCachedLiveRankToOverview(nil, overview, "player-1") {
		t.Fatal("an overlay rank without current-act games was treated as authoritative")
	}
	if overview.CurrentRank.CompetitiveTier != 0 || overview.CurrentRank.RankedRating != 0 {
		t.Fatalf("cached overlay rank leaked into current rank: %+v", overview.CurrentRank)
	}
	if overview.PeakRank.CompetitiveTier != 18 {
		t.Fatalf("historical peak was lost: %+v", overview.PeakRank)
	}
}

func TestRiotFailureReasonKeepsRankErrorsActionable(t *testing.T) {
	if got := riotFailureReason(errors.New(`Riot API returned status 404: {"message":"resource not found"}`)); got != "HTTP 404" {
		t.Fatalf("status reason = %q", got)
	}
	if got := riotFailureReason(errors.New("Riot returned no competitive updates")); got != "no competitive matches returned" {
		t.Fatalf("empty history reason = %q", got)
	}
}

func TestSyncInFlightGuardRejectsDuplicateSync(t *testing.T) {
	h := &Handler{}
	if !h.markSyncInFlight("player-1") {
		t.Fatal("first sync was rejected")
	}
	if h.markSyncInFlight("player-1") {
		t.Fatal("duplicate sync was accepted")
	}
	if !h.isSyncInFlight("player-1") {
		t.Fatal("sync was not marked in flight")
	}
	h.unmarkSyncInFlight("player-1")
	if h.isSyncInFlight("player-1") {
		t.Fatal("finished sync remained in flight")
	}
}

func TestBuildMatchDetailsKeepsPartyIDs(t *testing.T) {
	cache := &tracking.MatchCache{
		Match:  tracking.MatchRow{MatchID: "party-match"},
		Rounds: []tracking.MatchRound{{RoundNum: 0, WinningTeam: "Red", RoundResult: "Eliminated"}},
		Players: []tracking.PlayerRow{
			{Subject: "local", TeamID: "Red", PartyID: "party-123", GameName: "Local", IsLocal: true, RoundsPlayed: 5},
			{Subject: "duo", TeamID: "Red", PartyID: "party-123", GameName: "Duo", RoundsPlayed: 5},
			{Subject: "enemy", TeamID: "Blue", PartyID: "party-999", GameName: "Enemy", RoundsPlayed: 5},
		},
	}

	detail := buildMatchDetails(cache)
	if len(detail.Players) != 3 {
		t.Fatalf("players = %d, want 3", len(detail.Players))
	}
	if len(detail.Rounds) != 1 || detail.Rounds[0].WinningTeam != "Red" {
		t.Fatalf("rounds = %+v, want copied round metadata", detail.Rounds)
	}
	got := map[string]string{}
	for _, player := range detail.Players {
		got[player.Subject] = player.PartyID
	}
	if got["local"] != "party-123" || got["duo"] != "party-123" || got["enemy"] != "party-999" {
		t.Fatalf("detail party IDs = %#v", got)
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

	overview := &tracking.Overview{
		CurrentSeasonID: "current-unranked",
		CurrentRank: tracking.CurrentRank{
			CompetitiveTier: 16,
			RankedRating:    63,
			TierName:        "Diamond 1",
		},
	}
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

func TestCurrentSeasonRRSnapshotsExcludePreviousAct(t *testing.T) {
	snapshots := []tracking.RRSnapshot{
		{MatchID: "current", SeasonID: "v26a4", RREarned: 18},
		{MatchID: "previous", SeasonID: "ce2783e8-44fc-dd48-3da3-33b5ba6c4a22", RREarned: 24},
	}

	got := currentSeasonRRSnapshots(snapshots, "4f0864e2-40af-28a4-de2c-0e9e64e75f23")
	if len(got) != 1 || got[0].MatchID != "current" || got[0].RREarned != 18 {
		t.Fatalf("current act deltas = %+v", got)
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

func TestMergeRankActsPreservesCachedActsMissingFromRecentUpdates(t *testing.T) {
	recent := []tracking.RankActSummary{
		{SeasonID: "current-act", PeakRank: 18, FinalRank: 18},
	}
	cached := []tracking.RankActSummary{
		{SeasonID: "current-act", Wins: 10, Games: 18, RankedRating: 0, PeakRank: 17, FinalRank: 17},
		{SeasonID: "previous-act", PeakRank: 15, FinalRank: 15},
	}

	got := mergeRankActs(recent, cached, "current-act")
	if len(got) != 2 {
		t.Fatalf("acts = %+v, want current and previous", got)
	}
	if got[0].SeasonID != "current-act" || got[0].PeakRank != 18 {
		t.Fatalf("preferred current act was not retained: %+v", got[0])
	}
	if got[0].Games != 18 || got[0].Wins != 10 {
		t.Fatalf("richer cached counts were not merged: %+v", got[0])
	}
	if got[1].SeasonID != "previous-act" || got[1].PeakRank != 15 {
		t.Fatalf("cached previous act was lost: %+v", got[1])
	}
}
