import { Weapon, Agent, OwnedSkinsResponse, LoadoutItemV1, Preset, GunBuddy, ContentTier, OwnedGunBuddiesResponse, OwnedAgentsResponse, StorefrontResponse, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, IdentityV1, SpraySlot, RiotAccount } from '@/lib/types';
import { LocalClientError } from '@/lib/errors';

export const LOCAL_URL = "http://localhost:31719/v1"
const PUBLIC_API_TIMEOUT_MS = 8000;

export async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    return window.fetch(input, init);
}

/**
 * Activate an account in localStorage: writes riot_puuid / riot_region /
 * riot_access_token / riot_entitlements. Used by both the login card
 * (initial local-client login) and the DataContext switch/refresh paths.
 *
 * Note: tokens with `expiresAt` already in the past are NOT written —
 * the caller is expected to use the active Riot account through local
 * client SSO in that case.
 */
export function activateAccount(account: {
    puuid: string;
    accessToken: string;
    entitlementsToken: string;
    expiresAt?: number;
    region: string;
}) {
    localStorage.setItem("riot_puuid", account.puuid);
    localStorage.setItem("riot_region", account.region);
    const expiresAt = account.expiresAt ?? 0;
    if (expiresAt > 0 && Date.now() >= expiresAt - 60_000) {
        localStorage.removeItem("riot_access_token");
        localStorage.removeItem("riot_entitlements");
    } else if (account.accessToken) {
        localStorage.setItem("riot_access_token", account.accessToken);
        localStorage.setItem("riot_entitlements", account.entitlementsToken);
    } else {
        // No tokens yet — likely a local-client-only account. Clear so the
        // storefront fetch doesn't send empty Bearer headers.
        localStorage.removeItem("riot_access_token");
        localStorage.removeItem("riot_entitlements");
    }
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = PUBLIC_API_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await appFetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }
        return await response.json() as T;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchWithAuth(
    url: string,
    init?: RequestInit,
    options: { forceRemoteAuth?: boolean } = {},
): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    if (typeof window !== "undefined") {
        const useLocalSso = localStorage.getItem("use_local_sso") === "true";
        if (options.forceRemoteAuth || !useLocalSso) {
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
    return appFetch(url, { ...init, headers });
}

export interface HealthStatus {
    online: boolean;
    localClientActive: boolean;
    localPuuid: string;
}

export async function getHealth(): Promise<HealthStatus> {
    try {
        const response = await appFetch(LOCAL_URL + '/health');
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
    const response = await appFetch(LOCAL_URL + '/accounts/local');
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
    } catch {
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
        const response = await fetchWithAuth(LOCAL_URL+'/presets');
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
        const response = await fetchWithAuth(LOCAL_URL+'/presets', {
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
        const response = await appFetch(LOCAL_URL + '/accounts');
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data as RiotAccount[] : [];
    } catch {
        return [];
    }
}

export async function savePersistedAccounts(accounts: RiotAccount[]): Promise<void> {
    try {
        await appFetch(LOCAL_URL + '/accounts', {
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
    const response = await appFetch(LOCAL_URL + '/auth/url');
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
    const response = await appFetch(LOCAL_URL + '/auth/token', {
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
    const response = await appFetch(LOCAL_URL + '/auth/ssid-reauth', {
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
        [key: string]: unknown;
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
                    [key: string]: unknown;
                };
            };
            [key: string]: unknown;
        };
    };
    LatestPlacement?: unknown;
    [key: string]: unknown;
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
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
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
        [key: string]: unknown;
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
            [key: string]: unknown;
        }>;
        // Sometimes present
        winningTeam?: string;
        [key: string]: unknown;
    };
    players: Array<{
        subject: string;
        gameName: string;
        tagLine: string;
        teamId: string;
        platformInfo?: unknown;
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
            [key: string]: unknown;
        };
        competitiveTier: number;
        accountLevel: number;
        // Premade party size from same team (if available)
        premierPresenceInfo?: unknown;
        [key: string]: unknown;
    }>;
    coaches?: unknown[];
    teams?: unknown[];
    // Sometimes 'roundResults' / 'kills' are huge — we ignore them in this client
    [key: string]: unknown;
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

export async function getCompetitiveUpdates(startIndex = 0, endIndex = 20): Promise<unknown> {
    const params = new URLSearchParams({ startIndex: String(startIndex), endIndex: String(endIndex) });
    const response = await fetchWithAuth(`${LOCAL_URL}/career/competitive-updates?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch competitive updates.');
    }
    return response.json();
}

// ============================================================================
// Profile (local-cache-backed /v1/profile/* endpoints)
// ============================================================================
// These endpoints are served by the local Go backend, backed by a persistent
// SQLite cache. They are distinct from /v1/career/* (which hits Riot live).
// Auth is supplied via X-Riot-* headers by fetchWithAuth().
// All field names below mirror backend/tracking/types.go exactly.

export interface ProfileCurrentRank {
    competitiveTier: number;
    tierName: string;
    rankedRating: number;
    numberOfWins: number;
    numberOfGames: number;
    leaderboardRank: number;
}

export interface ProfilePeakRank {
    competitiveTier: number;
    tierName: string;
    seasonId: string;
}

export interface ProfileAccountSummary {
    level: number;
    totalXp: number;
}

export interface ProfileRankActSummary {
    seasonId: string;
    wins: number;
    games: number;
    rankedRating: number;
    peakRank: number;
    finalRank: number;
}

export interface ProfileRRSnapshot {
    matchId: string;
    seasonId: string;
    tierBefore: number;
    tierAfter: number;
    rrBefore: number;
    rrAfter: number;
    rrEarned: number;
    afkPenalty: number;
    matchStartTime: number;
}

export interface ProfileSeasonSummary {
    matches: number;
    wins: number;
    winrate: number;
    avgKda: number;
    avgHsPct: number;
    topAgent: string;
    topAgentCharacterId: string;
}

export interface ProfileOverview {
    puuid: string;
    region: string;
    gameName?: string;
    tagLine?: string;
    currentSeasonId: string;
    currentRank: ProfileCurrentRank;
    peakRank: ProfilePeakRank;
    account: ProfileAccountSummary;
    lastDeltas: ProfileRRSnapshot[];
    rankActs: ProfileRankActSummary[];
    seasonSummary: ProfileSeasonSummary | null;
}

export interface ProfileRRHistory {
    puuid: string;
    region: string;
    seasonId: string;
    snapshots: ProfileRRSnapshot[];
}

export interface ProfileAgentStat {
    characterId: string;
    matches: number;
    wins: number;
    winrate: number;
    kills: number;
    deaths: number;
    assists: number;
    kd: number;
    kda: number;
    headshots: number;
    hsPct: number;
    timePlayedMillis: number;
}

export interface ProfileAgentStatsResponse {
    puuid: string;
    region: string;
    queue: string;
    agents: ProfileAgentStat[];
}

export interface ProfileMapStat {
    mapID: string;
    matches: number;
    wins: number;
    winrate: number;
}

export interface ProfileMapStatsResponse {
    puuid: string;
    region: string;
    queue: string;
    maps: ProfileMapStat[];
}

export interface ProfilePlayerStats {
    subject: string;
    teamId: string;
    gameName: string;
    tagLine: string;
    characterId: string;
    kills: number;
    deaths: number;
    assists: number;
    score: number;
    headshots: number;
    bodyshots: number;
    legshots: number;
    damageDealt: number;
    roundsPlayed: number;
    isLocal: boolean;
    competitiveTier: number;
    kd: number;
    kda: number;
    adr: number;
    acs: number;
    hsPct: number;
}

export interface ProfileMatchInfo {
    matchId: string;
    mapID: string;
    gameStartMillis: number;
    gameLengthMillis: number;
    isRanked: boolean;
    queueID: string;
    gameMode: string;
    seasonId: string;
    completionState: string;
    blueRoundsWon: number;
    redRoundsWon: number;
    blueWins: boolean;
}

export interface ProfileMatchSummary {
    matchId: string;
    queueID: string;
    mapID: string;
    gameMode: string;
    gameStartMillis: number;
    gameLengthMillis: number;
    seasonId: string;
    isRanked: boolean;
    win: boolean;
    tierAfter: number;
    rrEarned: number;
    localPlayer: ProfilePlayerStats;
}

export interface ProfileMatchHistoryResponse {
    puuid: string;
    region: string;
    startIndex: number;
    endIndex: number;
    total: number;
    queue: string;
    matches: ProfileMatchSummary[];
}

export interface ProfileMatchDetails {
    matchId: string;
    matchInfo: ProfileMatchInfo;
    players: ProfilePlayerStats[];
    servedFrom: string;
}

export interface ProfileSyncStatus {
    puuid: string;
    lastSyncedAt: number;
    inFlight: boolean;
    totalMatches: number;
    lastError?: string;
}

export interface ProfileSyncResponse {
    started: boolean;
    inFlight?: boolean;
    startedAt?: number;
}

function appendProfileParams(
    params: URLSearchParams,
    opts: { puuid?: string; region?: string },
): void {
    if (opts.puuid) params.set("puuid", opts.puuid);
    if (opts.region) params.set("region", opts.region);
}

export async function getProfileOverview(
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileOverview> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/overview${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch profile overview.');
    }
    return response.json();
}

export async function getRRHistory(
    seasonId?: string,
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileRRHistory> {
    const params = new URLSearchParams();
    if (seasonId) params.set("seasonId", seasonId);
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/rr-history${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch RR history.');
    }
    return response.json();
}

export async function getAgentStats(
    queue?: string,
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileAgentStatsResponse> {
    const params = new URLSearchParams();
    if (queue) params.set("queue", queue);
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/agent-stats${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch agent stats.');
    }
    return response.json();
}

export async function getMapStats(
    queue?: string,
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileMapStatsResponse> {
    const params = new URLSearchParams();
    if (queue) params.set("queue", queue);
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/map-stats${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch map stats.');
    }
    return response.json();
}

export async function getProfileMatchHistory(
    startIndex = 0,
    endIndex = 20,
    queue?: string,
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileMatchHistoryResponse> {
    const params = new URLSearchParams({
        startIndex: String(startIndex),
        endIndex: String(endIndex),
    });
    if (queue) params.set("queue", queue);
    appendProfileParams(params, opts);
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/match-history?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch profile match history.');
    }
    return response.json();
}

export async function getProfileMatchDetails(
    matchID: string,
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileMatchDetails> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/match-details/${encodeURIComponent(matchID)}${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch match details.');
    }
    return response.json();
}

export async function postProfileSync(
    opts: { puuid?: string; region?: string; force?: boolean } = {},
): Promise<ProfileSyncResponse> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    if (opts.force) params.set("force", "true");
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/sync${qs ? `?${qs}` : ""}`, {
        method: "POST",
    });
    // 202 = sync already in flight; treat as a normal response payload.
    if (response.status === 202 || response.ok) {
        try {
            return await response.json();
        } catch {
            return { started: false, inFlight: true };
        }
    }
    const text = await response.text();
    throw new Error(text || 'Failed to start profile sync.');
}

export async function getProfileSyncStatus(
    opts: { puuid?: string; region?: string } = {},
): Promise<ProfileSyncStatus> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/sync-status${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch sync status.');
    }
    return response.json();
}

export interface LiveMatchResponse {
    phase: "pregame" | "coregame" | "none";
    matchId: string;
    mapId: string;
    queueId: string;
    timeLeft: number;
    allyTeam?: LivePlayer[];
    enemyTeam?: LivePlayer[];
    source?: "local" | "remote";
    error?: string;
}

export interface LivePlayer {
    puuid: string;
    name: string;
    agentId: string;
    selectionState: "selected" | "locked" | "none";
    accountLevel: number;
    cardId: string;
    isLocal: boolean;
    competitiveTier: number;
    rankedRating: number;
}

export async function getLiveMatch(): Promise<LiveMatchResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/livematch');
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { phase: "none", matchId: "", mapId: "", queueId: "", timeLeft: 0, error: text };
        }
        return await response.json();
    } catch (err) {
        return { phase: "none", matchId: "", mapId: "", queueId: "", timeLeft: 0, error: err instanceof Error ? err.message : String(err || "") };
    }
}

