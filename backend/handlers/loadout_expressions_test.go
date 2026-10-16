package handlers

import (
	"backend/presets"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPlayerLoadoutKeepsExpressionCategoriesAndOriginalPositions(t *testing.T) {
	// Synthetic response with the maintainer fixture's repeated category shape.
	const upstream = `{
		"Guns": [], "ActiveExpressions": [
			{"TypeID":"03a572de-4234-31ed-d344-ababa488f981","AssetID":"flex-asset"},
			{"TypeID":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","AssetID":"spray-one"},
			null,
			{"TypeID":"D5F120F8-FF8C-4AAC-92EA-F2B5ACBE9475","AssetID":"spray-three"},
			{"TypeID":"unknown-category","AssetID":"unknown-asset"},
			{"TypeID":"unknown-empty-category","AssetID":""}
		]
	}`
	mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodGet || !strings.Contains(r.URL.Path, "/personalization/v3/") {
			t.Fatalf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(upstream))}, nil
	})
	h := &Handler{Val: liveRetryClient("synthetic-player")}
	w := httptest.NewRecorder()
	h.GetPlayerLoadout(w, httptest.NewRequest(http.MethodGet, "/player-loadout", nil))
	var response struct {
		Sprays      []presets.SpraySlotV1 `json:"sprays"`
		Expressions []struct {
			TypeID    string `json:"typeId"`
			AssetID   string `json:"assetId"`
			SlotIndex int    `json:"slotIndex"`
		} `json:"expressions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != http.StatusOK {
		t.Fatalf("loadout response = %d %s, error=%v", w.Code, w.Body.String(), err)
	}
	if len(response.Sprays) != 2 || response.Sprays[0].EquipSlotID != presets.ExpressionWheelSlotID(1) || response.Sprays[1].EquipSlotID != presets.ExpressionWheelSlotID(3) {
		t.Fatalf("sprays were assigned category IDs or compacted positions: %+v", response.Sprays)
	}
	if len(response.Expressions) != 5 || response.Expressions[0].SlotIndex != 0 || response.Expressions[2].SlotIndex != 3 || response.Expressions[3].TypeID != "unknown-category" || response.Expressions[4].SlotIndex != 5 || response.Expressions[4].AssetID != "" {
		t.Fatalf("ordered or unknown expressions were lost: %+v", response.Expressions)
	}
}

func TestApplyLoadoutModernExpressionsIgnoreStaleLegacyAliases(t *testing.T) {
	const upstream = `{
		"Guns": [], "Identity": {}, "ActiveExpressions": [
			{"TypeID":"03a572de-4234-31ed-d344-ababa488f981","AssetID":"flex-current"},
			{"TypeID":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","AssetID":"spray-current"}
		]
	}`
	for _, modern := range []string{
		`[{"slotIndex":0,"typeId":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","assetId":"selected-spray"}]`,
		`[]`,
	} {
		t.Run(modern, func(t *testing.T) {
			putCalls := 0
			var written struct {
				Expressions []struct {
					TypeID  string `json:"TypeID"`
					AssetID string `json:"AssetID"`
				} `json:"ActiveExpressions"`
			}
			mockLiveRequests(t, func(r *http.Request) (*http.Response, error) {
				body := `{"Entitlements":[]}`
				if strings.Contains(r.URL.Path, "/playerloadout") {
					body = upstream
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
			body := `{"loadout":{},"expressions":` + modern + `,"sprays":[{"equipSlotId":"04cbc83a-43cf-aa2a-ee40-a09869679f22","sprayId":"stale-spray"}],"flexes":[{"typeId":"03a572de-4234-31ed-d344-ababa488f981","assetId":"stale-flex"}]}`
			h.PostApplyLoadout(w, httptest.NewRequest(http.MethodPost, "/apply-loadout", strings.NewReader(body)))
			if w.Code != http.StatusOK || putCalls != 1 || len(written.Expressions) != 2 || written.Expressions[1].AssetID != "spray-current" {
				t.Fatalf("legacy alias overwrote modern wheel: %d %s %+v, PUT calls=%d", w.Code, w.Body.String(), written.Expressions, putCalls)
			}
			wantFirst := "selected-spray"
			if modern == "[]" {
				wantFirst = "flex-current"
			}
			if written.Expressions[0].AssetID != wantFirst {
				t.Fatalf("first position = %+v, want %s", written.Expressions[0], wantFirst)
			}
		})
	}
}
