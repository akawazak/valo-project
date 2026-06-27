package main

import (
	"net/http"
	"net/http/httptest"
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
