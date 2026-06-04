import { Weapon, Agent, OwnedSkinsResponse, LoadoutItemV1, Preset, GunBuddy, ContentTier, OwnedGunBuddiesResponse, OwnedAgentsResponse, StorefrontResponse, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, IdentityV1, SpraySlot, RiotAccount } from '@/lib/types';
import { LocalClientError } from '@/lib/errors';
import { fetch } from '@tauri-apps/plugin-http';

export const LOCAL_URL = "http://localhost:31719/v1"
const PUBLIC_API_TIMEOUT_MS = 8000;

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = PUBLIC_API_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return await response.json() as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    if (typeof window !== "undefined") {
        const useLocalSso = localStorage.getItem("use_local_sso") === "true";
        if (!useLocalSso) {
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
    }
    return fetch(url, { ...init, headers });
}

export interface HealthStatus {
    online: boolean;
    localClientActive: boolean;
    localPuuid: string;
}

export async function getHealth(): Promise<HealthStatus> {
    try {
        const response = await fetch(LOCAL_URL + '/health');
        if (!response.ok) {
            return { online: false, localClientActive: false, localPuuid: "" };
        }
        const data = await response.json().catch(() => ({}));
        return {
            online: true,
            localClientActive: !!data.local_client_active,
            localPuuid: data.local_puuid || "",
        };
    } catch {
        return { online: false, localClientActive: false, localPuuid: "" };
    }
}

export interface LocalAccountResponse {
    puuid: string;
    region: string;
    game_name: string;
    tag_line: string;
}

export async function getLocalAccount(): Promise<LocalAccountResponse> {
    const response = await fetch(LOCAL_URL + '/accounts/local');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch local game details.');
    }
    return response.json();
}

export async function getAgents(): Promise<Agent[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: Agent[] }>('https://valorant-api.com/v1/agents');
        return data.data.filter((agent: Agent) => agent.displayIcon);
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getWeapons(): Promise<Weapon[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: Weapon[] }>('https://valorant-api.com/v1/weapons');
        return data.data as Weapon[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getGunBuddies(): Promise<GunBuddy[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: GunBuddy[] }>('https://valorant-api.com/v1/buddies');
        return data.data as GunBuddy[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getContentTiers(): Promise<ContentTier[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: ContentTier[] }>('https://valorant-api.com/v1/contenttiers');
        return data.data as ContentTier[];
    } catch (error) {
        console.error(error);
        return [];
    }
}


export type PlayerLoadoutData = {
    loadout: Record<string, LoadoutItemV1>;
    sprays: SpraySlot[];
    identity?: IdentityV1;
};

export async function getPlayerLoadoutData(): Promise<PlayerLoadoutData> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/player-loadout');
        if (!response.ok) {
            throw new Error('Failed to fetch player loadout. The local client might not be running or there was a server error.');
        }
        const data = await response.json();
        return {
            loadout: (data.loadout ?? data) as Record<string, LoadoutItemV1>,
            sprays: (data.sprays ?? []) as SpraySlot[],
            identity: data.identity as IdentityV1 | undefined,
        };
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getPlayerLoadout(): Promise<Record<string, LoadoutItemV1>> {
    const data = await getPlayerLoadoutData();
    return data.loadout;
}

export async function getPlayerSprays(): Promise<SpraySlot[]> {
    try {
        const data = await getPlayerLoadoutData();
        return data.sprays;
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
        const data = await response.json() as {
            buddies?: Array<{ levelId?: string; amount?: number; LevelId?: string; Amount?: number }>;
            Buddies?: Array<{ levelId?: string; amount?: number; LevelId?: string; Amount?: number }>;
        };
        const rawBuddies = data.buddies ?? data.Buddies ?? [];
        return {
            buddies: rawBuddies
                .map((buddy) => ({
                    levelId: buddy.levelId ?? buddy.LevelId ?? '',
                    amount: buddy.amount ?? buddy.Amount ?? 0,
                }))
                .filter((buddy) => buddy.levelId),
        };
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
    try {
        const data = await fetchJsonWithTimeout<{ data: BundleInfo[] }>('https://valorant-api.com/v1/bundles');
        return data.data as BundleInfo[];
    } catch (error) {
        console.error(error);
        return [];
    }
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
    try {
        const data = await fetchJsonWithTimeout<{ data: SprayAsset[] }>('https://valorant-api.com/v1/sprays');
        return data.data as SprayAsset[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getPlayerCards(): Promise<PlayerCardAsset[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: PlayerCardAsset[] }>('https://valorant-api.com/v1/playercards');
        return data.data as PlayerCardAsset[];
    } catch (error) {
        console.error(error);
        return [];
    }
}

export async function getPlayerTitles(): Promise<PlayerTitleAsset[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: PlayerTitleAsset[] }>('https://valorant-api.com/v1/playertitles');
        return data.data as PlayerTitleAsset[];
    } catch (error) {
        console.error(error);
        return [];
    }
}
