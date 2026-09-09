import { Weapon, Agent, OwnedSkinsResponse, LoadoutItemV1, Preset, GunBuddy, ContentTier, OwnedGunBuddiesResponse, OwnedAgentsResponse, StorefrontResponse, BundleInfo, SprayAsset, PlayerCardAsset, PlayerTitleAsset, IdentityV1, SpraySlot, RiotAccount, ExpressionSlot, FlexAsset } from '@/lib/types';
import { AppRequestError, LocalClientError } from '@/lib/errors';
import { isAndroidRuntime } from '@/lib/platform';
import { fetchCacheFirstJson } from '@/lib/resourceCache';

export const LOCAL_URL = "http://localhost:31719/v1"
const PUBLIC_API_TIMEOUT_MS = 8000;
let activeRemoteAccount: {
    puuid: string;
    region: string;
} | null = null;
const requestWarningAt = new Map<string, number>();
const REQUEST_WARNING_WINDOW_MS = 30_000;
let lastAuthInvalidEventAt = 0;
const AUTH_INVALID_EVENT_WINDOW_MS = 2_000;
const AUTH_FAILURE_CODES = ["AUTH_REQUIRED", "MISSING_ENTITLEMENT", "BAD_CLAIMS"];

export function reportAppError(message: string) {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("vantavault:error", { detail: message }));
    }
}

function warnRequestFailure(error: unknown) {
    const requestError = error instanceof AppRequestError ? error : null;
    const code = requestError?.code || (error instanceof Error ? error.name : "UNKNOWN");
    const warningKey = AUTH_FAILURE_CODES.includes(code) ? "AUTH_RECOVERY" : code;
    const now = Date.now();
    if (now - (requestWarningAt.get(warningKey) || 0) < REQUEST_WARNING_WINDOW_MS) return;
    requestWarningAt.set(warningKey, now);
    console.warn("ValoVault request failed", {
        code,
        status: requestError?.status,
        message: requestError?.message || (error instanceof Error ? error.message : String(error)),
    });
}

export async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(LOCAL_URL)) return window.fetch(input, init);
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    const selectedPuuid = localStorage.getItem("riot_puuid")?.trim();
    const selectedRegion = localStorage.getItem("riot_region")?.trim();
    // Callers such as background account renewal deliberately target an
    // inactive account. Keep that explicit scope instead of overwriting it
    // with whichever account is selected in the UI.
    if (selectedPuuid && !headers.has("X-Riot-Selected-Puuid")) {
        headers.set("X-Riot-Selected-Puuid", selectedPuuid);
    }
    if (selectedRegion && !headers.has("X-Riot-Region")) {
        headers.set("X-Riot-Region", selectedRegion);
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const localUrl = new URL(url);
    const result = await invoke<{ status: number; contentType: string; body: string }>("backend_request", {
        path: `${localUrl.pathname}${localUrl.search}`,
        method: init?.method || (input instanceof Request ? input.method : "GET"),
        headers: Object.fromEntries(headers.entries()),
        body: typeof init?.body === "string" ? init.body : null,
    });
    if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return new Response(result.body, {
        status: result.status,
        headers: { "Content-Type": result.contentType },
    });
}

