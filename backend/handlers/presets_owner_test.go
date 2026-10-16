package handlers

import (
	"backend/presets"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/truearken/valclient/valclient"
)

func TestPresetsUseSelectedOwnerWithoutValidSession(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	const localData = `[{"uuid":"local-preset"}]`
	const selectedData = `[{"uuid":"selected-preset"}]`
	if err := presets.SaveRawForOwner("local-account", []byte(localData)); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name    string
		local   bool
		expired bool
	}{
		{name: "offline"},
		{name: "different local account", local: true},
		{name: "expired selected session", local: true, expired: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := new(Handler)
			if tc.local {
				h.Val = &valclient.ValClient{Player: &valclient.ValClientPlayer{Uuid: "local-account"}}
			}
			if err := presets.SaveRawForOwner("selected-account", []byte(selectedData)); err != nil {
				t.Fatal(err)
			}
			request := func(method, body string) *http.Request {
				r := httptest.NewRequest(method, "/presets", strings.NewReader(body))
				r.Header.Set("X-Riot-Selected-Puuid", " SELECTED-ACCOUNT ")
				r.Header.Set("X-Riot-Expected-Puuid", "selected-account")
				// Even stale legacy credentials must not select the disk owner.
				r.Header.Set("X-Riot-Puuid", "local-account")
				if tc.expired {
					claims := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"selected-account","exp":1}`))
					r.Header.Set("X-Riot-Access-Token", "header."+claims+".signature")
				}
				return r
			}
			read := httptest.NewRecorder()
			h.GetPresets(read, request(http.MethodGet, ""))
			if read.Code != http.StatusOK || read.Body.String() != selectedData {
				t.Fatalf("selected owner read returned %d %s", read.Code, read.Body.String())
			}
			const replacement = `[{"uuid":"new-selected-preset"}]`
			write := httptest.NewRecorder()
			h.PostPresets(write, request(http.MethodPost, replacement))
			if write.Code != http.StatusOK {
				t.Fatalf("selected owner write returned %d %s", write.Code, write.Body.String())
			}
			for owner, want := range map[string]string{"local-account": localData, "selected-account": replacement} {
				got, err := presets.GetRawForOwner(owner)
				if err != nil || string(got) != want {
					t.Fatalf("owner %s: got %s, error %v", owner, got, err)
				}
			}
		})
	}
}

func TestPresetsRejectChangedCapturedOwnerBeforeDiskAccess(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	h := &Handler{Val: &valclient.ValClient{Player: &valclient.ValClientPlayer{Uuid: "local-account"}}}
	const original = `[{"uuid":"unchanged"}]`
	if err := presets.SaveRawForOwner("selected-account", []byte(original)); err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"previous-account", ""} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			r := httptest.NewRequest(method, "/presets", strings.NewReader(`[]`))
			r.Header.Set("X-Riot-Selected-Puuid", "selected-account")
			r.Header.Set("X-Riot-Expected-Puuid", expected)
			w := httptest.NewRecorder()
			if method == http.MethodGet {
				h.GetPresets(w, r)
			} else {
				h.PostPresets(w, r)
			}
			var body struct {
				ErrorCode string `json:"errorCode"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != http.StatusConflict || body.ErrorCode != "ACCOUNT_CHANGED" {
				t.Fatalf("%s expected owner %q: got %d %s", method, expected, w.Code, w.Body.String())
			}
		}
	}
	if got, err := presets.GetRawForOwner("selected-account"); err != nil || string(got) != original {
		t.Fatalf("rejected operation changed presets: %s, %v", got, err)
	}
}
