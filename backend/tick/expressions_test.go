package tick

import (
	"backend/presets"
	"reflect"
	"testing"
)

func TestAutoPresetExpressionsKeepsLegacyChildOverrideOverModernParent(t *testing.T) {
	index := 1
	base := &presets.PresetV1{
		Expressions: []presets.ExpressionSlotV1{{SlotIndex: &index, TypeID: presets.SprayExpressionTypeID, AssetID: "parent-spray"}},
		Sprays:      []presets.SpraySlotV1{{EquipSlotID: presets.ExpressionWheelSlotID(1), SprayID: "stale-parent-alias"}},
		Flexes:      []presets.ExpressionSlotV1{{TypeID: "stale-flex", AssetID: "stale-parent-alias"}},
	}
	child := &presets.PresetV1{Sprays: []presets.SpraySlotV1{{EquipSlotID: presets.ExpressionWheelSlotID(1), SprayID: "child-spray"}}}
	sprays, expressions := autoPresetExpressions(base, child)
	if sprays != nil || len(expressions) != 2 || expressions[0].TypeID != presets.ExpressionWheelSlotID(1) || expressions[0].AssetID != "child-spray" || expressions[1].AssetID != "parent-spray" {
		t.Fatalf("legacy child override was lost: sprays=%+v expressions=%+v", sprays, expressions)
	}
	if len(base.Expressions) != 1 || base.Expressions[0].AssetID != "parent-spray" {
		t.Fatal("base expression snapshot was mutated")
	}
}

func TestAutoPresetExpressionsModernChildIgnoresAliasesIncludingExplicitEmpty(t *testing.T) {
	base := &presets.PresetV1{Expressions: []presets.ExpressionSlotV1{{TypeID: "parent", AssetID: "parent"}}}
	for _, selected := range [][]presets.ExpressionSlotV1{{{TypeID: "modern", AssetID: "selected"}}, {}} {
		child := &presets.PresetV1{
			Expressions: selected,
			Sprays:      []presets.SpraySlotV1{{EquipSlotID: "legacy", SprayID: "stale"}},
			Flexes:      []presets.ExpressionSlotV1{{TypeID: "legacy", AssetID: "stale"}},
		}
		sprays, expressions := autoPresetExpressions(base, child)
		if sprays != nil || expressions == nil || !reflect.DeepEqual(expressions, selected) {
			t.Fatalf("modern child did not remain authoritative: sprays=%+v expressions=%+v", sprays, expressions)
		}
	}
}
