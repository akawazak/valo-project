package handlers

import (
	"backend/riothttp"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/truearken/valclient/valclient"
)

type liveRetryTransport func(*http.Request) (*http.Response, error)

func (f liveRetryTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func liveRetryClient(puuid string) *valclient.ValClient {
	return &valclient.ValClient{Region: "eu", Shard: "eu", Player: &valclient.ValClientPlayer{Uuid: puuid}, Header: http.Header{}}
}

func mockLiveRequests(t *testing.T, handler liveRetryTransport) {
	t.Helper()
	previous := http.DefaultTransport
	http.DefaultTransport = handler
	t.Cleanup(func() { http.DefaultTransport = previous })
}

func liveHTTPResponse(status int, retryAfter string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Retry-After": {retryAfter}}, Body: io.NopCloser(strings.NewReader(`{}`))}
}

func TestLiveRateLimitStopsPollingAndRecovers(t *testing.T) {
	calls := 0
	limited := true
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if strings.Contains(r.URL.Path, "/core-game/") && limited {
			return liveHTTPResponse(429, "90"), nil
		}
		return liveHTTPResponse(404, ""), nil
	})
	h := NewHandler(nil)
	client := liveRetryClient("one")
	first := h.fetchLiveMatchCached(client, "remote")
	if calls != 2 || first.Error == "" || first.RetryAt < time.Now().Add(89*time.Second).UnixMilli() {
		t.Fatalf("expected pregame miss then 90s coregame cooldown: calls=%d response=%+v", calls, first)
	}
	for i := 0; i < 5; i++ {
		h.fetchLiveMatchCached(client, "remote")
	}
	if calls != 2 {
		t.Fatalf("cooldown sent %d unexpected requests", calls-2)
	}
	key := liveMatchCacheKey(client, "remote")
	entry := h.liveMatchCache[key]
	entry.ExpiresAt = time.Now().Add(-time.Second)
	h.liveMatchCache[key] = entry
	limited = false
	response := h.fetchLiveMatchCached(client, "remote")
	if calls != 4 || response.Phase != "none" || response.Error != "" || response.RetryAt != 0 {
		t.Fatalf("did not recover after cooldown: calls=%d response=%+v", calls, response)
	}
}

func TestPregameRateLimitDoesNotFanOut(t *testing.T) {
	calls := 0
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		return liveHTTPResponse(429, "30"), nil
	})
	h := NewHandler(nil)
	h.fetchLiveMatchCached(liveRetryClient("one"), "remote")
	h.fetchLiveMatchCached(liveRetryClient("one"), "remote")
	if calls != 1 {
		t.Fatalf("expected one upstream request, got %d", calls)
	}
	h.fetchLiveMatchCached(liveRetryClient("two"), "remote")
	if calls != 2 {
		t.Fatal("different account incorrectly reused the first account's result")
	}
}

func TestLiveRosterSurvivesFailureButNotConfirmedEnd(t *testing.T) {
	now := time.Now()
	previous := liveMatchCacheEntry{LastSuccessAt: now, Response: LiveMatchResponse{Phase: "coregame", MatchID: "match-one", AllyTeam: []*LivePlayer{{Puuid: "one"}}, ScoreAvailable: true}}
	failure := liveMatchFailure("remote", fmt.Errorf("wrapped: %w", &riothttp.APIError{StatusCode: 429, RetryAfter: time.Minute}))
	stale := nextLiveMatchCacheEntry(previous, failure, now.Add(time.Second))
	if !stale.Response.Stale || stale.Response.MatchID != "match-one" || stale.Response.ScoreAvailable || stale.Response.RetryAt != failure.RetryAt {
		t.Fatalf("lost roster or labelled old score live: %+v", stale.Response)
	}
	stale.Response.AllyTeam[0].Puuid = "changed"
	if previous.Response.AllyTeam[0].Puuid != "one" {
		t.Fatal("cache alias mutated previous snapshot")
	}
	expired := nextLiveMatchCacheEntry(stale, failure, now.Add(121*time.Second))
	if expired.Response.Phase != "none" || expired.Response.Stale {
		t.Fatal("old match survived retention limit")
	}
	ended := nextLiveMatchCacheEntry(previous, LiveMatchResponse{Phase: "none"}, now.Add(time.Second))
	if ended.Response.MatchID != "" || ended.Response.Stale {
		t.Fatal("confirmed match end retained an old roster")
	}
}

func TestStaleRosterExpiryDoesNotBypassLongCooldown(t *testing.T) {
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		t.Fatal("request sent before Retry-After elapsed")
		return nil, fmt.Errorf("unexpected request")
	})
	client := liveRetryClient("one")
	h := NewHandler(nil)
	deadline := time.Now().Add(5 * time.Minute)
	h.liveMatchCache[liveMatchCacheKey(client, "remote")] = liveMatchCacheEntry{
		LastSuccessAt: time.Now().Add(-3 * time.Minute), ExpiresAt: deadline,
		Response: LiveMatchResponse{Phase: "coregame", MatchID: "old", Stale: true, Error: "Limited", RetryAt: deadline.UnixMilli()},
	}
	response := h.fetchLiveMatchCached(client, "remote")
	if response.Phase != "none" || response.MatchID != "" || response.RetryAt != deadline.UnixMilli() {
		t.Fatalf("expected cooldown without expired roster: %+v", response)
	}
}

func TestRankRefreshStopsAtRateLimit(t *testing.T) {
	calls := 0
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		calls++
		if strings.Contains(r.URL.Path, "/content-service/") {
			return liveHTTPResponse(200, ""), nil
		}
		return liveHTTPResponse(429, "60"), nil
	})
	response := LiveMatchResponse{Phase: "coregame", MatchID: "one", AllyTeam: []*LivePlayer{{Puuid: "first", CompetitiveTier: 12}, {Puuid: "second"}}}
	refreshLivePlayerRanks(liveRetryClient("one"), &response)
	if calls != 2 || response.RetryAt == 0 || response.Error == "" || response.AllyTeam[0].CompetitiveTier != 12 {
		t.Fatalf("rank refresh must stop and keep existing ranks: calls=%d response=%+v", calls, response)
	}
}

func TestNameLookupIncludesHiddenConfirmedPartyMember(t *testing.T) {
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		request := string(body)
		if !strings.Contains(request, `"hidden-party"`) || !strings.Contains(request, `"public"`) || strings.Contains(request, `"hidden-stranger"`) {
			t.Fatalf("unexpected name lookup: %s", request)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{},
			Body: io.NopCloser(strings.NewReader(`[
				{"Subject":"hidden-party","GameName":"Duo","TagLine":"PAL"},
				{"Subject":"public","GameName":"Visible","TagLine":"ONE"}
			]`)),
		}, nil
	})
	response := LiveMatchResponse{AllyTeam: []*LivePlayer{
		{Puuid: "hidden-party", Name: "Agent", PartyGroup: "your-party"},
		{Puuid: "hidden-stranger", Name: "Agent"},
		{Puuid: "public", Name: "Player"},
	}}
	h := NewHandler(nil)
	h.enrichLivePlayerNames(liveRetryClient("local"), &response)
	if response.AllyTeam[0].Name != "Duo#PAL" || response.AllyTeam[1].Name != "Agent" || response.AllyTeam[2].Name != "Visible#ONE" {
		t.Fatalf("unexpected resolved names: %+v", response.AllyTeam)
	}
}
