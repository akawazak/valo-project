package handlers

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/truearken/valclient/valclient"
)

func testParty(state string, localOwner bool, eligible ...string) *partyDetailsResponse {
	details := &partyDetailsResponse{State: state, EligibleQueues: eligible}
	details.MatchmakingData.QueueID = "competitive"
	details.Members = append(details.Members, struct {
		Subject         string `json:"Subject"`
		CompetitiveTier int    `json:"CompetitiveTier"`
		IsOwner         bool   `json:"IsOwner"`
		IsReady         bool   `json:"IsReady"`
		PlayerIdentity  struct {
			Subject      string `json:"Subject"`
			PlayerCardID string `json:"PlayerCardID"`
			AccountLevel int    `json:"AccountLevel"`
			Incognito    bool   `json:"Incognito"`
		} `json:"PlayerIdentity"`
	}{Subject: "me", IsOwner: localOwner, IsReady: true})
	details.Members = append(details.Members, details.Members[0])
	details.Members[1].Subject, details.Members[1].IsOwner = "mate", !localOwner
	return details
}

func TestPlanPartyActionBuildsTheDocumentedRequests(t *testing.T) {
	party := testParty("DEFAULT", true, "competitive", "unrated")
	cases := []struct {
		req  PartyActionRequest
		path string
	}{
		{PartyActionRequest{Action: "ready"}, "/members/me/setReady"},
		{PartyActionRequest{Action: "queue", QueueID: "unrated"}, "/queue"},
		{PartyActionRequest{Action: "start"}, "/matchmaking/join"},
		{PartyActionRequest{Action: "close"}, "/accessibility"},
		{PartyActionRequest{Action: "invite", Name: "Echo", Tag: "#DEMO"}, "/invites/name/Echo/tag/DEMO"},
	}
	for _, c := range cases {
		call, err := planPartyAction(party, "me", c.req)
		if err != nil {
			t.Fatalf("%s: unexpected refusal: %v", c.req.Action, err)
		}
		if call.method != http.MethodPost || call.path != c.path {
			t.Fatalf("%s: got %s %s, want POST %s", c.req.Action, call.method, call.path, c.path)
		}
	}
	call, _ := planPartyAction(party, "me", PartyActionRequest{Action: "close"})
	if body := call.body.(map[string]string); body["accessibility"] != "CLOSED" {
		t.Fatalf("close sent %v", body)
	}
	cancel, err := planPartyAction(testParty("MATCHMAKING", true), "me", PartyActionRequest{Action: "cancel"})
	if err != nil || cancel.path != "/matchmaking/leave" {
		t.Fatalf("cancel: %v %v", cancel, err)
	}
}

