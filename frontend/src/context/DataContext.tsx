"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { accountRequiresManualRepair, isLockfileAccount, Agent, Weapon, GunBuddy, ContentTier, OwnedBuddy, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, SpraySlot, RiotAccount, FlexAsset } from '@/lib/types';
import { activateAccount as activateRemoteAccount, appFetch, clearActiveAccount, clearChatHistory, getAgents, getWeapons, getGunBuddies, getContentTiers, getOwnedSkins, getOwnedGunBuddies, getHealth, getLocalAccount, getOwnedAgents, getBundles, getSprays, getPlayerCards, getPlayerTitles, getOwnedSprays, getOwnedPlayerCards, getOwnedPlayerTitles, getPlayerSprays, getAuthUrl, hasActiveRemoteAuth, reportAppError, submitTokenUrl, getFlexes } from '@/services/api';
import { pushAuthDebugEvent } from '@/lib/authDebug';
import { deleteStoredAccountSecrets, getStoredAccounts, hydrateStoredAccounts, saveStoredAccounts } from '@/lib/accountStorage';
import { isAndroidRuntime } from '@/lib/platform';
import { AppRequestError } from '@/lib/errors';
import { DISMISSED_LOCAL_ACCOUNT_KEY, selectPersistedAccount, selectedAccountCanUseLocalClient, shouldOfferLocalAccount } from '@/lib/accountSelection';

function isAccountExpired(account: RiotAccount | null) {
    if (!account?.expiresAt) return false;
    return Date.now() >= account.expiresAt - 60_000;
}

function checkTokenExpired(account: RiotAccount | null, localActive: boolean, localPuuidStr: string) {
    if (!account) return false;
    if (localActive && localPuuidStr && account.puuid.toLowerCase() === localPuuidStr.toLowerCase()) {
        return false;
    }
    return isAccountExpired(account);
}

function hasSsidCookie(cookies: string | null | undefined): cookies is string {
    return Boolean(cookies && /(?:^|;\s*)ssid=/.test(cookies));
}

function persistedAuthFailureMessage(code: string): string {
    switch (code) {
        case "account_mismatch": return "The saved Riot session belongs to a different account.";
        case "login_required": return "Riot requires a new sign-in.";
        case "cookies_expired": return "The saved Riot session has expired.";
        case "missing_cookies": return "No reusable Riot login session is available.";
        case "cancelled": return "Riot sign-in was cancelled.";
        default: return "Riot account renewal failed. Retry later or sign in again.";
    }
}

type LoginRedirectPayload = { sessionId: string; url: string };
type LoginCookiesPayload = { sessionId: string; cookies: string };
type LoginSessionPayload = { sessionId: string };

const COOKIE_MAINTENANCE_AGE_MS = 24 * 60 * 60 * 1000;
const COOKIE_MAINTENANCE_POLL_MS = 60 * 60 * 1000;
const COOKIE_MAINTENANCE_START_DELAY_MS = 30_000;
const COOKIE_MAINTENANCE_SPACING_MS = 3_000;
const INVENTORY_CACHE_VERSION = 1;
const USER_LOAD_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;

type InventoryCache = {
    version: number;
    savedAt: number;
    ownedAgentIDs: string[];
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    ownedBuddyIDs: OwnedBuddy[];
    ownedSprayIDs: string[];
    ownedCardIDs: string[];
    ownedTitleIDs: string[];
    playerSpraySlots: SpraySlot[];
};

function inventoryCacheKey(puuid: string) {
    return `vv-inventory-cache:v${INVENTORY_CACHE_VERSION}:${puuid.toLowerCase()}`;
}

function readInventoryCache(puuid: string): InventoryCache | null {
    if (!puuid) return null;
    try {
        const value = JSON.parse(localStorage.getItem(inventoryCacheKey(puuid)) || "null") as InventoryCache | null;
        return value?.version === INVENTORY_CACHE_VERSION ? value : null;
    } catch {
        return null;
    }
}

function writeInventoryCache(puuid: string, value: Omit<InventoryCache, "version" | "savedAt">) {
    if (!puuid) return;
    try {
        localStorage.setItem(inventoryCacheKey(puuid), JSON.stringify({
            ...value,
            version: INVENTORY_CACHE_VERSION,
            savedAt: Date.now(),
        } satisfies InventoryCache));
    } catch {
        // Inventory caching is an offline/startup optimization, never a requirement.
    }
}

/**
 * closeLoginWindowAndWait asks Tauri to close the popup for the given
 * sessionId and waits up to `timeoutMs` for the matching
 * `riot-login-closed-v2` event so we don't race ahead and read the cookie
 * DB before WebView2 has released its lock.
 */
async function closeLoginWindowAndWait(sessionId: string, timeoutMs: number = 5000) {
    if (!sessionId) return;
    const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
    ]);
    const closed = new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, timeoutMs);
        listen<LoginSessionPayload>("riot-login-closed-v2", (event) => {
            if (event.payload?.sessionId !== sessionId) return;
            window.clearTimeout(timer);
            resolve();
        }).then((unlisten) => {
            // If close already fired before we attached the listener, the
            // setTimeout still resolves us on timeout — acceptable.
            void unlisten;
        }).catch(() => {
            window.clearTimeout(timer);
            resolve();
        });
    });
    await invoke("close_login_window", { sessionId }).catch(() => {});
    await closed;
}

/**
 * completeLoginFlow performs the *full* login chain atomically. It does
 * NOT call activateAccount or onLoginSuccess — that's the caller's job
 * after this returns the new account. This function only RETURNS the
 * account; the caller is responsible for committing it.
 *
 * Cookie capture is best-effort because the permanent WebView2 session folder
 * remains the renewal fallback even when the raw ssid read is late.
 */
async function completeLoginFlow(
    ctx: LoginFlowState,
    redirectUrl: string,
): Promise<RiotAccount> {
    const { invoke } = await import("@tauri-apps/api/core");
    const submitTokenUrl = (await import("@/services/api")).submitTokenUrl;

    // 1. Exchange the redirect URL for an access token + entitlements.
    pushAuthDebugEvent("login.exchange", null, { outcome: "start", extra: { hasRedirectUrl: Boolean(redirectUrl) } });
    const res = await submitTokenUrl(redirectUrl);
    if (!res?.puuid || !res?.access_token || !res?.entitlements_token) {
        pushAuthDebugEvent("login.exchange", null, { outcome: "failed", message: "Token exchange returned an incomplete Riot session." });
        throw new Error("Token exchange did not return a valid Riot session.");
    }
    pushAuthDebugEvent("login.exchange", {
        puuid: res.puuid,
        accessToken: res.access_token,
        entitlementsToken: res.entitlements_token,
        expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
        region: res.region,
        gameName: res.game_name || "Unknown",
        tagLine: res.tag_line || "",
        sessionId: ctx.sessionId,
    }, { outcome: "success" });

    const sessionId = ctx.sessionId;
    const existingAccount = getStoredAccounts().find((account) => account.puuid === res.puuid);

    // 2. Close the popup and wait for WebView2 to release its lock on
    //    the cookie DB. Without this, get_ssid_cookie copies will fail.
    await closeLoginWindowAndWait(sessionId, 5000);

    // 3. Read the ssid cookie — prefer the cookies captured via the
    //    event (faster + more reliable), fall back to a direct read.
    let ssid: string | undefined;
    if (sessionId) {
        try {
            pushAuthDebugEvent("login.cookie_read", { puuid: res.puuid, sessionId }, { outcome: "start", extra: { capturedCookieEvent: hasSsidCookie(ctx.capturedCookies) } });
            const raw = hasSsidCookie(ctx.capturedCookies)
                ? ctx.capturedCookies
                : await invoke<string | null>("get_ssid_cookie", {
                      sessionId,
                      waitMs: 15000,
                  });
            ssid = raw ?? undefined;
            pushAuthDebugEvent("login.cookie_read", null, { outcome: hasSsidCookie(ssid) ? "success" : "failed", code: hasSsidCookie(ssid) ? undefined : "ssid_missing" });
        } catch {
            console.warn("Failed to read Riot login cookie.");
            pushAuthDebugEvent("login.cookie_read", null, { outcome: "failed", code: "cookie_read_error" });
            // Non-fatal — we still have OAuth tokens. Silent reauth just
            // won't work until the user manually signs in again.
        }
    }

    // 4. Keep the original WebView2 user-data folder permanently. Moving or
    //    copying it after close races the browser process and can silently lose
    //    cookies during rapid multi-account login.
    await invoke("claim_login_session", { sessionId });
    pushAuthDebugEvent("login.session_claimed", { puuid: res.puuid, sessionId, ssid }, { outcome: "success" });

    const finalSsid: string | undefined =
        ssid || (existingAccount && !accountRequiresManualRepair(existingAccount) ? existingAccount.ssid : undefined);

    return {
        puuid: res.puuid,
        accessToken: res.access_token,
        entitlementsToken: res.entitlements_token,
        expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
        region: res.region,
        gameName: res.game_name || "Unknown",
        tagLine: res.tag_line || "",
        sessionId,
        ssid: finalSsid,
        lastRenewedAt: Date.now(),
        lastCookieRotatedAt: hasSsidCookie(finalSsid) ? Date.now() : undefined,
        lastRefreshAttemptAt: Date.now(),
        lastRefreshError: undefined,
        lastRefreshErrorCode: undefined,
    };
}

