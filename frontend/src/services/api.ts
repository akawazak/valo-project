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

export interface AuthTokenResponse {
    access_token: string;
    entitlements_token: string;
    expires_in: number;
    puuid: string;
    region: string;
    game_name: string;
    tag_line: string;
    cookies?: string;
}

export interface ReauthTokenResponse {
    access_token: string;
    entitlements_token: string;
    expires_in: number;
    cookies?: string;
}

export async function submitTokenUrl(url: string): Promise<AuthTokenResponse> {
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

export async function refreshRiotSession(cookies: string): Promise<ReauthTokenResponse> {
    const response = await fetch(LOCAL_URL + '/auth/ssid-reauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Captured Riot session cookies were not accepted.');
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

// ============================================================================
// Profile / Career (Rank, Match History, Match Details)
// ============================================================================

export interface PlayerMMRResponse {
    Version: number;
    Subject: string;
    LatestCompetitiveUpdate?: {
        MatchID: string;
        MapID: string;
        SeasonID: string;
        MatchStartTime: number;
        TierAfterUpdate: number;
        TierBeforeUpdate: number;
        RankedRatingAfterUpdate: number;
        RankedRatingBeforeUpdate: number;
        RankedRatingEarned: number;
        AFKPenalty: number;
        // ... other fields preserved as-is
        [key: string]: any;
    };
    QueueSkills?: {
        [queue: string]: {
            TotalGamesNeededForRating: number;
            TotalGamesWon: number;
            RankedRating: number;
            CurrentSeasonGamesPlayed: number;
            SeasonalInfoBySeasonID?: {
                [seasonId: string]: {
                    WinsByTier: { [tier: string]: number };
                    GamesNeededForRating: number;
                    TotalWins: number;
                    RankedRating: number;
                    NumberOfWinsWithPlacements: number;
                    NumberOfGames: number;
                    FinalRank: number;
                    FinalRankPlacements: number;
                    RankedRatingPeak: number;
                    PeakRank: number;
                    Wins: number;
                    [key: string]: any;
                };
            };
            [key: string]: any;
        };
    };
    LatestPlacement?: any;
    [key: string]: any;
}

export interface AccountXPResponse {
    Version: number;
    Subject: string;
    // Total XP earned across all seasons (cumulative)
    TotalXP: number;
    // XP history per season
    History: Array<{
        ID: string;
        MatchStartTime: number;
        StartXP: number;
        EndXP: number;
        XPDelta: number;
        XPMultiplier: number;
        TierBeforeChange?: number;
        TierAfterChange?: number;
        LevelBeforeChange?: number;
        LevelAfterChange?: number;
        [key: string]: any;
    }>;
    [key: string]: any;
}

export interface MatchHistoryResponse {
    Subject: string;
    BeginIndex: number;
    EndIndex: number;
    Total: number;
    History: Array<{
        MatchID: string;
        GameStartTime: number;
        QueueID: string;
        MapID: string;
        SeasonID: string;
        IsRanked: boolean;
        MatchResult: string; // "Victory" | "Defeat" | "Draw"
        RoundsWon: number;
        RoundsLost: number;
        TeamID: string;
        // Some servers include a precomputed KDA summary
        Kills?: number;
        Deaths?: number;
        Assists?: number;
        Score?: number;
        [key: string]: any;
    }>;
}

export interface MatchDetailsResponse {
    matchInfo: {
        matchId: string;
        mapId: string;
        gamePodId?: string;
        gameLoopId?: string;
        gameServerAddress?: string;
        gameVersion?: string;
        gameStartMillis: number;
        gameLengthMillis: number;
        queueId: string;
        isRanked: boolean;
        seasonId: string;
        completionState: string; // "Completed" | "Surrendered" etc.
        // "TeamRed" | "TeamBlue" — or sometimes "Blue"/"Red"
        teams: Array<{
            teamId: string;
            won: boolean;
            roundsWon: number;
            roundsLost: number;
            numPoints: number;
            [key: string]: any;
        }>;
        // Sometimes present
        winningTeam?: string;
        [key: string]: any;
    };
    players: Array<{
        subject: string;
        gameName: string;
        tagLine: string;
        teamId: string;
        platformInfo?: any;
        partyId?: string;
        characterId: string;
        stats: {
            score: number;
            roundsPlayed: number;
            kills: number;
            deaths: number;
            assists: number;
            playtimeMillis: number;
            abilityCasts?: { [ability: string]: number };
            [key: string]: any;
        };
        competitiveTier: number;
        accountLevel: number;
        // Premade party size from same team (if available)
        premierPresenceInfo?: any;
        [key: string]: any;
    }>;
    coaches?: any[];
    teams?: any[];
    // Sometimes 'roundResults' / 'kills' are huge — we ignore them in this client
    [key: string]: any;
}

export async function getPlayerMMR(): Promise<PlayerMMRResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/career/mmr');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch player MMR.');
    }
    return response.json();
}

export async function getAccountXP(): Promise<AccountXPResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/career/account-xp');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch account XP.');
    }
    return response.json();
}

export async function getMatchHistory(startIndex = 0, endIndex = 20, queue?: string): Promise<MatchHistoryResponse> {
    const params = new URLSearchParams({ startIndex: String(startIndex), endIndex: String(endIndex) });
    if (queue) params.set('queue', queue);
    const response = await fetchWithAuth(`${LOCAL_URL}/career/match-history?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch match history.');
    }
    return response.json();
}

export async function getMatchDetails(matchID: string): Promise<MatchDetailsResponse> {
    const response = await fetchWithAuth(`${LOCAL_URL}/career/matches/${encodeURIComponent(matchID)}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch match details.');
    }
    return response.json();
}

export async function getCompetitiveUpdates(startIndex = 0, endIndex = 20): Promise<any> {
    const params = new URLSearchParams({ startIndex: String(startIndex), endIndex: String(endIndex) });
    const response = await fetchWithAuth(`${LOCAL_URL}/career/competitive-updates?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch competitive updates.');
    }
    return response.json();
}
