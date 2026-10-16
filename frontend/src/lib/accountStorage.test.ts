import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiotAccount } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/services/api", () => ({ getPersistedAccounts: mocks.get, savePersistedAccounts: mocks.save }));
vi.mock("@/lib/types", () => import("./types"));

const account = (puuid: string, authSource: "oauth" | "lockfile"): RiotAccount => ({
    puuid, authSource, accessToken: "", entitlementsToken: "", region: "eu", gameName: puuid, tagLine: "test",
});

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
    });
    mocks.invoke.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue([]);
    mocks.save.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("account persistence", () => {
    it("preserves memory and legacy metadata without any writeback when the account GET fails, then can retry", async () => {
        const saved = account('saved', 'oauth');
        const legacyJson = JSON.stringify([saved]);
        localStorage.setItem('riot_accounts', legacyJson);
        mocks.get.mockRejectedValueOnce(new Error('backend not ready'));
        const storage = await import('./accountStorage');

        await expect(storage.hydrateStoredAccounts()).rejects.toThrow('backend not ready');
        expect(storage.getStoredAccounts()).toEqual([saved]);
        expect(localStorage.getItem('riot_accounts')).toBe(legacyJson);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();

        mocks.get.mockResolvedValue([saved, account('persisted', 'oauth')]);
        expect((await storage.hydrateStoredAccounts()).map(item => item.puuid)).toEqual(['saved', 'persisted']);
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("preserves its previous cache if first-time migration cannot persist metadata", async () => {
        const saved = account('saved', 'oauth');
        localStorage.setItem('riot_accounts', JSON.stringify([saved]));
        mocks.get.mockResolvedValue(null);
        mocks.save.mockRejectedValueOnce(new Error('disk unavailable'));
        const storage = await import('./accountStorage');

        await expect(storage.hydrateStoredAccounts()).rejects.toThrow('disk unavailable');
        expect(storage.getStoredAccounts()).toEqual([saved]);
        expect(JSON.parse(localStorage.getItem('riot_accounts')!)).toEqual([saved]);
    });

    it("uses disk membership and metadata when another WebView still has deleted accounts", async () => {
        const old = { ...account('keep', 'oauth'), favorite: true, sessionId: 'old-session' };
        const current = { ...account('keep', 'oauth'), favorite: false, sessionId: 'new-session' };
        localStorage.setItem('riot_accounts', JSON.stringify([account('deleted', 'oauth'), old]));
        mocks.get.mockResolvedValue([current]);
        const storage = await import('./accountStorage');

        expect(await storage.hydrateStoredAccounts()).toEqual([current]);
        expect(JSON.parse(localStorage.getItem('riot_accounts')!)).toEqual([current]);
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.invoke).not.toHaveBeenCalled();
    });

    it("keeps a deliberately empty disk list empty despite stale WebView accounts", async () => {
        localStorage.setItem('riot_accounts', JSON.stringify([account('deleted', 'oauth')]));
        const storage = await import('./accountStorage');

        expect(await storage.hydrateStoredAccounts()).toEqual([]);
        expect(localStorage.getItem('riot_accounts')).toBe('[]');
        expect(mocks.save).not.toHaveBeenCalled();
    });

    it("migrates legacy accounts only when no disk snapshot exists", async () => {
        const legacy = { ...account('legacy', 'oauth'), accessToken: 'legacy-access' };
        localStorage.setItem('riot_accounts', JSON.stringify([legacy]));
        mocks.get.mockResolvedValue(null);
        const storage = await import('./accountStorage');

        expect(await storage.hydrateStoredAccounts()).toEqual([account('legacy', 'oauth')]);
        expect(mocks.invoke).toHaveBeenCalledWith('save_riot_account_secrets', {
            puuid: 'legacy', accessToken: 'legacy-access', entitlementsToken: null, ssid: null,
        });
        expect(mocks.save).toHaveBeenCalledWith([account('legacy', 'oauth')]);
    });

    it("does not overwrite a deletion made while startup is loading disk accounts", async () => {
        const original = [account('remove', 'oauth'), account('keep', 'oauth')];
        localStorage.setItem('riot_accounts', JSON.stringify(original));
        let finishRead!: (accounts: RiotAccount[]) => void;
        mocks.get.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        const storage = await import('./accountStorage');
        const hydration = storage.hydrateStoredAccounts();
        await vi.waitFor(() => expect(mocks.get).toHaveBeenCalled());

        const removal = storage.removeStoredAccount('remove');
        finishRead(original);
        expect((await hydration).map(item => item.puuid)).toEqual(['keep']);
        await removal;
        expect(storage.getStoredAccounts().map(item => item.puuid)).toEqual(['keep']);
        expect(mocks.save).toHaveBeenCalledTimes(1);
        expect(mocks.save).toHaveBeenLastCalledWith([account('keep', 'oauth')]);
    });

    it("keeps lockfile accounts in memory without saving them to disk", async () => {
        const storage = await import("./accountStorage");
        const saved = account("saved", "oauth");
        const local = account("local", "lockfile");
        await storage.saveStoredAccounts([saved, local]);
        expect(storage.getStoredAccounts()).toEqual([saved, local]);
        expect(mocks.save).toHaveBeenLastCalledWith([saved]);
        expect(JSON.parse(localStorage.getItem("riot_accounts")!)).toEqual([saved]);
    });

    it("drops old saved lockfile rows during startup while preserving OAuth accounts", async () => {
        const saved = account("saved", "oauth");
        const local = account("local", "lockfile");
        localStorage.setItem("riot_accounts", JSON.stringify([local, saved]));
        mocks.get.mockResolvedValue([local, saved]);
        const storage = await import("./accountStorage");
        expect(await storage.hydrateStoredAccounts()).toEqual([saved]);
        expect(mocks.save).toHaveBeenLastCalledWith([saved]);
    });

    it("does not restore a removed account on the next startup", async () => {
        const storage = await import("./accountStorage");
        await storage.saveStoredAccounts([account("remove", "oauth"), account("keep", "oauth")]);
        await storage.removeStoredAccount("remove");
        mocks.get.mockResolvedValue(mocks.save.mock.calls.at(-1)![0]);
        vi.resetModules();
        const restarted = await import("./accountStorage");
        expect((await restarted.hydrateStoredAccounts()).map(a => a.puuid)).toEqual(["keep"]);
    });

    it("keeps the account intact when saving its removal fails", async () => {
        const storage = await import("./accountStorage");
        const remove = account("remove", "oauth");
        const keep = account("keep", "oauth");
        await storage.saveStoredAccounts([remove, keep]);
        mocks.save.mockRejectedValueOnce(new Error("disk unavailable"));

        await expect(storage.removeStoredAccount("remove")).rejects.toThrow("disk unavailable");
        expect(storage.getStoredAccounts()).toEqual([remove, keep]);
    });

    it("does not rewrite another account's credentials while removing one", async () => {
        const storage = await import("./accountStorage");
        const remove = account("remove", "oauth");
        const keep = account("keep", "oauth");
        await storage.saveStoredAccounts([remove, keep]);
        keep.accessToken = "already-secure";
        mocks.invoke.mockRejectedValue(new Error("credential manager unavailable"));

        await expect(storage.removeStoredAccount("remove")).resolves.toMatchObject({ accounts: [keep] });
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