/**
 * Activate an account for this process. Only the non-secret PUUID and region
 * remain in localStorage; bearer credentials stay in memory. Used by the login card
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
    authSource?: "oauth" | "lockfile";
}) {
    if (isAndroidRuntime()) localStorage.setItem("use_local_sso", "false");
    localStorage.setItem("riot_puuid", account.puuid);
    localStorage.setItem("riot_region", account.region);
    localStorage.removeItem("riot_access_token");
    localStorage.removeItem("riot_entitlements");
    const expiresAt = account.expiresAt ?? 0;
    if (expiresAt > 0 && Date.now() >= expiresAt - 60_000 && account.authSource === "lockfile") {
        activeRemoteAccount = null;
    } else if (account.authSource !== "lockfile" || account.accessToken) {
        activeRemoteAccount = {
            puuid: account.puuid,
            region: account.region,
        };
    } else {
        // No tokens yet — likely a local-client-only account. Clear so the
        // storefront fetch doesn't send empty Bearer headers.
        activeRemoteAccount = null;
    }
}

export function clearActiveAccount() {
    activeRemoteAccount = null;
    localStorage.removeItem("riot_access_token");
    localStorage.removeItem("riot_entitlements");
}

export function hasActiveRemoteAuth() {
    return Boolean(activeRemoteAccount);
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = PUBLIC_API_TIMEOUT_MS): Promise<T> {
    try {
        return await fetchCacheFirstJson<T>(url, { timeoutMs, fetcher: appFetch });
    } catch (error) {
        reportAppError("Some game artwork and metadata could not be loaded. Check your connection and retry.");
        throw error;
    }
}

export function fetchCachedPublicJson<T>(url: string): Promise<T> {
    return fetchJsonWithTimeout<T>(url);
}

async function fetchWithAuth(
    url: string,
    init?: RequestInit,
    options: { forceRemoteAuth?: boolean } = {},
): Promise<Response> {
    const headers = new Headers(init?.headers || {});
    if (typeof window !== "undefined") {
        const android = isAndroidRuntime();
        if (options.forceRemoteAuth || android) {
            const selectedPuuid = localStorage.getItem("riot_puuid")?.trim();
            if (selectedPuuid) headers.set("X-Riot-Selected-Puuid", selectedPuuid);
        }
        // The selected account is authoritative. A global local-mode preference
        // must never make requests silently fall back to another Riot account.
        if (activeRemoteAccount) {
            headers.set("X-Riot-Selected-Puuid", activeRemoteAccount.puuid);
            headers.set("X-Riot-Region", activeRemoteAccount.region);
        }
    }
    return appFetch(url, { ...init, headers });
}

async function requestErrorFromResponse(
    response: Response,
    code: string,
    fallback: string,
): Promise<AppRequestError> {
    const raw = await response.text().catch(() => "");
    let serverMessage = "";
    let serverCode = "";
    try {
        const parsed = JSON.parse(raw) as { message?: string; error?: string; errorCode?: string; code?: string };
        serverMessage = parsed.message || parsed.error || "";
        serverCode = parsed.errorCode || parsed.code || "";
    } catch {
        serverMessage = raw;
    }
    const safeDetails = raw
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
        .replace(/eyJ[A-Za-z0-9._~-]+/g, "[token redacted]")
        .slice(0, 600);
    const authFailure = response.status === 401
        || response.status === 403
        || AUTH_FAILURE_CODES.includes(serverCode);
    if (
        typeof window !== "undefined"
        && authFailure
        && AUTH_FAILURE_CODES.includes(serverCode)
        && Date.now() - lastAuthInvalidEventAt >= AUTH_INVALID_EVENT_WINDOW_MS
    ) {
        lastAuthInvalidEventAt = Date.now();
        window.dispatchEvent(new CustomEvent("vantavault:riot-auth-invalid", {
            detail: { code: serverCode, status: response.status },
        }));
    }
    return new AppRequestError({
        message: authFailure
            ? "Your Riot session needs to be renewed before this data can load."
            : serverMessage || fallback,
        code: serverCode || `${code}-${response.status || "HTTP"}`,
        status: response.status,
        details: safeDetails || undefined,
        retryable: response.status !== 404,
    });
}

function clientRequestFailure(error: unknown, code: string, fallback: string): never {
    if (error instanceof AppRequestError) throw error;
    if (isAndroidRuntime() || hasActiveRemoteAuth()) {
        throw new AppRequestError({
            message: error instanceof Error && error.message ? error.message : fallback,
            code,
            details: error instanceof Error ? error.name : undefined,
        });
    }
    throw new LocalClientError();
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
        warnRequestFailure(error);
        return [];
    }
}

export async function getWeapons(): Promise<Weapon[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: Weapon[] }>('https://valorant-api.com/v1/weapons');
        return data.data as Weapon[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getGunBuddies(): Promise<GunBuddy[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: GunBuddy[] }>('https://valorant-api.com/v1/buddies');
        return data.data as GunBuddy[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getContentTiers(): Promise<ContentTier[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: ContentTier[] }>('https://valorant-api.com/v1/contenttiers');
        return data.data as ContentTier[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}


export type PlayerLoadoutData = {
    loadout: Record<string, LoadoutItemV1>;
    sprays: SpraySlot[];
    flexes: ExpressionSlot[];
    expressions: ExpressionSlot[];
    identity?: IdentityV1;
};

export async function getPlayerLoadoutData(): Promise<PlayerLoadoutData> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/player-loadout');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-LOADOUT", "Could not fetch your current loadout.");
        }
        const data = await response.json();
        const expressions = (data.expressions ?? []) as ExpressionSlot[];
        const [sprayCatalog, flexCatalog] = await Promise.all([getSprays(), getFlexes()]);
        const sprayIds = new Set(sprayCatalog.map((spray) => spray.uuid.toLowerCase()));
        const flexIds = new Set(flexCatalog.map((flex) => flex.uuid.toLowerCase()));
        return {
            loadout: (data.loadout ?? data) as Record<string, LoadoutItemV1>,
            sprays: ((data.sprays ?? []) as SpraySlot[])
                .filter((slot) => sprayIds.has(slot.sprayId.toLowerCase())),
            flexes: expressions.filter((expr) => flexIds.has(expr.assetId.toLowerCase())),
            expressions,
            identity: data.identity as IdentityV1 | undefined,
        };
    } catch (error) {
        clientRequestFailure(error, "VV-LOADOUT-NETWORK", "Could not reach the loadout service.");
    }
}

export async function getProfilePlayerCard(puuid: string, region: string): Promise<string> {
    const params = new URLSearchParams({ puuid, region });
    try {
        const response = await fetchWithAuth(
            `${LOCAL_URL}/profile/player-card?${params.toString()}`,
            undefined,
            { forceRemoteAuth: true },
        );
        if (!response.ok) return "";
        const data = await response.json() as { playerCardId?: unknown };
        return typeof data.playerCardId === "string" ? data.playerCardId : "";
    } catch {
        return "";
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
            throw await requestErrorFromResponse(response, "VV-SKINS", "Could not fetch owned skins.");
        }
        return await response.json();
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-SKINS-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getOwnedGunBuddies(): Promise<OwnedGunBuddiesResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/owned-gun-buddies');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-BUDDIES", "Could not fetch owned gun buddies.");
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
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-BUDDIES-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getOwnedAgents(): Promise<OwnedAgentsResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/owned-agents');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-AGENTS", "Could not fetch owned agents.");
        }
        return await response.json();
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-AGENTS-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getPresets(): Promise<Preset[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/presets');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-PRESETS", "Could not fetch presets.");
        }
        return await response.json();
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-PRESETS-NETWORK", "Could not reach the presets service.");
    }
}

export async function savePresets(presets: Preset[]): Promise<void> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/presets', {
            method: 'POST',
            body: JSON.stringify(presets),
        });
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-PRESETS-SAVE", "Could not save presets.");
        }
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-PRESETS-SAVE-NETWORK", "Could not reach the presets service.");
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

let accountSaveQueue: Promise<void> = Promise.resolve();

export function savePersistedAccounts(accounts: RiotAccount[]): Promise<void> {
    const snapshot = JSON.stringify(accounts.map((account) => ({
        ...account,
        accessToken: undefined,
        entitlementsToken: undefined,
        ssid: undefined,
    })));
    accountSaveQueue = accountSaveQueue.catch(() => undefined).then(async () => {
        const response = await appFetch(LOCAL_URL + '/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: snapshot,
        });
        if (!response.ok) {
            throw new Error(await response.text() || 'Failed to persist Riot accounts.');
        }
    });
    return accountSaveQueue;
}

export interface ApplyLoadoutRequest {
    loadout: Record<string, LoadoutItemV1>;
    identity?: IdentityV1;
    sprays?: SpraySlot[];
    flexes?: ExpressionSlot[];
    expressions?: ExpressionSlot[];
}

export async function applyLoadout(request: ApplyLoadoutRequest): Promise<void> {
    try {
        const response = await fetchWithAuth(LOCAL_URL+'/apply-loadout', {
            method: 'POST',
            body: JSON.stringify(request),
        });
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-LOADOUT-APPLY", "Could not apply the loadout.");
        }
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-LOADOUT-APPLY-NETWORK", "Could not reach the loadout service.");
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
    puuid: string;
    region: string;
    game_name: string;
    tag_line: string;
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
        throw await requestErrorFromResponse(response, "VV-STOREFRONT", "Could not fetch the storefront.");
    }
    return response.json();
}

export async function getWallet(): Promise<Record<string, number>> {
    const response = await fetchWithAuth(LOCAL_URL + '/wallet');
    if (!response.ok) {
        throw await requestErrorFromResponse(response, "VV-WALLET", "Could not fetch the wallet.");
    }
    const data = await response.json();
    return data.Balances || {};
}

export async function getBundles(): Promise<BundleInfo[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: BundleInfo[] }>('https://valorant-api.com/v1/bundles');
        return data.data as BundleInfo[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getOwnedSprays(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-sprays');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-SPRAYS", "Could not fetch owned sprays.");
        }
        const data = await response.json();
        return data.sprayIds || [];
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-SPRAYS-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getOwnedPlayerCards(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-cards');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-CARDS", "Could not fetch owned cards.");
        }
        const data = await response.json();
        return data.cardIds || [];
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-CARDS-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getOwnedPlayerTitles(): Promise<string[]> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/owned-titles');
        if (!response.ok) {
            throw await requestErrorFromResponse(response, "VV-TITLES", "Could not fetch owned titles.");
        }
        const data = await response.json();
        return data.titleIds || [];
    } catch (error) {
        warnRequestFailure(error);
        clientRequestFailure(error, "VV-TITLES-NETWORK", "Could not reach the inventory service.");
    }
}

export async function getSprays(): Promise<SprayAsset[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: SprayAsset[] }>('https://valorant-api.com/v1/sprays');
        return data.data as SprayAsset[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getPlayerCards(): Promise<PlayerCardAsset[]> {
    try {
        const load = () => fetchJsonWithTimeout<{ data: PlayerCardAsset[] }>('https://valorant-api.com/v1/playercards');
        const data = await load().catch(load);
        return data.data as PlayerCardAsset[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getPlayerTitles(): Promise<PlayerTitleAsset[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: PlayerTitleAsset[] }>('https://valorant-api.com/v1/playertitles');
        return data.data as PlayerTitleAsset[];
    } catch (error) {
        warnRequestFailure(error);
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
    Progress: { Level: number; XP: number };
    History: Array<{
        ID: string;
        MatchStart: string;
        StartProgress: { Level: number; XP: number };
        EndProgress: { Level: number; XP: number };
        XPDelta: number;
        XPSources: Array<{ ID: "time-played" | "match-win" | "first-win-of-the-day" | string; Amount: number }>;
        XPMultipliers: unknown[];
    }>;
    LastTimeGrantedFirstWin: string;
    NextTimeFirstWinAvailable: string;
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
    reachedAt?: number;
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
    performanceBonus: number;
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

export interface ProfileSeasonSummaryResponse {
    puuid: string;
    region: string;
    queue: string;
    seasonId: string;
    summary: ProfileSeasonSummary | null;
}

export interface ProfileOverview {
    puuid: string;
    region: string;
    gameName?: string;
    tagLine?: string;
    playerCardId?: string;
    playerTitleId?: string;
    currentSeasonId: string;
    currentRank: ProfileCurrentRank;
    peakRank: ProfilePeakRank;
    account: ProfileAccountSummary;
    lastDeltas: ProfileRRSnapshot[];
    rankActs: ProfileRankActSummary[];
    rankSource?: "live" | "cache";
    rankError?: string;
    seasonSummary: ProfileSeasonSummary | null;
}

export interface ProfileRRHistory {
    puuid: string;
    region: string;
    seasonId: string;
    source: "rr" | "tier";
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
    partyId?: string;
    gameName: string;
    tagLine: string;
    playerCardId?: string;
    playerTitleId?: string;
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
    playtimeMillis?: number;
    abilityCasts?: { grenade: number; ability1: number; ability2: number; ultimate: number };
    isLocal: boolean;
    competitiveTier: number;
    kd: number;
    kda: number;
    adr: number;
    acs: number;
    hsPct: number;
}

export interface ProfileMatchPartyMember {
    subject: string;
    gameName: string;
    tagLine: string;
    characterId: string;
    playerCardId?: string;
    playerTitleId?: string;
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
    blueRoundsWon: number;
    redRoundsWon: number;
    tierAfter: number;
    rrEarned: number;
    afkPenalty?: number;
    performanceBonus?: number;
    localPlayer: ProfilePlayerStats;
    partyMembers?: ProfileMatchPartyMember[];
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
    kills?: Array<{
        roundNum: number;
        gameTime: number;
        roundTime: number;
        killer: string;
        victim: string;
        victimX: number;
        victimY: number;
        damageType?: string;
        damageItem?: string;
        secondaryFire?: boolean;
        assistants?: string[];
        playerLocations?: Array<{
            subject?: string;
            viewRadians?: number;
            x: number;
            y: number;
        }>;
    }>;
    rounds?: Array<{
        roundNum: number;
        winningTeam: string;
        roundResult?: string;
        roundCeremony?: string;
        bombPlanter?: string;
        bombDefuser?: string;
        plantRoundTime?: number;
        plantSite?: string;
        defuseRoundTime?: number;
        plantLocation?: { x: number; y: number };
        defuseLocation?: { x: number; y: number };
        playerStats?: Array<{
            subject: string;
            score: number;
            damage?: Array<{ receiver: string; damage: number; legshots: number; bodyshots: number; headshots: number }>;
            economy: { loadoutValue: number; weapon?: string; armor?: string; remaining: number; spent: number };
            ability: { grenade: number; ability1: number; ability2: number; ultimate: number };
            wasAfk?: boolean;
            wasPenalized?: boolean;
            stayedInSpawn?: boolean;
        }>;
    }>;
    servedFrom: string;
}

export interface ProfileSyncStatus {
    puuid: string;
    lastSyncedAt: number;
    inFlight: boolean;
    totalMatches: number;
    errorKind?: "rate_limited";
    retryAt?: number;
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
    cacheOnly = false,
): Promise<ProfileOverview> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    if (cacheOnly) params.set("cacheOnly", "true");
    const qs = params.toString();
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/overview${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch profile overview.');
    }
    return response.json();
}

export async function getProfileSeasonSummary(
    queue: string,
    opts: { puuid?: string; region?: string } = {},
    seasonId?: string,
): Promise<ProfileSeasonSummaryResponse> {
    const params = new URLSearchParams({ queue });
    if (seasonId) params.set("seasonId", seasonId);
    appendProfileParams(params, opts);
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/season-summary?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to fetch season summary.");
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
    seasonId?: string,
): Promise<ProfileMatchHistoryResponse> {
    const params = new URLSearchParams({
        startIndex: String(startIndex),
        endIndex: String(endIndex),
    });
    if (queue) params.set("queue", queue);
    if (seasonId) params.set("seasonId", seasonId);
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
    opts: { puuid?: string; region?: string; analytics?: boolean } = {},
): Promise<ProfileMatchDetails> {
    const params = new URLSearchParams();
    appendProfileParams(params, opts);
    if (opts.analytics) params.set("analytics", "true");
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
    modeId?: string;
    allyScore?: number;
    enemyScore?: number;
    scoreAvailable?: boolean;
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
    rankedRating?: number;
    peakTier?: number;
    /** Opaque grouping only; raw Riot party IDs are never returned. */
    partyGroup?: string;
    /** Prior shared-party evidence from cached completed matches, never a live-party claim. */
    historyPartyGroup?: string;
    historyPartyMatches?: number;
    historyPartyLastSeenAt?: number;
    cachedEvidence?: {
        puuid: string;
        agentId?: string;
        latestTier?: number;
        peakTier?: number;
        matches?: number;
        wins?: number;
        winrate?: number;
        kills?: number;
        deaths?: number;
        assists?: number;
        kd?: number;
        kda?: number;
        lastMatchAt?: number;
        cacheUpdatedAt?: number;
    };
    teamId?: string;
}

