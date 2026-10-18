import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RiotAccount } from '../lib/types';

type Payload = { sessionId: string; url?: string; cookies?: string };
type Handler = (event: { payload: Payload }) => unknown;
const mocks = vi.hoisted(() => ({
    invoke: vi.fn(), listen: vi.fn(), appFetch: vi.fn(), getAuthUrl: vi.fn(), submitTokenUrl: vi.fn(),
    saveStoredAccounts: vi.fn(), activate: vi.fn(), accounts: [] as RiotAccount[],
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('@/lib/types', () => import('../lib/types'));
vi.mock('@/lib/errors', () => import('../lib/errors'));
vi.mock('@/lib/accountSelection', () => import('../lib/accountSelection'));
vi.mock('@/lib/accountHealth', () => import('../lib/accountHealth'));
vi.mock('@/lib/platform', () => ({ isAndroidRuntime: () => false }));
vi.mock('@/lib/authDebug', () => ({ pushAuthDebugEvent: vi.fn() }));
vi.mock('@/lib/accountStorage', () => ({
    getStoredAccounts: () => mocks.accounts,
    saveStoredAccounts: mocks.saveStoredAccounts,
    deleteStoredAccountSecrets: vi.fn(), hydrateStoredAccounts: vi.fn(), removeStoredAccount: vi.fn(),
}));
vi.mock('@/services/api', () => ({
    appFetch: mocks.appFetch, getAuthUrl: mocks.getAuthUrl, submitTokenUrl: mocks.submitTokenUrl,
    activateAccount: mocks.activate, clearActiveAccount: vi.fn(), clearChatHistory: vi.fn(), reportAppError: vi.fn(),
    getAgents: vi.fn(), getWeapons: vi.fn(), getGunBuddies: vi.fn(), getContentTiers: vi.fn(),
    getOwnedSkins: vi.fn(), getOwnedGunBuddies: vi.fn(), getHealth: vi.fn(), getLocalAccount: vi.fn(),
    getOwnedAgents: vi.fn(), getBundles: vi.fn(), getSprays: vi.fn(), getPlayerCards: vi.fn(),
    getPlayerTitles: vi.fn(), getOwnedSprays: vi.fn(), getOwnedPlayerCards: vi.fn(),
    getOwnedPlayerTitles: vi.fn(), getPlayerSprays: vi.fn(), hasActiveRemoteAuth: vi.fn(), getFlexes: vi.fn(),
}));
import { DataProvider, migrateSessionIds, useData } from './DataContext';

// Use real React refs/callbacks while leaving background hydration/health effects
// unmounted. The native event bus and all credentials below are synthetic.
let capturedProvider: ReturnType<typeof useData> | null = null;
function captureProvider() {
    let data!: ReturnType<typeof useData>;
    function Capture() { data = useData(); return null; }
    renderToStaticMarkup(createElement(DataProvider, null, createElement(Capture)));
    capturedProvider = data;
    return data;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return { promise, resolve };
}
const listeners = new Map<string, Set<Handler>>();
function register(name: string, handler: Handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(handler);
    return vi.fn(() => { listeners.get(name)?.delete(handler); });
}
async function emit(name: string, payload: Payload) {
    await Promise.all([...(listeners.get(name) ?? [])].map(handler => handler({ payload })));
}
async function flushAsync() {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 20; i++) await Promise.resolve();
}
function tokenResult(puuid: string) {
    return { puuid, access_token: 'synthetic-access', entitlements_token: 'synthetic-entitlements', expires_in: 3600, region: 'eu' };
}
function openedSession() {
    return mocks.invoke.mock.calls.find(([command]) => command === 'open_login_window')![1].sessionId as string;
}
const renewalAccount: RiotAccount = {
    puuid: 'account-a', gameName: 'Synthetic', tagLine: 'TEST', region: 'eu', authSource: 'oauth',
    accessToken: 'expired-access', entitlementsToken: 'expired-entitlements',
    sessionId: 'session-account-a', ssid: 'ssid=synthetic-cookie',
};

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    listeners.clear();
    capturedProvider = null;
    mocks.accounts = [{ ...renewalAccount }];
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval });
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('login-a').mockReturnValueOnce('login-b') });
    mocks.getAuthUrl.mockResolvedValue({ auth_url: 'https://auth.riotgames.com/synthetic-test' });
    mocks.appFetch.mockResolvedValue(new Response('{"error":"cookies_expired"}', { status: 401 }));
    mocks.saveStoredAccounts.mockImplementation(async (accounts: RiotAccount[]) => { mocks.accounts = accounts; });
    mocks.listen.mockImplementation(async (name: string, handler: Handler) => register(name, handler));
    mocks.invoke.mockImplementation(async (command: string, args: { sessionId: string }) => {
        if (command === 'close_login_window') await emit('riot-login-closed-v2', { sessionId: args.sessionId });
        if (command === 'get_ssid_cookie') return 'ssid=synthetic-cookie';
    });
});
afterEach(async () => {
    capturedProvider?.cancelLoginFlow();
    capturedProvider?.cancelAccountRefresh(renewalAccount);
    await flushAsync();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('saved account session migration', () => {
    it('waits for migrated metadata to persist before reporting readiness', async () => {
        mocks.accounts = [{ ...renewalAccount, sessionId: undefined }];
        const saving = deferred<void>();
        mocks.saveStoredAccounts.mockReturnValueOnce(saving.promise);
        const migration = migrateSessionIds();
        let ready = false;
        void migration.then(() => { ready = true; });
        await flushAsync();
        expect(ready).toBe(false);
        expect(mocks.saveStoredAccounts).toHaveBeenCalledWith([
            expect.objectContaining({ puuid: renewalAccount.puuid, sessionId: `session_${renewalAccount.puuid}` }),
        ]);

        saving.resolve();
        await migration;
        expect(ready).toBe(true);
    });

    it('leaves failed migration available for startup retry', async () => {
        mocks.accounts = [{ ...renewalAccount, sessionId: undefined }];
        mocks.saveStoredAccounts.mockRejectedValueOnce(new Error('disk unavailable'));
        await expect(migrateSessionIds()).rejects.toThrow('disk unavailable');
        expect(mocks.accounts[0].sessionId).toBeUndefined();
    });
});

describe('login attempt ownership', () => {
    it('cannot claim or settle B when cancelled A finishes a deferred token exchange', async () => {
        const data = captureProvider();
        const exchangeA = deferred<ReturnType<typeof tokenResult>>();
        mocks.submitTokenUrl.mockReturnValueOnce(exchangeA.promise).mockResolvedValueOnce(tokenResult('account-b'));
        const loginA = data.startLoginFlow();
        const rejectedA = expect(loginA).rejects.toThrow('Login cancelled');
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('open_login_window', expect.anything()));
        const sessionA = openedSession();
        const completingA = emit('riot-login-redirect-v2', { sessionId: sessionA, url: 'http://localhost/redirect#test-a' });
        await flushAsync();
        await vi.waitFor(() => expect(mocks.submitTokenUrl).toHaveBeenCalledTimes(1));

        data.cancelLoginFlow();
        await rejectedA;
        const loginB = data.startLoginFlow();
        let settledB = false;
        void loginB.then(() => { settledB = true; }, () => { settledB = true; });
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_login_window')).toHaveLength(2));
        const sessionB = mocks.invoke.mock.calls.filter(([command]) => command === 'open_login_window')[1][1].sessionId;
        exchangeA.resolve(tokenResult('account-a'));
        await completingA;
        await flushAsync();
        expect(settledB).toBe(false);
        expect(mocks.invoke).not.toHaveBeenCalledWith('claim_login_session', expect.anything());
        expect(mocks.saveStoredAccounts).not.toHaveBeenCalled();
        await expect(data.startLoginFlow()).rejects.toThrow('Another Riot login');

        await emit('riot-login-redirect-v2', { sessionId: sessionB, url: 'http://localhost/redirect#test-b' });
        await expect(loginB).resolves.toMatchObject({ puuid: 'account-b', sessionId: sessionB });
        expect(mocks.invoke.mock.calls.filter(([command]) => command === 'claim_login_session'))
            .toEqual([['claim_login_session', { sessionId: sessionB }]]);
    });

    it('disposes a login listener that finishes registering after cancellation', async () => {
        const pending = deferred<() => void>();
        const unlisten = vi.fn();
        mocks.listen.mockReturnValueOnce(pending.promise);
        const data = captureProvider();
        const login = data.startLoginFlow();
        const rejected = expect(login).rejects.toThrow('Login cancelled');
        await flushAsync();
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(1));
        data.cancelLoginFlow();
        await rejected;
        pending.resolve(unlisten);
        await flushAsync();
        expect(unlisten).toHaveBeenCalledTimes(1);
        expect(mocks.listen).toHaveBeenCalledTimes(1);
        expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_login_window')).toBe(false);
    });

    it('never opens a new login cancelled while its auth URL is pending', async () => {
        const authUrl = deferred<{ auth_url: string }>();
        mocks.getAuthUrl.mockReturnValueOnce(authUrl.promise);
        const data = captureProvider();
        const login = data.startLoginFlow();
        const rejected = expect(login).rejects.toThrow('Login cancelled');
        await vi.waitFor(() => expect(mocks.getAuthUrl).toHaveBeenCalledTimes(1));
        data.cancelLoginFlow();
        await rejected;
        authUrl.resolve({ auth_url: 'https://auth.riotgames.com/synthetic-test' });
        await flushAsync();
        expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_login_window')).toBe(false);
        expect([...listeners.values()].every(handlers => handlers.size === 0)).toBe(true);
    });
});

