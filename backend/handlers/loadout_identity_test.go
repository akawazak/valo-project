package handlers

import (
	"backend/presets"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/truearken/valclient/valclient"
)

const levelIdentityLoadout = `{
	"Guns": [], "ActiveExpressions": [],
	"Identity": {
		"PlayerCardID": "current-card", "PlayerTitleID": "current-title",
		"AccountLevel": 88, "PreferredLevelBorderID": "equipped-border",
		"HideAccountLevel": true
	}
}`

func TestPlayerLoadoutForwardsLevelDisplayMetadata(t *testing.T) {
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/personalization/v3/") {
			t.Fatalf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(levelIdentityLoadout))}, nil
	})
	h := &Handler{Val: liveRetryClient("synthetic-player")}
	w := httptest.NewRecorder()
	h.GetPlayerLoadout(w, httptest.NewRequest(http.MethodGet, "/player-loadout", nil))
	var response struct {
		Identity *presets.IdentityV1 `json:"identity"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != http.StatusOK {
		t.Fatalf("loadout response = %d %s, error=%v", w.Code, w.Body.String(), err)
	}
	if response.Identity == nil || response.Identity.AccountLevel != 88 || response.Identity.PreferredLevelBorderID != "equipped-border" || !response.Identity.HideAccountLevel {
		t.Fatalf("equipped level display metadata was lost: %+v", response.Identity)
	}
}

func TestApplyLoadoutPreservesEquippedLevelDisplayMetadata(t *testing.T) {
	putCalls := 0
	var written valclient.SetPlayerLoadoutRequest
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		body := `{"Entitlements":[]}`
		if strings.Contains(r.URL.Path, "/playerloadout") {
			body = levelIdentityLoadout
			if r.Method == http.MethodPut {
				putCalls++
				if err := json.NewDecoder(r.Body).Decode(&written); err != nil {
					t.Fatal(err)
				}
			}
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	h := &Handler{Val: liveRetryClient("synthetic-player")}
	w := httptest.NewRecorder()
	const body = `{"loadout":{},"identity":{"playerCardId":"selected-card","playerTitleId":"selected-title","accountLevel":999,"preferredLevelBorderId":"preset-border","hideAccountLevel":false}}`
	h.PostApplyLoadout(w, httptest.NewRequest(http.MethodPost, "/apply-loadout", strings.NewReader(body)))
	if w.Code != http.StatusOK || putCalls != 1 || written.Identity == nil {
		t.Fatalf("apply response = %d %s, PUT calls=%d, identity=%+v", w.Code, w.Body.String(), putCalls, written.Identity)
	}
	if written.Identity.PlayerCardID != "selected-card" || written.Identity.PlayerTitleID != "selected-title" || written.Identity.AccountLevel != 88 || written.Identity.PreferredLevelBorderID != "equipped-border" || !written.Identity.HideAccountLevel {
		t.Fatalf("applying card/title changed account level display metadata: %+v", written.Identity)
	}
}