export interface LivePlayerStats {
    matches: number;
    wins: number;
    winrate: number;
    kd: number;
    kda: number;
    loaded: boolean;
}

const EMPTY_STATS: LivePlayerStats = { matches: 0, wins: 0, winrate: 0, kd: 0, kda: 0, loaded: false };

/**
 * Fetch agent-specific stats for one player. Backed by an in-memory
 * cache on the backend, so subsequent calls for the same (puuid,
 * agent) pair return instantly. Returns `{ loaded: false }` on
 * failure so the caller can degrade silently.
 */
export async function getLivePlayerStats(puuid: string, agentId: string): Promise<LivePlayerStats> {
    if (!puuid || !agentId) return EMPTY_STATS;
    try {
        const url = `${LOCAL_URL}/live/player-stats?puuid=${encodeURIComponent(puuid)}&agent=${encodeURIComponent(agentId)}`;
        const response = await fetchWithAuth(url);
        if (!response.ok) return EMPTY_STATS;
        const data = await response.json();
        return {
            matches: Number(data?.matches) || 0,
            wins: Number(data?.wins) || 0,
            winrate: Number(data?.winrate) || 0,
            kd: Number(data?.kd) || 0,
            kda: Number(data?.kda) || 0,
            loaded: !!data?.loaded,
        };
    } catch {
        return EMPTY_STATS;
    }
}