function getOwnedBuddyDetails(gunBuddies: GunBuddy[], ownedBuddies: OwnedBuddy[]) {
    const ownedByLevel = new Map(ownedBuddies.map((buddy) => [buddy.levelId.toLowerCase(), buddy]));
    return gunBuddies
        .map((buddy) => {
            const ownedLevelIndex = buddy.levels.findIndex((level) => ownedByLevel.has(level.uuid.toLowerCase()));
            if (ownedLevelIndex === -1) return null;

            const ownedLevel = buddy.levels[ownedLevelIndex];
            const owned = ownedByLevel.get(ownedLevel.uuid.toLowerCase());
            const reorderedLevels = [
                ownedLevel,
                ...buddy.levels.filter((_, index) => index !== ownedLevelIndex),
            ];
            return owned ? { ...buddy, levels: reorderedLevels, amount: owned.amount } : null;
        })
        .filter((buddy): buddy is GunBuddy => Boolean(buddy));
}

async function deleteSavedLoginSession(sessionId: string | undefined) {
    if (!sessionId) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_login_session", { sessionId });
}

function deleteAccountScopedCaches(puuid: string) {
    const normalized = puuid.toLowerCase();
    for (const key of [
        inventoryCacheKey(puuid),
        `vv-mobile-social:v2:${puuid}`,
        `vv-mobile-home:v4:${puuid}`,
        `vantavault:social-cards:v1:${normalized}`,
        `vantavault:notifications:v1:${puuid}`,
        `vantavault:notifications:v1:${normalized}`,
        `vantavault:wishlist:${puuid}`,
        `vantavault:wishlist:${normalized}`,
    ]) {
        localStorage.removeItem(key);
    }
    for (const storage of [localStorage, sessionStorage]) {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
        for (const key of keys) {
            const lowered = key.toLowerCase();
            if (lowered.includes(`:${normalized}:`) || lowered.endsWith(`:${normalized}`)) {
                storage.removeItem(key);
            }
        }
    }
}

// Preserve the exact WebView2 user-data folder recorded for each account.
// Legacy accounts without one still use their existing PUUID-based folder.
export function migrateSessionIds(): void {
    try {
        const accounts = getStoredAccounts();
        let changed = false;
        const migrated = accounts.map(acc => {
            if (isLockfileAccount(acc)) {
                if (acc.authSource === "lockfile" && !acc.sessionId) return acc;
                changed = true;
                return {
                    ...acc,
                    authSource: "lockfile" as const,
                    sessionId: undefined,
                    lastRefreshError: undefined,
                    lastRefreshErrorCode: undefined,
                };
            }
            const stableId = `session_${acc.puuid}`;
            if (!acc.sessionId) {
                changed = true;
                return { ...acc, authSource: acc.authSource || ("oauth" as const), sessionId: stableId };
            }
            return acc;
        });
        if (changed) {
            void saveStoredAccounts(migrated).catch(() => {
                console.warn("Could not persist the migrated account list.");
            });
        }
    } catch {
        // silently ignore migration errors
    }
}

export function activateAccount(account: RiotAccount) {
    activateRemoteAccount(account);
}

export interface LoginFlowState {
    sessionId: string;
    startedAt: number;
    redirectReceivedAt?: number;
    /** Resolved when the popup redirects and the new account is committed. */
    resolve: (account: RiotAccount) => void;
    /** Resolved on cancel / window-closed / error. */
    reject: (err: Error) => void;
    /** Captured ssid cookies from the popup (set by the `riot-login-cookies-v2` event). */
    capturedCookies: string | null;
}

interface DataContextType {
    agents: Agent[];
    allAgents: Agent[];
    ownedAgentIDs: string[];
    weapons: Weapon[];
    ownedBuddies: GunBuddy[];
    allBuddies: GunBuddy[];
    contentTiers: ContentTier[];
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    ownedBuddyIDs: OwnedBuddy[];
    bundles: BundleInfo[];
    sprays: SprayAsset[];
    flexes: FlexAsset[];
    playerCards: PlayerCardAsset[];
    playerTitles: PlayerTitleAsset[];
    ownedSprayIDs: string[];
    ownedCardIDs: string[];
    ownedTitleIDs: string[];
    playerSpraySlots: SpraySlot[];
    loading: boolean;
    isClientHealthy: boolean;
    isBackendOnline: boolean;
    isLocalClientActive: boolean;
    localPuuid: string;
    refreshLoadout: () => Promise<void>;

    // Accounts management state
    accounts: RiotAccount[];
    activeAccount: RiotAccount | null;
    isTokenExpired: boolean;
    setIsTokenExpired: (expired: boolean) => void;
    handleSwitchAccount: (acc: RiotAccount) => void;
    handleDeleteAccount: (puuid: string) => Promise<void>;
    handleAddNewAccount: (acc: RiotAccount) => Promise<void>;
    refreshAccountsList: () => void;
    refreshAccountToken: (acc: RiotAccount, visible?: boolean, allowPopup?: boolean) => Promise<boolean>;
    cancelAccountRefresh: (acc: RiotAccount) => void;

    /**
     * Start a brand-new Riot login (the "Add account" / "Sign in" flow).
     *
     * Resolves ONLY when the full chain completes successfully:
     *   popup → redirect → token exchange → window close → cookie read →
     *   session claim → account stored.
     *
     * Rejects on:
     *   - Another login or refresh is already in flight.
     *   - The user cancels via cancelLoginFlow().
     *   - The popup window is closed before redirect.
     *   - Any step in the chain fails (and the account is NOT added).
     *
     * UI components should show a loading overlay for the entire duration.
     */
    startLoginFlow: () => Promise<RiotAccount>;
    finalizePastedLogin: (redirectUrl: string) => Promise<RiotAccount>;
    cancelLoginFlow: () => void;
    /** True while a login (or any per-session refresh that needs the WebView) is in flight. */
    loginInFlight: LoginFlowState | null;

    // Storefront refresh signal — increment to trigger re-fetch in StorePanels
    storefrontRefreshKey: number;
    // Local client import chooser
    pendingLocalAccount: RiotAccount | null;
    showLocalAccountChooser: boolean;
    handleResolveLocalAccount: (useLocal: boolean) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
    // Per-session refresh lock: prevents overlapping refreshAccountToken calls
    // (manual + auto + cross-account races) from clobbering the same window.
    const refreshInFlightRef = useRef<Set<string>>(new Set());
    const globalRefreshInFlightRef = useRef(false);
    const refreshWaitersRef = useRef<Array<{ sessionKey: string; resolve: (retry: boolean) => void }>>([]);
    // Per-session cancel handle so the UI can abort an in-flight refresh
    // (e.g. user clicked refresh by mistake). The cancel function closes the
    // login window, releases the lock, and resolves the promise as false.
    const refreshCancelRef = useRef<Map<string, () => void>>(new Map());
    // Single-flight login handle. While non-null, no other login OR refresh
    // may open a popup. The resolved value is the freshly-committed account;
    // on error/cancel the promise rejects with a descriptive Error and the
    // popup is closed and the temp session is NOT promoted to a stable one.
    const loginInFlightRef = useRef<LoginFlowState | null>(null);
    const [loginInFlight, setLoginInFlight] = useState<LoginFlowState | null>(null);

    const [agents, setAgents] = useState<Agent[]>([]);
    const [allAgents, setAllAgents] = useState<Agent[]>([]);
    const [ownedAgentIDs, setOwnedAgentIDs] = useState<string[]>([]);
    const [weapons, setWeapons] = useState<Weapon[]>([]);
    const [ownedBuddies, setOwnedBuddies] = useState<GunBuddy[]>([]);
    const [allBuddies, setAllBuddies] = useState<GunBuddy[]>([]);
    const [contentTiers, setContentTiers] = useState<ContentTier[]>([]);
    const [ownedLevelIDs, setOwnedLevelIDs] = useState<string[]>([]);
    const [ownedChromaIDs, setOwnedChromaIDs] = useState<string[]>([]);
    const [ownedBuddyIDs, setOwnedBuddyIDs] = useState<OwnedBuddy[]>([]);
    const [bundles, setBundles] = useState<BundleInfo[]>([]);
    const [sprays, setSprays] = useState<SprayAsset[]>([]);
    const [flexes, setFlexes] = useState<FlexAsset[]>([]);
    const [playerCards, setPlayerCards] = useState<PlayerCardAsset[]>([]);
    const [playerTitles, setPlayerTitles] = useState<PlayerTitleAsset[]>([]);
    const [ownedSprayIDs, setOwnedSprayIDs] = useState<string[]>([]);
    const [ownedCardIDs, setOwnedCardIDs] = useState<string[]>([]);
    const [ownedTitleIDs, setOwnedTitleIDs] = useState<string[]>([]);
    const [playerSpraySlots, setPlayerSpraySlots] = useState<SpraySlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [isClientHealthy, setIsClientHealthy] = useState(false);
    const [isBackendOnline, setIsBackendOnline] = useState(false);

