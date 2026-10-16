package handlers

import (
	"backend/tracking"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestMatchRankLookupPreservesHistoricalRanks(t *testing.T) {
	calls := 0
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"Seasons":[{"ID":"current","Type":"act","IsActive":true}]}`
		if strings.Contains(r.URL.Path, "/mmr/") {
			if !strings.HasSuffix(r.URL.Path, "/missing") {
				t.Fatalf("looked up a player with an existing match rank: %s", r.URL.Path)
			}
			body = `{"QueueSkills":{"competitive":{"SeasonalInfoBySeasonID":{"current":{"CompetitiveTier":15,"NumberOfGames":8}}}}}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	details := &tracking.MatchDetails{Players: []tracking.PlayerStats{
		{Subject: "recorded", CompetitiveTier: 12}, {Subject: "missing"},
	}}
	h := NewHandler(nil)
	h.loadMissingMatchRanks(liveRetryClient("account"), details)
	if calls != 2 || details.Players[0].CompetitiveTier != 12 || details.Players[0].CurrentCompetitiveTier != 0 || details.Players[1].CompetitiveTier != 0 || details.Players[1].CurrentCompetitiveTier != 15 {
		t.Fatalf("unexpected rank enrichment: calls=%d players=%+v", calls, details.Players)
	}
	if details.RankError != "" {
		t.Fatal(details.RankError)
	}
}

func TestMatchRankLookupStopsAtRateLimit(t *testing.T) {
	calls := 0
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return liveHTTPResponse(429, "60"), nil
	})
	details := &tracking.MatchDetails{Players: []tracking.PlayerStats{{Subject: "one"}, {Subject: "two"}}}
	h := NewHandler(nil)
	h.loadMissingMatchRanks(liveRetryClient("account"), details)
	if calls != 1 || details.RankRetryAt == 0 || details.RankError == "" {
		t.Fatalf("rate limit not preserved: calls=%d details=%+v", calls, details)
	}
}

func TestMatchRankLookupReusesRecentRanks(t *testing.T) {
	calls := 0
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"Seasons":[{"ID":"current","Type":"act","IsActive":true}]}`
		if strings.Contains(r.URL.Path, "/mmr/") {
			body = `{"QueueSkills":{"competitive":{"SeasonalInfoBySeasonID":{"current":{"CompetitiveTier":15,"NumberOfGames":8}}}}}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	h := NewHandler(nil)
	for range 2 {
		details := &tracking.MatchDetails{Players: []tracking.PlayerStats{{Subject: "same-player"}}}
		h.loadMissingMatchRanks(liveRetryClient("account"), details)
		if details.Players[0].CurrentCompetitiveTier != 15 {
			t.Fatalf("rank not returned: %+v", details.Players[0])
		}
	}
	if calls != 2 {
		t.Fatalf("rank cache made %d requests, want 2 from the first lookup only", calls)
	}
}

func TestMatchRankLookupKeepsCachedRanksWhileLoadingAnotherPlayer(t *testing.T) {
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		body := `{"Seasons":[{"ID":"current","Type":"act","IsActive":true}]}`
		if strings.Contains(r.URL.Path, "/mmr/") {
			body = `{"QueueSkills":{"competitive":{"SeasonalInfoBySeasonID":{"current":{"CompetitiveTier":15,"NumberOfGames":8}}}}}`
		}
		return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	h := NewHandler(nil)
	first := &tracking.MatchDetails{Players: []tracking.PlayerStats{{Subject: "cached"}}}
	h.loadMissingMatchRanks(liveRetryClient("account"), first)

	mixed := &tracking.MatchDetails{Players: []tracking.PlayerStats{{Subject: "cached"}, {Subject: "new"}}}
	h.loadMissingMatchRanks(liveRetryClient("account"), mixed)
	if mixed.Players[0].CurrentCompetitiveTier != 15 || mixed.Players[1].CurrentCompetitiveTier != 15 {
		t.Fatalf("cached or fetched rank lost: %+v", mixed.Players)
	}
}
