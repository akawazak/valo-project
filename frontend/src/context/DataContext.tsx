"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Agent, Weapon, GunBuddy, ContentTier, OwnedBuddy, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, SpraySlot, RiotAccount } from '@/lib/types';
import { getAgents, getWeapons, getGunBuddies, getContentTiers, getOwnedSkins, getOwnedGunBuddies, getHealth, getLocalAccount, getOwnedAgents, getBundles, getSprays, getPlayerCards, getPlayerTitles, getOwnedSprays, getOwnedPlayerCards, getOwnedPlayerTitles, getPlayerSprays, getPersistedAccounts, savePersistedAccounts, getAuthUrl, submitTokenUrl } from '@/services/api';

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

type LoginRedirectPayload = { sessionId: string; url: string };
type LoginCookiesPayload = { sessionId: string; cookies: string };
type LoginSessionPayload = { sessionId: string };

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
 * Throws only when Riot token exchange fails. Cookie capture and persistence
 * are best-effort so a normal login is not thrown away because WebView2 was
 * slow to flush a reusable session cookie.
 */
async function completeLoginFlow(
    ctx: LoginFlowState,
    redirectUrl: string,
): Promise<RiotAccount> {
    const { invoke } = await import("@tauri-apps/api/core");
    const submitTokenUrl = (await import("@/services/api")).submitTokenUrl;
    const refreshRiotSession = (await import("@/services/api")).refreshRiotSession;

    // 1. Exchange the redirect URL for an access token + entitlements.
    const res = await submitTokenUrl(redirectUrl);
    if (!res?.puuid || !res?.access_token || !res?.entitlements_token) {
        throw new Error("Token exchange did not return a valid Riot session.");
    }

    const tempSessionId = ctx.sessionId;
    const stableSessionId = `session_${res.puuid}`;

    // 2. Close the popup and wait for WebView2 to release its lock on
    //    the cookie DB. Without this, get_ssid_cookie copies will fail.
    await closeLoginWindowAndWait(tempSessionId, 5000);

    // 3. Read the ssid cookie — prefer the cookies captured via the
    //    event (faster + more reliable), fall back to a direct read.
    let ssid: string | undefined;
    if (tempSessionId) {
        try {
            const raw = hasSsidCookie(ctx.capturedCookies)
                ? ctx.capturedCookies
                : await invoke<string | null>("get_ssid_cookie", {
                      sessionId: tempSessionId,
                      waitMs: 15000,
                  });
            ssid = raw ?? undefined;
        } catch (err) {
            console.error("Failed to read ssid cookie:", err);
            // Non-fatal — we still have OAuth tokens. Silent reauth just
            // won't work until the user manually signs in again.
        }
    }

    // 4. Persist the temp session dir to the stable session dir. This enables
    //    silent reauth, but failing here should not throw away a valid login.
    if (tempSessionId && tempSessionId !== stableSessionId) {
        try {
            await invoke("persist_login_session", {
                fromSessionId: tempSessionId,
                toSessionId: stableSessionId,
            });
        } catch (err) {
            console.warn("Could not persist reusable Riot login session:", err);
        }
    }

    // 5. If we got an ssid, try a silent reauth to get fresh tokens.
    //    Failures here are non-fatal — we still have OAuth tokens.
    let finalTokens = res;
    let finalSsid: string | undefined = ssid;
    if (hasSsidCookie(ssid)) {
        try {
            const refreshed = await refreshRiotSession(ssid!);
            finalTokens = {
                ...res,
                access_token: refreshed.access_token,
                entitlements_token: refreshed.entitlements_token,
                expires_in: refreshed.expires_in,
                cookies: refreshed.cookies,
            };
            finalSsid = refreshed.cookies || ssid;
        } catch (err) {
            console.debug("Silent reauth skipped (cookies not yet accepted):", err);
        }
    }

    return {
        puuid: res.puuid,
        accessToken: finalTokens.access_token,
        entitlementsToken: finalTokens.entitlements_token,
        expiresAt: Date.now() + Math.max(0, (finalTokens.expires_in || 3600) - 60) * 1000,
        region: res.region,
        gameName: res.game_name || "Unknown",
        tagLine: res.tag_line || "",
        sessionId: stableSessionId,
        ssid: finalSsid,
    };
}

