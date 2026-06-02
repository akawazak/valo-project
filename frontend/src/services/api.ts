import { Weapon, Agent, OwnedSkinsResponse, LoadoutItemV1, Preset, GunBuddy, ContentTier, OwnedGunBuddiesResponse, OwnedAgentsResponse, StorefrontResponse, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, IdentityV1, SpraySlot, RiotAccount } from '@/lib/types';
import { LocalClientError } from '@/lib/errors';
import { fetch } from '@tauri-apps/plugin-http';

export const LOCAL_URL = "http://localhost:31719/v1"

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    if (typeof window !== "undefined") {
        const token = localStorage.getItem("riot_access_token");
        const entitlements = localStorage.getItem("riot_entitlements");
        const puuid = localStorage.getItem("riot_puuid");
        const region = localStorage.getItem("riot_region");
        if (token && entitlements && puuid && region) {
            headers.set("X-Riot-Access-Token", token);
            headers.set("X-Riot-Entitlements-JWT", entitlements);
            headers.set("X-Riot-Puuid", puuid);
            headers.set("X-Riot-Region", region);
        }
    }
    return fetch(url, { ...init, headers });
}

export async function getHealth(): Promise<boolean> {
    try {
        const response = await fetch(LOCAL_URL + '/health');
        return response.ok;
    } catch {
        return false;
    }
}

