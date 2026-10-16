import type { ExpressionSlot, SpraySlot } from './types';

export const SPRAY_TYPE_ID = "d5f120f8-ff8c-4aac-92ea-f2b5acbe9475";
export const FLEX_TYPE_ID = "03a572de-4234-31ed-d344-ababa488f981";
export const EMPTY_SPRAY_ID = "d7efbdd5-4a77-f858-a133-cfb8956ca1fe";

// Stable local position keys for older preset spray metadata; Riot v3 uses array order.
export const SPRAY_WHEEL_SLOTS = [
  { id: "0812b14c-4120-ed47-5cc2-c6b49b951408", name: "Slot 1", position: "top" as const },
  { id: "04cbc83a-43cf-aa2a-ee40-a09869679f22", name: "Slot 2", position: "right" as const },
  { id: "ee063def-4a6b-8254-8e39-16a7eb108e42", name: "Slot 3", position: "bottom" as const },
  { id: "d2b4e425-4a7b-3b3b-81d3-356c9a33bb58", name: "Slot 4", position: "left" as const },
] as const;

export function normalizeExpressions(expressions: ExpressionSlot[]): ExpressionSlot[] {
  return expressions.map((expression, index) => {
    const legacyIndex = SPRAY_WHEEL_SLOTS.findIndex(slot => slot.id.toLowerCase() === expression.typeId.toLowerCase());
    return { ...expression, typeId: legacyIndex < 0 ? expression.typeId : SPRAY_TYPE_ID, slotIndex: expression.slotIndex ?? (legacyIndex < 0 ? index : legacyIndex) };
  });
}

export function expressionMetadata(expressions: ExpressionSlot[]) {
  return {
    expressions,
    sprays: expressions.flatMap(expression => {
      const position = SPRAY_WHEEL_SLOTS[expression.slotIndex ?? -1];
      return position && expression.typeId.toLowerCase() === SPRAY_TYPE_ID
        ? [{ equipSlotId: position.id, sprayId: expression.assetId }] : [];
    }),
    flexes: expressions.filter(expression => expression.typeId.toLowerCase() === FLEX_TYPE_ID),
  };
}

/** Prefer the ordered v3 wheel; migrate position keys in older spray-only presets. */
export function resolveExpressions(expressions: ExpressionSlot[], sprays: SpraySlot[], flexes: ExpressionSlot[] = []): ExpressionSlot[] {
  if (expressions.length) return normalizeExpressions(expressions);
  const result = sprays.flatMap(spray => {
    const slotIndex = SPRAY_WHEEL_SLOTS.findIndex(slot => slot.id.toLowerCase() === spray.equipSlotId.toLowerCase());
    return slotIndex < 0 ? [] : [{ typeId: SPRAY_TYPE_ID, assetId: spray.sprayId, slotIndex }];
  });
  for (const flex of flexes) {
    const legacyIndex = SPRAY_WHEEL_SLOTS.findIndex(slot => slot.id.toLowerCase() === flex.typeId.toLowerCase());
    const slotIndex = flex.slotIndex ?? (legacyIndex < 0 ? undefined : legacyIndex);
    if (slotIndex !== undefined) {
      const duplicate = result.findIndex(expression => expression.slotIndex === slotIndex);
      if (duplicate >= 0) result.splice(duplicate, 1);
      result.push({ ...flex, typeId: FLEX_TYPE_ID, slotIndex });
    }
  }
  return result.sort((a, b) => a.slotIndex - b.slotIndex);
}

export function replaceExpressionSlot(expressions: ExpressionSlot[], slotIndex: number, typeId: string, assetId: string): ExpressionSlot[] {
  return [...expressions.filter(expression => expression.slotIndex !== slotIndex), { typeId, assetId, slotIndex }]
    .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));
}
