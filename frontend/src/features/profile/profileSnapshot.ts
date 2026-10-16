import {
    getAccountXP, getAgentStats, getFrequentTeammates, getMapStats,
    getPlayedQueues, getProfileOverview, getProfileSeasonSummary,
    getProfileSyncStatus, getRRHistory, type AccountRequestScope, type ProfileOverview, type ProfileSyncStatus,
} from "../../services/api";

export function isProfileSyncReady(puuid: string, readyFor: string, syncing: boolean, status: Pick<ProfileSyncStatus, "inFlight"> | null, error: string) {
    return readyFor === puuid && !syncing && !status?.inFlight && !error;
}

/** Gather the visible profile before revealing it. Private account XP is never requested for another player. */
export async function loadProfileSnapshot(scope: AccountRequestScope, queue: string, seasonQueue: string, refreshLive: boolean, isOwnProfile: boolean, onIdentity?: (overview: ProfileOverview) => void) {
    const [overview, agents, maps, played, teammates, status, accountXP] = await Promise.all([
        getProfileOverview(scope, isOwnProfile && !refreshLive).then(overview => {
            onIdentity?.(overview);
            if (overview.rankError) throw new Error(`Couldn't load player rank: ${overview.rankError}`);
            return overview;
        }),
        getAgentStats(queue || undefined, scope).catch(() => null),
        getMapStats(queue || undefined, scope).catch(() => null),
        getPlayedQueues(scope).catch(() => null),
        getFrequentTeammates(scope).catch(() => null),
        getProfileSyncStatus(scope).catch(() => null),
        isOwnProfile ? getAccountXP().catch(() => null) : Promise.resolve(null),
    ]);
    const [rrHistory, season] = await Promise.all([
        getRRHistory(overview.currentSeasonId || undefined, scope).catch(() => null),
        getProfileSeasonSummary(seasonQueue, scope, overview.currentSeasonId).catch(() => null),
    ]);
    return {
        overview, agents, maps, played, teammates, status, accountXP, rrHistory,
        seasonSummary: season?.summary ?? overview.seasonSummary,
        unavailable: [!agents && "agent stats", !maps && "map stats", !rrHistory && "rank history"].filter((label): label is string => Boolean(label)),
    };
}