    // Lifted accounts state
    const [accounts, setAccounts] = useState<RiotAccount[]>([]);
    const [accountsHydrated, setAccountsHydrated] = useState(false);
    const [activeAccount, setActiveAccount] = useState<RiotAccount | null>(null);
    const [isTokenExpired, setIsTokenExpired] = useState(false);
    const [isLocalClientActive, setIsLocalClientActive] = useState(false);
    const [localPuuid, setLocalPuuid] = useState("");

    // Storefront re-fetch signal (no page reload needed)
    const [storefrontRefreshKey, setStorefrontRefreshKey] = useState(0);
    const [pendingLocalAccount, setPendingLocalAccount] = useState<RiotAccount | null>(null);
    
    const weaponsRef = useRef<Weapon[]>([]);
    const gunBuddiesRef = useRef<GunBuddy[]>([]);
    const allAgentsRef = useRef<Agent[]>([]);
    
    const hasLoadedStaticRef = useRef(false);
    const staticLoadPromiseRef = useRef<Promise<void> | null>(null);
    const hasLoadedUserRef = useRef(false);
    const lastUserSourceRef = useRef<'none' | 'local' | 'remote'>('none');
    const userLoadFailuresRef = useRef(0);
    const nextUserLoadAtRef = useRef(0);
    const autoRenewedExpiryRef = useRef(new Set<string>());
    const nativeCookieRetryRef = useRef(new Set<string>());
    const authRecoveryInFlightRef = useRef(false);

    // Refresh local lists of accounts and active selection
    const refreshAccountsList = useCallback(() => {
        const android = isAndroidRuntime();
        const stored = getStoredAccounts().filter((account) => !android || !isLockfileAccount(account));
        if (android) localStorage.setItem("use_local_sso", "false");
        setAccounts(stored);
        const puuid = localStorage.getItem("riot_puuid");
        const found = selectPersistedAccount(stored, puuid);
        if (found) {
            activateAccount(found);
            const expired = isAccountExpired(found);
            setIsTokenExpired(prev => prev === expired ? prev : expired);
        } else {
            clearActiveAccount();
            localStorage.removeItem("riot_puuid");
            localStorage.removeItem("riot_region");
            setIsTokenExpired(prev => prev === false ? prev : false);
        }
        // Secure hydration may replace the public, tokenless copy for the same
        // PUUID. Always accept the freshly cached account instead of comparing
        // only its identifier and accidentally retaining blank credentials.
        setActiveAccount(found);
    }, []);

    useEffect(() => {
        const expired = activeAccount
            ? checkTokenExpired(activeAccount, isLocalClientActive, localPuuid)
            : false;
        setIsTokenExpired(prev => prev === expired ? prev : expired);
    }, [activeAccount, isLocalClientActive, localPuuid]);

    // 1. Load Public Static Catalog (unconditional, immediate)
    const loadStaticData = useCallback(async () => {
        if (staticLoadPromiseRef.current) {
            return staticLoadPromiseRef.current;
        }

        staticLoadPromiseRef.current = (async () => {
            try {
                const [agentsData, weaponsData, gunBuddiesData, contentTiersData, bundlesData, spraysData, flexesData, cardsData, titlesData] = await Promise.all([
                    getAgents(),
                    getWeapons(),
                    getGunBuddies(),
                    getContentTiers(),
                    getBundles(),
                    getSprays(),
                    getFlexes(),
                    getPlayerCards(),
                    getPlayerTitles(),
                ]);
                weaponsRef.current = weaponsData;
                gunBuddiesRef.current = gunBuddiesData;
                allAgentsRef.current = agentsData;
				setAllAgents(agentsData);

                setWeapons(weaponsData);
                setAllBuddies(gunBuddiesData);
                setContentTiers(contentTiersData);
                setBundles(bundlesData);
                setSprays(spraysData);
                setFlexes(flexesData);
                setPlayerCards(cardsData);
                setPlayerTitles(titlesData);
                setAgents(agentsData.filter(a => a.isBaseContent));
                hasLoadedStaticRef.current = true;
            } catch (error) {
                staticLoadPromiseRef.current = null;
                console.warn("Failed to load static catalog", error instanceof Error ? error.message : String(error));
                throw error;
            }
        })();

        return staticLoadPromiseRef.current;
    }, []);

    const ensureGunBuddyCatalog = useCallback(async () => {
        await loadStaticData();
        if (gunBuddiesRef.current.length > 0) {
            return gunBuddiesRef.current;
        }
        const buddies = await getGunBuddies();
        gunBuddiesRef.current = buddies;
        return buddies;
    }, [loadStaticData]);

    // 2. Load User-Specific Inventory (whenever connection becomes healthy)
    const loadUserData = useCallback(async () => {
        try {
            // Ensure static data is loaded first
            await loadStaticData();

            const selectedPuuid = localStorage.getItem("riot_puuid") || "";
            const cached = readInventoryCache(selectedPuuid);
            if (cached) {
                setOwnedAgentIDs(cached.ownedAgentIDs);
                setAgents(allAgentsRef.current.filter((agent) => cached.ownedAgentIDs.includes(agent.uuid) || agent.isBaseContent));
                setOwnedLevelIDs(cached.ownedLevelIDs);
                setOwnedChromaIDs(cached.ownedChromaIDs);
                setOwnedBuddyIDs(cached.ownedBuddyIDs);
                setOwnedSprayIDs(cached.ownedSprayIDs);
                setOwnedCardIDs(cached.ownedCardIDs);
                setOwnedTitleIDs(cached.ownedTitleIDs);
                setPlayerSpraySlots(cached.playerSpraySlots);
                setOwnedBuddies(getOwnedBuddyDetails(gunBuddiesRef.current, cached.ownedBuddyIDs));
                setLoading(false);
            }

            const [ownedSkins, ownedGunBuddies, ownedAgents, ownedSprays, ownedCards, ownedTitles, playerSprays] = await Promise.all([
                getOwnedSkins(),
                getOwnedGunBuddies(),
                getOwnedAgents(),
                getOwnedSprays(),
                getOwnedPlayerCards(),
                getOwnedPlayerTitles(),
                getPlayerSprays(),
            ]);

            const weaponsData = weaponsRef.current;
            const gunBuddiesData = await ensureGunBuddyCatalog();
            const agentsData = allAgentsRef.current;

            const ownedAgentDetails = agentsData.filter(a => ownedAgents.AgentIds.includes(a.uuid) || a.isBaseContent);
            setAgents(ownedAgentDetails);
			setOwnedAgentIDs(ownedAgents.AgentIds);

            const levels = ownedSkins.LevelIds.map(id => id.toLowerCase());
            for (const gun of weaponsData) {
                const defaultSkin = gun.skins.find(s => s.uuid.toLowerCase() === gun.defaultSkinUuid.toLowerCase());
                if (defaultSkin) levels.push(defaultSkin.levels[0].uuid.toLowerCase());
            }
            setOwnedLevelIDs(levels);
            setOwnedChromaIDs(ownedSkins.ChromaIds.map(id => id.toLowerCase()));
            setOwnedBuddyIDs(ownedGunBuddies.buddies);
            setOwnedSprayIDs(ownedSprays);
            setOwnedCardIDs(ownedCards);
            setOwnedTitleIDs(ownedTitles);
            setPlayerSpraySlots(playerSprays);

            setOwnedBuddies(getOwnedBuddyDetails(gunBuddiesData, ownedGunBuddies.buddies));
            writeInventoryCache(selectedPuuid, {
                ownedAgentIDs: ownedAgents.AgentIds,
                ownedLevelIDs: levels,
                ownedChromaIDs: ownedSkins.ChromaIds.map(id => id.toLowerCase()),
                ownedBuddyIDs: ownedGunBuddies.buddies,
                ownedSprayIDs: ownedSprays,
                ownedCardIDs: ownedCards,
                ownedTitleIDs: ownedTitles,
                playerSpraySlots: playerSprays,
            });
            userLoadFailuresRef.current = 0;
            nextUserLoadAtRef.current = 0;
            hasLoadedUserRef.current = true;
            setLoading(false);
        } catch (error) {
            // This is handled app state, not an uncaught runtime failure. Next's
            // development overlay treats console.error(Error) as a fatal-looking
            // console issue even though we recover below.
            if (error instanceof AppRequestError) {
                console.warn("User inventory is waiting for Riot authentication recovery.", {
                    code: error.code,
                    status: error.status,
                });
            } else {
                console.warn("Failed to load user-specific inventory:", error);
            }
            const failureIndex = Math.min(userLoadFailuresRef.current, USER_LOAD_RETRY_DELAYS_MS.length - 1);
            userLoadFailuresRef.current += 1;
            nextUserLoadAtRef.current = Date.now() + USER_LOAD_RETRY_DELAYS_MS[failureIndex];
            hasLoadedUserRef.current = false;
            setLoading(false);
        }
    }, [loadStaticData, ensureGunBuddyCatalog]);

