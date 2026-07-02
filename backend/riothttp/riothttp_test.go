package riothttp

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestDoRetriesRetryAfterAndStops(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if attempts.Add(1) < 3 {
			w.Header().Set("Retry-After", "0")
			http.Error(w, "slow down", http.StatusTooManyRequests)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	req, _ := http.NewRequest(http.MethodGet, server.URL, nil)
	body, err := Do(&http.Client{Timeout: time.Second}, req)
	if err != nil || string(body) != `{"ok":true}` || attempts.Load() != 3 {
		t.Fatalf("body=%q attempts=%d err=%v", body, attempts.Load(), err)
	}
}
