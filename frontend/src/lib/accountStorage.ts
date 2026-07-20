import { invoke } from "@tauri-apps/api/core";
import { RiotAccount } from "@/lib/types";
import { getPersistedAccounts, savePersistedAccounts } from "@/services/api";

const ACCOUNTS_KEY = "riot_accounts";

type SecureSecrets = {
    accessToken?: string;
    entitlementsToken?: string;
    ssid?: string;
};

let accountCache: RiotAccount[] | null = null;
let saveQueue: Promise<void> = Promise.resolve();
const securedSecretSnapshots = new Map<string, string>();

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

async function loadSecrets(puuid: string): Promise<SecureSecrets> {
    return invoke<SecureSecrets>("load_riot_account_secrets", { puuid });
}

async function saveSecrets(account: RiotAccount): Promise<void> {
    if (!account.accessToken && !account.entitlementsToken && !account.ssid) return;
    const snapshot = JSON.stringify([account.accessToken || "", account.entitlementsToken || "", account.ssid || ""]);
    if (securedSecretSnapshots.get(account.puuid) === snapshot) return;
    await invoke("save_riot_account_secrets", {
        puuid: account.puuid,
        accessToken: account.accessToken || null,
        entitlementsToken: account.entitlementsToken || null,
        ssid: account.ssid || null,
    });
    securedSecretSnapshots.set(account.puuid, snapshot);
}

async function persistPublicAccounts(accounts: RiotAccount[]) {
    const publicAccounts = accounts.map(publicAccount);
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(publicAccounts));
    localStorage.removeItem("riot_access_token");
    localStorage.removeItem("riot_entitlements");
    await savePersistedAccounts(publicAccounts);
}

export function getStoredAccounts(): RiotAccount[] {
    accountCache ??= readLegacyAccounts();
    return accountCache;
}

export function saveStoredAccounts(accounts: RiotAccount[]): Promise<void> {
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
            console.error("Could not migrate Riot credentials to Windows Credential Manager:", error);
        }
        await persistPublicAccounts(accounts);
    });
    return saveQueue;
}

export async function hydrateStoredAccounts(): Promise<RiotAccount[]> {
    const legacy = getStoredAccounts();
    const persisted = await getPersistedAccounts();
    const merged = mergeAccounts(legacy, persisted);
    let migrationSucceeded = true;

    const hydrated = await Promise.all(merged.map(async (account) => {
        try {
            const secrets = await loadSecrets(account.puuid);
            if (
                (!secrets.accessToken && account.accessToken)
                || (!secrets.entitlementsToken && account.entitlementsToken)
                || (!secrets.ssid && account.ssid)
            ) {
                await saveSecrets(account);
            }
            const hydratedAccount = {
                ...account,
                accessToken: secrets.accessToken || account.accessToken || "",
                entitlementsToken: secrets.entitlementsToken || account.entitlementsToken || "",
                ssid: secrets.ssid || account.ssid,
            };
            securedSecretSnapshots.set(account.puuid, JSON.stringify([
                hydratedAccount.accessToken,
                hydratedAccount.entitlementsToken,
                hydratedAccount.ssid || "",
            ]));
            return hydratedAccount;
        } catch (error) {
            migrationSucceeded = false;
            console.error("Could not load secure Riot credentials:", error);
            return account;
        }
    }));

    accountCache = hydrated;
    if (!migrationSucceeded) localStorage.setItem("riot_secure_storage_error", "1");
    await persistPublicAccounts(hydrated);
    return hydrated;
}

export async function deleteStoredAccountSecrets(puuid: string): Promise<void> {
    securedSecretSnapshots.delete(puuid);
    try {
        await invoke("delete_riot_account_secrets", { puuid });
    } catch (error) {
        console.warn("Could not delete Riot credentials from Windows Credential Manager:", error);
    }
}