    // Public metadata is cache-first. When its background revalidation finds
    // changed Riot artwork/content, reload the in-memory catalog once without
    // blocking the current screen or requiring an app restart.
    useEffect(() => {
        let timer = 0;
        const update = () => {
            if (!hasLoadedStaticRef.current) return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                staticLoadPromiseRef.current = null;
                void loadStaticData().catch(() => undefined);
            }, 350);
        };
        window.addEventListener("vantavault:resource-updated", update);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("vantavault:resource-updated", update);
        };
    }, [loadStaticData]);

    const refreshLoadout = useCallback(async () => {
        try {
            await loadStaticData();
            const weaponsData = weaponsRef.current;
            const gunBuddiesData = await ensureGunBuddyCatalog();
            const agentsData = allAgentsRef.current.length > 0 ? allAgentsRef.current : await getAgents();
            const [ownedSkins, ownedGunBuddies, ownedAgents, ownedSprays, ownedCards, ownedTitles, playerSprays] = await Promise.all([
                getOwnedSkins(),
                getOwnedGunBuddies(),
                getOwnedAgents(),
                getOwnedSprays(),
                getOwnedPlayerCards(),
                getOwnedPlayerTitles(),
                getPlayerSprays(),
            ]);
            const ownedAgentDetails = agentsData.filter(a => ownedAgents.AgentIds.includes(a.uuid) || a.isBaseContent);
            setAgents(ownedAgentDetails);
			setOwnedAgentIDs(ownedAgents.AgentIds);
            const levels = ownedSkins.LevelIds.map(id => id.toLowerCase());
            for (const gun of weaponsData) {
                const defaultSkin = gun.skins.find(s => s.uuid.toLowerCase() === gun.defaultSkinUuid.toLowerCase());
                if (defaultSkin) levels.push(defaultSkin.levels[0].uuid.toLowerCase());
            }
            setOwnedLevelIDs(levels);
            setOwnedChromaIDs(ownedSkins.ChromaIds.map(id => id.toLowerCase()));
            setOwnedBuddyIDs(ownedGunBuddies.buddies);
            setOwnedSprayIDs(ownedSprays);
            setOwnedCardIDs(ownedCards);
            setOwnedTitleIDs(ownedTitles);
            setPlayerSpraySlots(playerSprays);
            setOwnedBuddies(getOwnedBuddyDetails(gunBuddiesData, ownedGunBuddies.buddies));
        } catch {
            // silent
        }
    }, [ensureGunBuddyCatalog, loadStaticData]);

    // Account state handlers — NO page reloads, use refresh signals instead
    const handleSwitchAccount = useCallback((acc: RiotAccount) => {
        activateAccount(acc);
        setActiveAccount(acc);
        setPendingLocalAccount(null);
        if (localPuuid && acc.puuid.toLowerCase() !== localPuuid.toLowerCase()) {
            localStorage.setItem(DISMISSED_LOCAL_ACCOUNT_KEY, localPuuid);
        }
        hasLoadedUserRef.current = false;
        userLoadFailuresRef.current = 0;
        nextUserLoadAtRef.current = 0;
        if (isAccountExpired(acc)) {
            setIsTokenExpired(true);
        } else {
            setIsTokenExpired(false);
            // Bump the storefront refresh key so StorePanels re-fetches silently
            setStorefrontRefreshKey(k => k + 1);
        }
        void loadUserData();
    }, [loadUserData, localPuuid]);

    const handleDeleteAccount = useCallback(async (puuid: string) => {
        const stored = getStoredAccounts();
        const removed = stored.find(a => a.puuid === puuid);
        if (!removed) return;
        const updated = stored.filter(a => a.puuid !== puuid);
        try {
            await clearChatHistory(undefined, puuid);
            await deleteStoredAccountSecrets(puuid);
            await deleteSavedLoginSession(removed?.sessionId);
            deleteAccountScopedCaches(puuid);
            await saveStoredAccounts(updated);
        } catch (error) {
            reportAppError("The account was not removed because its private data could not be deleted completely. Retry after closing Riot sign-in windows.");
            throw error;
        }
        setAccounts(updated);

        if (activeAccount?.puuid === puuid) {
            const next = updated[0] ?? null;
            if (next) {
                activateAccount(next);
                setActiveAccount(next);
                hasLoadedUserRef.current = false;
                userLoadFailuresRef.current = 0;
                nextUserLoadAtRef.current = 0;
                // Bump storefront refresh key to re-fetch for new active account
                setStorefrontRefreshKey(k => k + 1);
            } else {
                setActiveAccount(null);
                clearActiveAccount();
                hasLoadedUserRef.current = false;
                userLoadFailuresRef.current = 0;
                nextUserLoadAtRef.current = 0;
                localStorage.removeItem("riot_puuid");
                localStorage.removeItem("riot_region");
            }
        }
        // No page reload — state updates are sufficient
    }, [activeAccount]);

    const handleAddNewAccount = useCallback(async (acc: RiotAccount) => {
        // Keep the exact user-data folder created by the successful login.
        const stored = getStoredAccounts();
        const existing = stored.find((account) => account.puuid === acc.puuid);
        const stableAcc: RiotAccount = {
            ...existing,
            ...acc,
            authSource: "oauth",
            sessionId: acc.sessionId || existing?.sessionId || `session_${acc.puuid}`,
            ssid: hasSsidCookie(acc.ssid)
                ? acc.ssid
                : existing && !accountRequiresManualRepair(existing) ? existing.ssid : undefined,
        };
        const updated = stored.filter(a => a.puuid !== stableAcc.puuid);
        updated.unshift(stableAcc);
        try {
            await saveStoredAccounts(updated);
        } catch {
            reportAppError("The Riot account could not be stored securely, so it was not added.");
            return;
        }
        setAccounts(updated);
        if (existing?.sessionId && existing.sessionId !== stableAcc.sessionId) {
            await deleteSavedLoginSession(existing.sessionId).catch(() => {
                reportAppError("The old Riot login session could not be removed. Retry from Account Manager.");
            });
        }
        activateAccount(stableAcc);
        setActiveAccount(stableAcc);
        setIsTokenExpired(false);
        hasLoadedUserRef.current = false;
        userLoadFailuresRef.current = 0;
        nextUserLoadAtRef.current = 0;
        void loadUserData();
        // Bump storefront refresh key so store loads fresh for new account
        setStorefrontRefreshKey(k => k + 1);
    }, [loadUserData]);

    const refreshAccountToken = useCallback(async function renewAccount(
        acc: RiotAccount,
        visible: boolean = false,
        allowPopup: boolean = true,
    ): Promise<boolean> {
        if (isLockfileAccount(acc)) {
            pushAuthDebugEvent("refresh.blocked", acc, { outcome: "skipped", code: "local_lockfile_session" });
            return false;
        }
        pushAuthDebugEvent("refresh.start", acc, { outcome: "start", allowPopup, visible });
        const sessionKey = acc.sessionId || `session_${acc.puuid}`;
        if (loginInFlightRef.current) {
            // A brand-new login is in flight — don't compete with it for the
            // WebView lock.
            pushAuthDebugEvent("refresh.blocked", acc, { outcome: "skipped", code: "login_in_flight" });
            return false;
        }
        if (globalRefreshInFlightRef.current || refreshInFlightRef.current.has(sessionKey)) {
            pushAuthDebugEvent("refresh.wait", acc, { outcome: "info", code: "refresh_in_flight" });
            const retry = await new Promise<boolean>((resolve) => {
                refreshWaitersRef.current.push({ sessionKey, resolve });
            });
            if (!retry) return false;
            const current = getStoredAccounts().find((account) => account.puuid === acc.puuid);
            if (current?.expiresAt && current.expiresAt > Date.now() && !current.lastRefreshError) return true;
            return renewAccount(current || acc, visible, allowPopup);
        }
        globalRefreshInFlightRef.current = true;
        refreshInFlightRef.current.add(sessionKey);
        let lockReleased = false;
        const releaseLock = () => {
            if (lockReleased) return;
            lockReleased = true;
            refreshInFlightRef.current.delete(sessionKey);
            refreshCancelRef.current.delete(sessionKey);
            globalRefreshInFlightRef.current = false;
            const waiters = refreshWaitersRef.current.splice(0);
            waiters.forEach(({ resolve }) => resolve(true));
        };

        let sessionId = acc.sessionId;
        if (!sessionId) {
            sessionId = `session_${acc.puuid}`;
            acc.sessionId = sessionId;
        }

        const recordFailure = (message: string, code: string = "temporary") => {
            void message;
            const safeMessage = persistedAuthFailureMessage(code);
            pushAuthDebugEvent("refresh.failure_recorded", acc, { outcome: "failed", code, message: safeMessage });
            const updated = getStoredAccounts().map((account) => account.puuid === acc.puuid ? {
                ...account,
                lastRefreshAttemptAt: Date.now(),
                lastRefreshError: safeMessage,
                lastRefreshErrorCode: code,
            } : account);
            void saveStoredAccounts(updated).catch(() => {
                reportAppError("The account renewal status could not be saved securely.");
            });
            setAccounts(updated);
            if (activeAccount?.puuid === acc.puuid) {
                const nextActive = updated.find((account) => account.puuid === acc.puuid);
                if (nextActive) setActiveAccount(nextActive);
            }
        };

        let cancelled = false;
        const previousSessionMissing = accountRequiresManualRepair(acc);
        const hasNativeSession = Boolean(acc.ssid || acc.sessionId);
        let failureCode = hasNativeSession ? "cookies_expired" : "missing_cookies";
        let failureReason = hasNativeSession
            ? "Saved Riot session was rejected. Sign in again to repair it."
            : "No reusable Riot session is stored. Sign in again to repair it.";
        const reauthController = new AbortController();
        refreshCancelRef.current.set(sessionKey, () => {
            cancelled = true;
            reauthController.abort();
            releaseLock();
            void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("close_login_window", { sessionId }).catch(() => {}),
            );
        });

        // Step 1: use the stored Riot session to renew the short-lived access
        // token without opening a popup.
        if (hasNativeSession) {
            try {
                pushAuthDebugEvent("refresh.ssid_reauth", acc, { outcome: "start" });
                // Let the native bridge try Credential Manager/Android Keystore
                // first. Supplying an older WebView cookie here would override the
                // newer rotated native cookie and incorrectly force a sign-in.
                let reauthCookies = acc.ssid;
                const requestReauth = (cookies: string | undefined) => appFetch("http://localhost:31719/v1/auth/ssid-reauth", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Riot-Selected-Puuid": acc.puuid,
                        "X-Riot-Region": acc.region,
                    },
                    body: JSON.stringify({ cookies: cookies || "" }),
                    signal: reauthController.signal,
                });
                let res = await requestReauth(reauthCookies);
                let responseBody = res.ok ? "" : await res.text().catch(() => "");
                let responseCode = "";
                try {
                    responseCode = responseBody ? JSON.parse(responseBody).error || "" : "";
                } catch {
                    responseCode = "";
                }

                // Pre-Credential-Manager installs kept the reusable cookie only in
                // the claimed per-account WebView2 profile. Use that profile only
                // when native storage explicitly reports that no cookie exists.
                if (!res.ok && responseCode === "missing_cookies" && !hasSsidCookie(reauthCookies) && sessionId) {
                    try {
                        const { invoke } = await import("@tauri-apps/api/core");
                        const sessionCookies = await invoke<string | null>("get_ssid_cookie", {
                            sessionId,
                            waitMs: 0,
                        });
                        if (hasSsidCookie(sessionCookies)) {
                            reauthCookies = sessionCookies;
                            pushAuthDebugEvent("refresh.session_cookie_read", acc, { outcome: "success" });
                            res = await requestReauth(reauthCookies);
                            responseBody = res.ok ? "" : await res.text().catch(() => "");
                        }
                    } catch {
                        pushAuthDebugEvent("refresh.session_cookie_read", acc, { outcome: "failed", code: "ssid_missing" });
                    }
                }
                if (cancelled) return false;
                if (res.ok) {
                    const data = await res.json();
                    if (cancelled) return false;
                    if (data.access_token) {
                        if (data.puuid && data.puuid.toLowerCase() !== acc.puuid.toLowerCase()) {
                            failureCode = "account_mismatch";
                            pushAuthDebugEvent("refresh.ssid_reauth", acc, { outcome: "failed", code: failureCode, message: "Saved Riot session belongs to a different account." });
                            throw new Error("Saved Riot session belongs to a different account.");
                        }
                        const updatedAcc: RiotAccount = {
                            ...acc,
                            accessToken: data.access_token,
                            entitlementsToken: data.entitlements_token,
                            expiresAt: Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000,
                            region: data.region || acc.region,
                            gameName: data.game_name || acc.gameName,
                            tagLine: data.tag_line || acc.tagLine,
                            ssid: hasSsidCookie(data.cookies) ? data.cookies : reauthCookies,
                            sessionId,
                            lastRenewedAt: Date.now(),
                            lastCookieRotatedAt: hasSsidCookie(data.cookies)
                                ? Date.now()
                                : acc.lastCookieRotatedAt,
                            lastRefreshAttemptAt: Date.now(),
                            lastRefreshError: undefined,
                            lastRefreshErrorCode: undefined,
                        };
                        const stored = getStoredAccounts();
                        const updated = stored.map(a => a.puuid === acc.puuid ? updatedAcc : a);
                        // Do not report success until the rotated cookies are safely
                        // committed to Windows Credential Manager.
                        await saveStoredAccounts(updated);
                        setAccounts(updated);
                        if (activeAccount?.puuid === acc.puuid) {
                            activateAccount(updatedAcc);
                            setActiveAccount(updatedAcc);
                            setIsTokenExpired(false);
                            setStorefrontRefreshKey(k => k + 1);
                        }
                        pushAuthDebugEvent("refresh.ssid_reauth", updatedAcc, { outcome: "success" });
                        releaseLock();
                        return true;
                    }
                }
                if (responseBody) {
                    try {
                        const parsed = JSON.parse(responseBody);
                        failureReason = parsed.message || parsed.error || failureReason;
                        failureCode = parsed.error || "temporary";
                    } catch {
                        failureReason = responseBody.slice(0, 240);
                        failureCode = "temporary";
                    }
                }
                pushAuthDebugEvent("refresh.ssid_reauth", acc, { outcome: "failed", code: failureCode, message: failureReason });
            } catch (error) {
                if (!cancelled) {
                    failureReason = error instanceof Error ? error.message : String(error || failureReason);
                    if (failureCode !== "account_mismatch") failureCode = "temporary";
                    pushAuthDebugEvent("refresh.ssid_reauth", acc, { outcome: "failed", code: failureCode, message: failureReason });
                }
            }
        } else {
            pushAuthDebugEvent("refresh.ssid_reauth", acc, { outcome: "skipped", code: "missing_cookies" });
        }
        if (cancelled) return false;
        if (!allowPopup) {
            recordFailure(failureReason, failureCode);
            releaseLock();
            return false;
        }

        // Step 2: Fallback — WebView popup (first login or refresh_token expired)
        try {
            const { auth_url } = await getAuthUrl();
            const { invoke } = await import("@tauri-apps/api/core");
            const { listen } = await import("@tauri-apps/api/event");
            pushAuthDebugEvent("refresh.popup", acc, { outcome: "start", allowPopup, visible });

            return new Promise<boolean>((resolve) => {
                let resolved = false;
                let unlistenFn: (() => void) | null = null;
                let unlistenCloseFn: (() => void) | null = null;
                let unlistenCookiesFn: (() => void) | null = null;
                let timeoutId: number | null = null;
                let capturedCookies: string | null = null;

                const cleanup = () => {
                    if (timeoutId !== null) window.clearTimeout(timeoutId);
                    if (unlistenFn) unlistenFn();
                    if (unlistenCloseFn) unlistenCloseFn();
                    if (unlistenCookiesFn) unlistenCookiesFn();
                };

                const finish = (ok: boolean) => {
                    if (resolved) return;
                    resolved = true;
                    cleanup();
                    releaseLock();
                    resolve(ok);
                };

                // Register a cancel handle so the UI can abort this refresh.
                refreshCancelRef.current.set(sessionKey, () => {
                    if (resolved) return;
                    cancelled = true;
                    finish(false);
                    // Close the window so the popup doesn't linger.
                    invoke("close_login_window", { sessionId }).catch(() => {});
                });

                timeoutId = window.setTimeout(async () => {
                    if (resolved) return;
                    if (!visible) {
                        await invoke("show_login_window", { sessionId }).catch(() => {});
                    }
                }, 10000);

                listen<LoginCookiesPayload>("riot-login-cookies-v2", (event) => {
                    if (event.payload?.sessionId !== sessionId) return;
                    if (hasSsidCookie(event.payload.cookies)) {
                        capturedCookies = event.payload.cookies;
                        pushAuthDebugEvent("refresh.popup_cookie_event", acc, { outcome: "success" });
                    }
                }).then(fn => { unlistenCookiesFn = fn; });

                listen<LoginRedirectPayload>("riot-login-redirect-v2", async (event) => {
                    if (resolved) return;
                    if (event.payload?.sessionId !== sessionId) return;
                    cleanup();

                    try {
                        const redirectUrl = event.payload.url;
                        pushAuthDebugEvent("refresh.popup_redirect", acc, { outcome: "success" });
                        const res = await submitTokenUrl(redirectUrl);
                        if (resolved) return;
                        if (res.puuid.toLowerCase() !== acc.puuid.toLowerCase()) {
                            failureCode = "account_mismatch";
                            pushAuthDebugEvent("refresh.popup_exchange", acc, { outcome: "failed", code: failureCode, message: "Signed into a different Riot account." });
                            throw new Error("You signed into a different Riot account. Refresh the selected account instead.");
                        }

                        // Save the tokens immediately — we can't read ssid cookies yet
                        // because the popup is still running and WebView2 hasn't flushed
                        // them to SQLite. We'll read them after the window closes.
                        const updatedAcc: RiotAccount = {
                            ...acc,
                            accessToken: res.access_token,
                            entitlementsToken: res.entitlements_token,
                            expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
                            region: res.region || acc.region,
                            gameName: res.game_name || acc.gameName,
                            tagLine: res.tag_line || acc.tagLine,
                            ssid: previousSessionMissing ? undefined : acc.ssid,
                            sessionId,
                            lastRenewedAt: Date.now(),
                            lastRefreshAttemptAt: Date.now(),
                            lastRefreshError: undefined,
                            lastRefreshErrorCode: undefined,
                        };
                        const stored = getStoredAccounts();
                        const updated = stored.map(a => a.puuid === acc.puuid ? updatedAcc : a);
                        await saveStoredAccounts(updated);
                        setAccounts(updated);
                        pushAuthDebugEvent("refresh.popup_exchange", updatedAcc, { outcome: "success" });
                        if (activeAccount?.puuid === acc.puuid) {
                            activateAccount(updatedAcc);
                            setActiveAccount(updatedAcc);
                            setIsTokenExpired(false);
                            setStorefrontRefreshKey(k => k + 1);
                        }

                        // Close the login window first to force WebView2 to flush all cookies to disk and release locks
                        const closedPromise = new Promise<void>((resVal) => {
                            let unlistenClose: (() => void) | null = null;
                            const timeoutIdClose = setTimeout(() => {
                                if (unlistenClose) unlistenClose();
                                resVal();
                            }, 3500);
                            listen<LoginSessionPayload>("riot-login-closed-v2", (event) => {
                                if (event.payload?.sessionId !== sessionId) return;
                                clearTimeout(timeoutIdClose);
                                if (unlistenClose) unlistenClose();
                                resVal();
                            }).then(fn => { unlistenClose = fn; }).catch(() => {
                                clearTimeout(timeoutIdClose);
                                resVal();
                            });
                        });

                        await invoke("close_login_window", { sessionId }).catch(() => {});
                        await closedPromise;
                        if (resolved) return;

                        // A missing/stale session directory may have been recreated by
                        // the fallback login. Keep that exact WebView2 profile so it can
                        // repair this account again later.
                        await invoke("claim_login_session", { sessionId }).catch(() => {});

                        // Fetch the ssid cookie from the session directory now that the lock is released
                        const raw = hasSsidCookie(capturedCookies)
                            ? capturedCookies
                            : await invoke<string | null>("get_ssid_cookie", { sessionId, waitMs: 15000 }) ?? undefined;
                        if (resolved) return;
                        const finalAcc = {
                            ...updatedAcc,
                            ssid: hasSsidCookie(raw) ? raw : updatedAcc.ssid,
                            lastCookieRotatedAt: hasSsidCookie(raw)
                                ? Date.now()
                                : updatedAcc.lastCookieRotatedAt,
                        };
                        pushAuthDebugEvent("refresh.popup_cookie_read", finalAcc, { outcome: hasSsidCookie(raw) ? "success" : "failed", code: hasSsidCookie(raw) ? undefined : "ssid_missing" });
                        const finalUpdated = getStoredAccounts().map(a => a.puuid === acc.puuid ? finalAcc : a);
                        await saveStoredAccounts(finalUpdated);
                        setAccounts(finalUpdated);
                        if (activeAccount?.puuid === acc.puuid) {
                            activateAccount(finalAcc);
                            setActiveAccount(finalAcc);
                        }

                        finish(true);
                    } catch (err) {
                        console.warn("Riot account renewal failed.");
                        if (!cancelled) {
                            recordFailure(
                                err instanceof Error ? err.message : String(err || "Riot sign-in failed."),
                                failureCode,
                            );
                        }
                        finish(false);
                    }
                }).then(fn => { unlistenFn = fn; });

                listen<LoginSessionPayload>("riot-login-closed-v2", (event) => {
                    if (event.payload?.sessionId !== sessionId) return;
                    if (resolved) return;
                    pushAuthDebugEvent("refresh.popup_closed", acc, { outcome: "failed", code: "cancelled" });
                    recordFailure("Sign-in window was closed before renewal completed.", "cancelled");
                    finish(false);
                }).then(fn => { unlistenCloseFn = fn; });

                invoke("open_login_window", { authUrl: auth_url, sessionId, visible }).catch((err) => {
                    console.warn("Failed to open Riot sign-in window.");
                    pushAuthDebugEvent("refresh.popup_open", null, { outcome: "failed", code: "popup_open_failed" });
                    recordFailure(err instanceof Error ? err.message : String(err || "Failed to open Riot sign-in."));
                    finish(false);
                });
            });
        } catch (err) {
            console.warn("Failed to start Riot account renewal.");
            recordFailure(err instanceof Error ? err.message : String(err || "Failed to start account renewal."));
            releaseLock();
            return false;
        }
    }, [activeAccount]);

    const cancelAccountRefresh = useCallback((acc: RiotAccount) => {
        const sessionKey = acc.sessionId || `session_${acc.puuid}`;
        const cancel = refreshCancelRef.current.get(sessionKey);
        if (cancel) {
            cancel();
        }
        refreshCancelRef.current.delete(sessionKey);
        const pending = refreshWaitersRef.current.filter((waiter) => waiter.sessionKey === sessionKey);
        refreshWaitersRef.current = refreshWaitersRef.current.filter((waiter) => waiter.sessionKey !== sessionKey);
        pending.forEach(({ resolve }) => resolve(false));
    }, []);

    const refreshAccountTokenRef = useRef(refreshAccountToken);
    useEffect(() => {
        refreshAccountTokenRef.current = refreshAccountToken;
    }, [refreshAccountToken]);

    // A Riot access token can still be within its advertised lifetime while
    // its paired entitlement JWT has been rotated or invalidated. Recover from
    // that server response immediately instead of waiting for the expiry timer.
    useEffect(() => {
        const recoverRiotAuth = () => {
            if (authRecoveryInFlightRef.current) return;
            authRecoveryInFlightRef.current = true;

            const canUseLocalSession = !isAndroidRuntime()
                && isLocalClientActive
                && Boolean(localPuuid)
                && Boolean(activeAccount?.puuid)
                && activeAccount!.puuid.toLowerCase() === localPuuid.toLowerCase();

            if (canUseLocalSession) {
                localStorage.setItem("use_local_sso", "true");
                clearActiveAccount();
                setIsTokenExpired(false);
                hasLoadedUserRef.current = false;
                userLoadFailuresRef.current = 0;
                nextUserLoadAtRef.current = 0;
                setStorefrontRefreshKey((key) => key + 1);
                void loadUserData().finally(() => {
                    authRecoveryInFlightRef.current = false;
                });
                return;
            }

            if (!activeAccount || isLockfileAccount(activeAccount)) {
                authRecoveryInFlightRef.current = false;
                return;
            }

            void refreshAccountTokenRef.current(activeAccount, false, false)
                .then((renewed) => {
                    if (!renewed) return;
                    hasLoadedUserRef.current = false;
                    userLoadFailuresRef.current = 0;
                    nextUserLoadAtRef.current = 0;
                    setStorefrontRefreshKey((key) => key + 1);
                    return loadUserData();
                })
                .finally(() => {
                    authRecoveryInFlightRef.current = false;
                });
        };

        window.addEventListener("vantavault:riot-auth-invalid", recoverRiotAuth);
        return () => window.removeEventListener("vantavault:riot-auth-invalid", recoverRiotAuth);
    }, [activeAccount, isLocalClientActive, localPuuid, loadUserData]);

    // Riot rotates the reusable auth cookies during successful reauth. Keep
    // inactive accounts alive too, but serialize and space the requests so a
    // large account list does not create a startup burst or rate-limit storm.
    useEffect(() => {
        if (!accountsHydrated || !isBackendOnline) return;
        let cancelled = false;
        let running = false;

        const maintainCookies = async () => {
            if (cancelled || running || loginInFlightRef.current) return;
            running = true;
            try {
                const now = Date.now();
                const dueAccounts = getStoredAccounts().filter((account) => {
                    if (!hasSsidCookie(account.ssid) && !account.sessionId) return false;
                    const lastMaintenance = Math.max(
                        account.lastCookieRotatedAt || 0,
                        account.lastRefreshAttemptAt || 0,
                        account.lastRenewedAt || 0,
                    );
                    const retryNativeCookie = ["login_required", "cookies_expired", "missing_cookies", "cancelled", "account_mismatch"]
                        .includes(account.lastRefreshErrorCode || "")
                        && !nativeCookieRetryRef.current.has(account.puuid);
                    return retryNativeCookie || now - lastMaintenance >= COOKIE_MAINTENANCE_AGE_MS;
                });

                for (const account of dueAccounts) {
                    if (cancelled || loginInFlightRef.current) break;
                    nativeCookieRetryRef.current.add(account.puuid);
                    const ok = await refreshAccountTokenRef.current(account, false, false);
                    if (!ok) {
                        const current = getStoredAccounts().find((item) => item.puuid === account.puuid);
                        // A network/backend failure affects the whole queue. Stop and
                        // let the hourly poll retry instead of marking every account.
                        if (current?.lastRefreshErrorCode === "temporary") break;
                    }
                    if (!cancelled) {
                        await new Promise<void>((resolve) => {
                            window.setTimeout(resolve, COOKIE_MAINTENANCE_SPACING_MS);
                        });
                    }
                }
            } finally {
                running = false;
            }
        };

        const initialTimer = window.setTimeout(() => {
            void maintainCookies();
        }, COOKIE_MAINTENANCE_START_DELAY_MS);
        const pollTimer = window.setInterval(() => {
            void maintainCookies();
        }, COOKIE_MAINTENANCE_POLL_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(initialTimer);
            window.clearInterval(pollTimer);
        };
    }, [accountsHydrated, isBackendOnline]);

    /**
     * Settle the in-flight login flow: either resolve with the new account
     * or reject with an error. ALWAYS clears the lock and the login state so
     * the next attempt can run. Idempotent — calling twice is a no-op.
     */
    const settleLoginFlow = useCallback((account: RiotAccount | null, err: Error | null) => {
        const ctx = loginInFlightRef.current;
        if (!ctx) return;
        loginInFlightRef.current = null;
        setLoginInFlight(null);
        if (account) ctx.resolve(account);
        else if (err) ctx.reject(err);
    }, []);

    /**
     * Cancel an in-flight login. Closes the popup and rejects the promise.
     * Safe to call when nothing is in flight.
     */
    const cancelLoginFlow = useCallback(() => {
        const ctx = loginInFlightRef.current;
        if (!ctx) return;
        // Close the popup window before rejecting so it can't linger.
        void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("close_login_window", { sessionId: ctx.sessionId }).catch(() => {}),
        );
        settleLoginFlow(null, new Error("Login cancelled."));
    }, [settleLoginFlow]);

    /**
     * startLoginFlow opens the Riot OAuth popup and resolves only once the
     * full chain completes:
     *
     *   popup → user signs in → redirect → token exchange → window close →
     *   ssid cookie read → permanent session claim → account stored →
     *   resolve(new account)
     *
     * While this is in flight, ALL other logins and refreshes are blocked
     * (refreshAccountToken will return false immediately). This is the
     * single source of truth for the "is something happening with a popup?"
     * state — UI components should gate every action on loginInFlight.
     *
     * The popup redirect listener is set up INSIDE this function so that
     * listeners are scoped to a single attempt and never overlap.
     */
    const startLoginFlow = useCallback(async (): Promise<RiotAccount> => {
        if (loginInFlightRef.current) {
            throw new Error("Another Riot login is already in progress. Please wait for it to finish.");
        }
        if (globalRefreshInFlightRef.current || refreshInFlightRef.current.size > 0) {
            throw new Error("An account refresh is already in progress. Please wait for it to finish.");
        }

        return new Promise<RiotAccount>((resolve, reject) => {
            const sessionId = `account_${crypto.randomUUID()}`;
            const ctx: LoginFlowState = {
                sessionId,
                startedAt: Date.now(),
                resolve,
                reject,
                capturedCookies: null,
            };
            loginInFlightRef.current = ctx;
            setLoginInFlight(ctx);

            let settled = false;
            const settleOnce = (account: RiotAccount | null, err: Error | null) => {
                if (settled) return;
                settled = true;
                settleLoginFlow(account, err);
            };

            (async () => {
                const [{ listen }, { invoke }] = await Promise.all([
                    import("@tauri-apps/api/event"),
                    import("@tauri-apps/api/core"),
                ]);

                // Capture cookies fired by lib.rs' on_navigation handler BEFORE
                // the WebView closes (the DB lock release is what guarantees
                // we can read them later). The lib.rs handler emits this event
                // ~immediately after detecting the redirect.
                const cookiesUnlisten = await listen<LoginCookiesPayload>("riot-login-cookies-v2", (event) => {
                    if (event.payload?.sessionId === sessionId && loginInFlightRef.current?.sessionId === sessionId) {
                        loginInFlightRef.current.capturedCookies = event.payload.cookies;
                        console.debug("Captured Riot login cookies for the active session.");
                    }
                }).catch(() => () => {});

                const redirectUnlisten = await listen<LoginRedirectPayload>("riot-login-redirect-v2", async (event) => {
                    if (event.payload?.sessionId !== sessionId) return;
                    try {
                        ctx.redirectReceivedAt = Date.now();
                        setLoginInFlight({ ...ctx });
                        const account = await completeLoginFlow(ctx, event.payload.url);
                        cookiesUnlisten();
                        redirectUnlisten();
                        closeUnlisten();
                        settleOnce(account, null);
                    } catch (err) {
                        const e = err instanceof Error ? err : new Error(String(err));
                        cookiesUnlisten();
                        redirectUnlisten();
                        closeUnlisten();
                        settleOnce(null, e);
                    }
                }).catch(() => () => {});

                // Manual cancel via close button (no redirect ever fires).
                const closeUnlisten = await listen<LoginSessionPayload>("riot-login-closed-v2", (event) => {
                    if (event.payload?.sessionId !== sessionId || loginInFlightRef.current?.sessionId !== sessionId) return;
                    // If we already settled (e.g. via redirect), ignore.
                    if (settled || ctx.redirectReceivedAt) return;
                    cookiesUnlisten();
                    redirectUnlisten();
                    closeUnlisten();
                    settleOnce(null, new Error("Login window was closed before authentication completed."));
                }).catch(() => () => {});

                try {
                    const { auth_url } = await getAuthUrl();
                    await invoke("open_login_window", {
                        authUrl: auth_url,
                        sessionId,
                        visible: true,
                    });
                } catch (err) {
                    cookiesUnlisten();
                    redirectUnlisten();
                    closeUnlisten();
                    settleOnce(null, err instanceof Error ? err : new Error(String(err)));
                }
            })();
        });
    }, [settleLoginFlow]);

    const finalizePastedLogin = useCallback(async (redirectUrl: string): Promise<RiotAccount> => {
        let parsed: URL;
        try {
            parsed = new URL(redirectUrl.trim());
        } catch {
            throw new Error("Paste the complete Riot redirect URL.");
        }
        if (!(["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/redirect")) {
            throw new Error("That is not a valid Riot localhost redirect URL.");
        }
        const res = await submitTokenUrl(parsed.toString());
        if (!res?.puuid || !res?.access_token || !res?.entitlements_token) {
            throw new Error("Riot did not return a complete session.");
        }
        return {
            puuid: res.puuid,
            accessToken: res.access_token,
            entitlementsToken: res.entitlements_token,
            expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
            region: res.region,
            gameName: res.game_name || "Unknown",
            tagLine: res.tag_line || "",
            lastRenewedAt: Date.now(),
            lastRefreshAttemptAt: Date.now(),
        };
    }, []);

    // Auto-refresh shortly before expiry and, importantly for Android, once
    // immediately after startup when the saved token is already expired.
    // Android has no local Riot Client SSO fallback, so skipping an already
    // expired token would leave every remote feature offline until the user
    // manually signed in again.
    useEffect(() => {
        let timer: number | null = null;
        if (!accountsHydrated || !isBackendOnline || !activeAccount?.expiresAt) return undefined;

        const msUntil = activeAccount.expiresAt - Date.now();
        const expiryKey = `${activeAccount.puuid}:${activeAccount.expiresAt}`;
        const runSilentRenewal = () => {
            if (autoRenewedExpiryRef.current.has(expiryKey)) return;
            autoRenewedExpiryRef.current.add(expiryKey);
            void refreshAccountToken(activeAccount, false, false)
                .catch(() => console.warn('Automatic Riot account renewal failed.'));
        };

        if (msUntil <= 90_000) {
            if (!isLockfileAccount(activeAccount)) {
                timer = window.setTimeout(runSilentRenewal, 1_000);
            }
        } else {
            timer = window.setTimeout(runSilentRenewal, Math.max(5_000, msUntil - 90_000));
        }
        return () => { if (timer) clearTimeout(timer); };
    }, [
        accountsHydrated,
        activeAccount,
        isBackendOnline,
        isLocalClientActive,
        localPuuid,
        refreshAccountToken,
    ]);

    // Initialize accounts list and load static data on mount
    useEffect(() => {
        migrateSessionIds();
        loadStaticData();
    }, [loadStaticData]);

    useEffect(() => {
        let cancelled = false;

        const hydrateAccounts = async () => {
            try {
                const hydrated = await hydrateStoredAccounts();
                if (cancelled) return;
                if (hydrated.length > 0) refreshAccountsList();
            } finally {
                if (!cancelled) setAccountsHydrated(true);
            }
        };

        hydrateAccounts();
        return () => {
            cancelled = true;
        };
    }, [refreshAccountsList]);

    // Auto-import local game session: when Valorant is running and no stored account
    // matches its PUUID, silently fetch and add the account so users never need to
    // manually reconnect after a restart as long as the game is open.
    const autoImportedLocalRef = useRef<string>("");
    useEffect(() => {
        if (isAndroidRuntime()) return;
        if (!isLocalClientActive || !localPuuid) return;
        if (autoImportedLocalRef.current === localPuuid) return; // already tried this session

        const stored = getStoredAccounts();
        const alreadyKnown = stored.some(
            a => a.puuid.toLowerCase() === localPuuid.toLowerCase()
        );
        if (alreadyKnown) {
            const match = stored.find(a => a.puuid.toLowerCase() === localPuuid.toLowerCase());
            if (match) {
                const currentPuuid = localStorage.getItem("riot_puuid");
                if (!currentPuuid) {
                    activateAccount(match);
                    setActiveAccount(match);
                    setStorefrontRefreshKey(k => k + 1);
                } else if (shouldOfferLocalAccount(
                    currentPuuid,
                    localPuuid,
                    localStorage.getItem(DISMISSED_LOCAL_ACCOUNT_KEY),
                )) {
                    setPendingLocalAccount(match);
                }
            }
            autoImportedLocalRef.current = localPuuid;
            return;
        }

        // Account not in storage — silently fetch it from the local client
        autoImportedLocalRef.current = localPuuid; // mark before async to avoid double-calls
        getLocalAccount().then(async data => {
            if (!data?.puuid) return;
            const newAcc: RiotAccount = {
                puuid: data.puuid,
                accessToken: "",
                entitlementsToken: "",
                authSource: "lockfile",
                expiresAt: 0,
                region: data.region,
                gameName: data.game_name,
                tagLine: data.tag_line,
            };
            const current = getStoredAccounts();
            const deduped = current.filter(a => a.puuid !== newAcc.puuid);
            deduped.unshift(newAcc);
            // Save the discovered account, but don't auto-activate when a remote SSO
            // session or different active account exists — show chooser instead.
            await saveStoredAccounts(deduped);
            setAccounts(deduped);

            const currentPuuid = localStorage.getItem("riot_puuid");

            if (shouldOfferLocalAccount(
                currentPuuid,
                newAcc.puuid,
                localStorage.getItem(DISMISSED_LOCAL_ACCOUNT_KEY),
            )) {
                setPendingLocalAccount(newAcc);
            } else {
                // A discovered local account may be stored for later without
                // replacing a deliberate selection or reopening a dismissed prompt.
                if (!currentPuuid) {
                    activateAccount(newAcc);
                    setActiveAccount(newAcc);
                    setIsTokenExpired(false);
                    setStorefrontRefreshKey(k => k + 1);
                }
            }
        }).catch(() => {
            reportAppError("The local Riot account could not be stored securely.");
        });
    }, [activeAccount, isLocalClientActive, localPuuid]);

    // Lockfile accounts are live-session conveniences, not renewable saved
    // accounts. Remove them when Riot confirms that session is gone or belongs
    // to another PUUID, including their account-scoped private caches.
    useEffect(() => {
        if (isAndroidRuntime()) return;
        if (!accountsHydrated || !isBackendOnline) return;

        const removeStaleLocalAccounts = async (currentLocalPuuid: string) => {
            const stored = getStoredAccounts();
            const staleLocalAccounts = stored.filter((account) =>
                isLockfileAccount(account) && account.puuid.toLowerCase() !== currentLocalPuuid
            );
            if (staleLocalAccounts.length === 0) return;

            const stalePuuids = new Set(staleLocalAccounts.map((account) => account.puuid.toLowerCase()));
            const updated = stored.filter((account) => !stalePuuids.has(account.puuid.toLowerCase()));
            try {
                for (const account of staleLocalAccounts) {
                    // Lockfile rows never own renewable credentials or login
                    // sessions. Their chat/cache cleanup is best-effort and must
                    // not prevent the ephemeral row from disappearing.
                    await clearChatHistory(undefined, account.puuid).catch(() => undefined);
                    deleteAccountScopedCaches(account.puuid);
                }
                await saveStoredAccounts(updated);
            } catch {
                reportAppError("The signed-out local account could not be removed from the account list.");
                return;
            }
            setAccounts(updated);
            setPendingLocalAccount((current) =>
                current && stalePuuids.has(current.puuid.toLowerCase()) ? null : current
            );
            autoImportedLocalRef.current = currentLocalPuuid;
            if (activeAccount && stalePuuids.has(activeAccount.puuid.toLowerCase())) {
                const preferredPuuid = localStorage.getItem("riot_puuid")?.toLowerCase();
                const next = updated.find((account) => account.puuid.toLowerCase() === preferredPuuid) || updated[0] || null;
                if (next) {
                    activateAccount(next);
                    setActiveAccount(next);
                    setIsTokenExpired(checkTokenExpired(next, isLocalClientActive, localPuuid));
                    setStorefrontRefreshKey((key) => key + 1);
                } else {
                    clearActiveAccount();
                    setActiveAccount(null);
                    setIsTokenExpired(false);
                    localStorage.removeItem("riot_puuid");
                    localStorage.removeItem("riot_region");
                }
            }
        };

        if (isLocalClientActive && localPuuid) {
            void removeStaleLocalAccounts(localPuuid.toLowerCase());
            return;
        }

        // A single negative health poll can happen while the backend is still
        // attaching to Riot. Confirm once more before deleting the local row.
        const confirmationTimer = window.setTimeout(() => {
            void getHealth().then((health) => {
                if (health.online && !health.localClientActive) {
                    void removeStaleLocalAccounts("");
                }
            });
        }, 5_000);
        return () => window.clearTimeout(confirmationTimer);
    }, [accountsHydrated, activeAccount, isBackendOnline, isLocalClientActive, localPuuid]);

    const handleResolveLocalAccount = useCallback((useLocal: boolean) => {
        if (!pendingLocalAccount) return;
        localStorage.setItem(DISMISSED_LOCAL_ACCOUNT_KEY, pendingLocalAccount.puuid);
        if (useLocal) {
            activateAccount(pendingLocalAccount);
            setActiveAccount(pendingLocalAccount);
            setIsTokenExpired(false);
            hasLoadedUserRef.current = false;
            userLoadFailuresRef.current = 0;
            nextUserLoadAtRef.current = 0;
            setStorefrontRefreshKey(k => k + 1);
            void loadUserData();
        }
        // Keep the discovered account in storage either way; user can switch later
        setPendingLocalAccount(null);
    }, [loadUserData, pendingLocalAccount]);

    // Health check and user inventory loading
    useEffect(() => {
        const healthCheck = async () => {
            const android = isAndroidRuntime();
            if (android) localStorage.setItem("use_local_sso", "false");
            const health = await getHealth();
            setIsBackendOnline(health.online);
            setIsLocalClientActive(android ? false : health.localClientActive);
            setLocalPuuid(android ? "" : health.localPuuid);

            const selectedPuuid = localStorage.getItem("riot_puuid");
            const hasRemoteSession = hasActiveRemoteAuth();
            const hasMatchingLocalSession = !android
                && health.online
                && selectedAccountCanUseLocalClient(selectedPuuid, health.localPuuid, health.localClientActive);
            const userSource = hasRemoteSession ? 'remote' : hasMatchingLocalSession ? 'local' : 'none';
            setIsClientHealthy(hasRemoteSession || hasMatchingLocalSession);

            if (userSource !== 'none') {
                const sourceChanged = lastUserSourceRef.current !== userSource;
                if (sourceChanged) {
                    userLoadFailuresRef.current = 0;
                    nextUserLoadAtRef.current = 0;
                }
                if ((!hasLoadedUserRef.current || sourceChanged) && Date.now() >= nextUserLoadAtRef.current) {
                    hasLoadedUserRef.current = true;
                    lastUserSourceRef.current = userSource;
                    void loadUserData();
                }
            } else {
                hasLoadedUserRef.current = false;
                lastUserSourceRef.current = 'none';
                userLoadFailuresRef.current = 0;
                nextUserLoadAtRef.current = 0;
                setLoading(false);
            }
        };
        healthCheck();
        const intervalId = setInterval(healthCheck, 3000);
        return () => clearInterval(intervalId);
    }, [loadUserData]);

    return (
        <DataContext.Provider value={{
            agents, allAgents, ownedAgentIDs, weapons, ownedBuddies, allBuddies, contentTiers, ownedLevelIDs, ownedChromaIDs, ownedBuddyIDs, bundles, loading, isClientHealthy, isBackendOnline, isLocalClientActive, localPuuid, refreshLoadout,
            sprays, flexes, playerCards, playerTitles, ownedSprayIDs, ownedCardIDs, ownedTitleIDs, playerSpraySlots,
            accounts, activeAccount, isTokenExpired, setIsTokenExpired,
            handleSwitchAccount, handleDeleteAccount, handleAddNewAccount, refreshAccountsList, refreshAccountToken, cancelAccountRefresh,
            startLoginFlow, finalizePastedLogin, cancelLoginFlow, loginInFlight,
            storefrontRefreshKey,
            pendingLocalAccount,
            showLocalAccountChooser: pendingLocalAccount !== null,
            handleResolveLocalAccount,
        }}>
            {children}
        </DataContext.Provider>
    );
}

export function useData() {
    const context = useContext(DataContext);
    if (context === undefined) throw new Error('useData must be used within a DataProvider');
    return context;
}
