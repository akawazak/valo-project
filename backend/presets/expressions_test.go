package presets

import (
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/truearken/valclient/valclient"
)

// Shape and category IDs follow the v3 maintainer's mixed-expression fixture:
// https://github.com/PrometheuzzZ/valorant-api-docs/blob/trunk/valorant-api-types/tests/endpoint-responses/player-loadout/response.json
const mixedExpressionLoadout = `{
	"Guns": [], "Identity": {}, "Incognito": false,
	"ActiveExpressions": [
		{"TypeID":"03a572de-4234-31ed-d344-ababa488f981","AssetID":"af52b5a0-4a4c-03b2-c9d7-8187a08a2675"},
		{"TypeID":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","AssetID":"8ade5e91-4a18-db7a-9bda-c2a7c37f3ada"},
		{"TypeID":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","AssetID":"6983ae7c-4cb5-835c-8f62-b7affbaae20e"},
		{"TypeID":"d5f120f8-ff8c-4aac-92ea-f2b5acbe9475","AssetID":"7e2ba2e8-4597-060a-b41e-81acedca414e"}
	]
}`

func expressionFixture(t *testing.T) *valclient.GetPlayerLoadoutRequest {
	t.Helper()
	loadout := new(valclient.GetPlayerLoadoutRequest)
	if err := json.Unmarshal([]byte(mixedExpressionLoadout), loadout); err != nil {
		t.Fatal(err)
	}
	return loadout
}

func TestApplyExpressionsUpdatesOrderedPositionAndPreservesUnknown(t *testing.T) {
	loadout := expressionFixture(t)
	loadout.ActiveExpressions[0].TypeID = "unknown-category"
	before := expressionFixture(t)
	before.ActiveExpressions[0].TypeID = "unknown-category"
	index := 2
	if err := applyExpressions(loadout, []SpraySlotV1{{EquipSlotID: ExpressionWheelSlotID(index), SprayID: "compat-spray"}}, []ExpressionSlotV1{
		{SlotIndex: &index, TypeID: "03a572de-4234-31ed-d344-ababa488f981", AssetID: "selected-flex"},
		{SlotIndex: &index, TypeID: SprayExpressionTypeID, AssetID: "stale-alias"},
	}); err != nil {
		t.Fatal(err)
	}
	for position, expression := range loadout.ActiveExpressions {
		if position == index {
			if expression.TypeID != "03a572de-4234-31ed-d344-ababa488f981" || expression.AssetID != "selected-flex" {
				t.Fatalf("selected position = %+v", expression)
			}
		} else if !reflect.DeepEqual(expression, before.ActiveExpressions[position]) {
			t.Fatalf("untouched position %d changed: %+v", position, expression)
		}
	}
}

func TestApplyExpressionsMapsLegacyPositionAndRejectsAmbiguousCategory(t *testing.T) {
	loadout := expressionFixture(t)
	if err := applyExpressions(loadout, []SpraySlotV1{{EquipSlotID: ExpressionWheelSlotID(3), SprayID: "last-spray"}}, nil); err != nil {
		t.Fatal(err)
	}
	if got := loadout.ActiveExpressions[3]; got.TypeID != SprayExpressionTypeID || got.AssetID != "last-spray" {
		t.Fatalf("legacy spray position was not canonicalized: %+v", got)
	}
	index := 1
	if err := applyExpressions(loadout, nil, []ExpressionSlotV1{{SlotIndex: &index, TypeID: ExpressionWheelSlotID(1), AssetID: "indexed-legacy"}}); err != nil {
		t.Fatal(err)
	}
	if got := loadout.ActiveExpressions[index]; got.TypeID != SprayExpressionTypeID || got.AssetID != "indexed-legacy" {
		t.Fatalf("indexed legacy type was not canonicalized: %+v", got)
	}
	if err := applyExpressions(loadout, nil, []ExpressionSlotV1{{TypeID: SprayExpressionTypeID, AssetID: "ambiguous"}}); err == nil || !strings.Contains(err.Error(), "ambiguous") {
		t.Fatalf("ambiguous category update was accepted: %v", err)
	}
	for _, invalid := range []int{-1, 4} {
		if err := applyExpressions(loadout, nil, []ExpressionSlotV1{{SlotIndex: &invalid, TypeID: SprayExpressionTypeID, AssetID: "invalid"}}); err == nil {
			t.Fatalf("invalid position %d was accepted", invalid)
		}
	}
}

func TestApplyExpressionsPreservesNullPositionsAndExplicitZero(t *testing.T) {
	loadout := expressionFixture(t)
	loadout.ActiveExpressions[1] = nil
	index := 0
	slot := ExpressionSlotV1{SlotIndex: &index, TypeID: SprayExpressionTypeID, AssetID: "first-spray"}
	encoded, err := json.Marshal(slot)
	if err != nil || !strings.Contains(string(encoded), `"slotIndex":0`) {
		t.Fatalf("position zero was omitted: %s, %v", encoded, err)
	}
	if err := applyExpressions(loadout, nil, []ExpressionSlotV1{slot}); err != nil {
		t.Fatal(err)
	}
	if len(loadout.ActiveExpressions) != 4 || loadout.ActiveExpressions[1] != nil || loadout.ActiveExpressions[0].AssetID != "first-spray" {
		t.Fatalf("position order changed: %+v", loadout.ActiveExpressions)
	}
}

type expressionTestTransport func(*http.Request) (*http.Response, error)

func (f expressionTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestApplySerializesCategoriesAtPositionsWithoutRealRequests(t *testing.T) {
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	putCalls := 0
	var written valclient.SetPlayerLoadoutRequest
	http.DefaultTransport = expressionTestTransport(func(r *http.Request) (*http.Response, error) {
		body := `{ "Entitlements": [] }`
		if strings.Contains(r.URL.Path, "/playerloadout") {
			body = mixedExpressionLoadout
			if r.Method == http.MethodPut {
				putCalls++
				if err := json.NewDecoder(r.Body).Decode(&written); err != nil {
					t.Fatal(err)
				}
			}
		}
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	client := &valclient.ValClient{Region: "eu", Shard: "eu", Player: &valclient.ValClientPlayer{Uuid: "synthetic-player"}, Header: http.Header{}}
	index := 3
	if err := Apply(client, nil, nil, nil, []ExpressionSlotV1{{SlotIndex: &index, TypeID: "03a572de-4234-31ed-d344-ababa488f981", AssetID: "selected-flex"}}); err != nil {
		t.Fatal(err)
	}
	if putCalls != 1 || len(written.ActiveExpressions) != 4 || written.ActiveExpressions[1].AssetID != "8ade5e91-4a18-db7a-9bda-c2a7c37f3ada" || written.ActiveExpressions[3].TypeID != "03a572de-4234-31ed-d344-ababa488f981" {
		t.Fatalf("serialized wheel = %+v, PUT calls = %d", written.ActiveExpressions, putCalls)
	}
	if err := Apply(client, nil, nil, nil, []ExpressionSlotV1{{TypeID: SprayExpressionTypeID, AssetID: "ambiguous"}}); err == nil || putCalls != 1 {
		t.Fatalf("ambiguous legacy preset sent a PUT: error=%v calls=%d", err, putCalls)
	}
}
