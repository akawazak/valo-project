package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/truearken/valclient/valclient"
)

func TestCorsAllowsTauriProductionOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("Origin", "http://tauri.localhost")
	res := httptest.NewRecorder()
	corsMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(res, req)
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "http://tauri.localhost" {
		t.Fatalf("Access-Control-Allow-Origin = %q", got)
	}
}

func TestCorsRejectsUntrustedOriginBeforeMutation(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts", strings.NewReader("[]"))
	req.Header.Set("Origin", "https://attacker.example")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
	if called {
		t.Fatal("untrusted origin reached mutation handler")
	}
}

func TestCleanupLogsKeepsOnlyCurrentFile(t *testing.T) {
	dir := t.TempDir()
	oldPath := filepath.Join(dir, "old.log")
	currentPath := filepath.Join(dir, "valovault.log")
	otherPath := filepath.Join(dir, "keep.txt")
	for _, path := range []string{oldPath, currentPath, otherPath} {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cleanupLogs(dir, currentPath)
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatalf("old log was not removed: %v", err)
	}
	for _, path := range []string{currentPath, otherPath} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to remain: %v", path, err)
		}
	}
}

func TestAPIKeyMiddlewareRejectsMissingOrWrongKey(t *testing.T) {
	handler := apiKeyMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, key := range []string{"", "wrong"} {
		req := httptest.NewRequest(http.MethodGet, "/v1/accounts", nil)
		req.Header.Set("X-VantaVault-Key", key)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusUnauthorized {
			t.Fatalf("key %q: got %d, want 401", key, res.Code)
		}
	}
}

func TestAPIKeyMiddlewareAllowsDesktopKey(t *testing.T) {
	handler := apiKeyMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	req.Header.Set("X-VantaVault-Key", "secret")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusNoContent {
		t.Fatalf("got %d, want 204", res.Code)
	}
}

func TestBootstrapProofDoesNotExposeAPIKeyAndBypassesAPIMiddleware(t *testing.T) {
	handler := bootstrapProofHandler("desktop-secret", apiKeyMiddleware("desktop-secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))
	req := httptest.NewRequest(http.MethodGet, "/v1/bootstrap-proof?nonce=0123456789abcdef", nil)
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("got %d, want 200", res.Code)
	}
	body := strings.TrimSpace(res.Body.String())
	if body != bootstrapProof("desktop-secret", "0123456789abcdef") {
		t.Fatalf("unexpected proof %q", body)
	}
	if strings.Contains(body, "desktop-secret") {
		t.Fatal("bootstrap proof exposed the API key")
	}
}

func TestBootstrapProofRejectsInvalidNonce(t *testing.T) {
	handler := bootstrapProofHandler("desktop-secret", http.NotFoundHandler())
	for _, nonce := range []string{"short", "../session_escape", strings.Repeat("a", 129)} {
		req := httptest.NewRequest(http.MethodGet, "/v1/bootstrap-proof?nonce="+nonce, nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("nonce %q: got %d, want 400", nonce, res.Code)
		}
	}
}

func TestDesktopCORSPreflightThenAuthenticatedRequest(t *testing.T) {
	called := 0
	handler := corsMiddleware(apiKeyMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	})))

	preflight := httptest.NewRequest(http.MethodOptions, "/v1/health", nil)
	preflight.Header.Set("Origin", "http://tauri.localhost")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodGet)
	preflight.Header.Set("Access-Control-Request-Headers", "X-VantaVault-Key, X-Riot-Selected-Puuid")
	preflightResult := httptest.NewRecorder()
	handler.ServeHTTP(preflightResult, preflight)
	if preflightResult.Code != http.StatusOK {
		t.Fatalf("preflight got %d, want 200", preflightResult.Code)
	}
	if allowed := preflightResult.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(allowed, "X-Riot-Selected-Puuid") {
		t.Fatalf("selected-account header is not allowed by CORS: %q", allowed)
	}
	if allowed := preflightResult.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(allowed, http.MethodDelete) {
		t.Fatalf("account-data deletion is not allowed by CORS: %q", allowed)
	}
	if called != 0 {
		t.Fatal("preflight unexpectedly reached the API handler")
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	request.Header.Set("Origin", "http://tauri.localhost")
	request.Header.Set("X-VantaVault-Key", "secret")
	result := httptest.NewRecorder()
	handler.ServeHTTP(result, request)
	if result.Code != http.StatusNoContent || called != 1 {
		t.Fatalf("authenticated request got status %d and called=%d", result.Code, called)
	}
}

func TestRefreshedLocalClientReplacesEntitlementAndAccount(t *testing.T) {
	current := &valclient.ValClient{
		Shard:  valclient.Shard("eu"),
		Region: valclient.Region("eu"),
		Player: &valclient.ValClientPlayer{Uuid: "old-account"},
		Header: http.Header{
			"Authorization":           []string{"Bearer old-access"},
			"X-Riot-Entitlements-Jwt": []string{"old-entitlement"},
			"X-Riot-Clientversion":    []string{"release-13.02-shipping-7-5092570"},
		},
	}
	auth := valclient.AuthenticateResponse{
		AccessToken: "new-access",
		Subject:     "new-account",
		Token:       "new-entitlement",
	}

	if !localClientAuthChanged(current, auth) {
		t.Fatal("changed local credentials were not detected")
	}
	refreshed := refreshedLocalClient(current, auth)
	if refreshed.Player.Uuid != "new-account" {
		t.Fatalf("puuid = %q", refreshed.Player.Uuid)
	}
	if got := refreshed.Header.Get("Authorization"); got != "Bearer new-access" {
		t.Fatalf("authorization = %q", got)
	}
	if got := refreshed.Header.Get("X-Riot-Entitlements-JWT"); got != "new-entitlement" {
		t.Fatalf("entitlement = %q", got)
	}
	if got := refreshed.Header.Get("X-Riot-ClientVersion"); got != "release-13.02-shipping-7-5092570" {
		t.Fatalf("client version was not preserved: %q", got)
	}
	if current.Header.Get("Authorization") != "Bearer old-access" {
		t.Fatal("original client headers were mutated")
	}
}