export async function getAgents(): Promise<Agent[]> {
    try {
        const response = await fetch('https://valorant-api.com/v1/agents');
        if (!response.ok) {
            throw new Error('Failed to fetch agents');
        }
        const data = await response.json();
        return data.data.filter((agent: Agent) => agent.displayIcon);
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getWeapons(): Promise<Weapon[]> {
    try {
        const response = await fetch('https://valorant-api.com/v1/weapons');
        if (!response.ok) {
            throw new Error('Failed to fetch weapons');
        }
        const data = await response.json();
        return data.data as Weapon[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getGunBuddies(): Promise<GunBuddy[]> {
    try {
        const response = await fetch('https://valorant-api.com/v1/buddies');
        if (!response.ok) {
            throw new Error('Failed to fetch gun buddies');
        }
        const data = await response.json();
        return data.data as GunBuddy[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getContentTiers(): Promise<ContentTier[]> {
    try {
        const response = await fetch('https://valorant-api.com/v1/contenttiers');
        if (!response.ok) {
            throw new Error('Failed to fetch content tiers');
        }
        const data = await response.json();
        return data.data as ContentTier[];
    } catch (error) {
        console.error(error);
        return [];
    }
}


export async function getPlayerLoadout(): Promise<Record<string, LoadoutItemV1>> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/player-loadout');
        if (!response.ok) {
            throw new Error('Failed to fetch player loadout. The local client might not be running or there was a server error.');
        }
        const data = await response.json();
        // New shape: { loadout: {...}, sprays: [...] }
        // Old shape fallback: the loadout object directly
        return (data.loadout ?? data) as Record<string, LoadoutItemV1>;
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getPlayerSprays(): Promise<SpraySlot[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/player-loadout');
        if (!response.ok) return [];
        const data = await response.json();
        return (data.sprays ?? []) as SpraySlot[];
    } catch {
        return [];
    }
}

export async function getOwnedSkins(): Promise<OwnedSkinsResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/owned-skins');
        if (!response.ok) {
            throw new Error('Failed to fetch owned skins. The local client might not be running or there was a server error.');
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getOwnedGunBuddies(): Promise<OwnedGunBuddiesResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/owned-gun-buddies');
        if (!response.ok) {
            throw new Error('Failed to fetch owned gun buddies. The local client might not be running or there was a server error.');
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getOwnedAgents(): Promise<OwnedAgentsResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/owned-agents');
        if (!response.ok) {
            throw new Error('Failed to fetch owned agents. The local client might not be running or there was a server error.');
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getPresets(): Promise<Preset[]> {
    try {
        const response = await fetch(LOCAL_URL+'/presets');
        if (!response.ok) {
            throw new Error('Failed to fetch presets. The local client might not be running or there was a server error.');
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function savePresets(presets: Preset[]): Promise<void> {
    try {
        const response = await fetch(LOCAL_URL+'/presets', {
            method: 'POST',
            body: JSON.stringify(presets),
        });
        if (!response.ok) {
            throw new Error('Failed to save presets. The local client might not be running or there was a server error.');
        }
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getPersistedAccounts(): Promise<RiotAccount[]> {
    try {
        const response = await fetch(LOCAL_URL + '/accounts');
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data as RiotAccount[] : [];
    } catch {
        return [];
    }
}

export async function savePersistedAccounts(accounts: RiotAccount[]): Promise<void> {
    try {
        await fetch(LOCAL_URL + '/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accounts),
        });
    } catch (error) {
        console.error('Failed to persist Riot accounts:', error);
    }
}

export interface ApplyLoadoutRequest {
    loadout: Record<string, LoadoutItemV1>;
    identity?: IdentityV1;
    sprays?: SpraySlot[];
}

export async function applyLoadout(request: ApplyLoadoutRequest): Promise<void> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/apply-loadout', {
            method: 'POST',
            body: JSON.stringify(request),
        });
        if (!response.ok) {
            throw new Error('Failed to apply loadout. The local client might not be running or there was a server error.');
        }
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getAuthUrl(): Promise<{ auth_url: string }> {
    const response = await fetch(LOCAL_URL + '/auth/url');
    if (!response.ok) throw new Error('Failed to get Riot login URL.');
    return response.json();
}

export async function submitTokenUrl(url: string): Promise<{ access_token: string; entitlements_token: string; expires_in: number; puuid: string; region: string; game_name: string; tag_line: string }> {
    const response = await fetch(LOCAL_URL + '/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to submit tokens.');
    }
    return response.json();
}

export async function getStorefront(): Promise<StorefrontResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/storefront');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch storefront.');
    }
    return response.json();
}

export async function getWallet(): Promise<Record<string, number>> {
    const response = await fetchWithAuth(LOCAL_URL + '/wallet');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch wallet.');
    }
    const data = await response.json();
    return data.Balances || {};
}

export async function getBundles(): Promise<BundleInfo[]> {
    const response = await fetch('https://valorant-api.com/v1/bundles');
    if (!response.ok) throw new Error('Failed to fetch bundle assets');
    const data = await response.json();
    return data.data as BundleInfo[];
}

export async function getOwnedSprays(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-sprays');
        if (!response.ok) {
            throw new Error('Failed to fetch owned sprays.');
        }
        const data = await response.json();
        return data.sprayIds || [];
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getOwnedPlayerCards(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-cards');
        if (!response.ok) {
            throw new Error('Failed to fetch owned cards.');
        }
        const data = await response.json();
        return data.cardIds || [];
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getOwnedPlayerTitles(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-titles');
        if (!response.ok) {
            throw new Error('Failed to fetch owned titles.');
        }
        const data = await response.json();
        return data.titleIds || [];
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getSprays(): Promise<SprayAsset[]> {
    const response = await fetch('https://valorant-api.com/v1/sprays');
    if (!response.ok) throw new Error('Failed to fetch spray assets');
    const data = await response.json();
    return data.data as SprayAsset[];
}

export async function getPlayerCards(): Promise<PlayerCardAsset[]> {
    const response = await fetch('https://valorant-api.com/v1/playercards');
    if (!response.ok) throw new Error('Failed to fetch playercard assets');
    const data = await response.json();
    return data.data as PlayerCardAsset[];
}

export async function getPlayerTitles(): Promise<PlayerTitleAsset[]> {
    const response = await fetch('https://valorant-api.com/v1/playertitles');
    if (!response.ok) throw new Error('Failed to fetch playertitle assets');
    const data = await response.json();
    return data.data as PlayerTitleAsset[];
}