describe('interactive account renewal', () => {
    it('uses the protected native cookie before an older in-memory cookie', async () => {
        mocks.appFetch.mockResolvedValueOnce(new Response(JSON.stringify(tokenResult('account-a'))));
        await expect(captureProvider().refreshAccountToken({ ...renewalAccount }, false, false)).resolves.toBe(true);
        expect(JSON.parse(mocks.appFetch.mock.calls[0][1].body)).toEqual({ cookies: '' });
        expect(mocks.invoke).not.toHaveBeenCalledWith('get_ssid_cookie', expect.anything());
    });

    it('uses the remembered cookie only if protected storage explicitly has none', async () => {
        mocks.appFetch.mockResolvedValueOnce(new Response('{"error":"missing_cookies"}', {status:401}));
        mocks.appFetch.mockResolvedValueOnce(new Response(JSON.stringify(tokenResult('account-a'))));
        await expect(captureProvider().refreshAccountToken({ ...renewalAccount }, false, false)).resolves.toBe(true);
        expect(mocks.appFetch.mock.calls.map(([, init]) => JSON.parse(init.body).cookies)).toEqual(['', renewalAccount.ssid]);
    });

    it('does not switch back when another account was selected during renewal', async () => {
        localStorage.setItem('riot_puuid', 'account-a');
        const response = deferred<Response>();
        mocks.appFetch.mockReturnValueOnce(response.promise);
        const renewing = captureProvider().refreshAccountToken({ ...renewalAccount }, false, false);
        localStorage.setItem('riot_puuid', 'account-b');
        response.resolve(new Response(JSON.stringify(tokenResult('account-a'))));
        await expect(renewing).resolves.toBe(true);
        expect(localStorage.getItem('riot_puuid')).toBe('account-b');
        expect(mocks.activate).not.toHaveBeenCalled();
    });

    it('does not report renewal success with missing entitlements', async () => {
        mocks.appFetch.mockResolvedValueOnce(new Response('{"access_token":"synthetic-access"}'));
        await expect(captureProvider().refreshAccountToken({ ...renewalAccount }, false, false)).resolves.toBe(false);
        expect(mocks.activate).not.toHaveBeenCalled();
    });

    it('retries a temporary reauth failure quickly before giving up', async () => {
        mocks.appFetch.mockResolvedValueOnce(new Response('{"errorCode":"VV-BACKEND"}', { status: 500 }));
        mocks.appFetch.mockRejectedValueOnce(new TypeError('network down'));
        mocks.appFetch.mockResolvedValueOnce(new Response(JSON.stringify(tokenResult('account-a'))));
        const renewing = captureProvider().refreshAccountToken({ ...renewalAccount }, false, false);
        await vi.advanceTimersByTimeAsync(2_500);
        await expect(renewing).resolves.toBe(true);
        expect(mocks.appFetch).toHaveBeenCalledTimes(3);
    });

    it('stops after three temporary failures and keeps the saved session', async () => {
        mocks.appFetch.mockImplementation(async () => new Response('{"errorCode":"VV-BACKEND"}', { status: 500 }));
        const renewing = captureProvider().refreshAccountToken({ ...renewalAccount }, false, false);
        await vi.advanceTimersByTimeAsync(2_500);
        await expect(renewing).resolves.toBe(false);
        expect(mocks.appFetch).toHaveBeenCalledTimes(3);
        expect(mocks.accounts[0]).toMatchObject({ ssid: renewalAccount.ssid, lastRefreshErrorCode: 'temporary' });
    });

    it('does not retry when Riot asks for a new sign-in', async () => {
        mocks.appFetch.mockResolvedValueOnce(new Response('{"error":"login_required"}', { status: 401 }));
        await expect(captureProvider().refreshAccountToken({ ...renewalAccount }, false, false)).resolves.toBe(false);
        expect(mocks.appFetch).toHaveBeenCalledTimes(1);
    });

    it('keeps MFA open beyond 30 seconds after failed silent auth and times out at five minutes', async () => {
        const data = captureProvider();
        const startedAt = Date.now();
        const refreshing = data.refreshAccountToken({ ...renewalAccount }, true, true);
        let settled = false;
        void refreshing.then(() => { settled = true; });
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('open_login_window', expect.anything()));
        expect(mocks.appFetch).toHaveBeenCalledTimes(1);
        expect(openedSession()).toBe(renewalAccount.sessionId);
        await vi.advanceTimersByTimeAsync(30_001);
        expect(settled).toBe(false);
        expect(mocks.invoke.mock.calls.some(([command]) => command === 'close_login_window')).toBe(false);
        await vi.advanceTimersByTimeAsync(5 * 60_000 - (Date.now() - startedAt) - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(refreshing).resolves.toBe(false);
        expect(mocks.invoke).toHaveBeenCalledWith('close_login_window', { sessionId: renewalAccount.sessionId });
        expect(mocks.accounts[0].lastRefreshErrorCode).toBe('timeout');
    });

    it('allows Stop to close MFA and release the refresh lock immediately', async () => {
        const data = captureProvider();
        const refreshing = data.refreshAccountToken({ ...renewalAccount }, true, true);
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('open_login_window', expect.anything()));
        data.cancelAccountRefresh(renewalAccount);
        await expect(refreshing).resolves.toBe(false);
        expect(mocks.invoke).toHaveBeenCalledWith('close_login_window', { sessionId: renewalAccount.sessionId });
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(mocks.invoke.mock.calls.filter(([command]) => command === 'close_login_window')).toHaveLength(1);
        expect([...listeners.values()].every(handlers => handlers.size === 0)).toBe(true);
        const login = data.startLoginFlow();
        const rejected = expect(login).rejects.toThrow('Login cancelled');
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_login_window')).toHaveLength(2));
        data.cancelLoginFlow();
        await rejected;
    });

    it('cancels both active and queued renewals for the same account without reopening MFA', async () => {
        const data = captureProvider();
        const active = data.refreshAccountToken({ ...renewalAccount }, true, true);
        await flushAsync();
        await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('open_login_window', expect.anything()));
        const queued = data.refreshAccountToken({ ...renewalAccount }, true, true);
        await flushAsync();
        expect(mocks.appFetch).toHaveBeenCalledTimes(1);

        data.cancelAccountRefresh(renewalAccount);
        await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
        await flushAsync();
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(mocks.invoke.mock.calls.filter(([command]) => command === 'open_login_window')).toHaveLength(1);
        expect(mocks.invoke.mock.calls.filter(([command]) => command === 'close_login_window')).toHaveLength(1);
        expect(mocks.appFetch).toHaveBeenCalledTimes(1);
        expect([...listeners.values()].every(handlers => handlers.size === 0)).toBe(true);
    });

    it('disposes all late renewal listeners and never opens a cancelled popup', async () => {
        const registrations = Array.from({ length: 3 }, () => deferred<() => void>());
        registrations.forEach(pending => mocks.listen.mockReturnValueOnce(pending.promise));
        const data = captureProvider();
        const refreshing = data.refreshAccountToken({ ...renewalAccount }, true, true);
        await flushAsync();
        await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(3));
        data.cancelAccountRefresh(renewalAccount);
        await expect(refreshing).resolves.toBe(false);
        const disposers = registrations.map(pending => {
            const unlisten = vi.fn();
            pending.resolve(unlisten);
            return unlisten;
        });
        await flushAsync();
        disposers.forEach(unlisten => expect(unlisten).toHaveBeenCalledTimes(1));
        expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_login_window')).toBe(false);
    });

    it('never registers or opens a renewal popup cancelled while its auth URL is pending', async () => {
        const authUrl = deferred<{ auth_url: string }>();
        mocks.getAuthUrl.mockReturnValueOnce(authUrl.promise);
        const data = captureProvider();
        const refreshing = data.refreshAccountToken({ ...renewalAccount }, true, true);
        await vi.waitFor(() => expect(mocks.getAuthUrl).toHaveBeenCalledTimes(1));
        data.cancelAccountRefresh(renewalAccount);
        authUrl.resolve({ auth_url: 'https://auth.riotgames.com/synthetic-test' });
        await expect(refreshing).resolves.toBe(false);
        await flushAsync();
        expect(mocks.listen).not.toHaveBeenCalled();
        expect(mocks.invoke.mock.calls.some(([command]) => command === 'open_login_window')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });
});