async function requestLiveMatchAction(path: string, fallback: string): Promise<LiveMatchResponse> {
    try {
        const response = await fetchWithAuth(LOCAL_URL + path, { method: "POST" });
        if (!response.ok) {
            const message = await response.text().catch(() => "");
            return { phase: "none", matchId: "", mapId: "", queueId: "", timeLeft: 0, error: message || fallback };
        }
        return await response.json();
    } catch (error) {
        return { phase: "none", matchId: "", mapId: "", queueId: "", timeLeft: 0, error: error instanceof Error ? error.message : fallback };
    }
}

export function refreshLiveMatchRanks(): Promise<LiveMatchResponse> {
    return requestLiveMatchAction("/livematch/ranks", "Could not refresh live ranks.");
}

export function scanLiveMatchLikelyStacks(): Promise<LiveMatchResponse> {
    return requestLiveMatchAction("/livematch/likely-stacks", "Could not recheck cached parties.");
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

export interface ProfileLeaderboardPlayer {
    PlayerCardID?: string;
    puuid: string;
    gameName: string;
    tagLine: string;
    leaderboardRank: number;
    rankedRating: number;
    numberOfWins: number;
    competitiveTier: number;
    IsAnonymized?: boolean;
}

export interface ProfileLeaderboard {
    SeasonID: string;
    Players: ProfileLeaderboardPlayer[];
    totalPlayers: number;
}

export async function getProfileLeaderboard(seasonId?: string, query = "", startIndex = 0, size = 25): Promise<ProfileLeaderboard> {
    const params = new URLSearchParams({ startIndex: String(startIndex), size: String(size) });
    if (seasonId) params.set("seasonId", seasonId);
    if (query.trim()) params.set("query", query.trim());
    const response = await fetchWithAuth(`${LOCAL_URL}/profile/leaderboard?${params.toString()}`);
    if (!response.ok) throw new Error(await response.text() || "Failed to fetch leaderboard.");
    return response.json();
}

export interface RiotMissionsResponse {
    Version: number;
    Subject: string;
    ActiveSpecialContract: string;
    Contracts: RiotContractProgress[];
    Missions: RiotMissionProgress[];
    ProcessedMatches: RiotProcessedContractMatch[];
    MissionMetadata: {
        NPECompleted: boolean;
        WeeklyCheckpoint: string;
        WeeklyRefillTime: string;
    };
}

export interface RiotContractProgress {
    ContractDefinitionID: string;
    ContractProgression: Record<string, unknown>;
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
    const response = await fetchWithAuth(LOCAL_URL + '/missions');
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
    queueStartedAt?: number;
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
    items?: LiveLoadoutItem[];
    gunCount: number;
}

export interface LiveLoadoutItem {
    weaponId: string;
    itemIds?: string[];
}

export async function getLiveLoadouts(phase?: "pregame" | "coregame", matchId?: string): Promise<LiveLoadoutsResponse> {
    try {
        const params = new URLSearchParams();
        if (phase) params.set("phase", phase);
        if (matchId) params.set("matchId", matchId);
        const response = await fetchWithAuth(`${LOCAL_URL}/live-loadouts${params.size ? `?${params}` : ""}`, undefined, { forceRemoteAuth: true });
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
    source?: "local" | "remote";
    remoteStatus?: "missing" | "config" | "connecting" | "live" | "error";
    remoteChatHost?: string;
    remoteChatPort?: number;
    friendCount: number;
    onlineCount: number;
    inGameCount: number;
    selfPresence?: SocialPresence;
    presences?: SocialPresence[];
    requests?: SocialFriendRequest[];
    activity?: SocialActivityEvent[];
    formerContacts?: SocialFormerContact[];
    error?: string;
}

export interface SocialFriendRequest {
    puuid: string;
    name: string;
    direction: "incoming" | "outgoing";
    firstSeenAt?: number;
}

export interface SocialActivityEvent {
    id: number;
    peerPuuid: string;
    name: string;
    type: "friend_first_observed" | "friend_added" | "friend_readded" | "friendship_ended" | "request_received" | "request_sent" | "request_cancelled" | "request_accepted_by_you" | "request_accepted_by_them" | "request_closed_unknown";
    occurredAt: number;
    evidence: string;
}

export interface SocialFormerContact {
    puuid: string;
    name: string;
    lastSeenAt: number;
}

export interface SocialPresence {
    puuid?: string;
    name?: string;
    product?: string;
    state?: string;
    availability?: string;
    queueId?: string;
    partyState?: string;
    partySize?: number;
    maxPartySize?: number;
    cardId?: string;
    platform?: string;
    partyGroup?: string;
    queueStartedAt?: number;
    mapId?: string;
    competitiveTier?: number;
    allyScore?: number;
    enemyScore?: number;
    scoreAvailable?: boolean;
}

export interface DailyTicketResponse {
    RemainingLifetimeSeconds: number;
    BonusMilestonesPending?: number;
    Milestones: Array<{ Progress: number; BonusApplied: boolean }>;
}

export async function getDailyTicket(): Promise<DailyTicketResponse> {
    const response = await fetchWithAuth(LOCAL_URL + '/daily-ticket');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch daily checkpoints.');
    }
    return response.json();
}

export interface ItemUpgradeDefinition {
    ID: string;
    Item: { ItemTypeID: string; ItemID: string };
    RequiredEntitlement: { ItemTypeID: string; ItemID: string };
    ProgressionSchedule: { Name: string; ProgressionCurrencyID: string; ProgressionDeltaPerLevel: number[] | null };
    RewardSchedule: {
        ID: string; Name: string;
        RewardsPerLevel: Array<{ EntitlementRewards: Array<{ Amount: number; ItemTypeID: string; ItemID: string }> }> | null;
    };
}

export async function getItemUpgrades(): Promise<ItemUpgradeDefinition[]> {
    const response = await fetchWithAuth(LOCAL_URL + '/item-upgrades');
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to fetch Agent Gear definitions.');
    }
    const data = await response.json() as { Definitions?: ItemUpgradeDefinition[] };
    return data.Definitions || [];
}

