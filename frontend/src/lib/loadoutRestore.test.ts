import { beforeEach, expect, it, vi } from 'vitest';
import { captureLoadoutRestore, readLoadoutRestore, writeLoadoutRestore } from './loadoutRestore';
import { FLEX_TYPE_ID, SPRAY_TYPE_ID, SPRAY_WHEEL_SLOTS } from './spraySlots';

const item = { skinId: 'old', skinLevelId: 'level', chromaId: 'silver', charmID: 'buddy', charmLevelID: 'buddy-level' };
const owner = { puuid: 'account-a', region: 'eu' };
const before = { loadout: { vandal: item, knife: { ...item, skinId: 'knife' } }, identity: { playerCardId: 'card', playerTitleId: 'title' }, sprays: [], flexes: [], expressions: [{ slotIndex: 0, typeId: SPRAY_TYPE_ID, assetId: 'spray' }, { slotIndex: 2, typeId: FLEX_TYPE_ID, assetId: 'flex' }] };
beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});
it('captures only the changed weapon including its buddy and survives a storage round trip', () => {
    const point = captureLoadoutRestore(before, { loadout: { vandal: { ...item, skinId: 'new' } } }, 'Vandal');
    expect(point.request).toEqual({ loadout: { vandal: item } });
    expect(point.request.loadout.vandal).not.toBe(item);
    writeLoadoutRestore(owner, point);
    expect(readLoadoutRestore(owner)).toEqual(point);
    expect(readLoadoutRestore({ ...owner, puuid: 'account-b' })).toBeNull();
    expect(readLoadoutRestore({ ...owner, region: 'na' })).toBeNull();
});
it('preserves sparse expression positions and restores only identity fields being changed', () => {
    const point = captureLoadoutRestore(before, { loadout: {}, identity: { playerCardId: 'new-card', playerTitleId: '' }, expressions: [{ typeId: SPRAY_TYPE_ID, assetId: 'new-spray', slotIndex: 2 }] }, 'Setup');
    expect(point.request.identity).toEqual({ playerCardId: 'card', playerTitleId: '' });
    expect(point.request.expressions).toEqual([before.expressions[1]]);
    const legacy = captureLoadoutRestore(before, { loadout: {}, sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[0].id, sprayId: 'new' }], flexes: [{ typeId: FLEX_TYPE_ID, assetId: 'new-flex' }] }, 'Setup');
    expect(legacy.request.expressions).toEqual(before.expressions);
});
it('refuses an apply whose previous equipment is missing rather than inventing defaults', () => {
    expect(() => captureLoadoutRestore(before, { loadout: { unknown: item } }, 'Unknown')).toThrow('Refresh');
    expect(() => captureLoadoutRestore(before, { loadout: {}, expressions: [{ typeId: FLEX_TYPE_ID, assetId: 'new', slotIndex: 1 }] }, 'Unknown')).toThrow('Refresh');
});
it('ignores invalid saved data and clears a completed restore', () => {
    writeLoadoutRestore(owner, captureLoadoutRestore(before, { loadout: { vandal: item } }, 'Test'));
    writeLoadoutRestore(owner, null);
    expect(readLoadoutRestore(owner)).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => '{bad json' });
    expect(readLoadoutRestore(owner)).toBeNull();
});
