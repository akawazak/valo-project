import { invoke } from "@tauri-apps/api/core";
import { RiotAccount } from "@/lib/types";
import { getPersistedAccounts, savePersistedAccounts } from "@/services/api";

const ACCOUNTS_KEY = "riot_accounts";

let accountCache: RiotAccount[] | null = null;
let saveQueue: Promise<void> = Promise.resolve();

function readLegacyAccounts(): RiotAccount[] {
    try {
        const value = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function publicAccount(account: RiotAccount): RiotAccount {
    return { ...account, accessToken: "", entitlementsToken: "", ssid: undefined };
}

function mergeAccounts(local: RiotAccount[], persisted: RiotAccount[]) {
    const merged = new Map(persisted.map((account) => [account.puuid, account]));
    for (const account of local) {
        const existing = merged.get(account.puuid);
        merged.set(account.puuid, {
            ...existing,
            ...account,
            accessToken: account.accessToken || existing?.accessToken || "",
            entitlementsToken: account.entitlementsToken || existing?.entitlementsToken || "",
            ssid: account.ssid || existing?.ssid,
        });
    }
    return Array.from(merged.values());
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
    const publicAccounts = accounts.map(publicAccount);
    await savePersistedAccounts(publicAccounts);
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

export async function hydrateStoredAccounts(): Promise<RiotAccount[]> {
    const legacy = getStoredAccounts();
    const persisted = await getPersistedAccounts();
    const merged = mergeAccounts(legacy, persisted);
    const hydrated = await Promise.all(merged.map(async (account) => {
        try {
            if (account.accessToken || account.entitlementsToken || account.ssid) {
                await saveSecrets(account);
            }
            return publicAccount(account);
        } catch (error) {
            localStorage.setItem("riot_secure_storage_error", "1");
            console.warn("Could not migrate legacy Riot credentials to protected native storage.");
            throw error;
        }
    }));

    accountCache = hydrated;
    localStorage.removeItem("riot_secure_storage_error");
    await persistPublicAccounts(hydrated);
    return hydrated;
}

export async function deleteStoredAccountSecrets(puuid: string): Promise<void> {
    await invoke("delete_riot_account_secrets", { puuid });
}