export async function subscribeProgressionEvents(onProgression: () => void, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
        await waitForEventRetry(60_000, signal);
        if (!signal.aborted) onProgression();
    }
}

export interface RiotProcessedContractMatch {
    ID: string;
    StartTime: number;
    XPGrants: null | {
        GamePlayed: number; GameWon: number; RoundPlayed: number; RoundWon: number;
        Missions: Record<string, number>;
        Modifier: { Value: number; BaseMultiplierValue: number; Modifiers: Array<{ Value: number; Name: string; BaseOnly: boolean }> };
        NumAFKRounds: number;
    };
    MissionDeltas: null | Record<string, { ID: string; Objectives: Record<string, number>; ObjectiveDeltas: Record<string, { ID: string; ProgressBefore: number; ProgressAfter: number }> }>;
    ContractDeltas: null | Record<string, { ID: string; TotalXPBefore: number; TotalXPAfter: number }>;
    CouldProgressMissions: boolean;
}

export async function getFlexes(): Promise<FlexAsset[]> {
    try {
        const data = await fetchJsonWithTimeout<{ data: FlexAsset[] }>('https://valorant-api.com/v1/flex');
        return data.data as FlexAsset[];
    } catch (error) {
        warnRequestFailure(error);
        return [];
    }
}

export async function getSocialStatus(): Promise<SocialStatusResponse> {
    try {
        // Supply remote credentials, but let the backend use the local Riot
        // Client as a same-account fallback when token XMPP is temporarily down.
        const response = await fetchWithAuth(LOCAL_URL + "/social", undefined, { forceRemoteAuth: true });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return { status: "unavailable", friendCount: 0, onlineCount: 0, inGameCount: 0, error: text || "Failed to fetch social status." };
        }
        return await response.json();
    } catch (err) {
        return { status: "unavailable", friendCount: 0, onlineCount: 0, inGameCount: 0, error: err instanceof Error ? err.message : String(err || "") };
    }
}

function waitForEventRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = window.setTimeout(done, delayMs);
        function done() {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
        }
        signal.addEventListener('abort', done, { once: true });
    });
}

async function subscribeEventStream(path: string, eventNames: ReadonlySet<string>, onEvent: () => void, signal: AbortSignal): Promise<void> {
    void path;
    void eventNames;
    while (!signal.aborted) {
        await waitForEventRetry(15_000, signal);
        if (!signal.aborted) onEvent();
    }
}

export async function subscribeSocialEvents(onSocial: () => void, signal: AbortSignal): Promise<void> {
    return subscribeEventStream('/social/events', new Set(['ready', 'social']), onSocial, signal);
}

export async function actOnSocialRequest(puuid: string, action: "accept" | "deny" | "cancel" | "send"): Promise<{ status: "confirmed" | "pending"; confirmed: boolean }> {
    const response = await fetchWithAuth(`${LOCAL_URL}/social/requests/${encodeURIComponent(puuid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
    }, { forceRemoteAuth: true });
    if (!response.ok) throw new Error(await response.text() || "Riot friend request action failed.");
    return response.json();
}

export async function sendSocialFriendRequest(gameName: string, gameTag: string): Promise<{ status: "confirmed" | "pending"; confirmed: boolean }> {
    const response = await fetchWithAuth(`${LOCAL_URL}/social/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameName, gameTag }),
    }, { forceRemoteAuth: true });
    if (!response.ok) throw new Error(await response.text() || "Riot friend request failed.");
    return response.json();
}

