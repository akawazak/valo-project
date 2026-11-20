package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/truearken/valclient/valclient"
)

type unavailableLocalAccountNameLookup struct{}

func (unavailableLocalAccountNameLookup) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("name service unavailable")
}

func TestGetLocalAccountFollowsRiotClientSession(t *testing.T) {
	defaultClient := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: unavailableLocalAccountNameLookup{}}
	t.Cleanup(func() { http.DefaultClient = defaultClient })

	for _, tc := range []struct {
		name, subject, gameName, tag string
		wantName                     string
		status                       int
	}{
		{"matching Riot session", "test-account", "Live Riot name", "TEST", "Live Riot name", http.StatusOK},
		{"no Riot ID available", "test-account", "", "", "Unknown", http.StatusOK},
		{"Riot switching accounts", "other-account", "Live Riot name", "TEST", "", http.StatusConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			riot := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/chat/v1/session" {
					http.NotFound(w, r)
					return
				}
				json.NewEncoder(w).Encode(map[string]string{
					"puuid": tc.subject, "game_name": tc.gameName, "game_tag": tc.tag,
				})
			}))
			defer riot.Close()
			address, err := url.Parse(riot.URL)
			if err != nil {
				t.Fatal(err)
			}
			h := NewHandler(nil)
			h.Val = &valclient.ValClient{
				Player: &valclient.ValClientPlayer{Uuid: "test-account"},
				Local:  &valclient.ValClientLocal{Port: address.Port(), HttpClient: riot.Client()},
				Region: "eu",
			}
			response := httptest.NewRecorder()
			h.GetLocalAccount(response, httptest.NewRequest(http.MethodGet, "/v1/accounts/local", nil))
			if response.Code != tc.status {
				t.Fatalf("status = %d, want %d", response.Code, tc.status)
			}
			if tc.status == http.StatusOK {
				var account LocalAccountResponse
				if err := json.NewDecoder(response.Body).Decode(&account); err != nil {
					t.Fatal(err)
				}
				if account.Puuid != tc.subject || account.Region != "eu" || account.GameName != tc.wantName || account.TagLine != tc.tag {
					t.Fatal("identity does not match the active Riot session")
				}
			}
		})
	}
}
