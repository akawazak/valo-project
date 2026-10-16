package tick

import "backend/presets"

func autoPresetExpressions(base, variant *presets.PresetV1) ([]presets.SpraySlotV1, []presets.ExpressionSlotV1) {
	if variant.Expressions != nil {
		return nil, variant.Expressions
	}
	if base.Expressions != nil {
		// A legacy child can still override an inherited modern wheel. Place its
		// position selections first so Apply keeps them over the base snapshot.
		expressions := append([]presets.ExpressionSlotV1{}, variant.Flexes...)
		for _, spray := range variant.Sprays {
			expressions = append(expressions, presets.ExpressionSlotV1{TypeID: spray.EquipSlotID, AssetID: spray.SprayID})
		}
		expressions = append(expressions, base.Expressions...)
		return nil, expressions
	}
	sprays, expressions := base.Sprays, base.Flexes
	if len(variant.Sprays) > 0 {
		sprays = variant.Sprays
	}
	if variant.Flexes != nil {
		expressions = variant.Flexes
	}
	return sprays, expressions
}
