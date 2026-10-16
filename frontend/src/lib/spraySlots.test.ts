import { expect, it } from 'vitest';
import { EMPTY_SPRAY_ID, FLEX_TYPE_ID, SPRAY_TYPE_ID, SPRAY_WHEEL_SLOTS, expressionMetadata, normalizeExpressions, replaceExpressionSlot, resolveExpressions } from './spraySlots';
import { buildPresetApplyRequest } from './effectivePreset';
import { isValidPresetTemplate } from './presetShare';

const wheel = normalizeExpressions([
    { typeId: FLEX_TYPE_ID, assetId: 'flex' },
    { typeId: SPRAY_TYPE_ID, assetId: 'spray-a' },
    { typeId: SPRAY_TYPE_ID, assetId: 'spray-b' },
    { typeId: 'future-category', assetId: 'unknown-expression' },
]);

it('preserves mixed expression order, repeated categories and unknown equipped assets', () => {
    expect(wheel.map(expression => expression.slotIndex)).toEqual([0, 1, 2, 3]);
    expect(expressionMetadata(wheel)).toEqual({
        expressions: wheel,
        sprays: [
            { equipSlotId: SPRAY_WHEEL_SLOTS[1].id, sprayId: 'spray-a' },
            { equipSlotId: SPRAY_WHEEL_SLOTS[2].id, sprayId: 'spray-b' },
        ],
        flexes: [wheel[0]],
    });
});

it('replaces only the selected position across spray and Flex categories', () => {
    const updated = replaceExpressionSlot(wheel, 1, FLEX_TYPE_ID, 'second-flex');
    expect(updated.map(expression => expression.assetId)).toEqual(['flex', 'second-flex', 'spray-b', 'unknown-expression']);
    expect(expressionMetadata(updated).sprays).toEqual([{ equipSlotId: SPRAY_WHEEL_SLOTS[2].id, sprayId: 'spray-b' }]);
    expect(expressionMetadata(updated).flexes).toHaveLength(2);
    const cleared = replaceExpressionSlot(updated, 1, SPRAY_TYPE_ID, EMPTY_SPRAY_ID);
    expect(cleared[1]).toEqual({ typeId: SPRAY_TYPE_ID, assetId: EMPTY_SPRAY_ID, slotIndex: 1 });
    expect(cleared[3]).toEqual(wheel[3]);
});

it('migrates legacy spray positions without compacting gaps', () => {
    expect(resolveExpressions([], [{ equipSlotId: SPRAY_WHEEL_SLOTS[2].id, sprayId: 'legacy' }])).toEqual([
        { typeId: SPRAY_TYPE_ID, assetId: 'legacy', slotIndex: 2 },
    ]);
    expect(normalizeExpressions([{ typeId: SPRAY_WHEEL_SLOTS[3].id, assetId: 'legacy' }])[0]).toEqual({ typeId: SPRAY_TYPE_ID, assetId: 'legacy', slotIndex: 3 });
});

it('uses child expressions as authority instead of stale inherited spray projections', () => {
    const parent = { uuid: 'parent', name: 'Parent', loadout: {}, sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[0].id, sprayId: 'parent-spray' }] };
    const child = { uuid: 'child', name: 'Child', parentUuid: parent.uuid, loadout: {}, expressions: [wheel[0]] };
    const request = buildPresetApplyRequest(child, [parent]);
    expect(request.expressions).toEqual([wheel[0]]);
    expect(request.sprays).toEqual([]);
    expect(request.flexes).toEqual([wheel[0]]);
});

it('overlays a legacy child spray on a modern parent while preserving other expression positions', () => {
    const parent = { uuid: 'parent', name: 'Parent', loadout: {}, expressions: wheel };
    const child = { uuid: 'child', name: 'Child', parentUuid: parent.uuid, loadout: {}, sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[1].id, sprayId: 'child-spray' }] };
    const request = buildPresetApplyRequest(child, [parent]);
    expect(request.expressions?.map(expression => expression.assetId)).toEqual(['flex', 'child-spray', 'spray-b', 'unknown-expression']);
});

it('rejects invalid or duplicate imported expression positions', () => {
    const expression = { typeId: SPRAY_TYPE_ID, assetId: EMPTY_SPRAY_ID, slotIndex: 0 };
    expect(isValidPresetTemplate({ loadout: {}, expressions: [expression] })).toBe(true);
    for (const slotIndex of [-1, 4, 0.5, null, '0']) {
        expect(isValidPresetTemplate({ loadout: {}, expressions: [{ ...expression, slotIndex }] })).toBe(false);
    }
    expect(isValidPresetTemplate({ loadout: {}, expressions: [expression, expression] })).toBe(false);
});
