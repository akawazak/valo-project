package handlers

import (
	"errors"
	"testing"
	"time"

	"github.com/truearken/valclient/valclient"
)

func TestParseQueueEntryTime(t *testing.T) {
	tests := []struct {
		value string
		want  int64
	}{
		{"2026-07-18T12:34:56.123Z", time.Date(2026, time.July, 18, 12, 34, 56, 123000000, time.UTC).UnixMilli()},
		{"2026.07.18-12.34.56", time.Date(2026, time.July, 18, 12, 34, 56, 0, time.UTC).UnixMilli()},
		{"not-a-time", 0},
	}
	for _, test := range tests {
		if got := parseQueueEntryTime(test.value); got != test.want {
			t.Fatalf("parseQueueEntryTime(%q) = %d, want %d", test.value, got, test.want)
		}
	}
}

func TestBuildPartyResponseOnlyIncludesTimerWhileSearching(t *testing.T) {
	h := &Handler{}
	details := &partyDetailsResponse{State: "MATCHMAKING", QueueEntryTime: "2026-07-18T12:34:56Z"}
	queued := h.buildPartyResponse(&valclient.ValClient{}, "local", details)
	if queued.QueueStartedAt == 0 {
		t.Fatal("matchmaking response should include Riot's queue start")
	}
	details.State = "DEFAULT"
	lobby := h.buildPartyResponse(&valclient.ValClient{}, "local", details)
	if lobby.QueueStartedAt != 0 {
		t.Fatalf("party lobby must not retain a stale queue timer: %d", lobby.QueueStartedAt)
	}
}

func TestExpectedNoPartyErrors(t *testing.T) {
	for _, message := range []string{
		`Riot API returned status 404: {"errorCode":"RESOURCE_NOT_FOUND"}`,
		`Riot API returned status 400: {"errorCode":"BAD_PARAMETER","message":"Bad parameter used as input"}`,
		"player not in party",
	} {
		if !isExpectedNoPartyError(errors.New(message)) {
			t.Fatalf("expected no-party error for %q", message)
		}
	}
	if isExpectedNoPartyError(errors.New(`Riot API returned status 400: {"errorCode":"BAD_REQUEST"}`)) {
		t.Fatal("unrelated 400 must remain an error")
	}
}
