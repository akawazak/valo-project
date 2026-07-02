package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
