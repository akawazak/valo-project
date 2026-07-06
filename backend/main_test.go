package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
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

func TestDesktopCORSPreflightThenAuthenticatedRequest(t *testing.T) {
	called := 0
	handler := corsMiddleware(apiKeyMiddleware("secret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	})))

	preflight := httptest.NewRequest(http.MethodOptions, "/v1/health", nil)
	preflight.Header.Set("Origin", "http://tauri.localhost")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodGet)
	preflight.Header.Set("Access-Control-Request-Headers", "X-VantaVault-Key")
	preflightResult := httptest.NewRecorder()
	handler.ServeHTTP(preflightResult, preflight)
	if preflightResult.Code != http.StatusOK {
		t.Fatalf("preflight got %d, want 200", preflightResult.Code)
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
