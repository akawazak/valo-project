import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RiotAccount } from './types';

const account: RiotAccount = {
    puuid: 'synthetic-puuid', gameName: 'SyntheticName', tagLine: 'TAG', region: 'eu', authSource: 'oauth',
    accessToken: 'synthetic-access', entitlementsToken: 'synthetic-entitlements',
    ssid: 'ssid=synthetic-cookie', sessionId: 'session-synthetic',
    lastRefreshErrorCode: 'temporary', lastRenewedAt: Date.UTC(2026, 9, 16),
};

beforeEach(() => {
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('auth diagnostics', () => {
    it('keeps events across a restart', async () => {
        (await import('./authDebug')).pushAuthDebugEvent('refresh.ssid_reauth', account, { outcome: 'failed', code: 'temporary' });
        vi.resetModules();
        const reloaded = await import('./authDebug');
        const snapshot = JSON.parse(reloaded.buildAuthDebugSnapshot([account], account));
        expect(snapshot.recentEvents).toEqual([expect.objectContaining({ stage: 'refresh.ssid_reauth', outcome: 'failed', code: 'temporary' })]);
    });

    it('never includes account names, IDs, tokens or cookies', async () => {
        const { buildAuthDebugSnapshot } = await import('./authDebug');
        const snapshot = buildAuthDebugSnapshot([account], account);
        for (const secret of ['synthetic-puuid', 'SyntheticName', 'synthetic-access', 'synthetic-entitlements', 'synthetic-cookie', 'session-synthetic']) {
            expect(snapshot).not.toContain(secret);
        }
        expect(JSON.parse(snapshot).accounts[0]).toMatchObject({ account: 1, active: true, lastRefreshErrorCode: 'temporary', hasSavedSession: true });
    });
});
