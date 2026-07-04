package riothttp

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

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
