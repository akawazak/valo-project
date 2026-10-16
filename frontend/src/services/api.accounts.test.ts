import { afterEach, beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/lib/errors", () => import("../lib/errors"));
vi.mock("@/lib/platform", () => ({ isAndroidRuntime: () => false }));
vi.mock("@/lib/resourceCache", () => ({ fetchCacheFirstJson: vi.fn() }));
import { activateAccount, appFetch, clearChatHistory, getPersistedAccounts, getPresets, LOCAL_URL, savePersistedAccounts, savePresets } from "./api";

beforeEach(() => {
    invoke.mockReset();
    const data = new Map([['riot_puuid', 'expired-account'], ['riot_region', 'eu']]);
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
    });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([204, 205, 304])("accepts a bodyless %s response from the native bridge", async status => {
    invoke.mockResolvedValue({ status, contentType: "application/json", body: "" });
    const response = await appFetch(`${LOCAL_URL}/chat/history`, { method: "DELETE" });
    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
});

it("finishes account chat deletion on 204 without unlocking the active Riot account", async () => {
    invoke.mockResolvedValue({ status: 204, contentType: "application/json", body: "" });
    await expect(clearChatHistory(undefined, "removed-account")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("backend_request", expect.objectContaining({
        path: "/v1/chat/history?accountPuuid=removed-account",
        method: "DELETE",
        headers: expect.objectContaining({ "x-riot-selected-puuid": "" }),
    }));
});

it("saves an empty account list independently of expired Riot credentials", async () => {
    invoke.mockResolvedValue({ status: 200, contentType: "application/json", body: "{}" });
    await savePersistedAccounts([]);
    expect(invoke).toHaveBeenCalledWith("backend_request", expect.objectContaining({
        path: "/v1/accounts", method: "POST", body: "[]",
        headers: expect.objectContaining({ "x-riot-selected-puuid": "" }),
    }));
});

it.each([
    { status: 503, body: '{"error":"backend unavailable"}' },
    { status: 200, body: '{"accounts":[]}' },
    { status: 200, body: 'invalid json' },
])("rejects an unsuccessful or invalid account-list read: $status $body", async ({ status, body }) => {
    invoke.mockResolvedValue({ status, contentType: 'application/json', body });
    await expect(getPersistedAccounts()).rejects.toThrow();
});

it("propagates an account-list transport failure instead of reporting an empty list", async () => {
    invoke.mockRejectedValue(new Error('backend not ready'));
    await expect(getPersistedAccounts()).rejects.toThrow('backend not ready');
});

it("accepts a successful empty account list", async () => {
    invoke.mockResolvedValue({ status: 200, contentType: 'application/json', body: '[]' });
    await expect(getPersistedAccounts()).resolves.toEqual([]);
});

it("distinguishes a missing account snapshot from a deliberately empty list", async () => {
    invoke.mockResolvedValue({ status: 204, contentType: 'application/json', body: '' });
    await expect(getPersistedAccounts()).resolves.toBeNull();
});

it("keeps a preset save bound to its explicit owner while another account is active", async () => {
    vi.stubGlobal('window', {});
    activateAccount({ puuid: 'account-b', region: 'na', accessToken: '', entitlementsToken: '' });
    invoke.mockResolvedValue({ status: 200, contentType: 'application/json', body: '{}' });
    await savePresets([], { puuid: 'account-a', region: 'eu' });
    expect(invoke).toHaveBeenCalledWith('backend_request', expect.objectContaining({
        path: '/v1/presets', method: 'POST',
        headers: expect.objectContaining({
            'x-riot-selected-puuid': 'account-a', 'x-riot-expected-puuid': 'account-a', 'x-riot-region': 'eu',
        }),
    }));
});

it("does not expire the new account when an old owner's preset read finishes with an auth error", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    let finish!: (result: { status: number; contentType: string; body: string }) => void;
    invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    activateAccount({ puuid: 'account-a', region: 'eu', accessToken: '', entitlementsToken: '' });
    const result = getPresets({ puuid: 'account-a', region: 'eu' });
    const rejected = expect(result).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    activateAccount({ puuid: 'account-b', region: 'na', accessToken: '', entitlementsToken: '' });
    finish({ status: 401, contentType: 'application/json', body: '{"errorCode":"AUTH_REQUIRED"}' });
    await rejected;
    expect(dispatchEvent).not.toHaveBeenCalled();
});