export interface RiotMissionsResponse {
    Version: number;
    Subject: string;
    ActiveSpecialContract: string;
    Contracts: RiotContractProgress[];
    Missions: RiotMissionProgress[];
    MissionMetadata: {
        NPECompleted: boolean;
        WeeklyCheckpoint: string;
        WeeklyRefillTime: string;
    };
}

export interface RiotContractProgress {
    ContractDefinitionID: string;
    ContractProgression: Record<string, any>;
    ProgressionLevelReached: number;
    ProgressionTowardsNextLevel: number;
}

export interface RiotMissionProgress {
    ID: string;
    Objectives: Record<string, number>;
    Complete: boolean;
    ExpirationTime: string;
}

export async function getMissions(): Promise<RiotMissionsResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/missions', undefined, { forceRemoteAuth: true });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch player missions.');
    }
    return response.json();
}

export interface PlayerContractsResponse {
    version: number;
    subject: string;
    activeSpecialContract: string;
    contracts: {
        id: string;
        totalProgressionEarned: number;
        totalProgressionEarnedVersion: number;
        highestRewardedLevel: number;
        progressionLevelReached?: number;
        progressionTowardsNextLevel?: number;
    }[];
}

export async function getContracts(): Promise<PlayerContractsResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/contracts', undefined, { forceRemoteAuth: true });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch player contracts.');
    }
    return response.json();
}

