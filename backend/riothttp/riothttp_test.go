package riothttp

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestRemoteSessionTransportReturnsBadClaimsWithoutLeakingMarker(t *testing.T) {
	transport := RemoteSessionTransport{Base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.Header.Get(RemoteSessionHeader) != "" {
			t.Fatal("internal remote-session marker leaked to Riot request")
		}
		return &http.Response{
			StatusCode: http.StatusBadRequest,
			Status:     "400 Bad Request",
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(`{"httpStatus":400,"errorCode":"BAD_CLAIMS"}`)),
			Request:    req,
		}, nil
	})}
	req, _ := http.NewRequest(http.MethodGet, "https://example.invalid", nil)
	req.Header.Set(RemoteSessionHeader, "1")
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusUnauthorized || !strings.Contains(string(body), "BAD_CLAIMS") {
		t.Fatalf("status=%d body=%s", resp.StatusCode, body)
	}
	if req.Header.Get(RemoteSessionHeader) != "1" {
		t.Fatal("transport mutated the caller's request")
	}
}

func TestDoReturnsRateLimitAndRetryAfterImmediately(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		w.Header().Set("Retry-After", "7")
		http.Error(w, "slow down", http.StatusTooManyRequests)
	}))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	_, err := Do(&http.Client{Timeout: time.Second}, req)
	apiErr, ok := err.(*APIError)
	if !ok || apiErr.StatusCode != http.StatusTooManyRequests || apiErr.RetryAfter != 7*time.Second || attempts.Load() != 1 {
		t.Fatalf("attempts=%d err=%#v", attempts.Load(), err)
	}
}
