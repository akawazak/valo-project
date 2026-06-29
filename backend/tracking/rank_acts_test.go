package tracking

import "testing"

func TestRankActsFromSnapshotsBuildsNewestActFirst(t *testing.T) {
	acts := rankActsFromSnapshots([]RRSnapshot{
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
