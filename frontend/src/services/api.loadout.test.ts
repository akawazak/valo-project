import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetchCacheFirstJson: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/lib/errors', () => import('../lib/errors'));
vi.mock('@/lib/platform', () => ({ isAndroidRuntime: () => false }));
vi.mock('@/lib/resourceCache', () => ({ fetchCacheFirstJson: mocks.fetchCacheFirstJson }));
import { getPlayerLoadoutData } from './api';
import { FLEX_TYPE_ID, SPRAY_TYPE_ID, SPRAY_WHEEL_SLOTS } from '../lib/spraySlots';

beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.fetchCacheFirstJson.mockReset();
    mocks.fetchCacheFirstJson.mockRejectedValue(new Error('catalog unavailable'));
    vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());

it('retrieves equipped spray and Flex positions without depending on artwork catalogs', async () => {
    mocks.invoke.mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({
        loadout: {}, sprays: [], expressions: [
            { typeId: FLEX_TYPE_ID, assetId: 'unknown-flex' },
            { typeId: SPRAY_TYPE_ID, assetId: 'unknown-spray' },
            { typeId: SPRAY_TYPE_ID, assetId: 'another-spray', slotIndex: 3 },
        ],
    }) });
    const result = await getPlayerLoadoutData({ puuid: 'account', region: 'eu' });
    expect(result.sprays).toEqual([
        { equipSlotId: SPRAY_WHEEL_SLOTS[1].id, sprayId: 'unknown-spray' },
        { equipSlotId: SPRAY_WHEEL_SLOTS[3].id, sprayId: 'another-spray' },
    ]);
    expect(result.flexes).toEqual([{ typeId: FLEX_TYPE_ID, assetId: 'unknown-flex', slotIndex: 0 }]);
    expect(mocks.fetchCacheFirstJson).not.toHaveBeenCalled();
});

it('keeps a legacy spray response when the ordered expression array is absent', async () => {
    const sprays = [{ equipSlotId: SPRAY_WHEEL_SLOTS[0].id, sprayId: 'uncatalogued' }];
    mocks.invoke.mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({ loadout: {}, sprays }) });
    expect((await getPlayerLoadoutData()).sprays).toEqual(sprays);
    expect(mocks.fetchCacheFirstJson).not.toHaveBeenCalled();
});