export interface ChatCapabilities { history: boolean; directMessages: boolean; party: boolean }
export interface ChatMessage {
    id: string; clientId?: string; conversationKey: string; senderPuuid?: string; senderName?: string;
	body: string; direction: "incoming" | "outgoing"; status: "pending" | "sent" | "failed"; timestamp: number; error?: string;
}
export interface ChatArchiveDiagnostic {
    requestId: string; responseType: string; errorCode?: string; errorText?: string;
    messageCount: number; messageShapes?: string[];
}
export interface ChatMessagesResponse { messages: ChatMessage[]; archiveDiagnostic?: ChatArchiveDiagnostic; snapshotState?: string }
export interface ChatConversation {
    key: string; type: "dm" | "party"; displayName: string; peerPuuid?: string; source: "local" | "remote" | "archive";
    state: string; participants?: Array<{ puuid: string; displayName: string }>; latestMessage?: ChatMessage;
    unreadCount: number; capabilities: ChatCapabilities;
}

export async function getChatConversations(): Promise<{ conversations: ChatConversation[]; source: string }> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PUBLIC_API_TIMEOUT_MS);
    try {
        const response = await fetchWithAuth(LOCAL_URL + '/chat/conversations', { signal: controller.signal }, { forceRemoteAuth: true });
        if (!response.ok) throw new Error(await response.text() || 'Chat is unavailable.');
        return response.json();
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Chat request timed out. Saved messages are still available.');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function getChatSummary(): Promise<{ conversations: ChatConversation[]; unreadCount: number }> {
    const response = await fetchWithAuth(LOCAL_URL + '/chat/summary', undefined, { forceRemoteAuth: true });
    if (!response.ok) throw new Error(await response.text() || 'Chat summary is unavailable.');
    return response.json();
}