it.each(['new login', 'renewal'] as const)('closes a cancelled %s when its pending native open finishes', async flow => {
    const opening = deferred<void>();
    const nativeWindows = new Set<string>();
    mocks.invoke.mockImplementation(async (command: string, args: { sessionId: string }) => {
        if (command === 'open_login_window') {
            await opening.promise;
            nativeWindows.add(args.sessionId);
        }
        if (command === 'close_login_window') {
            nativeWindows.delete(args.sessionId);
            await emit('riot-login-closed-v2', { sessionId: args.sessionId });
        }
    });
    const data = captureProvider();
    const pending = flow === 'new login'
        ? data.startLoginFlow()
        : data.refreshAccountToken({ ...renewalAccount }, true, true);
    const cancelled = flow === 'new login'
        ? expect(pending).rejects.toThrow('Login cancelled')
        : expect(pending).resolves.toBe(false);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('open_login_window', expect.anything()));
    const sessionId = openedSession();
    if (flow === 'new login') data.cancelLoginFlow();
    else data.cancelAccountRefresh(renewalAccount);
    await cancelled;
    await flushAsync();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'close_login_window'))
        .toEqual([['close_login_window', { sessionId }]]);
    opening.resolve();
    await vi.waitFor(() => expect(mocks.invoke.mock.calls.filter(([command]) => command === 'close_login_window'))
        .toEqual([['close_login_window', { sessionId }], ['close_login_window', { sessionId }]]));
    expect(nativeWindows.size).toBe(0);
    expect([...listeners.values()].every(handlers => handlers.size === 0)).toBe(true);
});
