package handlers

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNormalizeChatPresenceKeepsPlayerCard(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{"matchPresenceData":{"sessionLoopState":"MENUS","playerCardId":"card-123"}}`))
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:   "friend",
		Product: "valorant",
		Private: private,
	}, nil)
	if presence.CardID != "card-123" {
		t.Fatalf("player card was dropped from presence: %#v", presence)
	}
}

func TestNormalizeChatPresenceReadsTopLevelValorantFields(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{
		"sessionLoopState":"INGAME",
		"queueId":"competitive",
		"playerCardId":"card-top-level"
	}`))
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:   "friend",
		Product: "valorant",
		Private: private,
	}, nil)
	if presence.State != "INGAME" || presence.QueueID != "competitive" || presence.CardID != "card-top-level" {
		t.Fatalf("top-level presence fields were dropped: %#v", presence)
	}
}

func TestXMPPSessionPreservesRecentConnectionError(t *testing.T) {
	session := &xmppSocialSession{
		state:       "error",
		lastError:   "authentication failed",
		lastAttempt: time.Now(),
	}

	session.ensureRunning(remoteAuthHeaders{})

	if session.running || session.state != "error" || session.lastError != "authentication failed" {
		t.Fatalf("recent error was hidden by an immediate retry: %#v", session)
	}
}

func TestRemoteOnlySocialRequiresOAuthHeaders(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/social?remoteOnly=true", nil)
	response := httptest.NewRecorder()
	(&Handler{}).GetSocialStatus(response, request)

	var body SocialStatusResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Source != "remote" || body.RemoteStatus != "missing" || body.Status != "unavailable" {
		t.Fatalf("unexpected remote-only response: %#v", body)
	}
}

func TestRemoteAuthRejectsTokenForDifferentPlayer(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/profile/overview", nil)
	request.Header.Set("X-Riot-Access-Token", "e30.eyJzdWIiOiJvd25lci0xIn0.signature")
	request.Header.Set("X-Riot-Entitlements-JWT", "entitlement")
	request.Header.Set("X-Riot-Puuid", "owner-2")
	request.Header.Set("X-Riot-Region", "eu")

	if _, _, err := getRemoteAuthHeaders(request); err == nil {
		t.Fatal("expected mismatched Riot token subject to be rejected")
	}
}

func TestReadUntilContainsConsumesWholeXMPPStanza(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(
		`<stream:features><mechanisms>X-Riot-RSO-PAS</mechanisms></stream:features><iq id="next"></iq>`,
	))
	if _, err := readUntilContains(reader, "</stream:features>"); err != nil {
		t.Fatal(err)
	}
	remaining, _ := reader.Peek(4)
	if string(remaining) != "<iq " {
		t.Fatalf("next stanza was not left intact: %q", remaining)
	}
}

func TestReadUntilContainsReportsAuthenticationFailure(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(`<failure><not-authorized/></failure>`))
	if _, err := readUntilContains(reader, "</success>"); err == nil {
		t.Fatal("expected authentication failure")
	}
}
