import { invoke } from "@tauri-apps/api/core";
import { isLockfileAccount, RiotAccount } from "@/lib/types";
import { getPersistedAccounts, savePersistedAccounts } from "@/services/api";

const ACCOUNTS_KEY = "riot_accounts";

let accountCache: RiotAccount[] | null = null;
let saveQueue: Promise<void> = Promise.resolve();

function readLegacyAccounts(): RiotAccount[] {
    try {
        const value = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
        return Array.isArray(value) ? value.filter((account: RiotAccount) => !isLockfileAccount(account)) : [];
    } catch {
        return [];
    }
}

function publicAccount(account: RiotAccount): RiotAccount {
    return { ...account, accessToken: "", entitlementsToken: "", ssid: undefined };
}

async function saveSecrets(account: RiotAccount): Promise<void> {
    if (!account.accessToken && !account.entitlementsToken && !account.ssid) return;
    await invoke("save_riot_account_secrets", {
        puuid: account.puuid,
        accessToken: account.accessToken || null,
        entitlementsToken: account.entitlementsToken || null,
        ssid: account.ssid || null,
    });
}

async function persistPublicAccounts(accounts: RiotAccount[]) {
    const publicAccounts = accounts.filter(account => !isLockfileAccount(account)).map(publicAccount);
    await savePersistedAccounts(publicAccounts);
    cachePublicAccounts(publicAccounts);
}

function cachePublicAccounts(publicAccounts: RiotAccount[]) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(publicAccounts));
    localStorage.removeItem("riot_access_token");
    localStorage.removeItem("riot_entitlements");
}

export function getStoredAccounts(): RiotAccount[] {
    accountCache ??= readLegacyAccounts();
    return accountCache;
}

export function saveStoredAccounts(accounts: RiotAccount[]): Promise<void> {
    const previousAccounts = accountCache;
    accountCache = accounts;
    // One transient Credential Manager/backend failure must not poison every
    // later account save in this app session.
    saveQueue = saveQueue.catch(() => undefined).then(async () => {
        try {
            await Promise.all(accounts.map(saveSecrets));
            localStorage.removeItem("riot_secure_storage_error");
        } catch (error) {
            // Keep credentials in memory for this session, but never fall back to
            // persisting Riot secrets in WebView localStorage.
            localStorage.setItem("riot_secure_storage_error", "1");
            console.warn("Could not migrate Riot credentials to protected native storage.");
            throw error;
        }
        await persistPublicAccounts(accounts);
    });
    return saveQueue.catch((error) => {
        if (accountCache === accounts) accountCache = previousAccounts;
        throw error;
    });
}

export async function removeStoredAccount(puuid: string): Promise<{ removed: RiotAccount; accounts: RiotAccount[] } | null> {
    const normalizedPuuid = puuid.trim().toLowerCase();
    const current = getStoredAccounts();
    const removed = current.find((account) => account.puuid.toLowerCase() === normalizedPuuid);
    if (!removed) return null;

    const accounts = current.filter((account) => account.puuid.toLowerCase() !== normalizedPuuid);
    const previousAccounts = accountCache;
    accountCache = accounts;
    saveQueue = saveQueue.catch(() => undefined).then(() => persistPublicAccounts(accounts));
    await saveQueue.catch((error) => {
        if (accountCache === accounts) accountCache = previousAccounts;
        throw error;
    });
    return { removed, accounts };
}

export function saveStoredAccountPlayerCard(puuid: string, playerCardId: string): Promise<boolean> {
    const normalizedPuuid = puuid.trim().toLowerCase();
    const normalizedCardId = playerCardId.trim();
    if (!normalizedPuuid || !normalizedCardId) return Promise.resolve(false);

    const accounts = getStoredAccounts();
    let changed = false;
    const updated = accounts.map((account) => {
        if (account.puuid.toLowerCase() !== normalizedPuuid || account.playerCardId === normalizedCardId) {
            return account;
        }
        changed = true;
        return { ...account, playerCardId: normalizedCardId };
    });
    if (!changed) return Promise.resolve(false);
    return saveStoredAccounts(updated).then(() => true);
}

export function hydrateStoredAccounts(): Promise<RiotAccount[]> {
    const legacy = getStoredAccounts();
    const hydration = saveQueue.catch(() => undefined).then(async () => {
        const persisted = await getPersistedAccounts();
        // The shared disk snapshot owns membership, including an intentionally
        // empty list. Only migrate a WebView cache when no disk snapshot exists.
        const source = persisted ?? legacy;
        const retained = source.filter(account => !isLockfileAccount(account));
        const hydrated = await Promise.all(retained.map(async (account) => {
            try {
                await saveSecrets(account);
                return publicAccount(account);
            } catch (error) {
                localStorage.setItem("riot_secure_storage_error", "1");
                console.warn("Could not migrate legacy Riot credentials to protected native storage.");
                throw error;
            }
        }));

        if (persisted === null || retained.length !== source.length
            || retained.some(account => account.accessToken || account.entitlementsToken || account.ssid)) {
            await savePersistedAccounts(hydrated);
        }
        // A queued user edit has already updated memory; let its save finish
        // next instead of replacing it with this earlier startup snapshot.
        if (accountCache === legacy) {
            cachePublicAccounts(hydrated);
            accountCache = hydrated;
        }
        localStorage.removeItem("riot_secure_storage_error");
        return getStoredAccounts();
    });
    saveQueue = hydration.then(() => undefined, () => undefined);
    return hydration;
}

export async function deleteStoredAccountSecrets(puuid: string): Promise<void> {
    await invoke("delete_riot_account_secrets", { puuid });
}
