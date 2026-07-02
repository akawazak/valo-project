package handlers

import (
	"encoding/base64"
	"testing"
)

func TestMarkPartyMembersUsesOpaqueGroup(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam:  []*LivePlayer{{Puuid: "local"}, {Puuid: "friend"}, {Puuid: "solo"}},
		EnemyTeam: []*LivePlayer{{Puuid: "enemy"}},
	}

	markPartyMembers(response, []string{"local", "friend"}, "your-party")

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("confirmed party members were not grouped")
	}
	if response.AllyTeam[2].PartyGroup != "" || response.EnemyTeam[0].PartyGroup != "" {
		t.Fatal("unconfirmed players must not be guessed into a party")
	}
}

func TestApplyPartyMapOnlyStampsMatchingPuuids(t *testing.T) {
	response := &LiveMatchResponse{
		MatchID:   "match-1",
		AllyTeam:  []*LivePlayer{{Puuid: "a"}, {Puuid: "b"}, {Puuid: "c"}},
		EnemyTeam: []*LivePlayer{{Puuid: "d"}, {Puuid: "e"}},
	}
	groupMap := map[string]string{
		"a": "your-party",
		"b": "your-party",
		"d": "party-1",
		"e": "party-1",
	}
	applyPartyMap(response, groupMap)

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("local party should be stamped")
	}
	if response.AllyTeam[2].PartyGroup != "" {
		t.Fatal("unmapped solo ally should stay unlabelled")
	}
	if response.EnemyTeam[0].PartyGroup != "party-1" || response.EnemyTeam[1].PartyGroup != "party-1" {
		t.Fatal("enemy premade should get its own opaque key")
	}
}

func TestBuildPartyGroupMapLabelsAllPremadesDeterministically(t *testing.T) {
	groups := buildPartyGroupMap(map[string]string{
		"duo":    "party-z",
		"enemy1": "party-a",
		"enemy2": "party-a",
		"local":  "party-z",
		"solo":   "",
	}, "local")

	if groups["local"] != "your-party" || groups["duo"] != "your-party" {
		t.Fatalf("local duo = %q/%q, want your-party", groups["local"], groups["duo"])
	}
	if groups["enemy1"] != "party-1" || groups["enemy2"] != "party-1" {
		t.Fatalf("enemy duo = %q/%q, want party-1", groups["enemy1"], groups["enemy2"])
	}
	if groups["solo"] != "" {
		t.Fatalf("solo group = %q, want empty", groups["solo"])
	}
}

func TestCollectLivePuuidsDedupesAcrossTeams(t *testing.T) {
	response := &LiveMatchResponse{
		AllyTeam:  []*LivePlayer{{Puuid: "a"}, {Puuid: "b"}, nil, {Puuid: ""}},
		EnemyTeam: []*LivePlayer{{Puuid: "b"}, {Puuid: "c"}},
	}
	got := collectLivePuuids(response)
	if len(got) != 3 {
		t.Fatalf("want 3 unique puuids (a,b,c), got %d", len(got))
	}
	for _, p := range []string{"a", "b", "c"} {
		if _, ok := got[p]; !ok {
			t.Fatalf("missing puuid %q in collect result", p)
		}
	}
}

func TestTrustedPartyLookupRejectsSubjectMismatch(t *testing.T) {
	// Real scenario from the bug report: querying player "teammate-1"
	// but the server returns the local user's party record (Subject
	// = "local-user"). trustingPartyLookup must refuse the result,
	// otherwise teammate-1 would get stamped as part of "your-party".
	resp := &currentPartyPlayerResponse{
		Subject:        "local-user",
		CurrentPartyID: "party-local",
	}
	if id, ok := trustedPartyLookup(resp, "teammate-1"); ok {
		t.Fatalf("Subject mismatch must be rejected, got id=%q ok=%v", id, ok)
	}
}

func TestTrustedPartyLookupAcceptsMatchingSubject(t *testing.T) {
	resp := &currentPartyPlayerResponse{
		Subject:        "teammate-1",
		CurrentPartyID: "party-local",
	}
	id, ok := trustedPartyLookup(resp, "teammate-1")
	if !ok || id != "party-local" {
		t.Fatalf("matching Subject should be trusted, got id=%q ok=%v", id, ok)
	}
}

func TestTrustedPartyLookupAcceptsMatchingSubjectDifferentCase(t *testing.T) {
	// Riot UUID casing is documented as inconsistent. Both sides
	// must be normalized before comparison.
	resp := &currentPartyPlayerResponse{
		Subject:        "TEAMMATE-1",
		CurrentPartyID: "party-local",
	}
	id, ok := trustedPartyLookup(resp, "teammate-1")
	if !ok || id != "party-local" {
		t.Fatalf("case-insensitive Subject match should be trusted, got id=%q ok=%v", id, ok)
	}
}

func TestTrustedPartyLookupRejectsEmptyPartyID(t *testing.T) {
	resp := &currentPartyPlayerResponse{
		Subject:        "solo-player",
		CurrentPartyID: "",
	}
	if _, ok := trustedPartyLookup(resp, "solo-player"); ok {
		t.Fatal("empty CurrentPartyID (solo queue) must be rejected")
	}
}

func TestTrustedPartyLookupRejectsNilResponse(t *testing.T) {
	if _, ok := trustedPartyLookup(nil, "anyone"); ok {
		t.Fatal("nil response must be rejected")
	}
}

func TestPartyCacheReusesAcrossPolls(t *testing.T) {
	h := &Handler{partyCache: make(map[string]map[string]string)}
	matchID := "match-reuse"

	// Seed the cache as if a previous poll already ran the fan-out.
	h.partyCache[matchID] = map[string]string{
		"local":  "your-party",
		"friend": "your-party",
		"enemy1": "party-1",
		"enemy2": "party-1",
	}

	response := &LiveMatchResponse{
		MatchID:   matchID,
		AllyTeam:  []*LivePlayer{{Puuid: "local"}, {Puuid: "friend"}, {Puuid: "lone-ally"}},
		EnemyTeam: []*LivePlayer{{Puuid: "enemy1"}, {Puuid: "enemy2"}, {Puuid: "lone-enemy"}},
	}

	// No val client is needed because the cache hit short-circuits the fan-out.
	h.markAllParties(nil, response)

	if response.AllyTeam[0].PartyGroup != "your-party" || response.AllyTeam[1].PartyGroup != "your-party" {
		t.Fatal("local party should be stamped from cache")
	}
	if response.AllyTeam[2].PartyGroup != "" {
		t.Fatal("unmapped solo ally should stay unlabelled")
	}
	if response.EnemyTeam[0].PartyGroup != "party-1" || response.EnemyTeam[1].PartyGroup != "party-1" {
		t.Fatal("cached enemy premade should reuse its opaque key")
	}
	if response.EnemyTeam[2].PartyGroup != "" {
		t.Fatal("unmapped solo enemy should stay unlabelled")
	}
}

func TestScoreFromPresencePrivateUsesLocalTeamPerspective(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{
		"matchPresenceData": {
			"partyOwnerMatchCurrentTeam": "Red",
			"partyOwnerMatchScoreAllyTeam": 8,
			"partyOwnerMatchScoreEnemyTeam": 5
		}
	}`))

	ally, enemy, ok := scoreFromPresencePrivate(private, "Blue")
	if !ok || ally != 5 || enemy != 8 {
		t.Fatalf("score = %d-%d ok=%v, want 5-8", ally, enemy, ok)
	}
}
