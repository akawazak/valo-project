"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Agent, Weapon, GunBuddy, ContentTier, OwnedBuddy, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, SpraySlot, RiotAccount } from '@/lib/types';
import { getAgents, getWeapons, getGunBuddies, getContentTiers, getOwnedSkins, getOwnedGunBuddies, getHealth, getOwnedAgents, getBundles, getSprays, getPlayerCards, getPlayerTitles, getOwnedSprays, getOwnedPlayerCards, getOwnedPlayerTitles, getPlayerSprays, getPersistedAccounts, savePersistedAccounts } from '@/services/api';

function isAccountExpired(account: RiotAccount | null) {
    if (!account?.expiresAt) return false;
    return Date.now() >= account.expiresAt - 60_000;
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
    
    // Lifted accounts state
    const [accounts, setAccounts] = useState<RiotAccount[]>([]);
    const [activeAccount, setActiveAccount] = useState<RiotAccount | null>(null);
    const [isTokenExpired, setIsTokenExpired] = useState(false);
    
    // Storefront re-fetch signal (no page reload needed)
    const [storefrontRefreshKey, setStorefrontRefreshKey] = useState(0);
    
    const weaponsRef = useRef<Weapon[]>([]);
    const gunBuddiesRef = useRef<GunBuddy[]>([]);
    const allAgentsRef = useRef<Agent[]>([]);
    
    const hasLoadedStaticRef = useRef(false);
    const hasLoadedUserRef = useRef(false);

    // Refresh local lists of accounts and active selection
    const refreshAccountsList = useCallback(() => {
        const stored = getStoredAccounts();
        setAccounts(stored);
        const puuid = localStorage.getItem("riot_puuid");
        const found = stored.find(a => a.puuid === puuid) || stored[0] || null;
        if (found) {
            activateAccount(found);
            setIsTokenExpired(isAccountExpired(found));
        } else {
            localStorage.removeItem("riot_access_token");
            localStorage.removeItem("riot_entitlements");
            localStorage.removeItem("riot_puuid");
            localStorage.removeItem("riot_region");
            setIsTokenExpired(false);
        }
        setActiveAccount(found);
    }, []);

    // 1. Load Public Static Catalog (unconditional, immediate)
    const loadStaticData = useCallback(async () => {
        if (hasLoadedStaticRef.current) return;
        hasLoadedStaticRef.current = true;
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
        } catch (error) {
            console.error("Failed to load static catalog:", error);
        }
    }, []);

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
            const gunBuddiesData = gunBuddiesRef.current;
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
            setOwnedBuddyIDs(ownedGunBuddies.Buddies);
            setOwnedSprayIDs(ownedSprays);
            setOwnedCardIDs(ownedCards);
            setOwnedTitleIDs(ownedTitles);
            setPlayerSpraySlots(playerSprays);

            const ownedBuddyDetails = gunBuddiesData
                .filter(b => ownedGunBuddies.Buddies.findIndex(ob => ob.LevelId.toLowerCase() === b.levels[0].uuid.toLowerCase()) !== -1)
                .map(b => {
                    const ownedBuddy = ownedGunBuddies.Buddies.find(ob => ob.LevelId.toLowerCase() === b.levels[0].uuid.toLowerCase())!;
                    return { ...b, amount: ownedBuddy.Amount };
                });
            setOwnedBuddies(ownedBuddyDetails);
            setLoading(false);
        } catch (error) {
            console.error("Failed to load user-specific inventory:", error);
            setLoading(false);
        }
    }, [loadStaticData]);

    const refreshLoadout = useCallback(async () => {
        try {
            const weaponsData = weaponsRef.current;
            const gunBuddiesData = gunBuddiesRef.current;
            const agentsData = await getAgents();
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
            setOwnedBuddyIDs(ownedGunBuddies.Buddies);
            setOwnedSprayIDs(ownedSprays);
            setOwnedCardIDs(ownedCards);
            setOwnedTitleIDs(ownedTitles);
            setPlayerSpraySlots(playerSprays);
            if (gunBuddiesData.length > 0) {
                setOwnedBuddies(gunBuddiesData
                    .filter(b => ownedGunBuddies.Buddies.findIndex(ob => ob.LevelId.toLowerCase() === b.levels[0].uuid.toLowerCase()) !== -1)
                    .map(b => {
                        const ownedBuddy = ownedGunBuddies.Buddies.find(ob => ob.LevelId.toLowerCase() === b.levels[0].uuid.toLowerCase())!;
                        return { ...b, amount: ownedBuddy.Amount };
                    }));
            }
        } catch {
            // silent
        }
    }, []);

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

    // Health check and user inventory loading
    useEffect(() => {
        const healthCheck = async () => {
            const hasRemoteSession = typeof window !== 'undefined' && Boolean(localStorage.getItem('riot_access_token'));
            const isHealthy = hasRemoteSession || await getHealth();
            setIsClientHealthy(isHealthy);
            if (isHealthy) {
                if (!hasLoadedUserRef.current) {
                    hasLoadedUserRef.current = true;
                    loadUserData();
                }
            } else {
                hasLoadedUserRef.current = false;
            }
        };
        healthCheck();
        const intervalId = setInterval(healthCheck, 3000);
        return () => clearInterval(intervalId);
    }, [loadUserData]);

    return (
        <DataContext.Provider value={{
            agents, weapons, ownedBuddies, contentTiers, ownedLevelIDs, ownedChromaIDs, ownedBuddyIDs, bundles, loading, isClientHealthy, refreshLoadout,
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