export interface PartyStatusResponse {
    phase: "none" | "party" | "matchmaking" | "pregame" | "coregame" | "error";
    partyId?: string;
    queueId?: string;
    members?: PartyMember[];
    source?: "remote" | "local";
    error?: string;
}

export interface PartyMember {
    puuid: string;
    name: string;
    isLocal: boolean;
    isOwner: boolean;
    isReady: boolean;
    accountLevel: number;
    cardId: string;
    competitiveTier: number;
}

export async function getPartyStatus(): Promise<PartyStatusResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/party', undefined, { forceRemoteAuth: true });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { phase: "error", error: text || "Failed to fetch party status." };
        }
        return await response.json();
    } catch (err) {
        return { phase: "error", error: err instanceof Error ? err.message : String(err || "") };
    }
}

export interface LiveLoadoutsResponse {
    phase: "none" | "pregame" | "coregame" | "error";
    matchId?: string;
    source?: "remote" | "local";
    loadoutsValid?: boolean;
    players?: LiveLoadoutPlayer[];
    error?: string;
}

export interface LiveLoadoutPlayer {
    puuid?: string;
    skinIds?: string[];
    gunCount: number;
}

export async function getLiveLoadouts(): Promise<LiveLoadoutsResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/live-loadouts', undefined, { forceRemoteAuth: true });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { phase: "error", error: text || "Failed to fetch live loadouts." };
        }
        return await response.json();
    } catch (err) {
        return { phase: "error", error: err instanceof Error ? err.message : String(err || "") };
    }
}

export interface AccountHealthResponse {
    source?: "remote" | "local";
    services: Record<string, { status: string; detail?: string }>;
    penalties: { status: string; count: number; detail?: string };
    error?: string;
}

export async function getAccountHealth(): Promise<AccountHealthResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/account-health', undefined, { forceRemoteAuth: true });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { services: {}, penalties: { status: "unavailable", count: 0, detail: text || "Failed to fetch account health." } };
        }
        return await response.json();
    } catch (err) {
        return { services: {}, penalties: { status: "unavailable", count: 0, detail: err instanceof Error ? err.message : String(err || "") } };
    }
}

export interface SocialStatusResponse {
    status: "ok" | "unavailable";
    source?: "local";
    friendCount: number;
    onlineCount: number;
    inGameCount: number;
    presences?: {
        puuid?: string;
        name?: string;
        product?: string;
        state?: string;
        queueId?: string;
    }[];
    error?: string;
}

export async function getSocialStatus(): Promise<SocialStatusResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/social');
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { status: "unavailable", friendCount: 0, onlineCount: 0, inGameCount: 0, error: text || "Failed to fetch social status." };
        }
        return await response.json();
    } catch (err) {
        return { status: "unavailable", friendCount: 0, onlineCount: 0, inGameCount: 0, error: err instanceof Error ? err.message : String(err || "") };
    }
}
