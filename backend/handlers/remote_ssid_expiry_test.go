package handlers

import (
	"net/http"
	"testing"
	"time"
)

func TestSsidExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	if got := ssidExpiry([]*http.Cookie{{Name: "sub", MaxAge: 99}, {Name: "ssid", MaxAge: 3600}}, now); got != now.Add(time.Hour).UnixMilli() {
		t.Fatalf("max-age: got %d", got)
	}
	exp := now.Add(48 * time.Hour)
	if got := ssidExpiry([]*http.Cookie{{Name: "ssid", Expires: exp}}, now); got != exp.UnixMilli() {
		t.Fatalf("expires: got %d", got)
	}
	if got := ssidExpiry([]*http.Cookie{{Name: "ssid"}}, now); got != 0 {
		t.Fatalf("no expiry should be 0, got %d", got)
	}
}
