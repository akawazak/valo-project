"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Agent, Weapon, GunBuddy, ContentTier, OwnedBuddy, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, SpraySlot, RiotAccount } from '@/lib/types';
import { getAgents, getWeapons, getGunBuddies, getContentTiers, getOwnedSkins, getOwnedGunBuddies, getHealth, getLocalAccount, getOwnedAgents, getBundles, getSprays, getPlayerCards, getPlayerTitles, getOwnedSprays, getOwnedPlayerCards, getOwnedPlayerTitles, getPlayerSprays, getPersistedAccounts, savePersistedAccounts } from '@/services/api';

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

interface DataContextType {
    agents: Agent[];
    weapons: Weapon[];
    ownedBuddies: GunBuddy[];
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
    
    // Storefront refresh signal — increment to trigger re-fetch in StorePanels
    storefrontRefreshKey: number;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [weapons, setWeapons] = useState<Weapon[]>([]);
    const [ownedBuddies, setOwnedBuddies] = useState<GunBuddy[]>([]);
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
            setIsTokenExpired(checkTokenExpired(found, isLocalClientActive, localPuuid));
        } else {
            localStorage.removeItem("riot_access_token");
            localStorage.removeItem("riot_entitlements");
            localStorage.removeItem("riot_puuid");
            localStorage.removeItem("riot_region");
            setIsTokenExpired(false);
        }
        setActiveAccount(found);
    }, [isLocalClientActive, localPuuid]);

    useEffect(() => {
        if (activeAccount) {
            setIsTokenExpired(checkTokenExpired(activeAccount, isLocalClientActive, localPuuid));
        } else {
            setIsTokenExpired(false);
        }
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
        if (isAccountExpired(acc)) {
            setIsTokenExpired(true);
        } else {
            setIsTokenExpired(false);
            // Bump the storefront refresh key so StorePanels re-fetches silently
            setStorefrontRefreshKey(k => k + 1);
        }
    }, []);

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
        const stored = getStoredAccounts();
        const updated = stored.filter(a => a.puuid !== acc.puuid);
        updated.unshift(acc);
        saveStoredAccounts(updated);
        setAccounts(updated);
        activateAccount(acc);
        setActiveAccount(acc);
        setIsTokenExpired(false);
        // Bump storefront refresh key so store loads fresh for new account
        setStorefrontRefreshKey(k => k + 1);
    }, []);

    // Initialize accounts list and load static data on mount
    useEffect(() => {
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
            // Make sure the known account is active
            const match = stored.find(a => a.puuid.toLowerCase() === localPuuid.toLowerCase());
            if (match) {
                const currentPuuid = localStorage.getItem("riot_puuid");
                if (currentPuuid?.toLowerCase() !== localPuuid.toLowerCase()) {
                    activateAccount(match);
                    setActiveAccount(match);
                    setStorefrontRefreshKey(k => k + 1);
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
            saveStoredAccounts(deduped);
            setAccounts(deduped);
            activateAccount(newAcc);
            setActiveAccount(newAcc);
            setIsTokenExpired(false);
            setStorefrontRefreshKey(k => k + 1);
        }).catch(() => {});
    }, [isLocalClientActive, localPuuid]);

    // Health check and user inventory loading
    useEffect(() => {
        const healthCheck = async () => {
            const hasRemoteSession = typeof window !== 'undefined' && Boolean(localStorage.getItem('riot_access_token'));
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
            agents, weapons, ownedBuddies, contentTiers, ownedLevelIDs, ownedChromaIDs, ownedBuddyIDs, bundles, loading, isClientHealthy, isBackendOnline, refreshLoadout,
            sprays, playerCards, playerTitles, ownedSprayIDs, ownedCardIDs, ownedTitleIDs, playerSpraySlots,
            accounts, activeAccount, isTokenExpired, setIsTokenExpired,
            handleSwitchAccount, handleDeleteAccount, handleAddNewAccount, refreshAccountsList,
            storefrontRefreshKey,
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