function mergeAccounts(localAccounts: RiotAccount[], persistedAccounts: RiotAccount[]) {
    const merged = new Map<string, RiotAccount>();
    for (const account of persistedAccounts) {
        merged.set(account.puuid, account);
    }
    for (const account of localAccounts) {
        merged.set(account.puuid, account);
    }
    return Array.from(merged.values());
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

export function getStoredAccounts(): RiotAccount[] {
    try {
        return JSON.parse(localStorage.getItem("riot_accounts") || "[]");
    } catch {
        return [];
    }
}

export function saveStoredAccounts(accounts: RiotAccount[]) {
    localStorage.setItem("riot_accounts", JSON.stringify(accounts));
    void savePersistedAccounts(accounts);
}

// One-time migration: ensure every stored account has a stable, PUUID-based
// sessionId so the Tauri WebView always reuses the same data-directory (and
// therefore the same browser cookies) when the user clicks ↻ Refresh.
export function migrateSessionIds(): void {
    try {
        const accounts: RiotAccount[] = JSON.parse(localStorage.getItem("riot_accounts") || "[]");
        let changed = false;
        const migrated = accounts.map(acc => {
            const stableId = `session_${acc.puuid}`;
            // Only assign if the account has no sessionId OR has an old random one
            if (!acc.sessionId || (!acc.sessionId.startsWith('session_') || acc.sessionId !== stableId)) {
                changed = true;
                return { ...acc, sessionId: stableId };
            }
            return acc;
        });
        if (changed) {
            localStorage.setItem("riot_accounts", JSON.stringify(migrated));
            void savePersistedAccounts(migrated);
        }
    } catch {
        // silently ignore migration errors
    }
}

export function activateAccount(account: RiotAccount) {
    localStorage.setItem("riot_puuid", account.puuid);
    localStorage.setItem("riot_region", account.region);
    if (isAccountExpired(account)) {
        localStorage.removeItem("riot_access_token");
        localStorage.removeItem("riot_entitlements");
    } else {
        localStorage.setItem("riot_access_token", account.accessToken);
        localStorage.setItem("riot_entitlements", account.entitlementsToken);
    }
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
    weapons: Weapon[];
    ownedBuddies: GunBuddy[];
    allBuddies: GunBuddy[];
    contentTiers: ContentTier[];
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    ownedBuddyIDs: OwnedBuddy[];
    bundles: BundleInfo[];
    sprays: SprayAsset[];
    playerCards: PlayerCardAsset[];
    playerTitles: PlayerTitleAsset[];
    ownedSprayIDs: string[];
    ownedCardIDs: string[];
    ownedTitleIDs: string[];
    playerSpraySlots: SpraySlot[];
    loading: boolean;
    isClientHealthy: boolean;
    isBackendOnline: boolean;
    refreshLoadout: () => Promise<void>;

    // Accounts management state
    accounts: RiotAccount[];
    activeAccount: RiotAccount | null;
    isTokenExpired: boolean;
    setIsTokenExpired: (expired: boolean) => void;
    handleSwitchAccount: (acc: RiotAccount) => void;
    handleDeleteAccount: (puuid: string) => void;
    handleAddNewAccount: (acc: RiotAccount) => void;
    refreshAccountsList: () => void;
    refreshAccountToken: (acc: RiotAccount, visible?: boolean) => Promise<boolean>;
    cancelAccountRefresh: (acc: RiotAccount) => void;

    /**
     * Start a brand-new Riot login (the "Add account" / "Sign in" flow).
     *
     * Resolves ONLY when the full chain completes successfully:
     *   popup → redirect → token exchange → window close → cookie read →
     *   session persist → optional silent reauth → account stored.
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
    const [weapons, setWeapons] = useState<Weapon[]>([]);
    const [ownedBuddies, setOwnedBuddies] = useState<GunBuddy[]>([]);
    const [allBuddies, setAllBuddies] = useState<GunBuddy[]>([]);
    const [contentTiers, setContentTiers] = useState<ContentTier[]>([]);
    const [ownedLevelIDs, setOwnedLevelIDs] = useState<string[]>([]);
    const [ownedChromaIDs, setOwnedChromaIDs] = useState<string[]>([]);
    const [ownedBuddyIDs, setOwnedBuddyIDs] = useState<OwnedBuddy[]>([]);
    const [bundles, setBundles] = useState<BundleInfo[]>([]);
    const [sprays, setSprays] = useState<SprayAsset[]>([]);
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

    // Refresh local lists of accounts and active selection
    const refreshAccountsList = useCallback(() => {
        const stored = getStoredAccounts();
        setAccounts(stored);
        const puuid = localStorage.getItem("riot_puuid");
        const found = stored.find(a => a.puuid === puuid) || stored[0] || null;
        if (found) {
            activateAccount(found);
            const expired = checkTokenExpired(found, isLocalClientActive, localPuuid);
            setIsTokenExpired(prev => prev === expired ? prev : expired);
        } else {
            localStorage.removeItem("riot_access_token");
            localStorage.removeItem("riot_entitlements");
            localStorage.removeItem("riot_puuid");
            localStorage.removeItem("riot_region");
            setIsTokenExpired(prev => prev === false ? prev : false);
        }
        setActiveAccount(prev => prev?.puuid === found?.puuid ? prev : found);
    }, [isLocalClientActive, localPuuid]);

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
                const [agentsData, weaponsData, gunBuddiesData, contentTiersData, bundlesData, spraysData, cardsData, titlesData] = await Promise.all([
                    getAgents(),
                    getWeapons(),
                    getGunBuddies(),
                    getContentTiers(),
                    getBundles(),
                    getSprays(),
                    getPlayerCards(),
                    getPlayerTitles(),
                ]);
                weaponsRef.current = weaponsData;
                gunBuddiesRef.current = gunBuddiesData;
                allAgentsRef.current = agentsData;

                setWeapons(weaponsData);
                setAllBuddies(gunBuddiesData);
                setContentTiers(contentTiersData);
                setBundles(bundlesData);
                setSprays(spraysData);
                setPlayerCards(cardsData);
                setPlayerTitles(titlesData);
                setAgents(agentsData.filter(a => a.isBaseContent));
                hasLoadedStaticRef.current = true;
            } catch (error) {
                staticLoadPromiseRef.current = null;
                console.error("Failed to load static catalog:", error);
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
            setLoading(false);
        } catch (error) {
            console.error("Failed to load user-specific inventory:", error);
            hasLoadedUserRef.current = false;
            setLoading(false);
        }
    }, [loadStaticData, ensureGunBuddyCatalog]);

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
        hasLoadedUserRef.current = false;
        if (isAccountExpired(acc)) {
            setIsTokenExpired(true);
        } else {
            setIsTokenExpired(false);
            // Bump the storefront refresh key so StorePanels re-fetches silently
            setStorefrontRefreshKey(k => k + 1);
        }
        void loadUserData();
    }, [loadUserData]);

    const handleDeleteAccount = useCallback((puuid: string) => {
        const stored = getStoredAccounts();
        const updated = stored.filter(a => a.puuid !== puuid);
        saveStoredAccounts(updated);
        setAccounts(updated);
        
        if (activeAccount?.puuid === puuid) {
            const next = updated[0] ?? null;
            if (next) {
                activateAccount(next);
                setActiveAccount(next);
                // Bump storefront refresh key to re-fetch for new active account
                setStorefrontRefreshKey(k => k + 1);
            } else {
                setActiveAccount(null);
                localStorage.removeItem("riot_access_token");
                localStorage.removeItem("riot_entitlements");
                localStorage.removeItem("riot_puuid");
                localStorage.removeItem("riot_region");
            }
        }
        // No page reload — state updates are sufficient
    }, [activeAccount]);

    const handleAddNewAccount = useCallback((acc: RiotAccount) => {
        // Always ensure a stable, PUUID-based sessionId so the same cookie
        // directory is used for every future refresh of this account.
        const stableAcc: RiotAccount = {
            ...acc,
            sessionId: `session_${acc.puuid}`,
        };
        const stored = getStoredAccounts();
        const updated = stored.filter(a => a.puuid !== stableAcc.puuid);
        updated.unshift(stableAcc);
        saveStoredAccounts(updated);
        setAccounts(updated);
        activateAccount(stableAcc);
        setActiveAccount(stableAcc);
        setIsTokenExpired(false);
        hasLoadedUserRef.current = false;
        void loadUserData();
        // Bump storefront refresh key so store loads fresh for new account
        setStorefrontRefreshKey(k => k + 1);
    }, [loadUserData]);

    const refreshAccountToken = useCallback(async (acc: RiotAccount, visible: boolean = false): Promise<boolean> => {
        const sessionKey = acc.sessionId || `session_${acc.puuid}`;
        if (loginInFlightRef.current) {
            // A brand-new login is in flight — don't compete with it for the
            // WebView lock.
            return false;
        }
        if (globalRefreshInFlightRef.current || refreshInFlightRef.current.has(sessionKey)) {
            // Another refresh is already running for this session — wait for it
            // instead of opening a second login window.
            return false;
        }
        globalRefreshInFlightRef.current = true;
        refreshInFlightRef.current.add(sessionKey);
        const releaseLock = () => {
            refreshInFlightRef.current.delete(sessionKey);
            refreshCancelRef.current.delete(sessionKey);
            globalRefreshInFlightRef.current = false;
        };

        let sessionId = acc.sessionId;
        if (!sessionId) {
            sessionId = `session_${acc.puuid}`;
            acc.sessionId = sessionId;
        }

        // Step 1: Silent ssid cookie reauth (techchrism endpoint — no popup needed)
        // ssid lasts ~1 week, all-cookies strategy lasts ~3 weeks
        if (acc.ssid) {
            try {
                const res = await fetch("http://localhost:31719/v1/auth/ssid-reauth", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ cookies: acc.ssid }),
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.access_token) {
                        const updatedAcc: RiotAccount = {
                            ...acc,
                            accessToken: data.access_token,
                            entitlementsToken: data.entitlements_token,
                            expiresAt: Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000,
                            ssid: data.cookies || acc.ssid,
                            sessionId,
                        };
                        const stored = getStoredAccounts();
                        const updated = stored.map(a => a.puuid === acc.puuid ? updatedAcc : a);
                        saveStoredAccounts(updated);
                        setAccounts(updated);
                        if (activeAccount?.puuid === acc.puuid) {
                            activateAccount(updatedAcc);
                            setActiveAccount(updatedAcc);
                            setIsTokenExpired(false);
                            setStorefrontRefreshKey(k => k + 1);
                        }
                        releaseLock();
                        return true;
                    }
                }
                // 401 = ssid expired → fall through to popup
            } catch {
                // Network error → fall through to popup
            }
        }

        // Step 2: Fallback — WebView popup (first login or refresh_token expired)
        try {
            const { auth_url } = await getAuthUrl();
            const { invoke } = await import("@tauri-apps/api/core");
            const { listen } = await import("@tauri-apps/api/event");

            return new Promise<boolean>((resolve) => {
                let resolved = false;
                let unlistenFn: (() => void) | null = null;
                let unlistenCloseFn: (() => void) | null = null;
                let unlistenCookiesFn: (() => void) | null = null;
                let timeoutId: number | null = null;
                let capturedCookies: string | null = null;

                const cleanup = () => {
                    resolved = true;
                    if (timeoutId !== null) window.clearTimeout(timeoutId);
                    if (unlistenFn) unlistenFn();
                    if (unlistenCloseFn) unlistenCloseFn();
                    if (unlistenCookiesFn) unlistenCookiesFn();
                    refreshCancelRef.current.delete(sessionKey);
                };

                const finish = (ok: boolean) => {
                    if (resolved) return;
                    cleanup();
                    releaseLock();
                    resolve(ok);
                };

                // Register a cancel handle so the UI can abort this refresh.
                refreshCancelRef.current.set(sessionKey, () => {
                    if (resolved) return;
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
                    }
                }).then(fn => { unlistenCookiesFn = fn; });

                listen<LoginRedirectPayload>("riot-login-redirect-v2", async (event) => {
                    if (resolved) return;
                    if (event.payload?.sessionId !== sessionId) return;
                    cleanup();

                    try {
                        const redirectUrl = event.payload.url;
                        const res = await submitTokenUrl(redirectUrl);

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
                            ssid: acc.ssid ?? undefined,
                            sessionId,
                        };
                        const stored = getStoredAccounts();
                        const updated = stored.map(a => a.puuid === acc.puuid ? updatedAcc : a);
                        saveStoredAccounts(updated);
                        setAccounts(updated);
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

                        // Fetch the ssid cookie from the session directory now that the lock is released
                        const raw = hasSsidCookie(capturedCookies)
                            ? capturedCookies
                            : await invoke<string | null>("get_ssid_cookie", { sessionId, waitMs: 15000 }) ?? undefined;
                        console.debug("get_ssid_cookie: result for session", sessionId, "->", raw);

                        const finalAcc = { ...updatedAcc, ssid: raw ?? updatedAcc.ssid };
                        const finalUpdated = getStoredAccounts().map(a => a.puuid === acc.puuid ? finalAcc : a);
                        saveStoredAccounts(finalUpdated);
                        setAccounts(finalUpdated);
                        if (activeAccount?.puuid === acc.puuid) {
                            activateAccount(finalAcc);
                            setActiveAccount(finalAcc);
                        }

                        resolve(true);
                        releaseLock();
                    } catch (err) {
                        console.error("Error in token submit during auto-refresh:", err);
                        resolve(false);
                        releaseLock();
                    }
                }).then(fn => { unlistenFn = fn; });

                listen<LoginSessionPayload>("riot-login-closed-v2", (event) => {
                    if (event.payload?.sessionId !== sessionId) return;
                    if (resolved) return;
                    finish(false);
                }).then(fn => { unlistenCloseFn = fn; });

                invoke("open_login_window", { authUrl: auth_url, sessionId, visible }).catch((err) => {
                    console.error("Failed to open login window:", err);
                    cleanup();
                    releaseLock();
                    resolve(false);
                });
            });
        } catch (err) {
            console.error("Failed to start refreshAccountToken:", err);
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
    }, []);

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
     *   ssid cookie read → session persist (temp → stable) → optional
     *   silent reauth → account stored → resolve(new account)
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
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
                        console.debug("captured ssid cookies for session", sessionId);
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

    // Auto-refresh the active account token shortly before expiry to avoid
    // user-visible expiration. Schedule a refresh 90 seconds before expiry.
    useEffect(() => {
        let timer: number | null = null;
        if (activeAccount && activeAccount.expiresAt && activeAccount.expiresAt > Date.now()) {
            const msUntil = activeAccount.expiresAt - Date.now();
            const refreshMs = Math.max(5_000, msUntil - 90_000); // at least 5s
            timer = window.setTimeout(() => {
                // Attempt silent refresh; if it fails, leave token expired and UI will surface refresh option
                void refreshAccountToken(activeAccount, false).catch((err) => console.error('Auto refresh failed:', err));
            }, refreshMs);
        }
        return () => { if (timer) clearTimeout(timer); };
    }, [activeAccount, refreshAccountToken]);

    // Initialize accounts list and load static data on mount
    useEffect(() => {
        migrateSessionIds(); // one-time migration to stable PUUID-based session IDs
        refreshAccountsList();
        loadStaticData();
    }, [loadStaticData, refreshAccountsList]);

    useEffect(() => {
        let cancelled = false;

        const hydrateAccounts = async () => {
            const persisted = await getPersistedAccounts();
            if (cancelled || persisted.length === 0) return;

            const merged = mergeAccounts(getStoredAccounts(), persisted);
            saveStoredAccounts(merged);
            refreshAccountsList();
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
                const useLocalSso = localStorage.getItem("use_local_sso") === "true";
                const shouldUseLocal =
                    useLocalSso ||
                    !activeAccount ||
                    !currentPuuid ||
                    currentPuuid.toLowerCase() === localPuuid.toLowerCase();

                if (shouldUseLocal && currentPuuid?.toLowerCase() !== localPuuid.toLowerCase()) {
                    activateAccount(match);
                    setActiveAccount(match);
                    setStorefrontRefreshKey(k => k + 1);
                } else if (!shouldUseLocal && activeAccount.puuid.toLowerCase() !== localPuuid.toLowerCase()) {
                    setPendingLocalAccount(match);
                }
            }
            autoImportedLocalRef.current = localPuuid;
            return;
        }

        // Account not in storage — silently fetch it from the local client
        autoImportedLocalRef.current = localPuuid; // mark before async to avoid double-calls
        getLocalAccount().then(data => {
            if (!data?.puuid) return;
            const newAcc: RiotAccount = {
                puuid: data.puuid,
                accessToken: "",
                entitlementsToken: "",
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
            saveStoredAccounts(deduped);
            setAccounts(deduped);

            const hasRemoteSession = Boolean(localStorage.getItem('riot_access_token'));
            const conflictWithActive = activeAccount && activeAccount.puuid.toLowerCase() !== newAcc.puuid.toLowerCase();

            if (hasRemoteSession || conflictWithActive) {
                // Defer activation and surface chooser to the UI
                setPendingLocalAccount(newAcc);
            } else {
                activateAccount(newAcc);
                setActiveAccount(newAcc);
                setIsTokenExpired(false);
                setStorefrontRefreshKey(k => k + 1);
            }
        }).catch(() => {});
    }, [activeAccount, isLocalClientActive, localPuuid]);

    const handleResolveLocalAccount = useCallback((useLocal: boolean) => {
        if (!pendingLocalAccount) return;
        if (useLocal) {
            activateAccount(pendingLocalAccount);
            setActiveAccount(pendingLocalAccount);
            setIsTokenExpired(false);
            setStorefrontRefreshKey(k => k + 1);
        }
        // Keep the discovered account in storage either way; user can switch later
        setPendingLocalAccount(null);
    }, [pendingLocalAccount]);

    // Health check and user inventory loading
    useEffect(() => {
        const healthCheck = async () => {
            const useLocalSso = typeof window !== 'undefined' && localStorage.getItem('use_local_sso') === 'true';
            const hasRemoteSession = !useLocalSso && typeof window !== 'undefined' && Boolean(localStorage.getItem('riot_access_token'));
            const health = await getHealth();
            setIsBackendOnline(health.online);
            setIsLocalClientActive(health.localClientActive);
            setLocalPuuid(health.localPuuid);

            const userSource = hasRemoteSession ? 'remote' : (health.online && health.localClientActive) ? 'local' : 'none';
            setIsClientHealthy(hasRemoteSession || (health.online && health.localClientActive));

            if (userSource !== 'none') {
                if (!hasLoadedUserRef.current || lastUserSourceRef.current !== userSource) {
                    hasLoadedUserRef.current = true;
                    lastUserSourceRef.current = userSource;
                    loadUserData();
                }
            } else {
                hasLoadedUserRef.current = false;
                lastUserSourceRef.current = 'none';
                setLoading(false);
            }
        };
        healthCheck();
        const intervalId = setInterval(healthCheck, 3000);
        return () => clearInterval(intervalId);
    }, [loadUserData]);

    return (
        <DataContext.Provider value={{
            agents, weapons, ownedBuddies, allBuddies, contentTiers, ownedLevelIDs, ownedChromaIDs, ownedBuddyIDs, bundles, loading, isClientHealthy, isBackendOnline, refreshLoadout,
            sprays, playerCards, playerTitles, ownedSprayIDs, ownedCardIDs, ownedTitleIDs, playerSpraySlots,
            accounts, activeAccount, isTokenExpired, setIsTokenExpired,
            handleSwitchAccount, handleDeleteAccount, handleAddNewAccount, refreshAccountsList, refreshAccountToken, cancelAccountRefresh,
            startLoginFlow, cancelLoginFlow, loginInFlight,
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
