import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    current: true,
    savePresets: vi.fn(),
    saveSettings: vi.fn(),
    captureAccountRequest: vi.fn(),
}));
vi.mock('./api', () => ({
    captureAccountRequest: mocks.captureAccountRequest,
    savePresets: mocks.savePresets,
    getPresets: vi.fn(), getHealth: vi.fn(),
}));
vi.mock('./settings', () => ({ saveSettings: mocks.saveSettings, getSettings: vi.fn(), getStorageStatus: vi.fn() }));
vi.mock('@/lib/presetShare', () => import('../lib/presetShare'));
import { importBackup } from './recovery';

const owner = { puuid: 'synthetic-owner', region: 'eu' };
const settings = {
    autoSelectAgent: false, useLocalSso: false, autoSyncMatches: false, matchRetentionDays: 90,
    showOfflineFriends: false, showLiveMatch: false, showPartyWidget: false, showUnownedCosmetics: false,
};
function backupFile(presets: unknown[] = []): File {
    return { text: async () => JSON.stringify({ version: 1, createdAt: '2026-10-11', presets, settings }) } as File;
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.current = true;
    mocks.captureAccountRequest.mockReturnValue({ owner, isCurrent: () => mocks.current });
    mocks.savePresets.mockResolvedValue(undefined);
    mocks.saveSettings.mockResolvedValue(undefined);
});

describe('account-bound backup restore', () => {
    it('does not change app settings if the preset write fails', async () => {
        mocks.savePresets.mockRejectedValueOnce(new Error('disk unavailable'));
        await expect(importBackup(backupFile())).rejects.toThrow('disk unavailable');
        expect(mocks.savePresets).toHaveBeenCalledWith([], owner);
        expect(mocks.saveSettings).not.toHaveBeenCalled();
    });

    it('does not write a backup when the account changes during file reading', async () => {
        let finish!: (text: string) => void;
        const text = new Promise<string>(resolve => { finish = resolve; });
        const importing = importBackup({ text: () => text } as File);
        mocks.current = false;
        finish(await backupFile().text());
        await expect(importing).resolves.toBe(false);
        expect(mocks.savePresets).not.toHaveBeenCalled();
        expect(mocks.saveSettings).not.toHaveBeenCalled();
    });

    it('does not change settings or report completion after an account switch during the preset write', async () => {
        mocks.savePresets.mockImplementationOnce(async () => { mocks.current = false; });
        await expect(importBackup(backupFile())).resolves.toBe(false);
        expect(mocks.saveSettings).not.toHaveBeenCalled();
    });

    it.each([
        [{ uuid: 'a', name: 'Invalid', loadout: null }],
        [{ uuid: 'a', name: 'Invalid', loadout: { weapon: { skinId: 'invalid' } } }],
        [{ uuid: 'a', name: 'A', loadout: {}, parentUuid: 'b' }, { uuid: 'b', name: 'B', loadout: {}, parentUuid: 'a' }],
        [{ uuid: 'a', name: 'A', loadout: {}, parentUuid: 'missing' }],
        [{ uuid: 'a', name: 'A', loadout: {} }, { uuid: 'a', name: 'Duplicate', loadout: {} }],
    ].map(presets => ({ presets })))('rejects invalid nested data or broken parent chains before any write: %j', async ({ presets }) => {
        await expect(importBackup(backupFile(presets))).rejects.toThrow();
        expect(mocks.savePresets).not.toHaveBeenCalled();
        expect(mocks.saveSettings).not.toHaveBeenCalled();
    });

    it('preserves valid stored variant deltas and completes both writes in order', async () => {
        const presets = [{ uuid: 'a', name: 'Base', loadout: {} }, { uuid: 'b', name: 'Child', loadout: {}, parentUuid: 'a' }];
        await expect(importBackup(backupFile(presets))).resolves.toBe(true);
        expect(mocks.savePresets).toHaveBeenCalledWith(presets, owner);
        expect(mocks.saveSettings).toHaveBeenCalledWith(settings);
        expect(mocks.savePresets.mock.invocationCallOrder[0]).toBeLessThan(mocks.saveSettings.mock.invocationCallOrder[0]);
    });
});