func TestPlanPartyActionRefusesWhatTheClientWouldNotAllow(t *testing.T) {
	restricted := testParty("DEFAULT", true, "competitive")
	restricted.RestrictedSeconds = 120
	notReady := testParty("DEFAULT", true, "competitive")
	notReady.Members[1].IsReady = false
	full := testParty("DEFAULT", false, "competitive")
	for len(full.Members) < 5 {
		full.Members = append(full.Members, full.Members[1])
	}
	cases := []struct {
		name  string
		party *partyDetailsResponse
		req   PartyActionRequest
		want  string
	}{
		{"queue not eligible", testParty("DEFAULT", true, "unrated"), PartyActionRequest{Action: "queue", QueueID: "competitive"}, "does not list"},
		{"queue id junk", testParty("DEFAULT", true, "competitive"), PartyActionRequest{Action: "queue", QueueID: "../x"}, "does not list"},
		{"member changes queue", testParty("DEFAULT", false, "unrated"), PartyActionRequest{Action: "queue", QueueID: "unrated"}, "leader"},
		{"member starts", testParty("DEFAULT", false, "competitive"), PartyActionRequest{Action: "start"}, "leader"},
		{"restricted", restricted, PartyActionRequest{Action: "start"}, "restriction"},
		{"not ready", notReady, PartyActionRequest{Action: "start"}, "ready"},
		{"current queue not eligible", testParty("DEFAULT", true, "unrated"), PartyActionRequest{Action: "start"}, "not available"},
		{"agent select", testParty("PREGAME", true, "competitive"), PartyActionRequest{Action: "ready"}, "lobby"},
		{"in match", testParty("INGAME", true, "competitive"), PartyActionRequest{Action: "start"}, "lobby"},
		{"custom game", testParty("CUSTOM_GAME_SETUP", true, "competitive"), PartyActionRequest{Action: "queue", QueueID: "competitive"}, "lobby"},
		{"cancel when not queued", testParty("DEFAULT", true), PartyActionRequest{Action: "cancel"}, "not in a queue"},
		{"member opens party", testParty("DEFAULT", false), PartyActionRequest{Action: "open"}, "leader"},
		{"full party invite", full, PartyActionRequest{Action: "invite", Name: "Echo", Tag: "DEMO"}, "full"},
		{"bad riot id", testParty("DEFAULT", true), PartyActionRequest{Action: "invite", Name: "a/../b", Tag: "DEMO"}, "Riot ID"},
		{"not in party", testParty("DEFAULT", true), PartyActionRequest{Action: "ready"}, "not in this party"},
		{"unknown", testParty("DEFAULT", true), PartyActionRequest{Action: "lockAgent"}, "unknown"},
	}
	for _, c := range cases {
		local := "me"
		if c.name == "not in party" {
			local = "stranger"
		}
		_, err := planPartyAction(c.party, local, c.req)
		if err == nil || !errors.Is(err, errPartyAction) || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("%s: got %v, want refusal containing %q", c.name, err, c.want)
		}
	}
}

func TestPartyActionLimiterSpacesAndCapsActions(t *testing.T) {
	limiter := &partyActionLimiter{recent: map[string][]time.Time{}, busy: map[string]bool{}}
	now := time.Unix(1_000, 0)
	if err := limiter.acquire("me", now); err != nil {
		t.Fatal(err)
	}
	if err := limiter.acquire("me", now.Add(2*time.Second)); err == nil {
		t.Fatal("a second action ran while the first was still busy")
	}
	limiter.release("me")
	if err := limiter.acquire("me", now.Add(500*time.Millisecond)); err == nil {
		t.Fatal("actions closer than 1.2 s were allowed")
	}
	at := now
	for i := 1; i < 20; i++ {
		at = at.Add(1300 * time.Millisecond)
		if err := limiter.acquire("me", at); err != nil {
			t.Fatalf("action %d refused: %v", i+1, err)
		}
		limiter.release("me")
	}
	if err := limiter.acquire("me", at.Add(1300*time.Millisecond)); err == nil {
		t.Fatal("more than 20 actions a minute were allowed")
	}
	if err := limiter.acquire("other", at); err != nil {
		t.Fatalf("one account's limit blocked another: %v", err)
	}
}

func TestPartyRefusalTextIsASentence(t *testing.T) {
	if got := partyRefusalText(refuse("only the party leader can start the queue")); got != "Only the party leader can start the queue." {
		t.Fatalf("got %q", got)
	}
}

func TestBuildPartyResponseCarriesQueueEligibility(t *testing.T) {
	h := &Handler{}
	details := testParty("CUSTOM_GAME_SETUP", true, "competitive")
	details.Accessibility, details.RestrictedSeconds = "open", 61.2
	details.QueueIneligibilities = []string{"RANKED_RESTRICTED"}
	for i := range details.Members {
		details.Members[i].Subject = ""
	}
	resp := h.buildPartyResponse(&valclient.ValClient{Player: &valclient.ValClientPlayer{Uuid: "me"}}, "local", details)
	if resp.Accessibility != "OPEN" || resp.RestrictedSeconds != 62 || !resp.CustomGame || len(resp.EligibleQueues) != 1 || resp.QueueIneligibilities[0] != "RANKED_RESTRICTED" {
		t.Fatalf("got %+v", resp)
	}
}