function encodedChatKey(key: string) { return btoa(key).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }

export async function getChatMessages(key: string, before?: number): Promise<ChatMessagesResponse> {
    const query = before ? `?before=${before}&limit=50` : '?limit=50';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PUBLIC_API_TIMEOUT_MS);
    try {
        const response = await fetchWithAuth(`${LOCAL_URL}/chat/conversations/${encodedChatKey(key)}/messages${query}`, { signal: controller.signal }, { forceRemoteAuth: true });
        if (!response.ok) throw new Error(await response.text() || 'Messages are unavailable.');
        const data = (await response.json()) as Partial<ChatMessagesResponse>;
        return { messages: data.messages || [], archiveDiagnostic: data.archiveDiagnostic, snapshotState: data.snapshotState };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Message request timed out. Keeping saved messages.');
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function requestChatSnapshot(key: string, retry = false): Promise<{ snapshotState: string }> {
    const response = await fetchWithAuth(`${LOCAL_URL}/chat/conversations/${encodedChatKey(key)}/snapshot${retry ? '?retry=1' : ''}`, { method: 'POST' }, { forceRemoteAuth: true });
    if (!response.ok) throw new Error(await response.text() || 'Could not start this conversation history request.');
    return response.json();
}

export async function sendChatMessage(conversationKey: string, body: string, clientId: string): Promise<ChatMessage> {
    const response = await fetchWithAuth(LOCAL_URL + '/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationKey, body, clientId }) }, { forceRemoteAuth: true });
    const message = await response.json() as ChatMessage;
	if (!response.ok) throw Object.assign(new Error(message.error || 'Message failed to send.'), { messageRecord: message });
    return message;
}

export async function markChatRead(key: string): Promise<void> {
    await fetchWithAuth(`${LOCAL_URL}/chat/conversations/${encodedChatKey(key)}/read`, { method: 'POST' }, { forceRemoteAuth: true });
}

export async function clearChatHistory(conversationKey?: string, accountPuuid?: string): Promise<void> {
    const query = new URLSearchParams();
    if (conversationKey) query.set('conversationKey', encodedChatKey(conversationKey));
    if (accountPuuid) query.set('accountPuuid', accountPuuid);
    const response = await fetchWithAuth(`${LOCAL_URL}/chat/history${query.size ? `?${query}` : ''}`, { method: 'DELETE' }, { forceRemoteAuth: true });
    if (!response.ok) throw new Error(await response.text() || 'Could not clear chat history.');
}

export async function subscribeChatEvents(onChat: () => void, signal: AbortSignal): Promise<void> {
    return subscribeEventStream('/chat/events', new Set(['ready', 'chat']), onChat, signal);
}
