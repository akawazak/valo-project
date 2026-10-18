"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import ProfileLoading from "./ProfileLoading";
import { isProfileSyncReady, loadProfileSnapshot } from "./profileSnapshot";
import { useData } from "@/context/DataContext";
import { type AccountXPResponse, type ProfileTeammateStat, type ProfileQueueStat, getProfileMatchDetails, getProfileMatchHistory, getProfileSeasonSummary, getProfileSyncStatus, postProfileSync, fetchCachedPublicJson, type ProfileAgentStatsResponse, type ProfileMapStatsResponse, type ProfileMatchDetails, type ProfileMatchSummary, type ProfileOverview, type ProfileRRHistory, type ProfileSeasonSummary, type ProfileSyncStatus } from "@/services/api";
import { matchModeLabel, useGameModes, useQueues } from "@/lib/gameMeta";
import RRHistoryChart from "./RRHistoryChart";
import ProfileBadges from "./ProfileBadges";
import ProfileExtras, { type CareerView, type ProgressionSection } from "./ProfileExtras";
import DuoChemistry from "./DuoChemistry";
import { matchOutcome } from "./reviewStats";
import { OPEN_RECAP_FLAG } from "@/features/session/SessionEndToast";
import { FEATURE_FLAGS } from "@/lib/features";
import s from "./ProfilePanel.module.css";
import { type AgentMeta, type PublicAgent, type PublicMap, type PublicTierSet, type PublicSeason, type MapMeta, type SeasonMeta, RANK_COLORS, PAGE_SIZES, SEASON_QUEUES, FALLBACK_RANK_ICON, tierLabel, rankIconUrl, orderCandidates, seasonLabel, fmtPct, fmtRatio, isRecent, fmtAgo, dayStart, dayHeadline, dayAgo, kdColor, hsColor, cleanError } from "./profileShared";
import { MatchRow } from "./MatchRow";

export { RoundReview } from "./RoundReview";
export { MatchMapAnalytics } from "./MatchMap";

interface Props {
    onConnectAccount?: () => void;
    ownPlayerCardId?: string;
    requestedProfile?: { puuid: string; gameName: string; tagLine: string } | null;
    onRequestedProfileChange: (profile: { puuid: string; gameName: string; tagLine: string } | null) => void;
    autoSyncMatches: boolean;
}

let agentCache: Record<string, AgentMeta> | null = null;
let mapCache: Record<string, MapMeta> | null = null;
let tierAssetCache: Map<number, { smallIcon: string }> | null = null;
let agentPromise: Promise<Record<string, AgentMeta>> | null = null;
let mapPromise: Promise<Record<string, MapMeta>> | null = null;
let tierPromise: Promise<Map<number, { smallIcon: string }>> | null = null;
interface CachedProfileSnapshot {
    overview: ProfileOverview;
    seasonSummary: ProfileSeasonSummary | null;
    rrHistory: ProfileRRHistory | null;
    history: ProfileMatchSummary[];
    total: number;
    agentStats: ProfileAgentStatsResponse | null;
    mapStats: ProfileMapStatsResponse | null;
    syncStatus: ProfileSyncStatus | null;
    identity: { playerCardId: string; playerTitleId: string } | null;
    accountXP: AccountXPResponse | null;
    playedQueues: ProfileQueueStat[];
    teammates: ProfileTeammateStat[];
    queue: string;
    seasonQueue: string;
}
const profileSnapshotCache = new Map<string, CachedProfileSnapshot>();
async function loadAgentMap(): Promise<Record<string, AgentMeta>> {
    if (agentCache) return agentCache;
    if (agentPromise) return agentPromise;
    agentPromise = (async () => {
        try {
            // Unfiltered so Gauntlet's non-playable draft agent resolves; other
            // non-playable entries (duplicates, test agents) are skipped.
            const d = await fetchCachedPublicJson<{ data?: PublicAgent[] }>("https://valorant-api.com/v1/agents");
            const m: Record<string, AgentMeta> = {};
            for (const a of d?.data ?? []) {
                if (!a.uuid) continue;
                const draftAgent = a.developerName === "AbilityDraftAgent";
                if (a.isPlayableCharacter === false && !draftAgent) continue;
                m[a.uuid.toLowerCase()] = {
                    name: draftAgent ? "Draft agent" : a.displayName,
                    icon: a.displayIcon || a.killfeedPortrait || "",
                    full: a.fullPortrait || "",
                    role: draftAgent ? "" : a.role?.displayName || "Unknown",
                    roleIcon: a.role?.displayIcon || "",
                    abilities: Object.fromEntries((a.abilities || []).flatMap((ability) => {
                        const slot = ability.slot?.trim().toLowerCase();
                        return slot ? [[slot, { name: ability.displayName || ability.slot || "Ability", icon: ability.displayIcon || "" }]] : [];
                    })),
                };
            }
            agentCache = m;
            return m;
        } catch (e) {
            console.warn("Failed to load agents", e);
            agentCache = {};
            return agentCache;
        } finally {
            agentPromise = null;
        }
    })();
    return agentPromise;
}

async function loadMaps(): Promise<Record<string, MapMeta>> {
    if (mapCache) return mapCache;
    if (mapPromise) return mapPromise;
    mapPromise = (async () => {
        try {
            const d = await fetchCachedPublicJson<{ data?: PublicMap[] }>("https://valorant-api.com/v1/maps");
            const m: Record<string, MapMeta> = {};
            for (const mp of d?.data ?? []) {
                if (!mp.uuid) continue;
                const assetPath = String(mp.assetPath || "");
                const mode: MapMeta["mode"] = /\/Maps\/HURM\//i.test(assetPath)
                    ? "teamdeathmatch"
                    : /\/Maps\/(?:Duel|NPEV2|Poveglia(?:V2)?)\//i.test(assetPath)
                      ? "other"
                      : "standard";
                const meta: MapMeta = {
                    uuid: mp.uuid,
                    name: mp.displayName,
                    splash: mp.splash || "",
                    displayIcon: mp.displayIcon || "",
                    mode,
                    xMultiplier: mp.xMultiplier,
                    yMultiplier: mp.yMultiplier,
                    xScalarToAdd: mp.xScalarToAdd,
                    yScalarToAdd: mp.yScalarToAdd,
                    callouts: (mp.callouts || []).flatMap((callout) => {
                        const x = callout.location?.x;
                        const y = callout.location?.y;
                        return typeof x === "number" && typeof y === "number"
                            ? [{ name: callout.regionName || "Unknown", superRegion: callout.superRegionName || "", x, y }]
                            : [];
                    }),
                };
                m[mp.uuid.toLowerCase()] = meta;
                if (mp.mapUrl) m[mp.mapUrl.toLowerCase()] = meta;
            }
            mapCache = m;
            return m;
        } catch (e) {
            console.warn("Failed to load maps", e);
            mapCache = {};
            return mapCache;
        } finally {
            mapPromise = null;
        }
    })();
    return mapPromise;
}

async function loadTierAssets(): Promise<Map<number, { smallIcon: string }>> {
    if (tierAssetCache) return tierAssetCache;
    if (tierPromise) return tierPromise;
    tierPromise = (async () => {
        try {
            const d = await fetchCachedPublicJson<{ data?: PublicTierSet[] }>("https://valorant-api.com/v1/competitivetiers");
            const m = new Map<number, { smallIcon: string }>();
            for (const season of d?.data ?? []) {
                for (const tier of season?.tiers ?? []) {
                    if (typeof tier.tier === "number" && tier.smallIcon) {
                        m.set(tier.tier, { smallIcon: tier.smallIcon });
                    }
                }
            }
            tierAssetCache = m;
            return m;
        } catch (e) {
            console.warn("Failed to load competitive tiers metadata", e);
            tierAssetCache = new Map();
            return tierAssetCache;
        } finally {
            tierPromise = null;
        }
    })();
    return tierPromise;
}

