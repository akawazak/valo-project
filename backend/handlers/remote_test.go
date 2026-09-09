package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/truearken/valclient/valclient"
)

func unsignedTestJWT(claims map[string]string) string {
	payload, _ := json.Marshal(claims)
	return "e30." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func unsignedTestJWTAny(claims map[string]any) string {
	payload, _ := json.Marshal(claims)
	return "e30." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func TestGetRemoteAuthHeadersRejectsExpiredAccessToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/storefront", nil)
	req.Header.Set("X-Riot-Access-Token", unsignedTestJWTAny(map[string]any{
		"sub": "player-one",
		"exp": time.Now().Add(-time.Minute).Unix(),
	}))
	req.Header.Set("X-Riot-Entitlements-JWT", "entitlement")
	req.Header.Set("X-Riot-Puuid", "player-one")
	req.Header.Set("X-Riot-Region", "eu")

	_, ok, err := getRemoteAuthHeaders(req)
	if err == nil || ok || !strings.Contains(err.Error(), "authentication required") {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
}

func TestGetRemoteAuthHeadersIgnoresRegionOnlyMetadata(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/storefront", nil)
	req.Header.Set("X-Riot-Selected-Puuid", "player-one")
	req.Header.Set("X-Riot-Region", "eu")

	auth, ok, err := getRemoteAuthHeaders(req)
	if err != nil || ok || auth != nil {
		t.Fatalf("auth=%v ok=%v err=%v", auth, ok, err)
	}
}

func TestGetClientUsesLocalClientOnlyForSelectedAccount(t *testing.T) {
	local := &valclient.ValClient{Player: &valclient.ValClientPlayer{Uuid: "player-one"}}
	h := NewHandler(local)

	same := httptest.NewRequest(http.MethodGet, "/v1/owned-skins", nil)
	same.Header.Set("X-Riot-Selected-Puuid", "player-one")
	same.Header.Set("X-Riot-Region", "eu")
	client, err := h.getClient(same)
	if err != nil || client != local {
		t.Fatalf("same-account fallback client=%p err=%v", client, err)
	}

	different := httptest.NewRequest(http.MethodGet, "/v1/owned-skins", nil)
	different.Header.Set("X-Riot-Selected-Puuid", "player-two")
	different.Header.Set("X-Riot-Region", "eu")
	if _, err := h.getClient(different); err == nil || !strings.Contains(err.Error(), "authentication required") {
		t.Fatalf("expected mismatched account rejection, got %v", err)
	}
}

func TestOAuthAttemptsAreRandomAndSingleUse(t *testing.T) {
	h := NewHandler(nil)
	firstState, firstNonce, err := h.newOAuthAttempt()
	if err != nil {
		t.Fatal(err)
	}
	secondState, secondNonce, err := h.newOAuthAttempt()
	if err != nil {
		t.Fatal(err)
	}
	if firstState == secondState || firstNonce == secondNonce {
		t.Fatal("OAuth state and nonce must be unique per attempt")
	}
	attempt, ok := h.consumeOAuthAttempt(firstState)
	if !ok || attempt.Nonce != firstNonce {
		t.Fatal("matching OAuth attempt was not accepted")
	}
	if _, ok := h.consumeOAuthAttempt(firstState); ok {
		t.Fatal("OAuth state was accepted more than once")
	}
}

func TestGetAuthURLIncludesStateAndNonce(t *testing.T) {
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.GetAuthUrl(response, httptest.NewRequest(http.MethodGet, "/v1/auth/url", nil))
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	authURL, err := url.Parse(body["auth_url"])
	if err != nil {
		t.Fatal(err)
	}
	nonce := authURL.Query().Get("nonce")
	if authURL.Query().Get("state") == "" || nonce == "" {
		t.Fatalf("auth URL is missing state or nonce: %s", body["auth_url"])
	}
	if got := authURL.Query().Get("scope"); got != "openid link ban lol_region" {
		t.Fatalf("auth URL scope = %q", got)
	}
	if got := jwtStringClaim(unsignedTestJWT(map[string]string{"nonce": nonce}), "nonce"); got != nonce {
		t.Fatalf("nonce claim = %q", got)
	}
}

func TestRunRiotJSONReturnsBadClaimsWithoutPanicking(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"BAD_CLAIMS"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	err := runRiotJSON(http.MethodGet, server.URL, nil, nil, &map[string]any{})
	if err == nil || !strings.Contains(err.Error(), "BAD_CLAIMS") {
		t.Fatalf("expected BAD_CLAIMS error, got %v", err)
	}
}

func TestRiotClientReauthRequestMatchesObservedClientFlow(t *testing.T) {
	req, err := newRiotClientReauthRequest("ssid=secret; clid=client", "test-nonce")
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != http.MethodPost || req.URL.String() != riotClientReauthURL {
		t.Fatalf("unexpected request target: %s %s", req.Method, req.URL)
	}
	if got := req.Header.Get("User-Agent"); got != riotClientReauthUserAgent {
		t.Fatalf("User-Agent = %q", got)
	}
	if got := req.Header.Get("Cookie"); got != "ssid=secret; clid=client" {
		t.Fatalf("Cookie = %q", got)
	}
	if req.Header.Get("Cache-Control") != "no-cache" || req.Header.Get("Accept") != "application/json" {
		t.Fatal("required Riot Client headers are missing")
	}
	var payload riotClientReauthPayload
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.ClientID != "riot-client" || payload.Nonce != "test-nonce" {
		t.Fatalf("unexpected reauth identity: %+v", payload)
	}
	if payload.RedirectURI != "http://localhost/redirect" || payload.ResponseType != "token id_token" {
		t.Fatalf("unexpected redirect/response type: %+v", payload)
	}
	if payload.Scope != "openid link ban lol_region lol summoner offline_access" {
		t.Fatalf("unexpected reauth scope: %q", payload.Scope)
	}
}

func TestParseRiotClientReauthValidatesNonce(t *testing.T) {
	idToken := unsignedTestJWT(map[string]string{"nonce": "expected"})
	redirect := "http://localhost/redirect#access_token=access&id_token=" + url.QueryEscape(idToken) + "&expires_in=3600"
	body, _ := json.Marshal(map[string]any{
		"type": "response",
		"response": map[string]any{
			"mode":       "fragment",
			"parameters": map[string]string{"uri": redirect},
		},
	})

	tokens, err := parseRiotClientReauth(body, "expected")
	if err != nil {
		t.Fatal(err)
	}
	if tokens.AccessToken != "access" || tokens.IDToken != idToken || tokens.ExpiresIn != 3600 {
		t.Fatalf("unexpected tokens: %+v", tokens)
	}
	if _, err := parseRiotClientReauth(body, "different"); err == nil || !strings.Contains(err.Error(), "nonce") {
		t.Fatalf("expected nonce validation error, got %v", err)
	}
}

func TestParseRiotClientReauthReportsLoginRequired(t *testing.T) {
	_, err := parseRiotClientReauth([]byte(`{"type":"auth"}`), "nonce")
	if !errors.Is(err, errRiotLoginRequired) {
		t.Fatalf("expected login-required error, got %v", err)
	}
}

func TestMergeCookiesRotatesDeletesAndSorts(t *testing.T) {
	result := mergeCookies("ssid=old; zed=keep; delete_me=value", []*http.Cookie{
		{Name: "ssid", Value: "rotated"},
		{Name: "alpha", Value: "new"},
		{Name: "delete_me", Value: "", MaxAge: -1},
		{Name: "expired", Value: "gone", Expires: time.Now().Add(-time.Hour)},
	})
	if result != "alpha=new; ssid=rotated; zed=keep" {
		t.Fatalf("merged cookies = %q", result)
	}
}
