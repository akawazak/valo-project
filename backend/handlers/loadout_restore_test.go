package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/truearken/valclient/valclient"
)

func TestSingleWeaponRestoreKeepsOtherBuddyInstances(t *testing.T) {
	var written valclient.SetPlayerLoadoutRequest
	const current = `{"Guns":[{"ID":"other","SkinID":"keep","CharmInstanceID":"busy-instance","CharmLevelID":"buddy-level"},{"ID":"vandal","SkinID":"new"}],"ActiveExpressions":[],"Identity":{"PlayerCardID":"keep-card"}}`
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		body := `{"Entitlements":[{"ItemID":"buddy-level","InstanceID":"busy-instance"},{"ItemID":"buddy-level","InstanceID":"free-instance"}]}`
		if strings.Contains(r.URL.Path, "/playerloadout") {
			body = current
			if r.Method == http.MethodPut {
				if err := json.NewDecoder(r.Body).Decode(&written); err != nil {
					t.Fatal(err)
				}
			}
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	h := &Handler{Val: liveRetryClient("synthetic-player")}
	w := httptest.NewRecorder()
	h.PostApplyLoadout(w, httptest.NewRequest(http.MethodPost, "/apply-loadout", strings.NewReader(`{"loadout":{"vandal":{"skinId":"previous","skinLevelId":"old-level","chromaId":"silver","charmID":"buddy","charmLevelID":"buddy-level"}}}`)))
	if w.Code != http.StatusOK || len(written.Guns) != 2 {
		t.Fatalf("restore: %d %s, %+v", w.Code, w.Body.String(), written)
	}
	if written.Guns[0].SkinID != "keep" || written.Guns[0].CharmInstanceID != "busy-instance" || written.Guns[1].SkinID != "previous" || written.Guns[1].CharmInstanceID != "free-instance" || written.Identity.PlayerCardID != "keep-card" {
		t.Fatalf("single-weapon restore touched another slot or reused its buddy: %+v", written)
	}
}