export default function ProfilePanel({ onConnectAccount, ownPlayerCardId, requestedProfile, onRequestedProfileChange, autoSyncMatches }: Props) {
    const { activeAccount, playerCards: playerCardAssets, playerTitles: playerTitleAssets, weapons, allBuddies, sprays, flexes, allAgents: agentAssets, ownedAgentIDs, ownedLevelIDs, ownedBuddyIDs, ownedSprayIDs, ownedCardIDs, ownedTitleIDs } = useData();
    const ownPuuid = activeAccount?.puuid ?? "";
    const viewedProfile = requestedProfile?.puuid && requestedProfile.puuid !== ownPuuid ? requestedProfile : null;
    const puuid = viewedProfile?.puuid || ownPuuid;
    const region = activeAccount?.region ?? "na";

    const [overview, setOverview] = useState<ProfileOverview | null>(null);
    const [seasonSummary, setSeasonSummary] = useState<ProfileSeasonSummary | null>(null);
    const [seasonQueue, setSeasonQueue] = useState("competitive");
    const [rrHistory, setRRHistory] = useState<ProfileRRHistory | null>(null);
    const [history, setHistory] = useState<ProfileMatchSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const [queue, setQueue] = useState("");
    const [playedQueues, setPlayedQueues] = useState<ProfileQueueStat[]>([]);
    const [teammates, setTeammates] = useState<{ puuid: string; list: ProfileTeammateStat[] }>({ puuid: "", list: [] });
    const [matesOpen, setMatesOpen] = useState(false);
    // Account XP is only available for the signed-in account, so it is never shown on other profiles.
    const [accountXP, setAccountXP] = useState<{ puuid: string; data: AccountXPResponse } | null>(null);
    const gameModes = useGameModes();
    const queueNames = useQueues();
    const queueOptions = useMemo(() => {
        const options = playedQueues.map((entry) => ({
            value: entry.queueID,
            label: matchModeLabel(gameModes, entry.queueID, entry.gameMode, queueNames),
        }));
        if (queue && !options.some((option) => option.value === queue)) {
            options.push({ value: queue, label: matchModeLabel(gameModes, queue, "", queueNames) });
        }
        return options;
    }, [gameModes, playedQueues, queue, queueNames]);
    const [agentStats, setAgentStats] = useState<ProfileAgentStatsResponse | null>(null);
    const [mapStats, setMapStats] = useState<ProfileMapStatsResponse | null>(null);
    const [performanceView, setPerformanceView] = useState<"agents" | "maps">("agents");
    const [careerView, setCareerView] = useState<CareerView | null>(null);
    const [progressionSection, setProgressionSection] = useState<ProgressionSection>("missions");
    const [compareTarget, setCompareTarget] = useState("");
    const [duosOpen, setDuosOpen] = useState(false);
    // Match the match-history day button opened Session recap from, so the recap starts on that day.
    const [recapFocus, setRecapFocus] = useState("");
    const openProgression = (section: ProgressionSection) => { setProgressionSection(section); setCareerView("progression"); };
    // The app shell asks for a recap after a play session ends (SessionEndToast).
    useEffect(() => {
        const open = () => {
            try { sessionStorage.removeItem(OPEN_RECAP_FLAG); } catch { /* storage unavailable */ }
            setRecapFocus("");
            setCareerView("sessions");
        };
        try { if (sessionStorage.getItem(OPEN_RECAP_FLAG)) open(); } catch { /* storage unavailable */ }
        window.addEventListener("vv:open-session-recap", open);
        return () => window.removeEventListener("vv:open-session-recap", open);
    }, []);
    const [agentRole, setAgentRole] = useState("Duelist");
    const [mapMode, setMapMode] = useState("Standard maps");
    const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
    const [details, setDetails] = useState<Record<string, ProfileMatchDetails>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
    const [agents, setAgents] = useState<Record<string, AgentMeta>>({});
    const [maps, setMaps] = useState<Record<string, MapMeta>>({});
    const [tierAssets, setTierAssets] = useState<Map<number, { smallIcon: string }>>(new Map());
    const [seasons, setSeasons] = useState<Record<string, SeasonMeta>>({});
    const [profileAssetsReady, setProfileAssetsReady] = useState(false);
    const [profileArtReadyFor, setProfileArtReadyFor] = useState("");
    const [loading, setLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [overviewLoadedFor, setOverviewLoadedFor] = useState("");
    const [identityLoadedFor, setIdentityLoadedFor] = useState("");
    const [historyLoadedFor, setHistoryLoadedFor] = useState("");
    const [committedProfilePuuid, setCommittedProfilePuuid] = useState("");
    const [initialSyncReadyFor, setInitialSyncReadyFor] = useState("");
    const [initialSyncError, setInitialSyncError] = useState("");
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const [rateLimitUntil, setRateLimitUntil] = useState(0);
    const [rateLimitNow, setRateLimitNow] = useState(0);
    const [identity, setIdentity] = useState<{ playerCardId: string; playerTitleId: string } | null>(null);
    const playerCards = useMemo(() => Object.fromEntries(playerCardAssets.map((card) => [card.uuid.toLowerCase(), {
        wide: card.wideArt || "",
        icon: card.displayIcon || "",
        portrait: card.largeArt || card.displayIcon || "",
        name: card.displayName || "",
    }])), [playerCardAssets]);
    const playerCardImages = useMemo(() => Object.fromEntries(playerCardAssets.map((card) => [card.uuid.toLowerCase(), card.wideArt || card.displayIcon || ""])), [playerCardAssets]);
    const rewardAssets = useMemo(() => {
        const assets: Record<string, { name: string; image: string; hero?: string; type: string; owned: boolean }> = {};
        const ownedLevels = new Set(ownedLevelIDs.map((id) => id.toLowerCase()));
        const ownedBuddies = new Set(ownedBuddyIDs.map((item) => item.levelId.toLowerCase()));
        const ownedSprays = new Set(ownedSprayIDs.map((id) => id.toLowerCase()));
        const ownedCards = new Set(ownedCardIDs.map((id) => id.toLowerCase()));
        const ownedTitles = new Set(ownedTitleIDs.map((id) => id.toLowerCase()));
        const ownedAgents = new Set(ownedAgentIDs.map((id) => id.toLowerCase()));
        playerCardAssets.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.displayName, image: item.displayIcon || item.smallArt, hero: item.largeArt, type: "Player Card", owned: ownedCards.has(item.uuid.toLowerCase()) }; });
        playerTitleAssets.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.titleText || item.displayName, image: "", type: "Title", owned: ownedTitles.has(item.uuid.toLowerCase()) }; });
        sprays.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.displayName, image: item.fullTransparentIcon || item.fullIcon || item.displayIcon, type: "Spray", owned: ownedSprays.has(item.uuid.toLowerCase()) }; });
        flexes.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.displayName, image: item.displayIcon, type: "Flex", owned: false }; });
        agentAssets.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.displayName, image: item.displayIcon, type: "Agent", owned: ownedAgents.has(item.uuid.toLowerCase()) || item.isBaseContent }; });
        allBuddies.forEach((buddy) => { const owned = buddy.levels.some((level) => ownedBuddies.has(level.uuid.toLowerCase())); assets[buddy.uuid.toLowerCase()] = { name: buddy.displayName, image: buddy.levels[0]?.displayIcon || "", type: "Gun Buddy", owned }; buddy.levels.forEach((level) => { assets[level.uuid.toLowerCase()] = { name: buddy.displayName, image: level.displayIcon, type: "Gun Buddy", owned: ownedBuddies.has(level.uuid.toLowerCase()) }; }); });
        weapons.forEach((weapon) => weapon.skins.forEach((skin) => { const owned = skin.levels.some((level) => ownedLevels.has(level.uuid.toLowerCase())); assets[skin.uuid.toLowerCase()] = { name: skin.displayName, image: skin.displayIcon, type: "Weapon Skin", owned }; skin.levels.forEach((level) => { assets[level.uuid.toLowerCase()] = { name: skin.displayName, image: level.displayIcon || skin.displayIcon, type: "Weapon Skin", owned: ownedLevels.has(level.uuid.toLowerCase()) }; }); }));
        return assets;
    }, [agentAssets, allBuddies, flexes, ownedAgentIDs, ownedBuddyIDs, ownedCardIDs, ownedLevelIDs, ownedSprayIDs, ownedTitleIDs, playerCardAssets, playerTitleAssets, sprays, weapons]);
    const playerTitles = useMemo(() => Object.fromEntries(playerTitleAssets.map((title) => [
        title.uuid.toLowerCase(),
        title.titleText || title.displayName || "",
    ])), [playerTitleAssets]);

    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const profileStageRef = useRef<HTMLDivElement | null>(null);
    const autoSyncPuuidRef = useRef("");
    const historyRequestRef = useRef(0);
    const refreshRequestRef = useRef(0);
    const seasonSummaryKeyRef = useRef("");
    const seasonQueueRef = useRef(seasonQueue);
    seasonQueueRef.current = seasonQueue;
    const queueRef = useRef(queue);
    queueRef.current = queue;
    const loadedOverviewQueueRef = useRef("");
    const loadedHistoryQueueRef = useRef("");
    const currentPuuidRef = useRef(puuid);
    currentPuuidRef.current = puuid;
    useEffect(() => {
        currentPuuidRef.current = puuid;
        return () => { currentPuuidRef.current = ""; };
    }, [puuid]);
    const viewProfile = useCallback((profile: { puuid: string; gameName: string; tagLine: string }) => {
        onRequestedProfileChange(profile.puuid === ownPuuid ? null : profile);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [onRequestedProfileChange, ownPuuid]);

    useEffect(() => {
        let cancelled = false;
        let pendingAssets = 2;
        const assetsSettled = () => {
            pendingAssets -= 1;
            if (!cancelled && pendingAssets === 0) setProfileAssetsReady(true);
        };
        Promise.all([loadAgentMap(), loadMaps(), loadTierAssets()]).then(([agentMap, mapMap, tiers]) => {
            if (cancelled) return;
            setAgents(agentMap);
            setMaps(mapMap);
            setTierAssets(tiers);
        }).finally(assetsSettled);
fetchCachedPublicJson<{ data?: PublicSeason[] }>("https://valorant-api.com/v1/seasons")
            .then((d) => {
                if (cancelled) return;
                const next: Record<string, SeasonMeta> = {};
                // Build short-code aliases from `assetPath`
                // (e.g. `Season_Episode7_Act3_DataAsset` → `e7a3`) so the
                // UI can resolve Riot's compact SeasonID even when the
                // backend hasn't normalised it (older builds, cached rows,
                // locally-sourced data).
                const shortRe = /Season_Episode([Vv]?\d+(?:-\d+)?)_Act(\d+)_DataAsset/;
                for (const season of d.data || []) {
                    if (!season.uuid) continue;
                    const meta: SeasonMeta = {
                        uuid: season.uuid,
                        name: season.displayName || "Act",
                        parentUuid: season.parentUuid || "",
                        startTime: Date.parse(season.startTime || "") || 0,
                        isAct: Boolean(season.parentUuid),
                    };
                    next[season.uuid.toLowerCase()] = meta;
                    const match = season.assetPath?.match(shortRe);
                    if (match) {
                        const epRaw = match[1].toLowerCase().replace(/-/g, "");
                        const shortCode = `${epRaw}a${match[2]}`.toLowerCase();
                        next[shortCode] = meta;
                    }
                }
                setSeasons(next);
            })
            .catch((e) => console.warn("Failed to load season metadata", e))
            .finally(assetsSettled);
        return () => {
            cancelled = true;
        };
    }, []);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3200);
    }, []);

    const opts = useMemo(() => ({ puuid, region }), [puuid, region]);
    useEffect(() => {
        profileStageRef.current?.closest<HTMLElement>(".app-main-content")?.scrollTo({ top: 0, behavior: "auto" });
    }, [puuid]);
    const historyGroups = useMemo(() => {
        const groups: Array<{
            key: number;
            headline: string;
            ago: string;
            matches: ProfileMatchSummary[];
            wins: number;
            losses: number;
            roundsWon: number;
            roundsLost: number;
        }> = [];
        for (const match of history) {
            const key = dayStart(match.gameStartMillis);
            let group = groups[groups.length - 1];
            if (!group || group.key !== key) {
                group = { key, headline: dayHeadline(match.gameStartMillis), ago: dayAgo(match.gameStartMillis), matches: [], wins: 0, losses: 0, roundsWon: 0, roundsLost: 0 };
                groups.push(group);
            }
            group.matches.push(match);
            const blueSide = match.localPlayer.teamId.toLowerCase() === "blue";
            const ownRounds = blueSide ? match.blueRoundsWon : match.redRoundsWon;
            const enemyRounds = blueSide ? match.redRoundsWon : match.blueRoundsWon;
            if (ownRounds + enemyRounds <= 0) continue;
            if (match.win) group.wins += 1;
            else group.losses += 1;
            group.roundsWon += ownRounds;
            group.roundsLost += enemyRounds;
        }
        return groups;
    }, [history]);
    const loadHistory = useCallback(async () => {
        const request = ++historyRequestRef.current;
        const targetPuuid = puuid;
        if (!puuid) {
            setHistory([]);
            setTotal(0);
            setHistoryLoaded(false);
            return;
        }
        setHistoryLoading(true);
        setHistoryLoadedFor("");
        try {
            const matches = await getProfileMatchHistory(0, pageSize, queue || undefined, opts);
            if (request !== historyRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
            setHistory(matches.matches || []);
            setTotal(matches.total || 0);
            setHistoryLoaded(true);
            setHistoryLoadedFor(targetPuuid);
            loadedHistoryQueueRef.current = queue;
        } catch (err) {
            if (request === historyRequestRef.current && currentPuuidRef.current === targetPuuid) setError(cleanError(err));
        } finally {
            if (request === historyRequestRef.current && currentPuuidRef.current === targetPuuid) setHistoryLoading(false);
        }
    }, [opts, pageSize, puuid, queue]);

    const refresh = useCallback(async (refreshLive: boolean) => {
        const request = ++refreshRequestRef.current;
        const targetPuuid = puuid;
        if (!puuid) {
            setOverview(null);
            setSeasonSummary(null);
            setRRHistory(null);
            setHistory([]);
            setTotal(0);
            setAgentStats(null);
            setMapStats(null);
            setSyncStatus(null);
            return;
        }
        setLoading(true);
        setOverviewLoadedFor("");
        setError("");
        try {
            const targetSeasonQueue = seasonQueueRef.current;
            const snapshot = await loadProfileSnapshot(opts, queue, targetSeasonQueue, refreshLive, !viewedProfile, (ov) => {
                if (request !== refreshRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
                setOverview(ov);
                setIdentity({ playerCardId: ov.playerCardId || "", playerTitleId: ov.playerTitleId || "" });
                setIdentityLoadedFor(targetPuuid);
            });
            const { overview: ov, agents: ag, maps: mp, played, teammates: mates, status: st } = snapshot;
            if (request !== refreshRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
            setSyncStatus(st);
            if (st?.errorKind === "rate_limited") setRateLimitUntil(st.retryAt || Date.now() + 30_000);
            if (played) setPlayedQueues(played.queues);
            if (mates) setTeammates({ puuid: targetPuuid, list: mates.teammates });
            setOverview(ov);
            setSeasonSummary(snapshot.seasonSummary);
            setRRHistory(snapshot.rrHistory);
            setAccountXP(snapshot.accountXP ? { puuid: targetPuuid, data: snapshot.accountXP } : null);
            seasonSummaryKeyRef.current = `${targetPuuid}:${ov.currentSeasonId || ""}:${targetSeasonQueue}`;
            loadedOverviewQueueRef.current = queue;
            setAgentStats(ag);
            setMapStats(mp);
            const nextIdentity = { playerCardId: ov.playerCardId || "", playerTitleId: ov.playerTitleId || "" };
            setIdentity(nextIdentity);
            setOverviewLoadedFor(targetPuuid);
            if (snapshot.unavailable.length) setError(`Some profile data is unavailable: ${snapshot.unavailable.join(", ")}.`);
            else if (st?.lastError && st.errorKind !== "rate_limited" && !viewedProfile) setError(cleanError(st.lastError));
        } catch (err) {
            if (request === refreshRequestRef.current && currentPuuidRef.current === targetPuuid) {
                setError(cleanError(err));
            }
        } finally {
            if (request === refreshRequestRef.current && currentPuuidRef.current === targetPuuid) {
                setLoading(false);
            }
        }
    }, [opts, puuid, queue, viewedProfile]);

    useEffect(() => {
        const candidate = puuid ? profileSnapshotCache.get(puuid.toLowerCase()) : undefined;
        const cached = candidate?.queue === queueRef.current && candidate.seasonQueue === seasonQueueRef.current
            && candidate.agentStats && candidate.mapStats && candidate.rrHistory ? candidate : undefined;
        setOverview(cached?.overview ?? null);
        setSeasonSummary(cached?.seasonSummary ?? null);
        setRRHistory(cached?.rrHistory ?? null);
        setHistory(cached?.history ?? []);
        setTotal(cached?.total ?? 0);
        setHistoryLoaded(Boolean(cached));
        setPlayedQueues(cached?.playedQueues ?? []);
        setTeammates({ puuid, list: cached?.teammates ?? [] });
        setAgentStats(cached?.agentStats ?? null);
        setMapStats(cached?.mapStats ?? null);
        setSyncStatus(cached?.syncStatus ?? null);
        setIdentity(cached?.identity ?? null);
        setAccountXP(cached?.accountXP ? { puuid, data: cached.accountXP } : null);
        seasonSummaryKeyRef.current = cached ? `${puuid}:${cached.overview.currentSeasonId || ""}:${cached.seasonQueue}` : "";
        loadedOverviewQueueRef.current = cached?.queue ?? "";
        loadedHistoryQueueRef.current = cached?.queue ?? "";
        setOverviewLoadedFor(cached && puuid ? puuid : "");
        setIdentityLoadedFor(cached && puuid ? puuid : "");
        setHistoryLoadedFor(cached && puuid ? puuid : "");
        setCommittedProfilePuuid("");
        setInitialSyncReadyFor("");
        setInitialSyncError("");
        setDetails({});
        setExpanded(new Set());
        setLoadingDetails(new Set());
        setSyncing(false);
        setError("");
        setRateLimitUntil(0);
        setLoading(Boolean(puuid));
        setHistoryLoading(Boolean(puuid));
    }, [puuid, viewedProfile]);

    useEffect(() => {
        void refresh(true);
    }, [refresh, viewedProfile]);

    useEffect(() => {
        void loadHistory();
        return () => {
            historyRequestRef.current += 1;
        };
    }, [loadHistory]);

    useEffect(() => {
        if (!puuid || committedProfilePuuid !== puuid) return;
        const summaryKey = `${puuid}:${overview?.currentSeasonId || ""}:${seasonQueue}`;
        if (seasonSummaryKeyRef.current === summaryKey) return;
        let cancelled = false;
        getProfileSeasonSummary(seasonQueue, opts, overview?.currentSeasonId)
            .then((response) => {
                if (!cancelled) {
                    setSeasonSummary(response.summary);
                    seasonSummaryKeyRef.current = summaryKey;
                }
            })
            .catch((err) => {
                if (!cancelled && !viewedProfile && !/404|page not found/i.test(String(err))) {
                    setError(cleanError(err));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [committedProfilePuuid, opts, overview?.currentSeasonId, puuid, seasonQueue, viewedProfile]);

    const runSync = useCallback(
        async (manual: boolean) => {
            if (!puuid) return;
            const targetPuuid = puuid;
            setSyncing(true);
            setInitialSyncError("");
            setError("");
            try {
                if (!syncStatus?.inFlight) await postProfileSync(opts);
                if (currentPuuidRef.current !== targetPuuid) return;
                if (manual) showToast("Sync started.");
                let finalStatus: ProfileSyncStatus | null = null;
                let pollMisses = 0;
                let publishedTotal = syncStatus?.totalMatches ?? 0;
                for (let i = 0; i < 90; i += 1) {
                    await new Promise((resolve) => setTimeout(resolve, i < 3 ? 900 : 1800));
                    let st: ProfileSyncStatus;
                    try {
                        st = await getProfileSyncStatus(opts);
                    } catch (pollErr) {
                        pollMisses += 1;
                        if (pollMisses < 4) continue;
                        throw pollErr;
                    }
                    if (currentPuuidRef.current !== targetPuuid) return;
                    pollMisses = 0;
                    setSyncStatus(st);
                    finalStatus = st;
                    if (!st.inFlight || st.totalMatches - publishedTotal >= 3) {
                        await loadHistory();
                        publishedTotal = st.totalMatches;
                    }
                    if (!st.inFlight) break;
                }
                if (finalStatus?.inFlight) {
                    throw new Error("Sync is still running in the background. New matches will appear in batches.");
                }
                if (currentPuuidRef.current !== targetPuuid) return;
                if (finalStatus?.lastError) {
                    setInitialSyncError(cleanError(finalStatus.lastError));
                    if (finalStatus.errorKind === "rate_limited") {
                        setRateLimitUntil(finalStatus.retryAt || Date.now() + 30_000);
                        return;
                    }
                    if (manual || viewedProfile) setError(cleanError(finalStatus.lastError));
                } else if (manual) {
                    showToast("Profile synced.");
                }
                await Promise.all([
                    refresh(true),
                    loadHistory(),
                ]);
            } catch (err) {
                if (currentPuuidRef.current === targetPuuid) {
                    setInitialSyncError(cleanError(err));
                    if (manual || viewedProfile) setError(cleanError(err));
                }
            } finally {
                if (currentPuuidRef.current === targetPuuid) {
                    setSyncing(false);
                    setInitialSyncReadyFor(targetPuuid);
                }
            }
        },
        [loadHistory, opts, puuid, refresh, showToast, syncStatus?.inFlight, syncStatus?.totalMatches, viewedProfile],
    );

    useEffect(() => {
        if (!rateLimitUntil) return;
        setRateLimitNow(Date.now());
        const timer = window.setInterval(() => {
            const now = Date.now();
            setRateLimitNow(now);
            if (now >= rateLimitUntil) {
                window.clearInterval(timer);
                setRateLimitUntil(0);
                void runSync(false);
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [rateLimitUntil, runSync]);

    // An explicitly opened profile gets one stale-aware background refresh.
    // The profile component only mounts after a player click, so live rosters
    // do not fan out history calls for every visible player.
    useEffect(() => {
        if (!puuid || syncing || initialSyncReadyFor === puuid) return;
        if (loading || overviewLoadedFor !== puuid) return;
        if (!autoSyncMatches && !syncStatus?.inFlight) {
            setInitialSyncReadyFor(puuid);
            return;
        }
        if (!syncStatus) {
            if (autoSyncPuuidRef.current !== puuid) {
                autoSyncPuuidRef.current = puuid;
                void runSync(false);
            }
            return;
        }
        if (syncStatus.inFlight) {
            autoSyncPuuidRef.current = `${puuid}:${syncStatus.lastSyncedAt || 0}`;
            void runSync(false);
            return;
        }
        if (syncStatus.errorKind === "rate_limited" && (syncStatus.retryAt || 0) > Date.now()) {
            setInitialSyncError("Profile sync is temporarily rate limited. It will retry when Riot allows it.");
            setInitialSyncReadyFor(puuid);
            return;
        }
        const staleAfter = (viewedProfile ? 60 : 20) * 60 * 1000;
        if (syncStatus.lastSyncedAt && Date.now() - syncStatus.lastSyncedAt < staleAfter) {
            setInitialSyncReadyFor(puuid);
            return;
        }
        const attemptKey = `${puuid}:${syncStatus.lastSyncedAt || 0}`;
        if (autoSyncPuuidRef.current === attemptKey) return;
        autoSyncPuuidRef.current = attemptKey;
        void runSync(false);
    }, [autoSyncMatches, initialSyncReadyFor, loading, overviewLoadedFor, puuid, runSync, syncStatus, syncing, viewedProfile]);

    useEffect(() => {
        if (!puuid || identityLoadedFor !== puuid || !profileAssetsReady || !overview) return;
        let cancelled = false;
        const targetPuuid = puuid;
        const cardId = overview.playerCardId || (!viewedProfile ? ownPlayerCardId : "");
        const card = cardId ? playerCards[cardId.toLowerCase()] : undefined;
        const agentId = overview.seasonSummary?.topAgentCharacterId;
        const agent = agentId ? agents[agentId.toLowerCase()] : undefined;
        const tier = overview.currentRank?.competitiveTier || 0;
        const urls = [...new Set([card?.wide || agent?.full, card?.icon || agent?.icon, card?.portrait, tier > 0 ? rankIconUrl(tier, tierAssets) : undefined].filter((url): url is string => Boolean(url)))];
        const cleanups: Array<() => void> = [];
        Promise.all(urls.map((url) => new Promise<void>((resolve) => {
            const image = new window.Image();
            const finish = () => { clearTimeout(timeout); image.onload = null; image.onerror = null; resolve(); };
            const timeout = window.setTimeout(finish, 6000);
            image.onload = () => { void image.decode().catch(() => undefined).then(finish); };
            image.onerror = finish;
            image.src = url;
            cleanups.push(() => { clearTimeout(timeout); image.onload = null; image.onerror = null; });
        }))).then(() => { if (!cancelled && currentPuuidRef.current === targetPuuid) setProfileArtReadyFor(targetPuuid); });
        return () => { cancelled = true; cleanups.forEach((cleanup) => cleanup()); };
    }, [agents, identityLoadedFor, overview, ownPlayerCardId, playerCards, profileAssetsReady, puuid, tierAssets, viewedProfile]);

    const profileSnapshotCandidate = Boolean(puuid)
        && overviewLoadedFor === puuid
        && historyLoadedFor === puuid
        && Boolean(overview)
        && historyLoaded
        && profileAssetsReady
        && profileArtReadyFor === puuid
        && !loading && !historyLoading
        && isProfileSyncReady(puuid, initialSyncReadyFor, syncing, syncStatus, initialSyncError);

    useEffect(() => {
        if (!puuid || !profileSnapshotCandidate || !overview) return;
        setCommittedProfilePuuid(puuid);
        if (loadedOverviewQueueRef.current !== queue || loadedHistoryQueueRef.current !== queue
            || seasonSummaryKeyRef.current !== `${puuid}:${overview.currentSeasonId || ""}:${seasonQueue}`) return;
        profileSnapshotCache.set(puuid.toLowerCase(), {
            overview,
            seasonSummary,
            rrHistory,
            history,
            total,
            agentStats,
            mapStats,
            syncStatus,
            identity,
            accountXP: accountXP?.puuid === puuid ? accountXP.data : null,
            playedQueues,
            teammates: teammates.puuid === puuid ? teammates.list : [],
            queue,
            seasonQueue,
        });
    }, [accountXP, agentStats, history, identity, mapStats, overview, playedQueues, profileSnapshotCandidate, puuid, queue, rrHistory, seasonQueue, seasonSummary, syncStatus, teammates, total]);

    const toggleDetails = useCallback(
        async (matchId: string) => {
            const targetPuuid = puuid;
            setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(matchId)) next.delete(matchId);
                else next.add(matchId);
                return next;
            });
            if (details[matchId] || !puuid) return;
            setLoadingDetails((prev) => new Set(prev).add(matchId));
            try {
                const d = await getProfileMatchDetails(matchId, opts);
                if (currentPuuidRef.current === targetPuuid) {
                    setDetails((prev) => ({ ...prev, [matchId]: d }));
                }
            } catch (err) {
                if (currentPuuidRef.current === targetPuuid) setError(cleanError(err));
            } finally {
                if (currentPuuidRef.current === targetPuuid) {
                    setLoadingDetails((prev) => {
                        const next = new Set(prev);
                        next.delete(matchId);
                        return next;
                    });
                }
            }
        },
        [details, opts, puuid],
    );

    const currentTier = overview?.currentRank?.competitiveTier ?? 0;
    const currentRR = overview?.currentRank?.rankedRating ?? 0;
    const peakTier = overview?.peakRank?.competitiveTier ?? 0;
    const currentRankLabel = tierLabel(currentTier, overview?.currentRank?.tierName);
    const peakRankLabel = tierLabel(peakTier, overview?.peakRank?.tierName);
    const currentRankIcon = rankIconUrl(currentTier, tierAssets);
    const summary = seasonSummary;
    const identitySummary = overview?.seasonSummary;
    const isBusy = loading || syncing || !!syncStatus?.inFlight;
    const topAgentMeta = summary?.topAgentCharacterId ? agents[summary.topAgentCharacterId.toLowerCase()] : undefined;
    const identityTopAgentMeta = identitySummary?.topAgentCharacterId
        ? agents[identitySummary.topAgentCharacterId.toLowerCase()]
        : undefined;

    const lastRRDelta = (() => {
        const d = overview?.lastDeltas?.[0];
        if (!d) return null;
        const earned = Number(d.rrEarned) || 0;
        if (earned === 0) return null;
        return earned;
    })();

    const episodeActLabel = (() => {
        const id = overview?.currentSeasonId;
        if (!id) return "";
        return seasonLabel(id, seasons);
    })();
    const mapLookup = useMemo(() => {
        const out: Record<string, { displayName: string; splash?: string; mode: MapMeta["mode"] }> = {};
        for (const [id, meta] of Object.entries(maps)) {
            out[id] = { displayName: meta.name, splash: meta.splash, mode: meta.mode };
        }
        return out;
    }, [maps]);
    const agentPerformanceGroups = useMemo(
        () => groupAgentStats(agentStats?.agents ?? [], agents),
        [agentStats, agents],
    );
    const mapPerformanceGroups = useMemo(
        () => groupMapStats(mapStats?.maps ?? [], mapLookup),
        [mapStats, mapLookup],
    );
    const agentNames = useMemo(() => Object.fromEntries(Object.entries(agents).map(([id, meta]) => [id, meta.name])), [agents]);
    const mapNames = useMemo(() => Object.fromEntries(Object.entries(maps).map(([id, meta]) => [id, meta.name])), [maps]);
    const agentVisuals = useMemo(() => Object.fromEntries(Object.entries(agents).map(([id, meta]) => [id, meta.full || meta.icon])), [agents]);
    const agentIcons = useMemo(() => Object.fromEntries(Object.entries(agents).map(([id, meta]) => [id, meta.icon])), [agents]);
    const mapVisuals = useMemo(() => Object.fromEntries(Object.entries(maps).map(([id, meta]) => [id, meta.splash])), [maps]);
    const selectedAgentGroup = agentPerformanceGroups.find((group) => group.label === agentRole) || agentPerformanceGroups[0];
    const selectedMapGroup = mapPerformanceGroups.find((group) => group.label === mapMode) || mapPerformanceGroups[0];

    const playerCardId = identity?.playerCardId || (!viewedProfile ? ownPlayerCardId : "");
    const cardData = playerCardId ? playerCards[playerCardId.toLowerCase()] : null;
    const titleText = identity?.playerTitleId ? playerTitles[identity.playerTitleId.toLowerCase()] : "";
    const profileSnapshotFailed = Boolean(initialSyncError || error) && !loading && !historyLoading && !syncing
        && (Boolean(initialSyncError) || overviewLoadedFor !== puuid || historyLoadedFor !== puuid);
    const showProfileFacade = Boolean(puuid) && committedProfilePuuid !== puuid;
    const overviewReady = overviewLoadedFor === puuid;
    const matchesReady = historyLoadedFor === puuid && historyLoaded;
    const loadingCardId = (identityLoadedFor === puuid ? identity?.playerCardId : "") || (!viewedProfile ? ownPlayerCardId : "");

    if (!activeAccount) {
        return (
            <div className={s.empty}>
                <div className={s.emptyInner}>
                    <div className={s.emptyMark} aria-hidden="true" />
                    <h1 className={s.emptyTitle}>Profile</h1>
                    <p className={s.emptyText}>
                        Connect a Riot account to sync rank, recent matches, and career stats locally.
                    </p>
                    <button className={s.primaryBtn} onClick={onConnectAccount}>
                        Connect Riot Account
                    </button>
                </div>
            </div>
        );
    }

    const heroBg = cardData?.wide || identityTopAgentMeta?.full;
    const viewedGameName = overview?.gameName || viewedProfile?.gameName || activeAccount?.gameName || "Unknown";
    const viewedTagLine = overview?.tagLine || viewedProfile?.tagLine || activeAccount?.tagLine || "";

    // Account levels take 5,000 AP each; Progress.XP is the AP earned toward the next level.
    const ownAccountXP = !viewedProfile && accountXP?.puuid === puuid ? accountXP.data : null;
    const levelAP = ownAccountXP ? Math.max(0, Math.min(5000, ownAccountXP.Progress.XP || 0)) : 0;
    const frequentTeammates = teammates.puuid === puuid ? teammates.list : [];
    const recentForm = (() => {
        const decided = history.filter((match) => { const outcome = matchOutcome(match); return outcome === "win" || outcome === "loss"; }).slice(0, 10);
        if (decided.length < 3) return null;
        const wins = decided.filter((match) => matchOutcome(match) === "win").length;
        const snapshots = new Map((rrHistory?.snapshots ?? []).map((item) => [item.matchId, item.rrEarned]));
        const ranked = decided.filter((match) => snapshots.has(match.matchId));
        return { games: decided.length, wins, losses: decided.length - wins, rr: ranked.length ? ranked.reduce((sum, match) => sum + (snapshots.get(match.matchId) || 0), 0) : null };
    })();
    const knownComparisonIds = new Set([activeAccount.puuid, ...frequentTeammates.map(mate => mate.subject)].map(subject => subject.toLowerCase()));
    // The chart skips unranked games, so the subtitle counts the same set.
    const rankedSnapshotCount = rrHistory?.snapshots?.filter((snapshot) => snapshot.tierAfter > 0).length ?? 0;
    // Tiers below Immortal cap at 100 RR, so they get a progress bar to the next tier.
    const showRRProgress = currentTier >= 3 && currentTier < 24;
    const rankColor = currentTier >= 27 ? "#ffe9a8" : RANK_COLORS[Math.floor((currentTier - 3) / 3)] ?? "var(--accent)";
    const lastDelta = overview?.lastDeltas?.[0];
    const lastTierShift = lastDelta?.tierBefore && lastDelta.tierAfter && lastDelta.tierAfter !== lastDelta.tierBefore
        ? lastDelta.tierAfter > lastDelta.tierBefore ? "Promoted" : "Demoted"
        : "";
    const actPeakTier = (() => {
        const id = overview?.currentSeasonId?.toLowerCase();
        if (!id) return 0;
        return overview?.rankActs?.find((act) => act.seasonId?.toLowerCase() === id)?.peakRank ?? 0;
    })();
    const seasonQueueLabel = SEASON_QUEUES.find((option) => option.value === seasonQueue)?.label ?? "Competitive";
    const seasonMatches = summary?.matches ?? 0;
    const seasonWins = Math.min(summary?.wins ?? 0, seasonMatches);
    const seasonKd = summary && Number.isFinite(summary.avgKda) ? summary.avgKda : 0;
    const seasonHs = summary && Number.isFinite(summary.avgHsPct) ? summary.avgHsPct : 0;

    return (
        <div className={s.profileStage} ref={profileStageRef}>
        <div className={s.profileUnderlay} inert={showProfileFacade} aria-hidden={showProfileFacade || undefined}>
        <div className={s.shell}>
            {toast && <div className={s.toast}>{toast}</div>}

            {rateLimitUntil > 0 && (
                <div className={s.rateLimitPopup} role="alert" aria-live="assertive">
                    <strong>Riot rate limit reached</strong>
                    <span>
                        Profile sync will retry automatically in {Math.max(1, Math.ceil((rateLimitUntil - rateLimitNow) / 1000))}s.
                    </span>
                </div>
            )}

            {error && <div className={s.errorBar}>{error}</div>}

            <div className={s.layout}>
                {/* ── Vertical identity rail ── */}
                <aside className={s.rail}>
                    <div
                        className={s.railHero}
                        style={heroBg ? { backgroundImage: `url(${heroBg})` } : undefined}
                    >
                        <div className={s.railHeroScrim} />
                        <div className={s.railAvatar}>
                            {cardData?.icon ? (
                                <img src={cardData.icon} alt="Player Card" className={s.railAvatarImg} />
                            ) : identityTopAgentMeta?.icon ? (
                                <img src={identityTopAgentMeta.icon} alt={identityTopAgentMeta.name} className={s.railAvatarImg} />
                            ) : (
                                <div className={`${s.railAvatarImg} ${s.railAvatarFallback}`} />
                            )}
                            <div className={s.railLevel}>{overview?.account?.level || "—"}</div>
                        </div>
                    </div>

                    <div className={s.railBody}>
                        {viewedProfile && (
                            <button type="button" className={s.backToProfile} onClick={() => onRequestedProfileChange(null)}>
                                ← Back to my profile
                            </button>
                        )}
                        <div className={s.railName}>
                            {viewedGameName}
                            <span className={s.railTag}>#{viewedTagLine}</span>
                        </div>
                        {titleText && <div className={s.railTitle}>{titleText}</div>}
                        <div className={s.railChips}>
                            {currentTier > 0 ? (
                                <span className={s.railChip} style={{ "--chip-color": rankColor } as CSSProperties}>
                                    <Image src={currentRankIcon || FALLBACK_RANK_ICON} alt="" width={18} height={18} unoptimized />
                                    {currentRankLabel}
                                </span>
                            ) : null}
                            <span className={s.railChip}>{episodeActLabel || "Player profile"}</span>
                        </div>
                        <ProfileBadges puuid={puuid} region={region} queue={queue} matches={history} />

                        {ownAccountXP ? (
                            <div className={s.railLevelProgress} title={`${levelAP.toLocaleString()} of 5,000 AP toward level ${ownAccountXP.Progress.Level + 1}`}>
                                <div className={s.railLevelHead}>
                                    <span>Level {ownAccountXP.Progress.Level}</span>
                                    <small>{levelAP.toLocaleString()} / 5,000 AP</small>
                                </div>
                                <div className={s.railLevelBar} role="progressbar" aria-label="Account level progress" aria-valuemin={0} aria-valuemax={5000} aria-valuenow={levelAP}>
                                    <span style={{ width: `${(levelAP / 5000) * 100}%` }} />
                                </div>
                            </div>
                        ) : null}

                        <nav className={s.railNav} aria-label="Career tools">
                            {/* Compare lives on other players' profiles (them vs you); on yours it is reached from Played with. */}
                            {viewedProfile ? (
                                <button type="button" onClick={() => setCareerView("comparison")} aria-haspopup="dialog">
                                    <i className={s.railNavIcon} data-tone="compare">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18" /><path d="M4 8h5M4 12h5M4 16h5" /><path d="M15 8h5M15 12h5M15 16h5" /></svg>
                                    </i>
                                    <span className={s.railNavText}><strong>Compare with you</strong><small>Side by side with your profile</small></span>
                                    <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                                </button>
                            ) : null}
                            <button type="button" onClick={() => setCareerView("analytics")} aria-haspopup="dialog">
                                <i className={s.railNavIcon} data-tone="insights">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></svg>
                                </i>
                                <span className={s.railNavText}><strong>Insights</strong><small>{recentForm ? `Last ${recentForm.games}: ${recentForm.wins}W ${recentForm.losses}L${recentForm.rr !== null ? ` · ${recentForm.rr > 0 ? "+" : ""}${recentForm.rr} RR` : ""}` : "Trends from your matches"}</small></span>
                                <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                            </button>
                            <div className={s.railNavGroup}>
                                <button type="button" onClick={() => openProgression("missions")} aria-haspopup="dialog">
                                    <i className={s.railNavIcon} data-tone="pass">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" /><path d="M14 7v12" /></svg>
                                    </i>
                                    <span className={s.railNavText}><strong>Battle Pass &amp; XP</strong><small>Missions, pass tiers and contracts</small></span>
                                    <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                                </button>
                                <div className={s.railNavQuick} role="group" aria-label="Open a Battle Pass &amp; XP section">
                                    <button type="button" onClick={() => openProgression("missions")}>Missions</button>
                                    <button type="button" onClick={() => openProgression("battlepass")}>Battle Pass</button>
                                    <button type="button" onClick={() => openProgression("custom-contracts")}>Contracts</button>
                                </div>
                            </div>
                            {!viewedProfile && FEATURE_FLAGS.accolades() ? (
                                <button type="button" onClick={() => setCareerView("accolades")} aria-haspopup="dialog">
                                    <i className={s.railNavIcon} data-tone="accolades">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 20.2 7.2v9.6L12 21.5l-8.2-4.7V7.2z" /><path d="m12 8 1.2 2.6 2.8.3-2.1 1.9.6 2.8L12 14.1l-2.5 1.5.6-2.8L8 10.9l2.8-.3z" /></svg>
                                    </i>
                                    <span className={s.railNavText}><strong>Accolades</strong><small>Your personal bests</small></span>
                                    <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                                </button>
                            ) : null}
                            <button type="button" onClick={() => setCareerView("leaderboard")}>
                                <i className={s.railNavIcon} data-tone="leaderboard">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3" /><path d="M7 5H4v2a3 3 0 0 0 3 3" /></svg>
                                </i>
                                <span className={s.railNavText}><strong>Leaderboard</strong><small>Top players in your region</small></span>
                                <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                            </button>
                            {frequentTeammates.length ? (
                                <button type="button" onClick={() => (viewedProfile ? setMatesOpen(true) : setDuosOpen(true))} aria-haspopup="dialog">
                                    <span className={s.railNavFaces} aria-hidden="true">
                                        {frequentTeammates.slice(0, 3).map((mate) => {
                                            const icon = agents[mate.characterId?.toLowerCase?.() || ""]?.icon;
                                            return icon ? <img key={mate.subject} src={icon} alt="" /> : <i key={mate.subject} />;
                                        })}
                                    </span>
                                    <span className={s.railNavText}>
                                        <strong>{viewedProfile ? "Played with" : "Duos"}</strong>
                                        <small>{frequentTeammates.slice(0, 2).map((mate) => mate.gameName || "Hidden").join(", ")}{frequentTeammates.length > 2 ? ` +${frequentTeammates.length - 2}` : ""}</small>
                                    </span>
                                    <svg className={s.railNavChevron} viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                                </button>
                            ) : null}
                        </nav>

                        {/* Rank requests and match sync use separate Riot data paths. */}
                        <div className={s.railSync}>
                            <div className={s.railSyncRow}>
                                <span className={s.railSyncDot} data-state={loading ? "busy" : isRecent(overview?.lastLiveRankRefreshedAt) ? "fresh" : "stale"} aria-hidden="true" />
                                <span className={s.railSyncCopy}>
                                    <small>Rank</small>
                                    <strong>{overview?.rankSource === "live" && overview.lastLiveRankRefreshedAt
                                        ? `Updated ${fmtAgo(overview.lastLiveRankRefreshedAt)}`
                                        : overview?.rankSource === "cache" ? "Showing saved rank" : "No live rank yet"}</strong>
                                </span>
                                <button type="button" className={s.railSyncBtn} onClick={() => void refresh(true)} disabled={isBusy}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
                                    {loading ? "Refreshing…" : "Refresh"}
                                </button>
                            </div>
                            <div className={s.railSyncRow}>
                                <span className={s.railSyncDot} data-state={syncing || syncStatus?.inFlight ? "busy" : isRecent(syncStatus?.lastSyncedAt || overview?.lastCacheSyncedAt) ? "fresh" : "stale"} aria-hidden="true" />
                                <span className={s.railSyncCopy}>
                                    <small>Matches</small>
                                    <strong>{syncStatus?.lastSyncedAt || overview?.lastCacheSyncedAt
                                        ? `Synced ${fmtAgo(syncStatus?.lastSyncedAt || overview?.lastCacheSyncedAt || 0)}`
                                        : "Not synced yet"}</strong>
                                </span>
                                <button type="button" className={`${s.railSyncBtn} ${s.railSyncBtnPrimary}`} onClick={() => runSync(true)} disabled={isBusy}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 14-5.3L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15" /><path d="M4 20v-5h5" /></svg>
                                    {syncing || syncStatus?.inFlight ? "Syncing…" : "Sync"}
                                </button>
                            </div>
                        </div>
                    </div>
                </aside>

                {/* ── Main content ── */}
                <main className={s.main}>
                    {/* ── Tabs ── */}
                    <div className={s.body}>
                        <>
                                <div className={s.profileIntro}>
                                    <div>
                                        <h1>{viewedProfile ? `${viewedGameName}'s performance` : "Your performance"}</h1>
                                    </div>
                                    <div className={`${s.seasonQueueTabs} ${s.introQueueTabs}`} role="group" aria-label="Season stats mode">
                                        {SEASON_QUEUES.map((option) => (
                                            <button
                                                type="button"
                                                key={option.value}
                                                aria-pressed={seasonQueue === option.value}
                                                className={seasonQueue === option.value ? s.seasonQueueTabActive : ""}
                                                onClick={() => setSeasonQueue(option.value)}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <section className={s.rankHero} aria-label="Rank" style={{ "--rank-color": rankColor } as CSSProperties}>
                                    <div className={s.rankHeroCurrent}>
                                        <Image
                                            src={currentRankIcon || FALLBACK_RANK_ICON}
                                            alt=""
                                            width={96}
                                            height={96}
                                            className={s.rankHeroIcon}
                                            loading="eager"
                                            unoptimized
                                        />
                                        <div className={s.rankHeroCopy}>
                                            <span className={s.rankHeroLabel}>Current rank</span>
                                            <div className={s.rankHeroTitle}>
                                                <strong>{currentRankLabel}</strong>
                                                {lastRRDelta != null && currentTier < 27 && (
                                                    <span className={`${s.rankHeroDelta} ${lastRRDelta > 0 ? s.rankHeroDeltaUp : s.rankHeroDeltaDown}`}>
                                                        {lastRRDelta > 0 ? "▲" : "▼"} {Math.abs(lastRRDelta)} RR{lastTierShift ? ` · ${lastTierShift}` : ""}
                                                    </span>
                                                )}
                                            </div>
                                            {showRRProgress ? (
                                                <>
                                                    <div className={s.rankHeroRR}>
                                                        <span><b>{currentRR}</b> / 100 RR</span>
                                                        <span>{Math.max(0, 100 - currentRR)} RR to {tierLabel(currentTier + 1)}</span>
                                                    </div>
                                                    <div
                                                        className={s.rankHeroBar}
                                                        role="progressbar"
                                                        aria-label="Ranked rating"
                                                        aria-valuemin={0}
                                                        aria-valuemax={100}
                                                        aria-valuenow={currentRR}
                                                    >
                                                        <span style={{ width: `${Math.min(100, Math.max(0, currentRR))}%` }} />
                                                    </div>
                                                </>
                                            ) : currentTier >= 24 ? (
                                                <div className={s.rankHeroRR}><span><b>{currentRR}</b> RR</span></div>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className={s.rankHeroSide}>
                                        <span className={s.rankHeroLabel}>Act peak</span>
                                        <div className={s.rankHeroMini}>
                                            <Image
                                                src={rankIconUrl(actPeakTier, tierAssets) || FALLBACK_RANK_ICON}
                                                alt=""
                                                width={64}
                                                height={64}
                                                loading="eager"
                                                unoptimized
                                            />
                                            <div>
                                                <strong>{actPeakTier ? tierLabel(actPeakTier) : "—"}</strong>
                                                <small>{episodeActLabel || "This act"}</small>
                                            </div>
                                        </div>
                                    </div>
                                    <div className={s.rankHeroSide}>
                                        <span className={s.rankHeroLabel}>Career best</span>
                                        <div className={s.rankHeroMini}>
                                            <Image
                                                src={rankIconUrl(peakTier, tierAssets) || FALLBACK_RANK_ICON}
                                                alt=""
                                                width={64}
                                                height={64}
                                                loading="eager"
                                                unoptimized
                                            />
                                            <div>
                                                <strong>{peakRankLabel}</strong>
                                                <small>
                                                    {[
                                                        overview?.peakRank?.reachedAt ? fmtPeakDate(overview.peakRank.reachedAt) : "",
                                                        overview?.peakRank?.seasonId ? seasonLabel(overview.peakRank.seasonId, seasons) : "",
                                                    ].filter(Boolean).join(" · ") || "Career history"}
                                                </small>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className={s.statTiles} aria-label={`${seasonQueueLabel} stats this act`}>
                                    <div className={s.statTile}>
                                        <span className={s.statTileLabel}>Win rate</span>
                                        <strong className={s.statTileValue}>{fmtPct(summary?.winrate)}</strong>
                                        <div className={s.statTileSplit} aria-hidden="true">
                                            {seasonMatches > 0 ? (
                                                <>
                                                    <span className={s.statTileWin} style={{ flexGrow: seasonWins }} />
                                                    <span className={s.statTileLoss} style={{ flexGrow: seasonMatches - seasonWins }} />
                                                </>
                                            ) : <span className={s.statTileEmpty} />}
                                        </div>
                                        <small>{seasonWins} W · {seasonMatches - seasonWins} L</small>
                                    </div>
                                    <div className={s.statTile}>
                                        <span className={s.statTileLabel}>K/D ratio</span>
                                        <strong className={`${s.statTileValue} ${kdColor(summary?.avgKda)}`}>{fmtRatio(summary?.avgKda)}</strong>
                                        <div className={s.statTileMeter} aria-hidden="true">
                                            <span style={{ width: `${Math.min(100, (seasonKd / 2) * 100)}%` }} />
                                            <i />
                                        </div>
                                        <small>{seasonKd >= 1 ? "Above" : "Below"} 1.0 break-even</small>
                                    </div>
                                    <div className={s.statTile}>
                                        <span className={s.statTileLabel}>Headshot %</span>
                                        <strong className={`${s.statTileValue} ${hsColor(summary?.avgHsPct)}`}>{fmtPct(summary?.avgHsPct)}</strong>
                                        <div className={s.statTileMeter} aria-hidden="true">
                                            <span style={{ width: `${Math.min(100, Math.max(0, seasonHs))}%` }} />
                                        </div>
                                        <small>Of all hits</small>
                                    </div>
                                    <div className={s.statTile}>
                                        <span className={s.statTileLabel}>Matches</span>
                                        <strong className={s.statTileValue}>{seasonMatches}</strong>
                                        <small className={s.statTileFoot}>{seasonQueueLabel} this act</small>
                                    </div>
                                    <div className={`${s.statTile} ${s.statTileAgent}`}>
                                        {topAgentMeta?.icon ? (
                                            <img src={topAgentMeta.icon} alt="" className={s.statTileAgentIcon} />
                                        ) : <span className={s.statTileAgentIcon} />}
                                        <div>
                                            <span className={s.statTileLabel}>Most played</span>
                                            <strong>{topAgentMeta?.name || summary?.topAgent || "—"}</strong>
                                            {topAgentMeta?.role && <small>{topAgentMeta.role}</small>}
                                        </div>
                                    </div>
                                </section>
                                {seasonMatches > 0 && seasonMatches < 5 && (
                                    <p className={s.sampleNote}>Early sample: these averages may change as more matches are saved.</p>
                                )}

                                {/* A graph needs at least two ranked games; with fewer it would be an empty frame. */}
                                {rankedSnapshotCount >= 2 && <Panel
                                    title="RR Progression"
                                    subtitle={rrHistory?.source === "tier"
                                        ? `${rankedSnapshotCount} ranked tier checkpoints · exact RR unavailable`
                                        : `${rankedSnapshotCount} ranked games tracked`}
                                >
                                    <RRHistoryChart
                                        snapshots={rrHistory?.snapshots ?? []}
                                        source={rrHistory?.source}
                                        height={220}
                                        loading={isBusy}
                                    />
                                </Panel>}

                                <Panel
                                    title="Performance"
                                    subtitle={performanceView === "agents"
                                        ? `${agentStats?.agents?.length || 0} agents with cached matches`
                                        : `${mapStats?.maps?.length || 0} maps with cached matches`}
                                    headerRight={
                                        <div className={s.performanceToggle} role="group" aria-label="Performance view">
                                            <button
                                                type="button"
                                                className={performanceView === "agents" ? s.performanceToggleActive : ""}
                                                onClick={() => setPerformanceView("agents")}
                                            >
                                                Agents
                                            </button>
                                            <button
                                                type="button"
                                                className={performanceView === "maps" ? s.performanceToggleActive : ""}
                                                onClick={() => setPerformanceView("maps")}
                                            >
                                                Maps
                                            </button>
                                        </div>
                                    }
                                >
                                    {performanceView === "agents" ? (
                                        <div className={s.performanceGroups}>
                                            <div className={s.performanceGroupTabs}>
                                                {agentPerformanceGroups.map((group) => (
                                                    <button
                                                        type="button"
                                                        key={group.label}
                                                        className={selectedAgentGroup?.label === group.label ? s.performanceGroupTabActive : ""}
                                                        onClick={() => setAgentRole(group.label)}
                                                    >
                                                        {group.roleIcon && <img src={group.roleIcon} alt="" aria-hidden="true" />}
                                                        {group.label}
                                                    </button>
                                                ))}
                                            </div>
                                            {selectedAgentGroup && (
                                                <section className={s.performanceGroup} key={selectedAgentGroup.label}>
                                                    <div className={s.agentPerformanceRail} tabIndex={0} role="region" aria-label={`${selectedAgentGroup.label} performance, scroll horizontally for more agents`}>
                                                        {selectedAgentGroup.items.map(({ agent, meta }) => (
                                                            <div key={agent.characterId} className={s.agentPerformanceCard}>
                                                                {meta?.icon ? (
                                                                    <img src={meta.icon} alt="" className={s.agentPerformanceIcon} />
                                                                ) : <span className={s.agentPerformanceIcon} />}
                                                                <div className={s.agentPerformanceIdentity}>
                                                                    <strong>{meta?.name || "Agent"}</strong>
                                                                    <small>{agent.matches} matches · {agent.wins} wins</small>
                                                                </div>
                                                                <PerformanceStat label="WR" value={fmtPct(agent.winrate)} tone={agent.winrate >= 50 ? s.winText : s.lossText} />
                                                                <PerformanceStat label="K/D" value={fmtRatio(agent.kd)} tone={kdColor(agent.kd)} />
                                                                <PerformanceStat label="HS" value={fmtPct(agent.hsPct)} tone={hsColor(agent.hsPct)} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </section>
                                            )}
                                            {!agentStats?.agents?.length && <div className={s.placeholder}>No agent stats cached.</div>}
                                        </div>
                                    ) : (
                                    <div className={s.performanceGroups}>
                                        <div className={s.performanceGroupTabs}>
                                            {mapPerformanceGroups.map((group) => (
                                                <button
                                                    type="button"
                                                    key={group.label}
                                                    className={selectedMapGroup?.label === group.label ? s.performanceGroupTabActive : ""}
                                                    onClick={() => setMapMode(group.label)}
                                                >
                                                    {group.label}<span>{group.items.length}</span>
                                                </button>
                                            ))}
                                        </div>
                                        {selectedMapGroup && (
                                            <section className={s.performanceGroup} key={selectedMapGroup.label}>
                                                <h3>{selectedMapGroup.label}<span>{selectedMapGroup.items.length}</span></h3>
                                                <div className={s.mapStrip} tabIndex={0} role="region" aria-label="Map performance, scroll horizontally for more maps">
                                                    {selectedMapGroup.items.map(({ stat: mStat, meta: mMeta }) => (
                                                        <div
                                                            key={mStat.mapID}
                                                            className={s.mapCard}
                                                            style={mMeta?.splash ? { backgroundImage: `url(${mMeta.splash})` } : undefined}
                                                        >
                                                            <div className={s.mapCardScrim} />
                                                            <div className={s.mapCardBody}>
                                                                <span className={s.mapCardName}>{mMeta?.displayName || mStat.mapID.slice(0, 6)}</span>
                                                                <span className={`${s.mapCardWr} ${mStat.winrate >= 50 ? s.winText : s.lossText}`}>
                                                                    {fmtPct(mStat.winrate)}
                                                                </span>
                                                                <span className={s.mapCardGames}>
                                                                    {mStat.matches} games · {mStat.wins}W {Math.max(0, mStat.matches - mStat.wins)}L
                                                                </span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </section>
                                        )}
                                        {!mapStats?.maps?.length && (
                                            <div className={s.placeholder}>No map stats cached.</div>
                                        )}
                                    </div>
                                    )}
                                </Panel>

                                <Panel
                                    title="Match History"
                                    subtitle={`${total} cached matches`}
                                    headerRight={
                                        <div className={s.historyFilters}>
                                            <select
                                                className={`${s.select} ${s.historyQueueSelect}`}
                                                value={queue}
                                                onChange={(e) => setQueue(e.target.value)}
                                                aria-label="Show matches from"
                                            >
                                                <option value="">All queues</option>
                                                {queueOptions.map((opt) => (
                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                            </select>
                                            <select
                                                className={`${s.select} ${s.pageSizeSelect}`}
                                                value={pageSize}
                                                onChange={(e) => setPageSize(Number(e.target.value))}
                                                aria-label="Matches per page"
                                            >
                                                {PAGE_SIZES.map((size) => (
                                                    <option key={size} value={size}>
                                                        {size} per page
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    }
                                >
                                    {history.length === 0 && (historyLoading || syncStatus?.inFlight || syncing) ? (
                                        <div className={s.matchLoading} role="status" aria-live="polite">
                                            <span className={s.profileFacadeSpinner} aria-hidden="true" />
                                            <strong>Loading recent matches…</strong>
                                            <small>The first group will appear as soon as it is ready.</small>
                                        </div>
                                    ) : history.length === 0 ? (
                                        <div className={s.placeholder}>
                                            {syncStatus?.inFlight || syncing
                                                ? "Syncing match history…"
                                                : "No matches cached yet. Hit Sync."}
                                        </div>
                                    ) : (
                                        <div className={s.matchList}>
                                            {historyGroups.map((group) => (
                                                <section className={s.matchDayGroup} key={`day-${group.key}`}>
                                                    <header className={s.matchDayHeader}>
                                                        <span className={s.matchDayDot} data-tone={group.wins > group.losses ? "win" : group.losses > group.wins ? "loss" : "even"} aria-hidden="true" />
                                                        <h3 className={s.matchDayTitle}>{group.headline}</h3>
                                                        {group.ago ? <span className={s.matchDayAgo}>{group.ago}</span> : null}
                                                        <span className={s.matchDayRule} aria-hidden="true" />
                                                        <span className={s.matchDayRecord} data-mixed={group.wins > 0 && group.losses > 0 ? "true" : undefined}>
                                                            {group.wins > 0 ? <b className={s.winText}>{group.wins}W</b> : null}
                                                            {group.losses > 0 ? <b className={s.lossText}>{group.losses}L</b> : null}
                                                        </span>
                                                        <small className={s.matchDayRounds}>
                                                            {group.roundsWon + group.roundsLost > 0
                                                                ? `${group.roundsWon}–${group.roundsLost} rounds`
                                                                : `${group.matches.length} ${group.matches.length === 1 ? "match" : "matches"}`}
                                                        </small>
                                                        {!viewedProfile ? <button type="button" className={s.matchDayRecap} onClick={() => { setRecapFocus(group.matches[0]?.matchId || ""); setCareerView("sessions"); }} aria-haspopup="dialog">
                                                            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>
                                                            Session recap
                                                        </button> : null}
                                                    </header>
                                                    <div className={s.matchDayList}>
                                                        {group.matches.map((match) => (
                                                            <MatchRow
                                                                key={match.matchId}
                                                                match={match}
                                                                detail={details[match.matchId]}
                                                                expanded={expanded.has(match.matchId)}
                                                                loading={loadingDetails.has(match.matchId)}
                                                                agents={agents}
                                                                maps={maps}
                                                                weapons={weapons}
                                                                tierAssets={tierAssets}
                                                                profilePuuid={puuid}
                                                                region={region}
                                                                onToggle={() => toggleDetails(match.matchId)}
                                                                onViewProfile={viewProfile}
                                                            />
                                                        ))}
                                                    </div>
                                                </section>
                                            ))}
                                        </div>
                                    )}
                                </Panel>
                        </>
                    </div>
                </main>
            </div>
            {matesOpen && frequentTeammates.length ? (
                <TeammatesDialog
                    teammates={frequentTeammates}
                    agents={agents}
                    onClose={() => setMatesOpen(false)}
                    onView={(profile) => { setMatesOpen(false); viewProfile(profile); }}
                    onCompare={(mate) => { setMatesOpen(false); setCompareTarget(mate); setCareerView("comparison"); }}
                />
            ) : null}
            {duosOpen ? (
                <DuoChemistry
                    you={{ name: viewedGameName || "You", tag: activeAccount.tagLine, cardId: playerCardId || undefined }}
                    region={region}
                    agents={agents}
                    mapNames={mapNames}
                    mapVisuals={mapVisuals}
                    onClose={() => setDuosOpen(false)}
                    onViewProfile={(profile) => { setDuosOpen(false); viewProfile(profile); }}
                    onCompare={(mate) => { setDuosOpen(false); setCompareTarget(mate); setCareerView("comparison"); }}
                />
            ) : null}
            <ProfileExtras
                queue={queue}
                queueLabel={queue ? queueOptions.find((option) => option.value === queue)?.label || queue : "All queues"}
                view={careerView}
                onClose={() => { setCareerView(null); setCompareTarget(""); setRecapFocus(""); }}
                recapFocus={recapFocus}
                selfPuuid={activeAccount.puuid}
                initialSection={progressionSection}
                puuid={puuid}
                region={region}
                seasonId={overview?.currentSeasonId}
                isOwnProfile={!viewedProfile}
                matches={history}
                rr={rrHistory?.snapshots ?? []}
                agentNames={agentNames}
                mapNames={mapNames}
                agentVisuals={agentVisuals}
                mapVisuals={mapVisuals}
                playerCardImages={playerCardImages}
                rewardAssets={rewardAssets}
                rankActs={overview?.rankActs ?? []}
                seasonNames={Object.fromEntries(Object.entries(seasons).map(([key, value]) => [key, value.name]))}
                onViewProfile={viewProfile}
                identityCard={viewedProfile ? undefined : { name: viewedGameName, cardId: playerCardId || "", titleText, portrait: playerCardId ? playerCards[playerCardId.toLowerCase()]?.portrait : undefined }}
                reviewPlayer={{ puuid, gameName: overview?.gameName || (viewedProfile ? viewedProfile.gameName || "Player" : activeAccount.gameName || "You"), tagLine: overview?.tagLine || (viewedProfile ? viewedProfile.tagLine || "" : activeAccount.tagLine || "") }}
                rankIcons={Object.fromEntries([...tierAssets].map(([tier, art]) => [tier, art.smallIcon]))}
                agentIcons={agentIcons}
                comparisonCandidates={orderCandidates(compareTarget, [...new Map([
                    { puuid: activeAccount.puuid, gameName: activeAccount.gameName || "You", tagLine: activeAccount.tagLine || "" },
                    ...frequentTeammates.map(mate => ({ puuid: mate.subject, gameName: mate.gameName, tagLine: mate.tagLine })),
                    ...[...profileSnapshotCache.values()].filter(cached => !knownComparisonIds.has(cached.overview.puuid.toLowerCase())).map(cached => ({ puuid: cached.overview.puuid, gameName: cached.overview.gameName || "Player", tagLine: cached.overview.tagLine || "" })),
                ].filter(player => player.puuid && player.puuid.toLowerCase() !== puuid.toLowerCase()).map(player => [player.puuid.toLowerCase(), player])).values()])}
            />
        </div>
        </div>
        {showProfileFacade && (
            <ProfileLoading
                gameName={(viewedProfile ? viewedProfile.gameName : activeAccount.gameName) || "Player"}
                tagLine={viewedProfile?.tagLine || (!viewedProfile ? activeAccount.tagLine : "")}
                cardArt={loadingCardId ? playerCards[loadingCardId.toLowerCase()]?.portrait : undefined}
                overviewReady={overviewReady && !loading}
                matchesReady={matchesReady && !historyLoading && isProfileSyncReady(puuid, initialSyncReadyFor, syncing, syncStatus, initialSyncError)}
                artReady={profileArtReadyFor === puuid}
                error={profileSnapshotFailed ? initialSyncError || error : undefined}
                onBack={viewedProfile ? () => onRequestedProfileChange(null) : undefined}
                onRetry={() => {
                    if (initialSyncError) void runSync(true);
                    else { void refresh(true); void loadHistory(); }
                }}
            />
        )}
        </div>
    );
}

/* ── Primitives ── */

function Panel({
    title,
    subtitle,
    headerRight,
    children,
}: {
    title: string;
    subtitle?: string;
    headerRight?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className={s.panel}>
            <header className={s.panelHeader}>
                <div className={s.panelTitleRow}>
                    <span className={s.panelTitle}>{title}</span>
                    {subtitle && <span className={s.panelSubtitle}>{subtitle}</span>}
                </div>
                {headerRight && <div className={s.panelHeaderRight}>{headerRight}</div>}
            </header>
            <div className={s.panelBody}>{children}</div>
        </section>
    );
}

function fmtPeakDate(ms?: number): string {
    if (!ms) return "";
    return new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function PerformanceStat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
    return (
        <span className={s.performanceStat}>
            <small>{label}</small>
            <strong className={tone}>{value}</strong>
        </span>
    );
}

function groupAgentStats(stats: ProfileAgentStatsResponse["agents"], agents: Record<string, AgentMeta>) {
    const order = ["Duelist", "Initiator", "Controller", "Sentinel", "Unknown"];
    const groups = new Map<string, Array<{ agent: ProfileAgentStatsResponse["agents"][number]; meta?: AgentMeta }>>();
    for (const agent of stats) {
        const meta = agents[agent.characterId.toLowerCase()];
        const role = meta?.role || "Unknown";
        const items = groups.get(role) || [];
        items.push({ agent, meta });
        groups.set(role, items);
    }
    return order
        .filter((role) => groups.has(role))
        .map((role) => {
            const items = groups.get(role)!;
            return {
                label: role,
                roleIcon: items.find(({ meta }) => meta?.roleIcon)?.meta?.roleIcon || "",
                items,
            };
        });
}

function groupMapStats(
    stats: ProfileMapStatsResponse["maps"],
    maps: Record<string, { displayName: string; splash?: string; mode: MapMeta["mode"] }>,
) {
    const standard: Array<{ stat: ProfileMapStatsResponse["maps"][number]; meta?: { displayName: string; splash?: string; mode: MapMeta["mode"] } }> = [];
    const deathmatch: typeof standard = [];
    for (const stat of stats) {
        const meta = maps[stat.mapID.toLowerCase()];
        if (meta?.mode === "standard") standard.push({ stat, meta });
        if (meta?.mode === "teamdeathmatch") deathmatch.push({ stat, meta });
    }
    return [
        { label: "Standard maps", items: standard },
        { label: "Team Deathmatch", items: deathmatch },
    ].filter((group) => group.items.length > 0);
}

function TeammatesDialog({
    teammates,
    agents,
    onClose,
    onView,
    onCompare,
}: {
    teammates: ProfileTeammateStat[];
    agents: Record<string, AgentMeta>;
    onClose: () => void;
    onView: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    onCompare: (puuid: string) => void;
}) {
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    return createPortal(
        <div className={s.matesBackdrop} role="presentation" onMouseDown={onClose}>
            <section
                className={s.matesDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="mates-dialog-title"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header>
                    <div>
                        <h2 id="mates-dialog-title">Played with</h2>
                        <p>Players you queued with most, from your saved matches</p>
                    </div>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close">×</button>
                </header>
                <ol>
                    {teammates.map((mate, index) => {
                        const icon = agents[mate.characterId?.toLowerCase?.() || ""]?.icon;
                        const winRate = mate.decided ? Math.round((mate.wins / mate.decided) * 100) : null;
                        const body = (
                            <>
                                <span className={s.matesRank}>{index + 1}</span>
                                {icon ? <img src={icon} alt="" /> : <span className={s.railMateFallback} />}
                                <span className={s.matesCopy}>
                                    <strong>{mate.gameName || "Hidden player"}{mate.tagLine ? <em>#{mate.tagLine}</em> : null}</strong>
                                    <small>Last played {fmtAgo(mate.lastPlayed)}</small>
                                </span>
                                <span className={s.matesStat}><b>{mate.games}</b><small>games</small></span>
                                <span className={s.matesStat}>
                                    <b className={winRate === null ? "" : winRate >= 50 ? s.winText : s.lossText}>{winRate === null ? "—" : `${winRate}%`}</b>
                                    <small>win rate</small>
                                </span>
                            </>
                        );
                        return (
                            <li key={mate.subject}>
                                {mate.gameName ? (
                                    <button type="button" onClick={() => onView({ puuid: mate.subject, gameName: mate.gameName, tagLine: mate.tagLine })} title={`View ${mate.gameName}'s profile`}>
                                        {body}
                                    </button>
                                ) : <div>{body}</div>}
                                {mate.gameName ? <button type="button" className={s.matesCompare} onClick={() => onCompare(mate.subject)} aria-label={`Compare with ${mate.gameName}`}>Compare</button> : null}
                            </li>
                        );
                    })}
                </ol>
            </section>
        </div>,
        document.body,
    );
}
