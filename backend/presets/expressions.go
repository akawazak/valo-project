package presets

import (
	"fmt"
	"strings"

	"github.com/truearken/valclient/valclient"
)

const SprayExpressionTypeID = "d5f120f8-ff8c-4aac-92ea-f2b5acbe9475"

// These legacy IDs are local position keys only. The v3 wire format uses an
// ordered expression wheel, with a cosmetic category
// TypeID that can occur in several positions.
var expressionWheelSlotIDs = [...]string{
	"0812b14c-4120-ed47-5cc2-c6b49b951408",
	"04cbc83a-43cf-aa2a-ee40-a09869679f22",
	"ee063def-4a6b-8254-8e39-16a7eb108e42",
	"d2b4e425-4a7b-3b3b-81d3-356c9a33bb58",
}

func ExpressionWheelSlotID(index int) string {
	if index < 0 || index >= len(expressionWheelSlotIDs) {
		return ""
	}
	return expressionWheelSlotIDs[index]
}

func expressionWheelIndex(id string) int {
	for index, slotID := range expressionWheelSlotIDs {
		if strings.EqualFold(id, slotID) {
			return index
		}
	}
	return -1
}

func applyExpressions(loadout *valclient.GetPlayerLoadoutRequest, sprays []SpraySlotV1, expressions []ExpressionSlotV1) error {
	updates := make(map[int]*valclient.ActiveExpressions)
	for _, spray := range sprays {
		if spray.SprayID == "" || spray.EquipSlotID == "" {
			continue
		}
		index := expressionWheelIndex(spray.EquipSlotID)
		if index < 0 {
			return fmt.Errorf("spray wheel position is missing; re-save this preset from your current loadout")
		}
		updates[index] = &valclient.ActiveExpressions{TypeID: SprayExpressionTypeID, AssetID: spray.SprayID}
	}
	seen := make(map[int]bool)
	for _, expression := range expressions {
		if expression.TypeID == "" || expression.AssetID == "" {
			continue
		}
		index := -1
		typeID := expression.TypeID
		legacyIndex := expressionWheelIndex(typeID)
		if legacyIndex >= 0 {
			typeID = SprayExpressionTypeID
		}
		if expression.SlotIndex != nil {
			index = *expression.SlotIndex
		} else if legacyIndex >= 0 {
			index = legacyIndex
		} else {
			// Old presets without positions are safe only when this category
			// currently identifies exactly one expression on the wheel.
			for currentIndex, current := range loadout.ActiveExpressions {
				if current != nil && strings.EqualFold(current.TypeID, typeID) {
					if index >= 0 {
						return fmt.Errorf("expression wheel position is ambiguous; re-save this preset from your current loadout")
					}
					index = currentIndex
				}
			}
		}
		if index < 0 || index >= len(loadout.ActiveExpressions) {
			return fmt.Errorf("expression wheel position is unavailable; refresh your loadout and re-save this preset")
		}
		// Expressions precede the legacy Flexes alias in Apply's callers.
		// Keep that authoritative selection if both describe the same position.
		if !seen[index] {
			updates[index] = &valclient.ActiveExpressions{TypeID: typeID, AssetID: expression.AssetID}
			seen[index] = true
		}
	}
	for index, expression := range updates {
		if index >= len(loadout.ActiveExpressions) {
			return fmt.Errorf("expression wheel position is unavailable; refresh your loadout and re-save this preset")
		}
		loadout.ActiveExpressions[index] = expression
	}
	return nil
}
