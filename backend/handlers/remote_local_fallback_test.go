package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/truearken/valclient/valclient"
)

func testToken(subject string, expiresAt time.Time) string {
	part := func(value string) string { return base64.RawURLEncoding.EncodeToString([]byte(value)) }
	return part(`{"alg":"none"}`) + "." + part(fmt.Sprintf(`{"sub":%q,"exp":%d}`, subject, expiresAt.Unix())) + "." + part("sig")
}

func remoteRequest(puuid, token string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/v1/wallet", nil)
	r.Header.Set("X-Riot-Selected-Puuid", puuid)
	r.Header.Set("X-Riot-Puuid", puuid)
	r.Header.Set("X-Riot-Region", "eu")
	r.Header.Set("X-Riot-Access-Token", token)
	r.Header.Set("X-Riot-Entitlements-JWT", "entitlements")
	return r
}

func TestPreferLiveLocalSession(t *testing.T) {
	const player = "aaaaaaaa-0000-0000-0000-000000000001"
	const other = "aaaaaaaa-0000-0000-0000-000000000002"
	h := NewHandler(nil)
	h.Val = &valclient.ValClient{Player: &valclient.ValClientPlayer{Uuid: player}}

	cases := []struct {
		name       string
		request    *http.Request
		wantRemote bool
	}{
		{"expired token, same account in the Riot Client", remoteRequest(player, testToken(player, time.Now().Add(-time.Minute))), false},
		{"valid token stays remote", remoteRequest(player, testToken(player, time.Now().Add(time.Hour))), true},
		{"expired token for another account stays remote", remoteRequest(other, testToken(other, time.Now().Add(-time.Minute))), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seen *http.Request
			h.PreferLiveLocalSession(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = r })).ServeHTTP(httptest.NewRecorder(), tc.request)
			if got := seen.Header.Get("X-Riot-Access-Token") != ""; got != tc.wantRemote {
				t.Fatalf("remote token kept = %v, want %v", got, tc.wantRemote)
			}
			if !tc.wantRemote {
				client, err := h.getClient(seen)
				if err != nil || client != h.Val {
					t.Fatalf("expected the local client, got %v, %v", client, err)
				}
			}
		})
	}

	t.Run("no Riot Client keeps the expiry error", func(t *testing.T) {
		offline := NewHandler(nil)
		var seen *http.Request
		offline.PreferLiveLocalSession(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = r })).ServeHTTP(httptest.NewRecorder(), remoteRequest(player, testToken(player, time.Now().Add(-time.Minute))))
		if _, err := offline.getClient(seen); err == nil {
			t.Fatal("expected an authentication error without a local client")
		}
	})
}
