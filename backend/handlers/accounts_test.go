package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetAccountsDistinguishesMissingAndSavedEmptyAccounts(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	h := NewHandler(nil)
	response := httptest.NewRecorder()
	h.GetAccounts(response, httptest.NewRequest(http.MethodGet, "/v1/accounts", nil))
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("missing accounts: status %d, body %q; want 204, no body", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	h.PostAccounts(response, httptest.NewRequest(http.MethodPost, "/v1/accounts", strings.NewReader("[]")))
	if response.Code != http.StatusOK {
		t.Fatalf("saving empty accounts: status %d, body %q", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	h.GetAccounts(response, httptest.NewRequest(http.MethodGet, "/v1/accounts", nil))
	if response.Code != http.StatusOK || response.Body.String() != "[]" {
		t.Fatalf("saved empty accounts: status %d, body %q; want 200, []", response.Code, response.Body.String())
	}
}

func TestGetAccountsRejectsInvalidExistingAccounts(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	dir := filepath.Join(config, "valovault", "accounts")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{"", "invalid json", "null", "{}"} {
		t.Run(data, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, "accounts.json"), []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			NewHandler(nil).GetAccounts(response, httptest.NewRequest(http.MethodGet, "/v1/accounts", nil))
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("invalid accounts %q: status %d, body %q; want 500", data, response.Code, response.Body.String())
			}
		})
	}
}
