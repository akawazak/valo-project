"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import type { Weapon } from "@/lib/types";
import {
    getAgentStats,
    getMapStats,
    getProfileMatchDetails,
    getProfileMatchHistory,
    getProfileOverview,
    getProfileSeasonSummary,
    getProfileSyncStatus,
    getRRHistory,
    postProfileSync,
    fetchCachedPublicJson,
    type ProfileAgentStatsResponse,
    type ProfileMapStatsResponse,
    type ProfileMatchDetails,
    type ProfileMatchSummary,
    type ProfileOverview,
    type ProfileRRHistory,
    type ProfileSeasonSummary,
    type ProfileSyncStatus,
} from "@/services/api";
import RRHistoryChart from "./RRHistoryChart";
import ProfileExtras, { type CareerView } from "./ProfileExtras";
import s from "./ProfilePanel.module.css";

interface Props {
    onConnectAccount?: () => void;
    ownPlayerCardId?: string;
    requestedProfile?: { puuid: string; gameName: string; tagLine: string } | null;
    onRequestedProfileChange: (profile: { puuid: string; gameName: string; tagLine: string } | null) => void;
    autoSyncMatches: boolean;
}

interface AgentMeta {
    name: string;
    icon: string;
    full?: string;
    role: string;
    roleIcon: string;
    abilities?: Record<string, { name: string; icon: string }>;
}

interface PublicAgent {
    uuid?: string;
    displayName: string;
    displayIcon?: string;
    killfeedPortrait?: string;
    fullPortrait?: string;
    role?: { displayName?: string; displayIcon?: string };
    abilities?: Array<{ slot?: string; displayName?: string; displayIcon?: string }>;
}
interface PublicMap {
    uuid?: string;
    displayName: string;
    splash?: string;
    displayIcon?: string;
    assetPath?: string;
    mapUrl?: string;
    xMultiplier?: number;
    yMultiplier?: number;
    xScalarToAdd?: number;
    yScalarToAdd?: number;
    callouts?: Array<{ regionName?: string; superRegionName?: string; location?: { x?: number; y?: number } }>;
}
interface PublicTierSet { tiers?: Array<{ tier?: number; smallIcon?: string }> }
interface PublicSeason { uuid?: string; displayName?: string; parentUuid?: string; startTime?: string; assetPath?: string }
interface MapMeta {
    uuid: string;
    name: string;
    splash: string;
    displayIcon: string;
    mode: "standard" | "teamdeathmatch" | "other";
    xMultiplier?: number;
    yMultiplier?: number;
    xScalarToAdd?: number;
    yScalarToAdd?: number;
    callouts: Array<{ name: string; superRegion: string; x: number; y: number }>;
}

function mapCalloutLabel(callout: MapMeta["callouts"][number]): string {
    const region = callout.superRegion.trim();
    const name = callout.name.trim();
    if (!region || name.toLowerCase().startsWith(region.toLowerCase())) return name || region || "Map area";
    return `${region} ${name}`;
}

function mapZoneLabel(callout: MapMeta["callouts"][number]): string {
    const region = callout.superRegion.trim().toLowerCase();
    if (region === "a" || region.startsWith("a ")) return "A Site";
    if (region === "b" || region.startsWith("b ")) return "B Site";
    if (region === "c" || region.startsWith("c ")) return "C Site";
    if (region.includes("mid")) return "Mid";
    return "Other";
}

function mapCalloutPlotPosition(map: MapMeta, callout: MapMeta["callouts"][number]) {
    const left = callout.y * map.xMultiplier! + map.xScalarToAdd!;
    let top = callout.x * map.yMultiplier! + map.yScalarToAdd!;

    // Valorant-API's Breeze A Lobby anchor lands below the non-transparent minimap geometry.
    if (
        (map.uuid === "2fb9a4fd-47b8-4e7d-a969-74b4046ebd53" || map.name.trim().toLowerCase() === "breeze")
        && callout.superRegion.trim().toLowerCase() === "a"
        && callout.name.trim().toLowerCase() === "lobby"
    ) {
        top -= 0.065;
    }

    return {
        left: Math.max(0, Math.min(1, left)),
        top: Math.max(0, Math.min(1, top)),
    };
}
interface SeasonMeta {
    uuid: string;
    name: string;
    parentUuid: string;
    startTime: number;
    isAct: boolean;
}
const RANK_GROUPS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
const QUEUE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "", label: "All queues" },
    { value: "competitive", label: "Competitive" },
    { value: "unrated", label: "Unrated" },
    { value: "spikerush", label: "Spike Rush" },
    { value: "deathmatch", label: "Deathmatch" },
    { value: "teamdeathmatch", label: "Team Deathmatch" },
    { value: "swiftplay", label: "Swiftplay" },
    { value: "premier", label: "Premier" },
    { value: "custom", label: "Custom" },
];
const QUEUE_LABEL: Record<string, string> = {
    competitive: "Competitive",
    unrated: "Unrated",
    spikerush: "Spike Rush",
    deathmatch: "Deathmatch",
    teamdeathmatch: "Team Deathmatch",
    swiftplay: "Swiftplay",
    premier: "Premier",
    custom: "Custom",
};
const PAGE_SIZES = [10, 20, 50];
const SEASON_QUEUES = [
    { value: "competitive", label: "Competitive" },
    { value: "all", label: "All modes" },
    { value: "swiftplay", label: "Swiftplay" },
    { value: "unrated", label: "Unrated" },
];
const FALLBACK_RANK_ICON =
    "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/smallicon.png";

// Session-scoped caches for valorant-api.com metadata so we only fetch
// agents / maps / competitive-tier icons once per app session.
let agentCache: Record<string, AgentMeta> | null = null;
let mapCache: Record<string, MapMeta> | null = null;
let tierAssetCache: Map<number, { smallIcon: string }> | null = null;
let agentPromise: Promise<Record<string, AgentMeta>> | null = null;
let mapPromise: Promise<Record<string, MapMeta>> | null = null;
let tierPromise: Promise<Map<number, { smallIcon: string }>> | null = null;
interface CachedProfileSnapshot {
    overview: ProfileOverview;
    seasonSummary: ProfileSeasonSummary | null;
    history: ProfileMatchSummary[];
    total: number;
    agentStats: ProfileAgentStatsResponse | null;
    mapStats: ProfileMapStatsResponse | null;
    syncStatus: ProfileSyncStatus | null;
    identity: { playerCardId: string; playerTitleId: string } | null;
}
const profileSnapshotCache = new Map<string, CachedProfileSnapshot>();
function tierLabel(tier: number, fallback?: string): string {
    if (!tier || tier <= 0) return "Unranked";
    if (tier >= 27) return "Radiant";
    const groupIdx = Math.floor((tier - 3) / 3);
    const sub = (tier - 3) % 3;
    const name = RANK_GROUPS[Math.min(groupIdx, RANK_GROUPS.length - 1)] ?? fallback ?? "Rank";
    return `${name} ${sub + 1}`;
}

function rankIconUrl(tier: number, tierAssets: Map<number, { smallIcon: string }>): string | null {
    return tierAssets.get(tier)?.smallIcon || FALLBACK_RANK_ICON;
}
function seasonLabel(id: string, seasons: Record<string, SeasonMeta>): string {
    const key = (id || "").toLowerCase();
    const season = seasons[key];
    if (!season) {
        // Show something more helpful than just an uppercase blob if the
        // short code doesn't match — Riot codes like "e7a3" can be expanded
        // by hand to "E7 A3" so the user knows it's a real act.
        if (/^e?\d{1,2}a\d{1,2}$/.test(key)) {
            return key.toUpperCase();
        }
        if (/^v\d{1,2}a\d{1,2}$/.test(key)) {
            return key.toUpperCase();
        }
        return id;
    }
    const parent = season.parentUuid ? seasons[season.parentUuid.toLowerCase()] : undefined;
    return parent ? `${parent.name} · ${season.name}` : season.name;
}

function fmtDate(ms: number): string {
    if (!ms) return "Never";
    return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function fmtLength(ms: number): string {
    if (!ms || ms < 0) return "--";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtPct(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return `${(n ?? 0).toFixed(1)}%`;
}

function fmtRatio(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return (n ?? 0).toFixed(2);
}

function statCount(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function fmtAgo(ms: number): string {
    if (!ms) return "—";
    const diff = Date.now() - ms;
    if (diff < 0) return "just now";
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function kdColor(kd: number | undefined): string {
    if (!Number.isFinite(kd ?? NaN)) return "";
    const v = kd ?? 0;
    if (v >= 2.0) return s.statElite;
    if (v >= 1.5) return s.statGreat;
    if (v >= 1.0) return s.statGood;
    if (v >= 0.8) return s.statAvg;
    return s.statPoor;
}
function hsColor(hs: number | undefined): string {
    if (!Number.isFinite(hs ?? NaN)) return "";
    const v = hs ?? 0;
    if (v >= 30) return s.statElite;
    if (v >= 22) return s.statGreat;
    if (v >= 15) return s.statGood;
    if (v >= 10) return s.statAvg;
    return s.statPoor;
}
function acsColor(acs: number | undefined): string {
    if (!Number.isFinite(acs ?? NaN)) return "";
    const v = acs ?? 0;
    if (v >= 280) return s.statElite;
    if (v >= 220) return s.statGreat;
    if (v >= 160) return s.statGood;
    if (v >= 120) return s.statAvg;
    return s.statPoor;
}
function adrColor(adr: number | undefined): string {
    if (!Number.isFinite(adr ?? NaN)) return "";
    const v = adr ?? 0;
    if (v >= 180) return s.statElite;
    if (v >= 145) return s.statGreat;
    if (v >= 115) return s.statGood;
    if (v >= 90) return s.statAvg;
    return s.statPoor;
}

function cleanError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err || "");
    if (!raw) return "Something went wrong.";
    if (/error sending request|failed to fetch|connection refused|unable to connect|localhost:31719/i.test(raw)) {
        return "Local backend is not reachable. Restart ValoVault, then sync again.";
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.message) return String(parsed.message);
        if (parsed?.error) return String(parsed.error);
    } catch {
        // Keep the original string.
    }
    if (/expired|unauthorized|forbidden|401|403/i.test(raw)) {
        return "Token expired or Riot rejected the session. Reconnect this account.";
    }
    return raw;
}

async function loadAgentMap(): Promise<Record<string, AgentMeta>> {
    if (agentCache) return agentCache;
    if (agentPromise) return agentPromise;
    agentPromise = (async () => {
        try {
            const d = await fetchCachedPublicJson<{ data?: PublicAgent[] }>("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
            const m: Record<string, AgentMeta> = {};
            for (const a of d?.data ?? []) {
                if (!a.uuid) continue;
                m[a.uuid.toLowerCase()] = {
                    name: a.displayName,
                    icon: a.displayIcon || a.killfeedPortrait || "",
                    full: a.fullPortrait || "",
                    role: a.role?.displayName || "Unknown",
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
    const [agentStats, setAgentStats] = useState<ProfileAgentStatsResponse | null>(null);
    const [mapStats, setMapStats] = useState<ProfileMapStatsResponse | null>(null);
    const [performanceView, setPerformanceView] = useState<"agents" | "maps">("agents");
    const [careerView, setCareerView] = useState<CareerView | null>(null);
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
    const [loading, setLoading] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [overviewLoadedFor, setOverviewLoadedFor] = useState("");
    const [historyLoadedFor, setHistoryLoadedFor] = useState("");
    const [committedProfilePuuid, setCommittedProfilePuuid] = useState("");
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const [rateLimitUntil, setRateLimitUntil] = useState(0);
    const [rateLimitNow, setRateLimitNow] = useState(0);
    const [identity, setIdentity] = useState<{ playerCardId: string; playerTitleId: string } | null>(null);
    const playerCards = useMemo(() => Object.fromEntries(playerCardAssets.map((card) => [card.uuid.toLowerCase(), {
        wide: card.wideArt || "",
        icon: card.displayIcon || "",
        name: card.displayName || "",
    }])), [playerCardAssets]);
    const playerCardImages = useMemo(() => Object.fromEntries(playerCardAssets.map((card) => [card.uuid.toLowerCase(), card.wideArt || card.displayIcon || ""])), [playerCardAssets]);
    const rewardAssets = useMemo(() => {
        const assets: Record<string, { name: string; image: string; type: string; owned: boolean }> = {};
        const ownedLevels = new Set(ownedLevelIDs.map((id) => id.toLowerCase()));
        const ownedBuddies = new Set(ownedBuddyIDs.map((item) => item.levelId.toLowerCase()));
        const ownedSprays = new Set(ownedSprayIDs.map((id) => id.toLowerCase()));
        const ownedCards = new Set(ownedCardIDs.map((id) => id.toLowerCase()));
        const ownedTitles = new Set(ownedTitleIDs.map((id) => id.toLowerCase()));
        const ownedAgents = new Set(ownedAgentIDs.map((id) => id.toLowerCase()));
        playerCardAssets.forEach((item) => { assets[item.uuid.toLowerCase()] = { name: item.displayName, image: item.displayIcon || item.smallArt, type: "Player Card", owned: ownedCards.has(item.uuid.toLowerCase()) }; });
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
    const autoSyncPuuidRef = useRef("");
    const historyRequestRef = useRef(0);
    const refreshRequestRef = useRef(0);
    const currentPuuidRef = useRef(puuid);
    currentPuuidRef.current = puuid;
    const viewProfile = useCallback((profile: { puuid: string; gameName: string; tagLine: string }) => {
        onRequestedProfileChange(profile.puuid === ownPuuid ? null : profile);
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [onRequestedProfileChange, ownPuuid]);
    const setPerformanceRail = useCallback((rail: HTMLDivElement | null) => {
        if (!rail) return;
        const handleWheel = (event: WheelEvent) => {
            if (rail.scrollWidth <= rail.clientWidth) return;
            const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            if (!delta) return;
            event.preventDefault();
            rail.scrollLeft += delta;
        };
        rail.addEventListener("wheel", handleWheel, { passive: false });
        return () => rail.removeEventListener("wheel", handleWheel);
    }, []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([loadAgentMap(), loadMaps(), loadTierAssets()]).then(([agentMap, mapMap, tiers]) => {
            if (cancelled) return;
            setAgents(agentMap);
            setMaps(mapMap);
            setTierAssets(tiers);
        });
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
            .catch((e) => console.warn("Failed to load season metadata", e));
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
        try {
            const matches = await getProfileMatchHistory(0, pageSize, queue || undefined, opts);
            if (request !== historyRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
            setHistory(matches.matches || []);
            setTotal(matches.total || 0);
            setHistoryLoaded(true);
            setHistoryLoadedFor(targetPuuid);
        } catch (err) {
            if (request === historyRequestRef.current && currentPuuidRef.current === targetPuuid) setError(cleanError(err));
        } finally {
            if (request === historyRequestRef.current && currentPuuidRef.current === targetPuuid) setHistoryLoading(false);
        }
    }, [opts, pageSize, puuid, queue]);

    const refresh = useCallback(async () => {
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
        setError("");
        try {
            const st = await getProfileSyncStatus(opts).catch(() => null);
            if (request !== refreshRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
            setSyncStatus(st);
            if (st?.errorKind === "rate_limited") {
                setRateLimitUntil(st.retryAt || Date.now() + 30_000);
            }

            const [ov, ag, mp] = await Promise.all([
                getProfileOverview(opts),
                getAgentStats(queue || undefined, opts),
                getMapStats(queue || undefined, opts),
            ]);
            if (request !== refreshRequestRef.current || currentPuuidRef.current !== targetPuuid) return;
            setOverview(ov);
            setSeasonSummary(ov.seasonSummary);
            setAgentStats(ag);
            setMapStats(mp);
            const nextIdentity = { playerCardId: ov.playerCardId || "", playerTitleId: ov.playerTitleId || "" };
            setIdentity(nextIdentity);
            setOverviewLoadedFor(targetPuuid);
            if (st?.lastError && st.errorKind !== "rate_limited" && !viewedProfile) setError(cleanError(st.lastError));
        } catch (err) {
            if (request === refreshRequestRef.current && currentPuuidRef.current === targetPuuid) {
                if (!viewedProfile || !/404|not found/i.test(String(err))) {
                    setError(cleanError(err));
                }
            }
        } finally {
            if (request === refreshRequestRef.current && currentPuuidRef.current === targetPuuid) {
                setLoading(false);
            }
        }
    }, [opts, puuid, queue, viewedProfile]);

    useEffect(() => {
        const cached = puuid ? profileSnapshotCache.get(puuid.toLowerCase()) : undefined;
        setOverview(cached?.overview ?? null);
        setSeasonSummary(cached?.seasonSummary ?? null);
        setRRHistory(null);
        setHistory(cached?.history ?? []);
        setTotal(cached?.total ?? 0);
        setHistoryLoaded(Boolean(cached));
        setAgentStats(cached?.agentStats ?? null);
        setMapStats(cached?.mapStats ?? null);
        setSyncStatus(cached?.syncStatus ?? null);
        setIdentity(cached?.identity ?? null);
        setOverviewLoadedFor(cached && puuid ? puuid : "");
        setHistoryLoadedFor(cached && puuid ? puuid : "");
        setCommittedProfilePuuid(cached && puuid ? puuid : "");
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
        void refresh();
    }, [refresh]);

    useEffect(() => {
        void loadHistory();
        return () => {
            historyRequestRef.current += 1;
        };
    }, [loadHistory]);

    useEffect(() => {
        const currentSeasonId = overview?.currentSeasonId;
        if (!puuid || !currentSeasonId) {
            setRRHistory(null);
            return;
        }
        let cancelled = false;
        getRRHistory(currentSeasonId, opts)
            .then((rr) => {
                if (cancelled) return;
                setRRHistory(rr);
            })
            .catch((err) => {
                if (!cancelled && !viewedProfile) setError(cleanError(err));
            });
        return () => {
            cancelled = true;
        };
    }, [opts, overview?.currentSeasonId, puuid, viewedProfile]);

    useEffect(() => {
        if (!puuid) return;
        let cancelled = false;
        getProfileSeasonSummary(seasonQueue, opts, overview?.currentSeasonId)
            .then((response) => {
                if (!cancelled) setSeasonSummary(response.summary);
            })
            .catch((err) => {
                if (!cancelled && !viewedProfile && !/404|page not found/i.test(String(err))) {
                    setError(cleanError(err));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [opts, overview?.currentSeasonId, puuid, seasonQueue, viewedProfile]);

    const runSync = useCallback(
        async (manual: boolean) => {
            if (!puuid) return;
            const targetPuuid = puuid;
            setSyncing(true);
            setError("");
            try {
                await postProfileSync(opts);
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
                    if (finalStatus.errorKind === "rate_limited") {
                        setRateLimitUntil(finalStatus.retryAt || Date.now() + 30_000);
                        return;
                    }
                    if (manual || viewedProfile) setError(cleanError(finalStatus.lastError));
                } else if (manual) {
                    showToast("Profile synced.");
                }
                await refresh();
                await loadHistory();
            } catch (err) {
                if (currentPuuidRef.current === targetPuuid) {
                    if (manual || viewedProfile) setError(cleanError(err));
                }
            } finally {
                if (currentPuuidRef.current === targetPuuid) {
                    setSyncing(false);
                }
            }
        },
        [loadHistory, opts, puuid, refresh, showToast, syncStatus?.totalMatches, viewedProfile],
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

    // Auto-sync every profile once per visit/account. The backend deduplicates
    // a sync that is already running, and this ref prevents render-driven
    // repeats while the same profile remains open.
    useEffect(() => {
        if (!autoSyncMatches || !puuid || loading || syncing) return;
        if (!syncStatus) {
            if (autoSyncPuuidRef.current !== puuid) {
                autoSyncPuuidRef.current = puuid;
                void runSync(false);
            }
            return;
        }
        if (syncStatus.inFlight) {
            autoSyncPuuidRef.current = puuid;
            void runSync(false);
            return;
        }
        if (autoSyncPuuidRef.current !== puuid) {
            autoSyncPuuidRef.current = puuid;
            void runSync(false);
        }
    }, [autoSyncMatches, loading, puuid, runSync, syncStatus, syncing]);

    const knownShortHistory = historyLoaded
        && !syncStatus?.inFlight
        && (syncStatus?.totalMatches ?? total) < 3;
    const requiredProfileMatches = knownShortHistory ? Math.min(3, total) : 3;
    const profileSnapshotCandidate = Boolean(puuid)
        && overviewLoadedFor === puuid
        && historyLoadedFor === puuid
        && Boolean(overview)
        && historyLoaded
        && history.length >= requiredProfileMatches;

    useEffect(() => {
        if (!puuid || !profileSnapshotCandidate || !overview) return;
        setCommittedProfilePuuid(puuid);
        profileSnapshotCache.set(puuid.toLowerCase(), {
            overview,
            seasonSummary,
            history,
            total,
            agentStats,
            mapStats,
            syncStatus,
            identity,
        });
    }, [agentStats, history, identity, mapStats, overview, profileSnapshotCandidate, puuid, seasonSummary, syncStatus, total]);

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
    const mapVisuals = useMemo(() => Object.fromEntries(Object.entries(maps).map(([id, meta]) => [id, meta.splash])), [maps]);
    const selectedAgentGroup = agentPerformanceGroups.find((group) => group.label === agentRole) || agentPerformanceGroups[0];
    const selectedMapGroup = mapPerformanceGroups.find((group) => group.label === mapMode) || mapPerformanceGroups[0];

    const playerCardId = identity?.playerCardId || (!viewedProfile ? ownPlayerCardId : "");
    const cardData = playerCardId ? playerCards[playerCardId.toLowerCase()] : null;
    const titleText = identity?.playerTitleId ? playerTitles[identity.playerTitleId.toLowerCase()] : "";
    const profileSnapshotFailed = Boolean(error) && !loading && !historyLoading;
    const showProfileFacade = Boolean(puuid) && committedProfilePuuid !== puuid;

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

    if (showProfileFacade) {
        const overviewReady = overviewLoadedFor === puuid;
        const matchesReady = historyLoadedFor === puuid && historyLoaded && history.length >= requiredProfileMatches;
        const profileLoadMessage = matchesReady
            ? "Finishing profile..."
            : overviewReady
                ? "Loading recent matches..."
                : "Loading rank and identity...";
        return (
            <div className={s.profileFacade} role="status" aria-live="polite">
                {viewedProfile && (
                    <button type="button" className={s.profileFacadeBack} onClick={() => onRequestedProfileChange(null)}>
                        ← Back to my profile
                    </button>
                )}
                <div className={s.profileFacadeContent}>
                    {profileSnapshotFailed ? (
                        <>
                            <span className={s.profileLoadKicker}>PROFILE UNAVAILABLE</span>
                            <strong>Couldn&apos;t load this profile</strong>
                            <small>{error}</small>
                            <button type="button" className={s.profileLoadRetry} onClick={() => { void refresh(); void loadHistory(); }}>
                                Try again
                            </button>
                        </>
                    ) : (
                        <>
                            <span className={s.profileLoadKicker}>PROFILE</span>
                            <strong>{viewedProfile?.gameName || activeAccount.gameName || "Player"}</strong>
                            <small>{profileLoadMessage}</small>
                            <div className={s.profileLoadTrack} aria-hidden="true">
                                <span className={overviewReady ? s.profileLoadTrackComplete : s.profileLoadTrackActive} />
                                <span className={matchesReady ? s.profileLoadTrackComplete : overviewReady ? s.profileLoadTrackActive : ""} />
                            </div>
                            <div className={s.profileLoadSteps} aria-hidden="true">
                                <span className={overviewReady ? s.profileLoadStepComplete : s.profileLoadStepActive}>Rank &amp; identity</span>
                                <span className={matchesReady ? s.profileLoadStepComplete : overviewReady ? s.profileLoadStepActive : ""}>Recent matches</span>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }

    const heroBg = cardData?.wide || identityTopAgentMeta?.full;
    const viewedGameName = overview?.gameName || viewedProfile?.gameName || activeAccount?.gameName || "Unknown";
    const viewedTagLine = overview?.tagLine || viewedProfile?.tagLine || activeAccount?.tagLine || "";

    const stats: Array<{ label: string; value: string; accent?: boolean }> = [
        { label: "Rank", value: currentRankLabel, accent: true },
        { label: "Rating", value: currentTier >= 27 ? "MAX" : `${currentRR} RR` },
        { label: "Peak", value: peakRankLabel },
        { label: "Win Rate", value: fmtPct(identitySummary?.winrate) },
        { label: "K/D", value: fmtRatio(identitySummary?.avgKda) },
        { label: "Matches", value: String(identitySummary?.matches ?? 0) },
    ];

    return (
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
                        <div className={s.railSubline}>
                            {episodeActLabel && <span>{episodeActLabel}</span>}
                        </div>
                        <div className={s.railSynced}>{fmtAgo(syncStatus?.lastSyncedAt || 0)} synced</div>

                        {currentRankIcon && (
                            <div className={s.railRank}>
                                <Image
                                    src={currentRankIcon}
                                    alt={currentRankLabel}
                                    width={88}
                                    height={88}
                                    className={s.railRankIcon}
                                    loading="eager"
                                    unoptimized
                                />
                                <div className={s.railRankName}>{currentRankLabel}</div>
                                <div className={s.railRankRr}>
                                    {currentTier >= 27 ? "MAX" : `${currentRR} RR`}
                                    {lastRRDelta != null && currentTier < 27 && (
                                        <span className={`${s.railRankDelta} ${lastRRDelta > 0 ? s.deltaUp : s.deltaDown}`}>
                                            {lastRRDelta > 0 ? "▲" : "▼"} {Math.abs(lastRRDelta)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className={s.railStats}>
                            {stats.slice(2).map((stat) => (
                                <div key={stat.label} className={s.railStat}>
                                    <span className={s.railStatLabel}>{stat.label}</span>
                                    <span className={s.railStatValue}>{stat.value}</span>
                                </div>
                            ))}
                        </div>

                        {/* ── Command bar (compact, in rail) ── */}
                        <div className={s.railCommand}>
                            <select
                                className={s.select}
                                value={queue}
                                onChange={(e) => setQueue(e.target.value)}
                                aria-label="Queue filter"
                            >
                                {QUEUE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                            <div className={s.railCommandBtns}>
                                <button className={s.ghostBtn} onClick={refresh} disabled={isBusy}>
                                    Refresh
                                </button>
                                <button className={s.primaryBtn} onClick={() => runSync(true)} disabled={isBusy}>
                                    {isBusy ? "…" : "Sync"}
                                </button>
                            </div>
                            <button className={s.railProgressButton} type="button" onClick={() => setCareerView("progression")}>
                                <span aria-hidden="true">◇</span> Open XP Center
                            </button>
                        </div>
                    </div>
                </aside>

                {/* ── Main content ── */}
                <main className={s.main}>
                    {/* ── Tabs ── */}
                    <div className={s.body}>
                        <>
                                <div className={s.overviewTop}>
                                    <Panel
                                        title="Season Averages"
                                        subtitle={episodeActLabel || "Current act"}
                                        headerRight={
                                            <div className={s.seasonHeaderActions}>
                                                <div className={s.seasonQueueTabs} role="group" aria-label="Season average mode">
                                                    {SEASON_QUEUES.map((option) => (
                                                        <button
                                                            type="button"
                                                            key={option.value}
                                                            className={seasonQueue === option.value ? s.seasonQueueTabActive : ""}
                                                            onClick={() => setSeasonQueue(option.value)}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div className={s.profileTools}>
                                                    <button type="button" onClick={() => setCareerView("analytics")}><span aria-hidden="true">↗</span> Insights</button>
                                                    <button type="button" onClick={() => setCareerView("progression")}><span aria-hidden="true">◇</span> Battle Pass</button>
                                                    <button type="button" onClick={() => setCareerView("leaderboard")}><span aria-hidden="true">#</span> Leaderboard</button>
                                                </div>
                                            </div>
                                        }
                                    >
                                        <div className={s.metricGrid}>
                                            <Metric label="Win Rate" value={fmtPct(summary?.winrate)} tone={s.metricAccent} />
                                            <Metric label="K/D Ratio" value={fmtRatio(summary?.avgKda)} tone={kdColor(summary?.avgKda)} />
                                            <Metric label="Headshot %" value={fmtPct(summary?.avgHsPct)} tone={hsColor(summary?.avgHsPct)} />
                                            <Metric label="Matches" value={String(summary?.matches ?? 0)} />
                                            <Metric label="Top Agent" value={topAgentMeta?.name || summary?.topAgent || "—"} />
                                            <Metric label="Peak Rank" value={peakRankLabel} />
                                        </div>
                                    </Panel>

                                    <Panel title="Career Peak" subtitle="Highest verified competitive tier">
                                        <div className={s.peakCard}>
                                            <div className={s.peakEmblem}>
                                                <Image
                                                    src={rankIconUrl(peakTier, tierAssets) || FALLBACK_RANK_ICON}
                                                    alt=""
                                                    width={78}
                                                    height={78}
                                                    loading="eager"
                                                    unoptimized
                                                />
                                            </div>
                                            <div className={s.peakCopy}>
                                                <span className={s.peakEyebrow}>Personal best</span>
                                                <strong>{peakRankLabel}</strong>
                                                <span>
                                                    {overview?.peakRank?.reachedAt
                                                        ? `Reached ${fmtPeakDate(overview.peakRank.reachedAt)}`
                                                        : "Peak date unavailable from verified RR updates"}
                                                </span>
                                            </div>
                                            <div className={s.peakAct}>
                                                <span>Recorded in</span>
                                                <strong>
                                                    {overview?.peakRank?.seasonId
                                                        ? seasonLabel(overview.peakRank.seasonId, seasons)
                                                        : "Career history"}
                                                </strong>
                                            </div>
                                        </div>
                                    </Panel>
                                </div>

                                <Panel
                                    title="RR Progression"
                                    subtitle={
                                        rrHistory?.snapshots?.length
                                            ? rrHistory.source === "tier"
                                                ? `${rrHistory.snapshots.length} ranked tier checkpoints · exact RR unavailable`
                                                : `${rrHistory.snapshots.length} ranked games tracked`
                                            : `${episodeActLabel || "Current act"} has no cached ranked progression`
                                    }
                                >
                                    <RRHistoryChart
                                        snapshots={rrHistory?.snapshots ?? []}
                                        source={rrHistory?.source}
                                        height={250}
                                    />
                                </Panel>

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
                                                    <h3>
                                                        {selectedAgentGroup.roleIcon && <img src={selectedAgentGroup.roleIcon} alt="" aria-hidden="true" />}
                                                        {selectedAgentGroup.label}
                                                    </h3>
                                                    <div ref={setPerformanceRail} className={s.agentPerformanceRail}>
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
                                                <div ref={setPerformanceRail} className={s.mapStrip}>
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
                                        <select
                                            className={`${s.select} ${s.pageSizeSelect}`}
                                            value={pageSize}
                                            onChange={(e) => setPageSize(Number(e.target.value))}
                                            aria-label="Matches per page"
                                        >
                                            {PAGE_SIZES.map((size) => (
                                                <option key={size} value={size}>
                                                    {size}
                                                </option>
                                            ))}
                                        </select>
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
                                            {history.map((match) => (
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
                                    )}
                                </Panel>
                        </>
                    </div>
                </main>
            </div>
            <ProfileExtras
                view={careerView}
                onClose={() => setCareerView(null)}
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
            />
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

function Metric({
    label,
    value,
    tone = "",
}: {
    label: string;
    value: string;
    tone?: string;
}) {
    return (
        <div className={s.metric}>
            <span className={s.metricLabel}>{label}</span>
            <span className={`${s.metricValue} ${tone}`}>{value}</span>
        </div>
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

type MatchKillEvent = NonNullable<ProfileMatchDetails["kills"]>[number];
type MatchDetailPlayer = ProfileMatchDetails["players"][number];

interface DuelFocus {
    id: string;
    label: string;
    events: MatchKillEvent[];
    index: number;
}

interface DuelFinisher {
    name: string;
    icon: string;
    kind: "ability" | "weapon";
}

function fightEventKey(event: MatchKillEvent): string {
    return `${event.roundNum}:${event.gameTime}:${event.killer.toLowerCase()}:${event.victim.toLowerCase()}`;
}

const RIOT_ABILITY_WEAPON_SLOTS: Record<string, string> = {
    "856d9a7e-4b06-dc37-15dc-9d809c37cb90": "ability1", // Chamber — Headhunter
    "39099fb5-4293-def4-1e09-2e9080ce7456": "ultimate", // Chamber — Tour de Force
    "95336ae4-45d4-1032-cfaf-6bad01910607": "ultimate", // Neon — Overdrive
};

function riotAbilitySlotKey(damageType: string, damageItem: string): string {
    if (damageType.includes("ability")) {
        return damageItem === "grenadeability" ? "grenade" : damageItem;
    }
    return RIOT_ABILITY_WEAPON_SLOTS[damageItem] || "";
}

function MapDuelFinisher({ finisher, offset }: { finisher: DuelFinisher; offset: { x: number; y: number } }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
        <span
            className={`${s.mapDuelWeapon} ${finisher.kind === "ability" ? s.mapDuelWeaponAbility : s.mapDuelWeaponGun}`}
            title={finisher.name}
            style={{ "--weapon-x": `${offset.x}px`, "--weapon-y": `${offset.y}px` } as CSSProperties}
        >
            <Image
                src={finisher.icon}
                alt={finisher.name}
                width={finisher.kind === "ability" ? 20 : 40}
                height={finisher.kind === "ability" ? 20 : 18}
                unoptimized
                onError={() => setFailed(true)}
            />
        </span>
    );
}

function MapDuelMarker({
    point,
    player,
    agent,
    dead,
    local,
    finisher,
    avoidPoint,
}: {
    point: { left: number; top: number };
    player?: MatchDetailPlayer;
    agent?: AgentMeta;
    dead: boolean;
    local: boolean;
    finisher?: DuelFinisher;
    avoidPoint?: { left: number; top: number };
}) {
    const playerName = local ? "You" : player?.gameName || agent?.name || "Player";
    const weaponOffset = useMemo(() => {
        if (!avoidPoint) return { x: 0, y: -30 };
        const dx = point.left - avoidPoint.left;
        const dy = point.top - avoidPoint.top;
        const y = Math.abs(dy) < 0.035 ? -30 : dy > 0 ? 37 : -30;
        const blockedByVerticalEdge = (y < 0 && point.top < 0.11) || (y > 0 && point.top > 0.88);
        if (!blockedByVerticalEdge) return { x: 0, y };

        let x = dx >= 0 ? 34 : -34;
        if ((x < 0 && point.left < 0.11) || (x > 0 && point.left > 0.89)) x *= -1;
        return { x, y: 0 };
    }, [avoidPoint, point.left, point.top]);
    return (
        <span
            className={`${s.mapDuelMarker} ${dead ? s.mapDuelMarkerDead : s.mapDuelMarkerKiller} ${local ? s.mapDuelMarkerLocal : ""}`}
            style={{ left: `${point.left * 100}%`, top: `${point.top * 100}%` }}
            title={`${playerName}${dead ? " was eliminated" : " got the elimination"}`}
            aria-label={`${playerName}${dead ? " was eliminated" : " got the elimination"}`}
        >
            {!dead && finisher?.icon ? <MapDuelFinisher key={finisher.icon} finisher={finisher} offset={weaponOffset} /> : null}
            <span className={s.mapDuelPortrait}>
                {agent?.icon ? (
                    <Image src={agent.icon} alt={agent.name} width={42} height={42} unoptimized />
                ) : (
                    <b>{(agent?.name || playerName).slice(0, 1)}</b>
                )}
                {dead ? <i aria-hidden="true" /> : null}
            </span>
            <small>{playerName}</small>
        </span>
    );
}

/* ── Match row with expandable scoreboard ── */

function MatchRow({
    match,
    detail,
    expanded,
    loading,
    agents,
    maps,
    weapons,
    tierAssets,
    profilePuuid,
    region,
    onToggle,
    onViewProfile,
}: {
    match: ProfileMatchSummary;
    detail?: ProfileMatchDetails;
    expanded: boolean;
    loading: boolean;
    agents: Record<string, AgentMeta>;
    maps: Record<string, MapMeta>;
    weapons: Weapon[];
    tierAssets: Map<number, { smallIcon: string }>;
    profilePuuid: string;
    region: string;
    onToggle: () => void;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const [activeMatchTab, setActiveMatchTab] = useState<"scoreboard" | "rounds" | "map">("scoreboard");
    const [loadedAnalytics, setLoadedAnalytics] = useState<ProfileMatchDetails | null>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsError, setAnalyticsError] = useState("");
    const agentMeta = agents[match.localPlayer.characterId?.toLowerCase?.() || ""];
    const mapMeta = maps[match.mapID?.toLowerCase?.() || ""];
    const agentName = agentMeta?.name || match.localPlayer.characterId?.slice(0, 8) || "Agent";
    const mapName = mapMeta?.name || match.mapID?.slice(0, 8) || "Map";
    const resultClass = match.win ? s.winText : s.lossText;
    const queueName = QUEUE_LABEL[match.queueID] || match.queueID || "Queue";

    const matchTier = match.tierAfter ?? 0;
    const matchRRIcon = rankIconUrl(matchTier, tierAssets);
    const matchRRLabel = tierLabel(matchTier);
    const rrEarned = match.rrEarned ?? 0;
    const rrSign = rrEarned > 0 ? "+" : "";
    const blueSide = match.localPlayer.teamId.toLowerCase() === "blue";
    const ownRounds = blueSide ? match.blueRoundsWon : match.redRoundsWon;
    const enemyRounds = blueSide ? match.redRoundsWon : match.blueRoundsWon;
    const completionState = detail?.matchInfo.completionState || "Completed";
    const unusualCompletion = !/^completed$/i.test(completionState);

    const openAnalyticsTab = useCallback(async (tab: "rounds" | "map") => {
        setActiveMatchTab(tab);
        if ((detail?.rounds?.length || 0) > 0 || loadedAnalytics !== null || analyticsLoading) return;
        setAnalyticsLoading(true);
        setAnalyticsError("");
        try {
            const refreshed = await getProfileMatchDetails(match.matchId, { puuid: profilePuuid, region, analytics: true });
            setLoadedAnalytics(refreshed);
        } catch (error) {
            setAnalyticsError(error instanceof Error ? error.message : "Could not load map events for this match.");
        } finally {
            setAnalyticsLoading(false);
        }
    }, [analyticsLoading, detail?.rounds?.length, loadedAnalytics, match.matchId, profilePuuid, region]);

    const kda = match.localPlayer.kda;
    const hsPct = match.localPlayer.hsPct;
    const adr = Math.round(match.localPlayer.adr || 0);
    const acs = Math.round(match.localPlayer.acs || 0);
    const kdaText = `${match.localPlayer.kills}/${match.localPlayer.deaths}/${match.localPlayer.assists}`;
    const detailedLocalPlayer = detail?.players.find((player) => player.isLocal);
    const detailedPartyMembers = detailedLocalPlayer?.partyId
        ? (detail?.players || [])
            .filter((player) => !player.isLocal && player.partyId === detailedLocalPlayer.partyId)
            .map((player) => ({
                subject: player.subject,
                gameName: player.gameName,
                tagLine: player.tagLine,
                characterId: player.characterId,
                playerCardId: player.playerCardId,
                playerTitleId: player.playerTitleId,
            }))
        : [];
    const partyMembers = ((match.partyMembers || []).length > 0 ? match.partyMembers || [] : detailedPartyMembers)
        .filter((member) => member.subject !== match.localPlayer.subject);
    const partyPreview = partyMembers.slice(0, 3);
    const partyLabel = ["SOLO", "DUO", "TRIO", "4-STACK", "5-STACK"][Math.min(4, partyMembers.length)];
    const partyNames = partyMembers
        .map((member) => member.gameName ? `${member.gameName}${member.tagLine ? `#${member.tagLine}` : ""}` : "Hidden player")
        .join(", ");
    const partyPreviewNames = partyPreview
        .map((member) => member.gameName || agents[member.characterId?.toLowerCase?.() || ""]?.name || "Hidden")
        .join(", ");
    const partyOverflow = partyMembers.length - partyPreview.length;

    return (
        <div className={`${s.matchWrap} ${expanded ? s.matchWrapExpanded : ""}`}>
            <button type="button" className={`${s.matchRow} ${match.win ? s.matchRowWin : s.matchRowLoss}`} onClick={() => {
                if (!expanded) setActiveMatchTab("scoreboard");
                onToggle();
            }} aria-expanded={expanded}>
                <div className={s.matchResultBlock}>
                    <div className={s.matchResultTop}>
                        <span className={`${s.matchResultText} ${resultClass}`}>{match.win ? "WIN" : "LOSS"}</span>
                        <span className={s.matchScore}>
                            <b className={match.win ? s.winText : s.lossText}>{ownRounds}</b>
                            <i>:</i>
                            <b>{enemyRounds}</b>
                        </span>
                    </div>
                    <span className={s.matchResultMeta}>
                        {queueName} · {fmtLength(match.gameLengthMillis)}
                    </span>
                    <div className={s.matchDateRow}>
                        <span className={s.matchDateChip}>{fmtDate(match.gameStartMillis)}</span>
                        <span className={s.matchAgoChip}>{fmtAgo(match.gameStartMillis)}</span>
                    </div>
                </div>

                <div className={s.matchMain}>
                    <div className={s.matchAgent}>
                        {agentMeta?.icon ? (
                            <Image src={agentMeta.icon} alt={agentName} width={56} height={56} unoptimized className={s.matchAgentIcon} />
                        ) : (
                            <div className={`${s.matchAgentIcon} ${s.matchAgentPlaceholder}`} />
                        )}
                        <div className={s.matchAgentMeta}>
                            <div className={s.matchAgentName}>{agentName}</div>
                            <div className={s.matchMapName}>{mapName}</div>
                            <div className={s.matchPartyInline} title={partyNames || "No queued teammates detected"}>
                                <span className={s.matchPartyBadge}>{partyLabel}</span>
                                {partyPreview.length > 0 && (
                                    <span className={s.matchPartyAvatars} aria-label={`Queued with ${partyNames}`}>
                                        {partyPreview.map((member) => {
                                            const memberMeta = agents[member.characterId?.toLowerCase?.() || ""];
                                            return memberMeta?.icon ? (
                                                <Image
                                                    key={member.subject}
                                                    src={memberMeta.icon}
                                                    alt=""
                                                    width={20}
                                                    height={20}
                                                    unoptimized
                                                    className={s.matchPartyIcon}
                                                />
                                            ) : <span key={member.subject} className={s.matchPartyDot} aria-hidden="true" />;
                                        })}
                                        <small>
                                            {partyPreviewNames}
                                            {partyOverflow > 0 ? ` +${partyOverflow}` : ""}
                                        </small>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={s.matchStats}>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>KDA</span>
                            <strong className={s.matchStatValue}>{kdaText}</strong>
                            <span className={`${s.matchStatSub} ${kdColor(kda)}`}>{fmtRatio(kda)}</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>HS%</span>
                            <strong className={`${s.matchStatValue} ${hsColor(hsPct)}`}>{fmtPct(hsPct)}</strong>
                            <span className={s.matchStatSub}>accuracy</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ADR</span>
                            <strong className={`${s.matchStatValue} ${adrColor(adr)}`}>{adr}</strong>
                            <span className={s.matchStatSub}>dmg/rd</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ACS</span>
                            <strong className={`${s.matchStatValue} ${acsColor(acs)}`}>{acs}</strong>
                            <span className={s.matchStatSub}>score/rd</span>
                        </div>
                    </div>
                </div>

                <div className={s.matchVisual}>
                    {mapMeta?.splash ? (
                        <div className={s.matchMapCard} style={{ backgroundImage: `url(${mapMeta.splash})` }}>
                            <div className={s.matchMapOverlay} />
                            <div className={s.matchMapCaption}>
                                <span>{mapName}</span>
                                <small>{queueName}</small>
                            </div>
                        </div>
                    ) : (
                        <div className={s.matchMapCardEmpty}>
                            <span>{mapName}</span>
                        </div>
                    )}

                    {matchTier > 0 ? (
                        <div className={s.matchRankCell}>
                            <div className={s.matchRankRow}>
                                {matchRRIcon && (
                                    <Image src={matchRRIcon} alt={matchRRLabel} width={24} height={24} unoptimized className={s.matchRankIcon} />
                                )}
                                <span className={s.matchRankName}>{matchRRLabel}</span>
                            </div>
                            <div className={`${s.matchRrBadge} ${rrEarned > 0 ? s.rrGain : rrEarned < 0 ? s.rrLoss : s.rrNeutral}`}>
                                {rrSign}
                                {rrEarned}
                            </div>
                            {(match.performanceBonus || match.afkPenalty) ? <div className={s.matchRrReceipt}>
                                {match.performanceBonus ? <span data-tone="good">+{match.performanceBonus} performance</span> : null}
                                {match.afkPenalty ? <span data-tone="danger">{match.afkPenalty > 0 ? "-" : ""}{Math.abs(match.afkPenalty)} AFK</span> : null}
                            </div> : null}
                        </div>
                    ) : match.isRanked ? (
                        <div className={s.matchTimeCell}>
                            <span className={s.matchTime}>No RR change cached</span>
                        </div>
                    ) : null}
                </div>

                <span className={s.matchChevron} aria-hidden="true">
                    {expanded ? "⌃" : loading ? "…" : "›"}
                </span>
            </button>

            {expanded && createPortal(
                <div className={s.matchModalBackdrop} role="presentation" onMouseDown={onToggle}>
                    <section
                        className={`${s.matchModal} ${match.win ? s.matchModalWin : s.matchModalLoss}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${mapName} match details`}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <header
                            className={s.matchModalHeader}
                            style={mapMeta?.splash ? { backgroundImage: `url(${mapMeta.splash})` } : undefined}
                        >
                            <div className={s.matchModalHeaderShade} />
                            <div className={s.matchModalHeading}>
                                <span className={`${s.matchModalResult} ${resultClass}`}>{match.win ? "Victory" : "Defeat"}</span>
                                <h2>{mapName}</h2>
                                <p>{queueName} · {fmtLength(match.gameLengthMillis)} · {fmtDate(match.gameStartMillis)}</p>
                                {unusualCompletion ? <span className={s.matchCompletionBadge}>{completionState}</span> : null}
                            </div>
                            <div className={s.matchModalScore}>
                                <strong className={match.win ? s.winText : s.lossText}>{ownRounds}</strong>
                                <span>-</span>
                                <strong>{enemyRounds}</strong>
                            </div>
                            <button type="button" className={s.matchModalClose} onClick={onToggle} aria-label="Close match details">×</button>
                        </header>
                        <nav className={s.matchDetailTabs} aria-label="Match detail views">
                            <button
                                type="button"
                                className={activeMatchTab === "rounds" ? s.matchDetailTabActive : ""}
                                onClick={() => void openAnalyticsTab("rounds")}
                            >
                                Round review
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "scoreboard" ? s.matchDetailTabActive : ""}
                                onClick={() => setActiveMatchTab("scoreboard")}
                            >
                                Scoreboard
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "map" ? s.matchDetailTabActive : ""}
                                onClick={() => void openAnalyticsTab("map")}
                            >
                                Map
                            </button>
                        </nav>
                        <div className={s.matchModalBody}>
                            {loading ? (
                                <div className={s.placeholder}>Loading scoreboard…</div>
                            ) : detail ? (
                                activeMatchTab === "scoreboard" ? (
                                    <Scoreboard
                                        detail={detail}
                                        partyMembers={partyMembers}
                                        agents={agents}
                                        tierAssets={tierAssets}
                                        onViewProfile={onViewProfile}
                                    />
                                ) : activeMatchTab === "rounds" ? (
                                    <RoundReview
                                        detail={loadedAnalytics ?? detail}
                                        map={mapMeta}
                                        agents={agents}
                                        weapons={weapons}
                                    />
                                ) : (
                                    <MatchMapAnalytics
                                        detail={loadedAnalytics ?? detail}
                                        kills={loadedAnalytics?.kills ?? detail.kills ?? []}
                                        map={mapMeta}
                                        agents={agents}
                                        weapons={weapons}
                                        loading={analyticsLoading}
                                        error={analyticsError}
                                    />
                                )
                            ) : (
                                <div className={s.placeholder}>No details cached for this match.</div>
                            )}
                        </div>
                    </section>
                </div>,
                document.body,
            )}
        </div>
    );
}

function RoundReview({
    detail,
    map,
    agents,
    weapons,
}: {
    detail: ProfileMatchDetails;
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
}) {
    const rounds = detail.rounds || [];
    const local = detail.players.find((player) => player.isLocal);
    const localSubject = local?.subject.toLowerCase() || "";
    const localTeam = local?.teamId.toLowerCase() || "";
    const [selectedRoundNum, setSelectedRoundNum] = useState(rounds[0]?.roundNum ?? 0);
    const weaponById = useMemo(() => new Map(weapons.map((weapon) => [weapon.uuid.toLowerCase(), weapon])), [weapons]);
    const selectedRound = rounds.find((round) => round.roundNum === selectedRoundNum) || rounds[0];
    const selectedStat = selectedRound?.playerStats?.find((stat) => stat.subject.toLowerCase() === localSubject);
    const selectedKills = (detail.kills || []).filter((event) => event.roundNum === selectedRound?.roundNum);
    const localKills = selectedKills.filter((event) => event.killer.toLowerCase() === localSubject);
    const localDeaths = selectedKills.filter((event) => event.victim.toLowerCase() === localSubject);
    const localAssists = selectedKills.filter((event) => event.assistants?.some((assistant) => assistant.toLowerCase() === localSubject));
    const damageDone = selectedStat?.damage?.reduce((sum, event) => sum + event.damage, 0) || 0;
    const headshots = selectedStat?.damage?.reduce((sum, event) => sum + event.headshots, 0) || 0;
    const roundWon = selectedRound?.winningTeam.toLowerCase() === localTeam;
    const weapon = selectedStat?.economy.weapon ? weaponById.get(selectedStat.economy.weapon.toLowerCase()) : undefined;
    const hasDetailedRounds = rounds.some((round) => (round.playerStats?.length || 0) > 0);
    const selectedEvents = [...localKills, ...localDeaths];
    const selectedAltFireEvents = selectedEvents.filter((event) => event.secondaryFire);
    const canPlot = Boolean(map?.displayIcon && typeof map.xMultiplier === "number" && typeof map.yMultiplier === "number" && typeof map.xScalarToAdd === "number" && typeof map.yScalarToAdd === "number");
    const plot = (x: number, y: number) => ({
        left: Math.max(0, Math.min(1, y * map!.xMultiplier! + map!.xScalarToAdd!)) * 100,
        top: Math.max(0, Math.min(1, x * map!.yMultiplier! + map!.yScalarToAdd!)) * 100,
    });
    const playerBySubject = useMemo(() => new Map(detail.players.map((player) => [player.subject.toLowerCase(), player])), [detail.players]);
    const firstKills = useMemo(() => {
        const byRound = new Map<number, MatchKillEvent>();
        for (const event of detail.kills || []) {
            const current = byRound.get(event.roundNum);
            if (!current || event.gameTime < current.gameTime) byRound.set(event.roundNum, event);
        }
        return byRound;
    }, [detail.kills]);
    const opening = [...firstKills.values()].filter((event) => event.killer.toLowerCase() === localSubject || event.victim.toLowerCase() === localSubject);
    const openingWins = opening.filter((event) => event.killer.toLowerCase() === localSubject);
    const convertedOpeningWins = openingWins.filter((event) => rounds.find((round) => round.roundNum === event.roundNum)?.winningTeam.toLowerCase() === localTeam).length;
    const allLocalDeaths = (detail.kills || []).filter((event) => event.victim.toLowerCase() === localSubject);
    const tradedDeaths = allLocalDeaths.filter((death) => (detail.kills || []).some((event) => event.roundNum === death.roundNum && event.roundTime >= death.roundTime && event.roundTime - death.roundTime <= 5_000 && event.victim.toLowerCase() === death.killer.toLowerCase() && playerBySubject.get(event.killer.toLowerCase())?.teamId.toLowerCase() === localTeam)).length;
    const totalAbilityEffects = rounds.reduce((sum, round) => {
        const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
        return sum + (stat?.ability.grenade || 0) + (stat?.ability.ability1 || 0) + (stat?.ability.ability2 || 0) + (stat?.ability.ultimate || 0);
    }, 0);
    const abilityUsage = ([
        ["grenade", local?.abilityCasts?.grenade || 0],
        ["ability1", local?.abilityCasts?.ability1 || 0],
        ["ability2", local?.abilityCasts?.ability2 || 0],
        ["ultimate", local?.abilityCasts?.ultimate || 0],
    ] as const).filter(([, count]) => count > 0).map(([slot, count]) => ({
        count,
        name: agents[local?.characterId.toLowerCase() || ""]?.abilities?.[slot]?.name || ({ grenade: "Signature", ability1: "Ability 1", ability2: "Ability 2", ultimate: "Ultimate" } as const)[slot],
    }));
    const totalAbilityCasts = abilityUsage.reduce((sum, ability) => sum + ability.count, 0);
    const objectiveLines = [
        selectedRound?.bombPlanter ? `${selectedRound.bombPlanter.toLowerCase() === localSubject ? "You planted" : "Spike planted"}${selectedRound.plantSite ? ` at ${selectedRound.plantSite}` : ""}${selectedRound.plantRoundTime ? ` · ${fmtLength(selectedRound.plantRoundTime)}` : ""}` : "",
        selectedRound?.bombDefuser ? `${selectedRound.bombDefuser.toLowerCase() === localSubject ? "You defused" : "Spike defused"}${selectedRound.defuseRoundTime ? ` · ${fmtLength(selectedRound.defuseRoundTime)}` : ""}` : "",
    ].filter(Boolean);
    const flaggedRounds = rounds.filter((round) => round.playerStats?.some((entry) => entry.subject.toLowerCase() === localSubject && (entry.wasAfk || entry.wasPenalized || entry.stayedInSpawn)));
    const roundTimeline = useMemo(() => {
        if (!selectedRound) return [];
        const timeline: Array<{
            id: string;
            time: number;
            order: number;
            kind: "economy" | "kill" | "plant" | "defuse" | "result";
            label: string;
            detail: string;
            icon?: string;
            local?: boolean;
        }> = [];
        const nameOf = (subject?: string) => {
            if (!subject) return "Unknown player";
            if (subject.toLowerCase() === localSubject) return "You";
            const player = playerBySubject.get(subject.toLowerCase());
            return player?.gameName || "Player";
        };
        const playerTeam = (subject?: string) => playerBySubject.get(subject?.toLowerCase() || "")?.teamId.toLowerCase() || "";
        const stats = selectedRound.playerStats || [];
        const allyValue = stats.filter((stat) => playerTeam(stat.subject) === localTeam).reduce((sum, stat) => sum + (stat.economy.loadoutValue || 0), 0);
        const enemyValue = stats.filter((stat) => playerTeam(stat.subject) && playerTeam(stat.subject) !== localTeam).reduce((sum, stat) => sum + (stat.economy.loadoutValue || 0), 0);
        if (stats.length) timeline.push({ id: "buy", time: 0, order: 0, kind: "economy", label: "Round loadouts", detail: `Your team ${allyValue.toLocaleString()} · Enemy ${enemyValue.toLocaleString()}` });

        const events = [...selectedKills].sort((a, b) => a.roundTime - b.roundTime || a.gameTime - b.gameTime);
        events.forEach((event, index) => {
            const damageItem = event.damageItem?.trim().toLowerCase() || "";
            const killer = playerBySubject.get(event.killer.toLowerCase());
            const killerAgent = agents[killer?.characterId.toLowerCase() || ""];
            const abilitySlot = riotAbilitySlotKey(event.damageType?.toLowerCase() || "", damageItem);
            const ability = abilitySlot ? killerAgent?.abilities?.[abilitySlot] : undefined;
            const usedWeapon = damageItem ? weaponById.get(damageItem) : undefined;
            const prior = events.slice(0, index).reverse().find((candidate) => (
                event.roundTime >= candidate.roundTime
                && event.roundTime - candidate.roundTime <= 5_000
                && event.victim.toLowerCase() === candidate.killer.toLowerCase()
                && playerTeam(event.killer) === playerTeam(candidate.victim)
            ));
            const isOpening = index === 0;
            const isTrade = Boolean(prior);
            timeline.push({
                id: fightEventKey(event),
                time: event.roundTime || event.gameTime,
                order: 2 + index,
                kind: "kill",
                label: isOpening ? "Opening duel" : isTrade ? "Trade" : "Elimination",
                detail: `${nameOf(event.killer)} eliminated ${nameOf(event.victim)}${ability?.name ? ` · ${ability.name}` : usedWeapon?.displayName ? ` · ${usedWeapon.displayName}` : ""}`,
                icon: ability?.icon || usedWeapon?.displayIcon,
                local: event.killer.toLowerCase() === localSubject || event.victim.toLowerCase() === localSubject,
            });
        });
        if (selectedRound.bombPlanter) timeline.push({ id: "plant", time: selectedRound.plantRoundTime || 0, order: 90, kind: "plant", label: `Spike planted${selectedRound.plantSite ? ` · ${selectedRound.plantSite}` : ""}`, detail: nameOf(selectedRound.bombPlanter) });
        if (selectedRound.bombDefuser) timeline.push({ id: "defuse", time: selectedRound.defuseRoundTime || 0, order: 95, kind: "defuse", label: "Spike defused", detail: nameOf(selectedRound.bombDefuser) });
        timeline.push({ id: "result", time: Math.max(...timeline.map((item) => item.time), 0) + 1, order: 100, kind: "result", label: roundWon ? "Round won" : "Round lost", detail: selectedRound.roundResult || selectedRound.roundCeremony || "Round completed", local: true });
        return timeline.sort((a, b) => a.time - b.time || a.order - b.order);
    }, [agents, localSubject, localTeam, playerBySubject, roundWon, selectedKills, selectedRound, weaponById]);

    if (!rounds.length) return <div className={s.mapAnalyticsEmpty}><strong>Round evidence is not cached yet.</strong><span>Open this view while connected to refresh the match details.</span></div>;

    return <section className={s.roundReview}>
        <header className={s.roundReviewHeader}>
            <div><span>Round evidence</span><strong>Read the match one decision at a time</strong></div>
            <small>{hasDetailedRounds ? "Riot match receipt" : "Objective timeline available · detailed buys require a refresh"}</small>
        </header>
        <div className={s.roundFilmstrip} role="list" aria-label="Rounds">
            {rounds.map((round) => {
                const won = round.winningTeam.toLowerCase() === localTeam;
                const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
                const events = (detail.kills || []).filter((event) => event.roundNum === round.roundNum);
                const kills = events.filter((event) => event.killer.toLowerCase() === localSubject).length;
                const deaths = events.filter((event) => event.victim.toLowerCase() === localSubject).length;
                return <button key={round.roundNum} type="button" role="listitem" data-result={won ? "win" : "loss"} data-active={round.roundNum === selectedRound?.roundNum} onClick={() => setSelectedRoundNum(round.roundNum)}>
                    <small>R{round.roundNum + 1}</small><strong>{won ? "W" : "L"}</strong><span>{kills ? `${kills}K` : deaths ? "D" : stat?.economy.spent ? `${Math.round(stat.economy.spent / 100) / 10}k` : "—"}</span>
                </button>;
            })}
        </div>
        <div className={s.roundEvidenceGrid}>
            <div className={s.roundMapStage}>
                <header><span>Round {selectedRound!.roundNum + 1}</span><strong>{selectedRound!.plantSite ? `${selectedRound!.plantSite} site` : selectedRound!.roundResult || "Round positions"}</strong></header>
                <div className={s.roundMapCanvas}>
                    {map?.displayIcon ? <Image src={map.displayIcon} alt={`${map.name} tactical map`} fill sizes="680px" unoptimized /> : null}
                    {canPlot && selectedEvents.map((event) => {
                        const position = plot(event.victimX, event.victimY);
                        const isKill = event.killer.toLowerCase() === localSubject;
                        return <span key={fightEventKey(event)} className={isKill ? s.roundMapKill : s.roundMapDeath} style={{ left: `${position.left}%`, top: `${position.top}%` }} title={isKill ? "Your kill" : "Your death"}>{isKill ? "+" : "×"}</span>;
                    })}
                    {canPlot && selectedRound!.plantLocation && (selectedRound!.plantLocation.x || selectedRound!.plantLocation.y) ? (() => { const p = plot(selectedRound!.plantLocation!.x, selectedRound!.plantLocation!.y); return <i className={s.roundSpikeMarker} data-event="plant" title={`Spike planted${selectedRound!.plantRoundTime ? ` at ${fmtLength(selectedRound!.plantRoundTime)}` : ""}`} style={{ left: `${p.left}%`, top: `${p.top}%` }}>P</i>; })() : null}
                    {canPlot && selectedRound!.defuseLocation && (selectedRound!.defuseLocation.x || selectedRound!.defuseLocation.y) ? (() => { const p = plot(selectedRound!.defuseLocation!.x, selectedRound!.defuseLocation!.y); return <i className={s.roundSpikeMarker} data-event="defuse" title={`Spike defused${selectedRound!.defuseRoundTime ? ` at ${fmtLength(selectedRound!.defuseRoundTime)}` : ""}`} style={{ left: `${p.left}%`, top: `${p.top}%` }}>D</i>; })() : null}
                </div>
                <footer>{selectedEvents.length ? `${selectedEvents.length} fight${selectedEvents.length === 1 ? "" : "s"} involving you` : "No kill or death for you this round"}<span>{selectedRound!.bombPlanter ? "P plant" : ""}{selectedRound!.bombPlanter && selectedRound!.bombDefuser ? " · " : ""}{selectedRound!.bombDefuser ? "D defuse" : ""}</span></footer>
            </div>
            <aside className={s.roundReceipt}>
                <div className={s.roundReceiptResult} data-result={roundWon ? "win" : "loss"}><span>{roundWon ? "Round won" : "Round lost"}</span><strong>{selectedRound!.roundResult || selectedRound!.roundCeremony || "Elimination"}</strong></div>
                <div className={s.roundReceiptPlayer}>
                    {local && agents[local.characterId.toLowerCase()]?.icon ? <Image src={agents[local.characterId.toLowerCase()].icon} alt="" width={44} height={44} unoptimized /> : null}
                    <div><span>Your impact</span><strong>{localKills.length}K · {localDeaths.length}D · {localAssists.length}A</strong></div>
                    <b>{damageDone}<small> dmg</small></b>
                </div>
                <dl className={s.roundReceiptStats}>
                    <div><dt>Loadout</dt><dd>{selectedStat?.economy.loadoutValue?.toLocaleString() || "—"}</dd></div>
                    <div><dt>Spent</dt><dd>{selectedStat?.economy.spent?.toLocaleString() || "—"}</dd></div>
                    <div><dt>Credits left</dt><dd>{selectedStat?.economy.remaining?.toLocaleString() || "—"}</dd></div>
                    <div><dt>Headshots</dt><dd>{headshots || "—"}</dd></div>
                </dl>
                <div className={s.roundLoadout}>
                    <span>{weapon?.displayIcon ? <Image src={weapon.displayIcon} alt="" width={112} height={34} unoptimized /> : null}</span>
                    <p><small>Primary</small><strong>{weapon?.displayName || (selectedStat?.economy.weapon ? "Weapon recorded" : "No weapon recorded")}</strong></p>
                    <em>{selectedStat?.economy.armor ? "Armor equipped" : "No armor"}</em>
                </div>
                <div className={s.roundObjectiveLine}>
                    <span>Objective timeline</span>
                    <strong>{objectiveLines.length ? objectiveLines.map((line) => <small key={line}>{line}</small>) : "No objective action recorded"}</strong>
                    {selectedAltFireEvents.length ? <em>{selectedAltFireEvents.length} fight{selectedAltFireEvents.length === 1 ? "" : "s"} recorded with secondary fire.</em> : null}
                </div>
            </aside>
        </div>
        <section className={s.roundTimeline} aria-label={`Round ${selectedRound!.roundNum + 1} event timeline`}>
            <header><div><span>Round timeline</span><strong>What happened, in order</strong></div><small>{roundTimeline.length} recorded events</small></header>
            <div className={s.roundTimelineRail}>
                {roundTimeline.map((event, index) => <article key={event.id} data-kind={event.kind} data-local={event.local || undefined}>
                    <time>{event.time ? fmtLength(event.time) : "START"}</time>
                    <i><span>{index + 1}</span></i>
                    <div>{event.icon ? <Image src={event.icon} alt="" width={38} height={22} unoptimized /> : null}<span><strong>{event.label}</strong><small>{event.detail}</small></span></div>
                </article>)}
            </div>
        </section>
        <div className={s.matchPatterns}>
            <header><span>Match patterns</span><small>Factual signals from this match</small></header>
            <article data-tone={openingWins.length && convertedOpeningWins === openingWins.length ? "good" : "neutral"}><span>First contact</span><strong>{openingWins.length} of {opening.length} opening duels won</strong><small>{openingWins.length ? `${convertedOpeningWins} of those ${openingWins.length === 1 ? "round" : "rounds"} converted into a win.` : "You did not record an opening kill."}</small></article>
            <article data-tone={allLocalDeaths.length && tradedDeaths === 0 ? "danger" : "neutral"}><span>Trade window</span><strong>{tradedDeaths} of {allLocalDeaths.length} deaths traded</strong><small>Counts a teammate eliminating your killer within five seconds.</small></article>
            <article data-tone="neutral"><span>Ability usage</span><strong>{totalAbilityCasts ? `${totalAbilityCasts} casts` : `${totalAbilityEffects} recorded effects`}</strong><small>{abilityUsage.length ? abilityUsage.map((ability) => `${ability.name} ${ability.count}`).join(" · ") : hasDetailedRounds ? "No cast total was reported; round effects are still preserved." : "Refresh this match to preserve ability evidence."}{totalAbilityCasts && totalAbilityEffects ? ` · ${totalAbilityEffects} round effects` : ""}</small></article>
            {local?.playtimeMillis ? <article data-tone="neutral"><span>Active time</span><strong>{fmtLength(local.playtimeMillis)} recorded</strong><small>{detail.matchInfo.gameLengthMillis ? `${fmtLength(detail.matchInfo.gameLengthMillis)} total match duration. ` : ""}Riot&apos;s player timer is shown directly; disconnect intent is not inferred.</small></article> : null}
            {flaggedRounds.length ? <article data-tone="danger"><span>Riot status</span><strong>{flaggedRounds.length} round{flaggedRounds.length === 1 ? "" : "s"} flagged</strong><small>AFK, spawn, or penalty state was reported in rounds {flaggedRounds.map((round) => round.roundNum + 1).join(", ")}.</small></article> : <article data-tone="good"><span>Riot status</span><strong>No round penalties reported</strong><small>No AFK, spawn, or round penalty flags were present in this match payload.</small></article>}
        </div>
    </section>;
}

function MatchMapAnalytics({
    detail,
    kills,
    map,
    agents,
    weapons,
    loading,
    error,
}: {
    detail: ProfileMatchDetails;
    kills: MatchKillEvent[];
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
    loading: boolean;
    error: string;
}) {
    const [filter, setFilter] = useState<"all" | "kill" | "death">("all");
    const [focusedArea, setFocusedArea] = useState<string | null>(null);
    const [focusedZone, setFocusedZone] = useState<string | null>(null);
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [duelFocus, setDuelFocus] = useState<DuelFocus | null>(null);
    const analysis = useMemo(() => {
        const localPlayer = detail.players.find((player) => player.isLocal);
        const localSubject = localPlayer?.subject.toLowerCase() || "";
        const localTeam = localPlayer?.teamId.toLowerCase() || "";
        const playerTeamBySubject = new Map(
            detail.players.map((player) => [player.subject.toLowerCase(), player.teamId.toLowerCase()]),
        );
        const roundWinnerByNumber = new Map(
            (detail.rounds || [])
                .filter((round) => round.winningTeam)
                .map((round) => [round.roundNum, round.winningTeam.toLowerCase()]),
        );
        const localWonRound = (roundNum: number) => {
            const winner = roundWinnerByNumber.get(roundNum);
            return winner ? winner === localTeam : null;
        };
        const points: Array<{ type: "kill" | "death"; x: number; y: number; round: number; gameTime: number; event: MatchKillEvent }> = [];
        for (const event of kills) {
            if (event.killer.toLowerCase() === localSubject) {
                points.push({ type: "kill", x: event.victimX, y: event.victimY, round: event.roundNum, gameTime: event.gameTime, event });
            }
            if (event.victim.toLowerCase() === localSubject) {
                points.push({ type: "death", x: event.victimX, y: event.victimY, round: event.roundNum, gameTime: event.gameTime, event });
            }
        }

        const firstByRound = new Map<number, MatchKillEvent>();
        for (const event of kills) {
            const current = firstByRound.get(event.roundNum);
            if (!current || event.gameTime < current.gameTime) firstByRound.set(event.roundNum, event);
        }
        let openingWins = 0;
        let openingLosses = 0;
        for (const event of firstByRound.values()) {
            if (event.killer.toLowerCase() === localSubject) openingWins += 1;
            if (event.victim.toLowerCase() === localSubject) openingLosses += 1;
        }

        const nearestCallout = (x: number, y: number) => {
            let nearest: MapMeta["callouts"][number] | undefined;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (const callout of map?.callouts || []) {
                const distance = (callout.x - x) ** 2 + (callout.y - y) ** 2;
                if (distance < nearestDistance) {
                    nearest = callout;
                    nearestDistance = distance;
                }
            }
            return nearest
                ? { area: mapCalloutLabel(nearest), zone: mapZoneLabel(nearest) }
                : { area: "Map area", zone: "Other" };
        };

        const openingEvents = [...firstByRound.values()]
            .filter((event) => event.killer.toLowerCase() === localSubject || event.victim.toLowerCase() === localSubject)
            .map((event) => ({
                result: event.killer.toLowerCase() === localSubject ? "win" as const : "loss" as const,
                roundNum: event.roundNum,
                round: event.roundNum + 1,
                teamWon: localWonRound(event.roundNum),
                x: event.victimX,
                y: event.victimY,
                event,
                ...nearestCallout(event.victimX, event.victimY),
            }))
            .sort((a, b) => a.round - b.round);

        const localDeaths = kills
            .filter((event) => event.victim.toLowerCase() === localSubject)
            .sort((a, b) => a.gameTime - b.gameTime);
        const tradedDeaths = localDeaths.filter((death) => kills.some((event) => (
            event.roundNum === death.roundNum
            && event.roundTime >= death.roundTime
            && event.roundTime - death.roundTime <= 5_000
            && event.victim.toLowerCase() === death.killer.toLowerCase()
            && playerTeamBySubject.get(event.killer.toLowerCase()) === localTeam
        ))).length;
        const tradePoint = localDeaths[0]
            ? { x: localDeaths[0].victimX, y: localDeaths[0].victimY, ...nearestCallout(localDeaths[0].victimX, localDeaths[0].victimY) }
            : null;

        const locatedPoints = points.map((point) => ({ ...point, ...nearestCallout(point.x, point.y) }));
        const hotspotMap = new Map<string, { name: string; kills: number; deaths: number; killRounds: number[]; deathRounds: number[]; killXTotal: number; killYTotal: number; deathXTotal: number; deathYTotal: number }>();
        const zoneMap = new Map<string, { name: string; focusZone: string; focusArea: string; kills: number; deaths: number; xTotal: number; yTotal: number; count: number; rounds: Set<number> }>();
        for (const point of locatedPoints) {
            const name = point.area;
            const hotspot = hotspotMap.get(name) || { name, kills: 0, deaths: 0, killRounds: [], deathRounds: [], killXTotal: 0, killYTotal: 0, deathXTotal: 0, deathYTotal: 0 };
            hotspot[point.type === "kill" ? "kills" : "deaths"] += 1;
            hotspot[point.type === "kill" ? "killRounds" : "deathRounds"].push(point.round + 1);
            hotspot[point.type === "kill" ? "killXTotal" : "deathXTotal"] += point.x;
            hotspot[point.type === "kill" ? "killYTotal" : "deathYTotal"] += point.y;
            hotspotMap.set(name, hotspot);

            const zoneName = point.zone === "Other" ? point.area : point.zone;
            const zone = zoneMap.get(zoneName) || {
                name: zoneName,
                focusZone: point.zone === "Other" ? "" : point.zone,
                focusArea: point.zone === "Other" ? point.area : "",
                kills: 0,
                deaths: 0,
                xTotal: 0,
                yTotal: 0,
                count: 0,
                rounds: new Set<number>(),
            };
            zone[point.type === "kill" ? "kills" : "deaths"] += 1;
            zone.xTotal += point.x;
            zone.yTotal += point.y;
            zone.count += 1;
            zone.rounds.add(point.round);
            zoneMap.set(zoneName, zone);
        }

        const hotspots = [...hotspotMap.values()]
            .sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths));
        const killSpots = hotspots.filter((area) => area.kills > 0).sort((a, b) => b.kills - a.kills || a.killRounds[0] - b.killRounds[0]);
        const deathSpots = hotspots.filter((area) => area.deaths > 0).sort((a, b) => b.deaths - a.deaths || a.deathRounds[0] - b.deathRounds[0]);
        const zoneOrder = new Map([["A Site", 0], ["B Site", 1], ["C Site", 2], ["Mid", 3], ["Other", 4]]);
        const zones = [...zoneMap.values()]
            .filter((zone) => zone.kills + zone.deaths > 0)
            .map((zone) => {
                const decidedRounds = [...zone.rounds].filter((roundNum) => localWonRound(roundNum) !== null);
                return {
                    ...zone,
                    decidedRounds: decidedRounds.length,
                    roundWins: decidedRounds.filter((roundNum) => localWonRound(roundNum) === true).length,
                };
            })
            .sort((a, b) => (zoneOrder.get(a.name) ?? 9) - (zoneOrder.get(b.name) ?? 9));

        return {
            points: locatedPoints,
            kills: locatedPoints.filter((point) => point.type === "kill").length,
            deaths: locatedPoints.filter((point) => point.type === "death").length,
            openingWins,
            openingLosses,
            openingEvents,
            localSubject,
            localTeam,
            localDeaths,
            tradedDeaths,
            tradePoint,
            zones,
            killSpot: killSpots.find((spot) => spot.kills >= 2) || null,
            deathSpot: deathSpots.find((spot) => spot.deaths >= 2) || null,
        };
    }, [detail.players, detail.rounds, kills, map?.callouts]);

    const canPlot = Boolean(
        map?.displayIcon
        && typeof map.xMultiplier === "number"
        && typeof map.yMultiplier === "number"
        && typeof map.xScalarToAdd === "number"
        && typeof map.yScalarToAdd === "number",
    );
    const visiblePoints = analysis.points.filter((point) => {
        if (filter !== "all" && point.type !== filter) return false;
        if (focusedZone && point.zone !== focusedZone) return false;
        if (focusedArea && point.area !== focusedArea) return false;
        return true;
    });
    const playerBySubject = useMemo(
        () => new Map(detail.players.map((player) => [player.subject.toLowerCase(), player])),
        [detail.players],
    );
    const weaponById = useMemo(
        () => new Map(weapons.map((weapon) => [weapon.uuid.toLowerCase(), weapon])),
        [weapons],
    );
    const selectDuelGroup = useCallback((id: string, label: string, events: MatchKillEvent[]) => {
        const uniqueEvents = [...new Map(events.map((event) => [fightEventKey(event), event])).values()]
            .sort((a, b) => a.roundNum - b.roundNum || a.gameTime - b.gameTime);
        if (!uniqueEvents.length) return;
        setFilter("all");
        setFocusedArea(null);
        setFocusedZone(null);
        setDuelFocus((current) => current?.id === id ? null : { id, label, events: uniqueEvents, index: 0 });
    }, []);
    const selectedFight = duelFocus?.events[duelFocus.index] || null;
    const duelData = useMemo(() => {
        if (!selectedFight || !canPlot || !map) return null;
        const toPlotPoint = (x: number, y: number) => ({
            left: Math.max(0, Math.min(1, y * map.xMultiplier! + map.xScalarToAdd!)),
            top: Math.max(0, Math.min(1, x * map.yMultiplier! + map.yScalarToAdd!)),
        });
        const killerSubject = selectedFight.killer.toLowerCase();
        const victimSubject = selectedFight.victim.toLowerCase();
        const killerLocation = selectedFight.playerLocations?.find((location) => location.subject?.toLowerCase() === killerSubject);
        const killerPlayer = playerBySubject.get(killerSubject);
        const victimPlayer = playerBySubject.get(victimSubject);
        const damageItemKey = selectedFight.damageItem?.trim().toLowerCase() || "";
        const weapon = damageItemKey ? weaponById.get(damageItemKey) : undefined;
        const killerAgent = agents[killerPlayer?.characterId?.toLowerCase() || ""];
        const damageType = selectedFight.damageType?.toLowerCase() || "";
        const abilitySlot = riotAbilitySlotKey(damageType, damageItemKey);
        const isAbility = Boolean(abilitySlot);
        const ability = abilitySlot ? killerAgent?.abilities?.[abilitySlot] : undefined;
        const finisher: DuelFinisher | undefined = isAbility
            ? ability?.icon ? { name: ability.name, icon: ability.icon, kind: "ability" } : undefined
            : weapon?.displayIcon ? { name: weapon.displayName || "Weapon", icon: weapon.displayIcon, kind: "weapon" } : undefined;
        const localDeath = victimSubject === analysis.localSubject;
        const roundWinner = (detail.rounds || []).find((round) => round.roundNum === selectedFight.roundNum)?.winningTeam.toLowerCase();
        const roundWon = roundWinner ? roundWinner === analysis.localTeam : null;
        const locatedFight = analysis.points.find((point) => fightEventKey(point.event) === fightEventKey(selectedFight));
        return {
            killerPlayer,
            victimPlayer,
            killerAgent,
            victimAgent: agents[victimPlayer?.characterId?.toLowerCase() || ""],
            killerPoint: killerLocation ? toPlotPoint(killerLocation.x, killerLocation.y) : null,
            victimPoint: toPlotPoint(selectedFight.victimX, selectedFight.victimY),
            finisher,
            localDeath,
            roundWon,
            area: locatedFight?.area || "Map area",
        };
    }, [agents, analysis.localSubject, analysis.localTeam, analysis.points, canPlot, detail.rounds, map, playerBySubject, selectedFight, weaponById]);

    const zoneRegions = useMemo(() => {
        if (!canPlot || !map) return [];
        const groups = new Map<string, Array<{ left: number; top: number }>>();
        for (const callout of map.callouts) {
            const zone = mapZoneLabel(callout);
            if (zone === "Other") continue;
            const { left, top } = mapCalloutPlotPosition(map, callout);
            const points = groups.get(zone) || [];
            points.push({ left, top });
            groups.set(zone, points);
        }
        return [...groups.entries()].map(([name, points]) => {
            let left = Math.min(...points.map((point) => point.left)) - 0.035;
            let right = Math.max(...points.map((point) => point.left)) + 0.035;
            let top = Math.min(...points.map((point) => point.top)) - 0.035;
            let bottom = Math.max(...points.map((point) => point.top)) + 0.035;
            const minSize = 0.15;
            if (right - left < minSize) {
                const center = (left + right) / 2;
                left = center - minSize / 2;
                right = center + minSize / 2;
            }
            if (bottom - top < minSize) {
                const center = (top + bottom) / 2;
                top = center - minSize / 2;
                bottom = center + minSize / 2;
            }
            left = Math.max(0, left);
            right = Math.min(1, right);
            top = Math.max(0, top);
            bottom = Math.min(1, bottom);
            return { name, left, top, width: right - left, height: bottom - top };
        });
    }, [canPlot, map]);
    const strongestZone = analysis.zones.filter((zone) => zone.kills + zone.deaths > 0).sort((a, b) => {
        const aRate = a.kills / Math.max(1, a.deaths);
        const bRate = b.kills / Math.max(1, b.deaths);
        return bRate - aRate || (b.kills + b.deaths) - (a.kills + a.deaths);
    })[0];
    const weakestZone = analysis.zones
        .filter((zone) => zone.deaths > zone.kills)
        .sort((a, b) => (b.deaths - b.kills) - (a.deaths - a.kills) || b.deaths - a.deaths)[0];
    const reviewNotes: Array<{ id: string; tone: "good" | "danger" | "neutral"; kicker: string; label: string; copy: string; x: number; y: number; events: MatchKillEvent[] }> = [];
    const openingKillsWithOutcome = analysis.openingEvents.filter((event) => event.result === "win" && event.teamWon !== null);
    if (openingKillsWithOutcome.length) {
        const converted = openingKillsWithOutcome.filter((event) => event.teamWon).length;
        const conversion = Math.round((converted / openingKillsWithOutcome.length) * 100);
        const representative = openingKillsWithOutcome[0];
        reviewNotes.push({
            id: "opening-advantage",
            tone: conversion >= 60 ? "good" : conversion < 50 ? "danger" : "neutral",
            kicker: "Opening advantage",
            label: `${conversion}% round conversion`,
            copy: `Your team won ${converted} of ${openingKillsWithOutcome.length} rounds after you got the first kill.`,
            x: representative.x,
            y: representative.y,
            events: openingKillsWithOutcome.map((event) => event.event),
        });
    }
    const openingDeathsWithOutcome = analysis.openingEvents.filter((event) => event.result === "loss" && event.teamWon !== null);
    if (openingDeathsWithOutcome.length) {
        const recovered = openingDeathsWithOutcome.filter((event) => event.teamWon).length;
        const recovery = Math.round((recovered / openingDeathsWithOutcome.length) * 100);
        const representative = openingDeathsWithOutcome[0];
        reviewNotes.push({
            id: "opening-death",
            tone: recovery >= 50 ? "good" : "danger",
            kicker: "After first death",
            label: `${recovery}% round recovery`,
            copy: `Your team recovered ${recovered} of ${openingDeathsWithOutcome.length} rounds after you died first.`,
            x: representative.x,
            y: representative.y,
            events: openingDeathsWithOutcome.map((event) => event.event),
        });
    }
    if (analysis.deathSpot) {
        const spot = analysis.deathSpot;
        const rounds = [...new Set(spot.deathRounds)];
        const localTeam = detail.players.find((player) => player.isLocal)?.teamId.toLowerCase() || "";
        const winners = new Map((detail.rounds || []).map((round) => [round.roundNum + 1, round.winningTeam.toLowerCase()]));
        const decidedRounds = rounds.filter((round) => winners.get(round));
        const lostRounds = decidedRounds.filter((round) => winners.get(round) !== localTeam).length;
        reviewNotes.push({
            id: `repeat-death-${spot.name}`,
            tone: "danger",
            kicker: "Repeat location",
            label: decidedRounds.length ? `${lostRounds} of ${decidedRounds.length} rounds lost` : `${spot.deaths} deaths at ${spot.name}`,
            copy: decidedRounds.length
                ? `You died at ${spot.name} ${spot.deaths} times. Your team lost ${lostRounds} of the affected rounds.`
                : `${statCount(spot.deaths, "death")} in ${rounds.length === 1 ? `Round ${rounds[0]}` : `Rounds ${rounds.join(", ")}`}.`,
            x: spot.deathXTotal / Math.max(1, spot.deaths),
            y: spot.deathYTotal / Math.max(1, spot.deaths),
            events: analysis.points.filter((point) => point.type === "death" && point.area === spot.name).map((point) => point.event),
        });
    }
    if (analysis.tradePoint && analysis.deaths > 0) {
        const tradeRate = analysis.tradedDeaths / analysis.deaths;
        reviewNotes.push({
            id: "trade-timing",
            tone: tradeRate >= 0.6 ? "good" : tradeRate < 0.35 ? "danger" : "neutral",
            kicker: "Trade timing",
            label: `${analysis.tradedDeaths} of ${analysis.deaths} deaths traded`,
            copy: `A teammate eliminated your killer within 5 seconds after ${analysis.tradedDeaths} of your deaths.`,
            x: analysis.tradePoint.x,
            y: analysis.tradePoint.y,
            events: analysis.localDeaths,
        });
    } else if (weakestZone && weakestZone.name !== strongestZone?.name) {
        reviewNotes.push({
            id: `area-result-${weakestZone.name}`,
            tone: "danger",
            kicker: "Area result",
            label: `${weakestZone.name}: ${weakestZone.kills}-${weakestZone.deaths}`,
            copy: weakestZone.decidedRounds
                ? `Your team won ${weakestZone.roundWins} of ${weakestZone.decidedRounds} rounds with one of your fights here.`
                : `${statCount(weakestZone.kills, "kill")} and ${statCount(weakestZone.deaths, "death")} were recorded here.`,
            x: weakestZone.xTotal / Math.max(1, weakestZone.count),
            y: weakestZone.yTotal / Math.max(1, weakestZone.count),
            events: analysis.points.filter((point) => (point.zone === "Other" ? point.area : point.zone) === weakestZone.name).map((point) => point.event),
        });
    }
    if (strongestZone) {
        reviewNotes.push({
            id: `strongest-area-${strongestZone.name}`,
            tone: "good",
            kicker: "Strongest area",
            label: `${strongestZone.name}: ${strongestZone.kills}-${strongestZone.deaths}`,
            copy: strongestZone.decidedRounds
                ? `Your team won ${strongestZone.roundWins} of ${strongestZone.decidedRounds} rounds with one of your fights here.`
                : `${statCount(strongestZone.kills, "kill")} and ${statCount(strongestZone.deaths, "death")} were recorded here.`,
            x: strongestZone.xTotal / Math.max(1, strongestZone.count),
            y: strongestZone.yTotal / Math.max(1, strongestZone.count),
            events: analysis.points.filter((point) => (point.zone === "Other" ? point.area : point.zone) === strongestZone.name).map((point) => point.event),
        });
    }

    if (loading) {
        return <div className={s.mapAnalyticsEmpty}>Loading this match&apos;s map events...</div>;
    }
    if (error) {
        const needsRiotAccess = /auth|log in|session|token/i.test(error);
        return (
            <div className={s.mapAnalyticsEmpty} role="status">
                <strong>{needsRiotAccess ? "Map analysis needs Riot access" : "Map analysis unavailable"}</strong>
                <span>{needsRiotAccess ? "Reconnect this Riot account, then reopen the match." : error}</span>
            </div>
        );
    }
    if (!kills.length) {
        return <div className={s.mapAnalyticsEmpty}>No positional events were returned for this match.</div>;
    }
    if (!analysis.points.length) {
        return <div className={s.mapAnalyticsEmpty}>This match has no mapped fights involving you.</div>;
    }

    return (
        <section className={s.mapAnalytics}>
            <div className={s.mapAnalyticsLayout}>
                <div className={s.mapPlotPanel}>
                    <div className={s.mapPlotToolbar}>
                        <strong>
                            {duelFocus && selectedFight && duelData
                                ? `Fight detail · R${selectedFight.roundNum + 1} · ${duelData.area}`
                                : map?.name || "Map"}
                        </strong>
                        {duelFocus ? (
                            <div className={s.mapDuelControls} aria-label="Selected duel controls">
                                <span>{duelFocus.label}</span>
                            </div>
                        ) : (
                            <div className={s.mapPlotFilters} aria-label="Map event filter">
                                {(["all", "kill", "death"] as const).map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={filter === value ? s.mapPlotFilterActive : ""}
                                        onClick={() => {
                                            setDuelFocus(null);
                                            setFilter(value);
                                            setFocusedArea(null);
                                            setFocusedZone(null);
                                        }}
                                    >
                                        {value === "all" ? "All" : value === "kill" ? "Kills" : "Deaths"}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {canPlot ? (
                        <div className={s.mapPlot}>
                            <Image src={map!.displayIcon} alt={`${map!.name} minimap`} width={640} height={640} unoptimized className={s.mapPlotImage} draggable={false} />
                            {!selectedFight && zoneRegions.map((region) => {
                                const fights = analysis.zones.find((zone) => zone.name === region.name);
                                const count = (fights?.kills || 0) + (fights?.deaths || 0);
                                const isActive = focusedZone === region.name || hoveredZone === region.name;
                                return (
                                    <span
                                        key={region.name}
                                        className={`${s.mapZoneRegion} ${isActive ? s.mapZoneRegionActive : ""}`}
                                        data-zone={region.name.startsWith("A") ? "A" : region.name.startsWith("B") ? "B" : region.name.startsWith("C") ? "C" : "M"}
                                        style={{
                                            left: `${region.left * 100}%`,
                                            top: `${region.top * 100}%`,
                                            width: `${region.width * 100}%`,
                                            height: `${region.height * 100}%`,
                                        }}
                                        aria-hidden="true"
                                    >
                                        <strong>{region.name}</strong>
                                        <small>{count} {count === 1 ? "fight" : "fights"}</small>
                                    </span>
                                );
                            })}
                            {!selectedFight && map!.callouts.map((callout, index) => {
                                const { left, top } = mapCalloutPlotPosition(map!, callout);
                                return (
                                    <span
                                        key={`${callout.superRegion}-${callout.name}-${index}`}
                                        className={`${s.mapCallout} ${(focusedArea === mapCalloutLabel(callout) || focusedZone === mapZoneLabel(callout) || hoveredZone === mapZoneLabel(callout)) ? s.mapCalloutFocused : ""}`}
                                        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
                                    >
                                        {mapCalloutLabel(callout)}
                                    </span>
                                );
                            })}
                            {!selectedFight && visiblePoints.map((point, index) => {
                                const left = Math.max(0, Math.min(1, point.y * map!.xMultiplier! + map!.xScalarToAdd!));
                                const top = Math.max(0, Math.min(1, point.x * map!.yMultiplier! + map!.yScalarToAdd!));
                                return (
                                    <span
                                        key={`${point.round}-${point.gameTime}-${point.type}-${index}`}
                                        className={`${s.mapEvent} ${point.type === "kill" ? s.mapEventKill : s.mapEventDeath}`}
                                        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
                                        title={`${point.type === "kill" ? "Kill" : "Death"}, round ${point.round + 1}`}
                                    >
                                        <i className={s.mapHeat} aria-hidden="true" />
                                        <b className={s.mapPoint} aria-hidden="true" />
                                    </span>
                                );
                            })}
                            {selectedFight && duelData ? (
                                <>
                                    {duelData.killerPoint ? (
                                        <svg className={`${s.mapDuelLine} ${duelData.localDeath ? s.mapDuelLineDeath : s.mapDuelLineKill}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                            <line
                                                x1={duelData.killerPoint.left * 100}
                                                y1={duelData.killerPoint.top * 100}
                                                x2={duelData.victimPoint.left * 100}
                                                y2={duelData.victimPoint.top * 100}
                                            />
                                            <line
                                                x1={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 - 1.15}
                                                y1={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 - 1.15}
                                                x2={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 + 1.15}
                                                y2={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 + 1.15}
                                            />
                                            <line
                                                x1={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 + 1.15}
                                                y1={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 - 1.15}
                                                x2={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 - 1.15}
                                                y2={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 + 1.15}
                                            />
                                        </svg>
                                    ) : null}
                                    {duelData.killerPoint ? (
                                        <MapDuelMarker
                                            point={duelData.killerPoint}
                                            player={duelData.killerPlayer}
                                            agent={duelData.killerAgent}
                                            dead={false}
                                            local={selectedFight.killer.toLowerCase() === analysis.localSubject}
                                            finisher={duelData.finisher}
                                            avoidPoint={duelData.victimPoint}
                                        />
                                    ) : null}
                                    <MapDuelMarker
                                        point={duelData.victimPoint}
                                        player={duelData.victimPlayer}
                                        agent={duelData.victimAgent}
                                        dead
                                        local={selectedFight.victim.toLowerCase() === analysis.localSubject}
                                    />
                                </>
                            ) : null}
                        </div>
                    ) : (
                        <div className={s.mapAnalyticsEmpty}>This map does not provide minimap coordinate metadata.</div>
                    )}
                    {duelFocus ? (
                        <div className={s.mapDuelNavigator} aria-label="Choose a fight to display">
                            <span>Fight <b>{String(duelFocus.index + 1).padStart(2, "0")}</b><i>/ {String(duelFocus.events.length).padStart(2, "0")}</i></span>
                            <div className={s.mapDuelRounds}>
                                {duelFocus.events.map((event, index) => (
                                    <button
                                        key={fightEventKey(event)}
                                        type="button"
                                        className={index === duelFocus.index ? s.mapDuelRoundActive : ""}
                                        onClick={() => setDuelFocus((current) => current ? { ...current, index } : current)}
                                        aria-label={`Show fight ${index + 1} from round ${event.roundNum + 1}`}
                                        aria-pressed={index === duelFocus.index}
                                    >
                                        Round {event.roundNum + 1}
                                    </button>
                                ))}
                            </div>
                            <button type="button" className={s.mapDuelClear} onClick={() => setDuelFocus(null)}>Exit detail</button>
                        </div>
                    ) : null}
                    {!selectedFight ? (
                        <div className={s.mapLegend}>
                            <>
                                <span><i className={s.mapLegendKill} /> Kill location</span>
                                <span><i className={s.mapLegendDeath} /> Death location</span>
                            </>
                        </div>
                    ) : null}
                </div>
                <section className={s.mapInsights} aria-label="Map performance breakdown">
                    <header className={s.mapInsightsHeader}>
                        <div>
                            <span>Fight report</span>
                            <strong>Where you fought</strong>
                        </div>
                        <small>{analysis.kills + analysis.deaths} fights · Select a zone</small>
                    </header>
                    <div className={s.mapZoneList}>
                        {analysis.zones.map((zone) => {
                            const total = zone.kills + zone.deaths;
                            const share = total / Math.max(1, analysis.kills + analysis.deaths);
                            const zoneKey = zone.name === "A Site" ? "A" : zone.name === "B Site" ? "B" : zone.name === "C Site" ? "C" : zone.name === "Mid" ? "M" : "-";
                            const zoneAverageX = zone.xTotal / Math.max(1, zone.count);
                            const zoneAverageY = zone.yTotal / Math.max(1, zone.count);
                            const zoneMarkerLeft = canPlot
                                ? Math.max(0, Math.min(1, zoneAverageY * map!.xMultiplier! + map!.xScalarToAdd!))
                                : 0.5;
                            const zoneMarkerTop = canPlot
                                ? Math.max(0, Math.min(1, zoneAverageX * map!.yMultiplier! + map!.yScalarToAdd!))
                                : 0.5;
                            const zoneSummary = zone.kills > zone.deaths
                                    ? "Won more fights here"
                                    : zone.deaths > zone.kills
                                        ? "Lost more fights here"
                                        : "Even fights";
                            const zoneDetail = zone.kills > 0 && zone.deaths === 0
                                    ? "No deaths"
                                    : `${fmtRatio(zone.kills / zone.deaths)} K/D`;
                            const isFocused = zone.focusArea
                                ? focusedArea === zone.focusArea
                                : focusedZone === zone.focusZone;
                            return (
                                <button
                                    key={zone.name}
                                    type="button"
                                    data-zone={zoneKey}
                                    className={`${s.mapZoneCard} ${isFocused ? s.mapZoneCardActive : ""}`}
                                    onClick={() => {
                                        setDuelFocus(null);
                                        setFilter("all");
                                        if (zone.focusArea) {
                                            setFocusedZone(null);
                                            setFocusedArea((current) => current === zone.focusArea ? null : zone.focusArea);
                                        } else {
                                            setFocusedArea(null);
                                            setFocusedZone((current) => current === zone.focusZone ? null : zone.focusZone);
                                        }
                                    }}
                                    onMouseEnter={() => setHoveredZone(zone.focusZone || null)}
                                    onMouseLeave={() => setHoveredZone(null)}
                                    onFocus={() => setHoveredZone(zone.focusZone || null)}
                                    onBlur={() => setHoveredZone(null)}
                                    aria-pressed={isFocused}
                                >
                                    <span className={s.mapZoneThumb} aria-hidden="true">
                                        {map?.displayIcon ? <Image src={map.displayIcon} alt="" fill sizes="58px" unoptimized /> : null}
                                        <i style={{ left: `${zoneMarkerLeft * 100}%`, top: `${zoneMarkerTop * 100}%` }} />
                                    </span>
                                    <span className={s.mapZoneIdentity}>
                                        <strong>{zone.name}</strong>
                                        <small>{zoneSummary} <b>{zoneDetail}</b></small>
                                    </span>
                                    <span className={s.mapZoneStats}>
                                        <span><small>Kills</small><b className={s.mapKillText}>{zone.kills}</b></span>
                                        <span><small>Deaths</small><b className={s.mapDeathText}>{zone.deaths}</b></span>
                                        <span><small>Fights</small><b>{total}</b></span>
                                    </span>
                                    <i className={s.mapZoneShare} aria-hidden="true"><b style={{ width: `${share * 100}%` }} /></i>
                                </button>
                            );
                        })}
                    </div>
                    {(analysis.killSpot || analysis.deathSpot) && <div className={s.mapHotspotSummary}>
                        <div className={s.mapInsightSectionHeading}>
                            <span>Repeat positions</span>
                            <small>Select to isolate</small>
                        </div>
                        {([{ type: "kill", spot: analysis.killSpot }, { type: "death", spot: analysis.deathSpot }] as const).map(({ type, spot }) => {
                            if (!spot) return null;
                            const count = type === "kill" ? spot.kills : spot.deaths;
                            const rounds = type === "kill" ? spot.killRounds : spot.deathRounds;
                            const uniqueRounds = [...new Set(rounds)];
                            const averageX = (type === "kill" ? spot.killXTotal : spot.deathXTotal) / Math.max(1, count);
                            const averageY = (type === "kill" ? spot.killYTotal : spot.deathYTotal) / Math.max(1, count);
                            const markerLeft = canPlot ? Math.max(0, Math.min(1, averageY * map!.xMultiplier! + map!.xScalarToAdd!)) : 0.5;
                            const markerTop = canPlot ? Math.max(0, Math.min(1, averageX * map!.yMultiplier! + map!.yScalarToAdd!)) : 0.5;
                            const hotspotEvents = analysis.points
                                .filter((point) => point.type === type && point.area === spot.name)
                                .map((point) => point.event);
                            const duelId = `hotspot-${type}-${spot.name}`;
                            const isDuelFocused = duelFocus?.id === duelId;
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    className={`${s.mapHotspotItem} ${type === "kill" ? s.mapHotspotKill : s.mapHotspotDeath} ${isDuelFocused ? s.mapHotspotItemActive : ""}`}
                                    aria-label={`${type === "kill" ? `Got ${count} kills` : `Died ${count} times`} at ${spot.name}; select to isolate on the map`}
                                    aria-pressed={isDuelFocused}
                                    onClick={() => selectDuelGroup(duelId, `${type === "kill" ? "Kills" : "Deaths"} at ${spot.name}`, hotspotEvents)}
                                >
                                    <span className={s.mapHotspotThumb} aria-hidden="true">
                                        {map?.displayIcon ? <Image src={map.displayIcon} alt="" fill sizes="58px" unoptimized /> : null}
                                        <i style={{ left: `${markerLeft * 100}%`, top: `${markerTop * 100}%` }} />
                                    </span>
                                    <span>
                                        <strong>{type === "kill" ? `Got ${count} kills here` : `Died here ${count} times`}</strong>
                                        <small>{spot.name} · {type === "kill" ? "Kill hotspot" : "Death hotspot"}</small>
                                    </span>
                                    <span><small>{uniqueRounds.length === 1 ? `Round ${uniqueRounds[0]}` : `Rounds ${uniqueRounds.join(", ")}`}</small></span>
                                </button>
                            );
                        })}
                    </div>}
                    <div className={s.mapMatchInsight}>
                        <span>Round impact</span>
                        <div className={s.mapReviewList}>
                            {reviewNotes.slice(0, 4).map((note, index) => {
                                const markerLeft = canPlot ? Math.max(0, Math.min(1, note.y * map!.xMultiplier! + map!.xScalarToAdd!)) : 0.5;
                                const markerTop = canPlot ? Math.max(0, Math.min(1, note.x * map!.yMultiplier! + map!.yScalarToAdd!)) : 0.5;
                                const isDuelFocused = duelFocus?.id === note.id;
                                return (
                                <button
                                    key={`${note.label}-${note.copy}`}
                                    type="button"
                                    className={`${s.mapReviewCard} ${isDuelFocused ? s.mapReviewCardActive : ""}`}
                                    data-tone={note.tone}
                                    aria-pressed={isDuelFocused}
                                    onClick={() => selectDuelGroup(note.id, note.kicker, note.events)}
                                >
                                    <span className={s.mapReviewThumb} aria-hidden="true">
                                        {map?.displayIcon ? <Image src={map.displayIcon} alt="" fill sizes="52px" unoptimized /> : <b>{index + 1}</b>}
                                        <i style={{ left: `${markerLeft * 100}%`, top: `${markerTop * 100}%` }} />
                                    </span>
                                    <p><small>{note.kicker}</small><strong>{note.label}</strong><span>{note.copy}</span></p>
                                </button>
                                );
                            })}
                        </div>
                    </div>
                </section>
            </div>
        </section>
    );
}

function Scoreboard({
    detail,
    partyMembers,
    agents,
    tierAssets,
    onViewProfile,
}: {
    detail: ProfileMatchDetails;
    partyMembers: NonNullable<ProfileMatchSummary["partyMembers"]>;
    agents: Record<string, AgentMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const localPlayer = detail.players.find((p) => p.isLocal);
    const localTeamId = localPlayer?.teamId || "Blue";
    const localIsBlue = localTeamId.toLowerCase() === "blue";
    const yourTeam = detail.players.filter((p) => p.teamId.toLowerCase() === localTeamId.toLowerCase());
    const enemyTeam = detail.players.filter((p) => p.teamId.toLowerCase() !== localTeamId.toLowerCase());
    const partyMemberSubjects = new Set(partyMembers.map((member) => member.subject.toLowerCase()));
    const partyGroups = buildScorePartyGroups(detail.players, partyMemberSubjects);
    const sortPlayers = (rows: typeof detail.players) =>
        [...rows].sort((a, b) => (b.acs || 0) - (a.acs || 0) || b.score - a.score || b.kills - a.kills);

    const mvpPlayer = useMemo(() => {
        if (!detail.players.length) return null;
        return [...detail.players].reduce(
            (max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max),
            detail.players[0],
        );
    }, [detail.players]);

    return (
        <div className={s.scoreboardStage}>
            <div className={s.scoreGrid}>
                <ScoreTeam
                    title="Your"
                    side="blue"
                    won={localIsBlue ? detail.matchInfo.blueWins : !detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.blueRoundsWon : detail.matchInfo.redRoundsWon}
                    players={sortPlayers(yourTeam)}
                    agents={agents}
                    mvpPlayer={mvpPlayer}
                    partyGroups={partyGroups}
                    tierAssets={tierAssets}
                    onViewProfile={onViewProfile}
                />
                <ScoreTeam
                    title="Enemy"
                    side="red"
                    won={localIsBlue ? !detail.matchInfo.blueWins : detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.redRoundsWon : detail.matchInfo.blueRoundsWon}
                    players={sortPlayers(enemyTeam)}
                    agents={agents}
                    mvpPlayer={mvpPlayer}
                    partyGroups={partyGroups}
                    tierAssets={tierAssets}
                    onViewProfile={onViewProfile}
                />
            </div>
        </div>
    );
}

function ScoreTeam({
    title,
    side,
    won,
    score,
    players,
    agents,
    mvpPlayer,
    partyGroups,
    tierAssets,
    onViewProfile,
}: {
    title: string;
    side: "blue" | "red";
    won: boolean;
    score: number;
    players: ProfileMatchDetails["players"];
    agents: Record<string, AgentMeta>;
    mvpPlayer: ProfileMatchDetails["players"][number] | null;
    partyGroups: Map<string, ScorePartyGroup>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    return (
        <div className={`${s.scoreTeam} ${side === "blue" ? s.scoreTeamBlue : s.scoreTeamRed}`}>
            <div className={s.scoreTeamHeader}>
                <span>{title} Team</span>
                <small>{won ? "Victory" : "Defeat"}</small>
                <strong>{score}</strong>
            </div>
            <table className={s.scoreTable}>
                <thead>
                    <tr>
                        <th scope="col">Player</th>
                        <th scope="col">K / D / A</th>
                        <th scope="col">ACS</th>
                        <th scope="col">ADR</th>
                        <th scope="col">HS%</th>
                    </tr>
                </thead>
                <tbody>
                    {players.map((p, idx) => {
                        const meta = agents[p.characterId?.toLowerCase?.() || ""];
                        const name = p.gameName
                            ? `${p.gameName}${p.tagLine ? `#${p.tagLine}` : ""}`
                            : p.isLocal
                                ? "You"
                                : "Player";
                        const isMvp = Boolean(mvpPlayer && mvpPlayer.subject === p.subject);
                        const party = partyGroups.get(p.subject.toLowerCase());
                        const rankIcon = p.competitiveTier > 0 ? rankIconUrl(p.competitiveTier, tierAssets) : null;
                        const rowStyle = {
                            "--agent-art": meta?.full ? `url(${meta.full})` : "none",
                            ...(party ? { "--party-color": party.color } : {}),
                        } as CSSProperties;
                        return (
                            <tr
                                data-slot="score-player-row"
                                key={p.subject || `${p.characterId}-${idx}`}
                                className={`${p.isLocal ? s.scoreLocal : ""} ${party ? s.scorePartyRow : ""}`}
                                style={rowStyle}
                                title={party?.title}
                            >
                                <td>
                                    <span className={s.scorePlayer}>
                                        {meta?.icon ? (
                                            <Image src={meta.icon} alt={meta.name} width={26} height={26} unoptimized className={s.scoreAgentIcon} />
                                        ) : (
                                            <span className={`${s.scoreAgentIcon} ${s.scoreAgentPlaceholder}`} />
                                        )}
                                        <span className={s.scorePlayerMeta}>
                                            <span className={s.scorePlayerName}>
                                                {rankIcon && (
                                                    <Image src={rankIcon} alt="" width={16} height={16} unoptimized className={s.scoreRankIcon} />
                                                )}
                                                {p.subject && p.gameName && !p.isLocal ? (
                                                    <button
                                                        type="button"
                                                        className={s.scoreProfileBtn}
                                                        onClick={() => onViewProfile({ puuid: p.subject, gameName: p.gameName, tagLine: p.tagLine || "" })}
                                                        title={`View ${name}'s profile`}
                                                    >
                                                        {name}
                                                    </button>
                                                ) : name}
                                                {p.isLocal && <span className={s.youBadge}>You</span>}
                                                {party && (
                                                    <span className={s.partyBadge}>
                                                        {party.includesLocal && !p.isLocal ? "With you" : party.label}
                                                    </span>
                                                )}
                                                {isMvp && <span className={s.mvpBadge}>MVP</span>}
                                            </span>
                                            <small>{meta?.name || "Agent"}</small>
                                        </span>
                                    </span>
                                </td>
                                <td>
                                    <div>{p.kills}/{p.deaths}/{p.assists}</div>
                                    <div className={`${s.scoreSub} ${kdColor(p.kd)}`}>{fmtRatio(p.kd)} KD</div>
                                </td>
                                <td>
                                    <div className={acsColor(p.acs)}>{Math.round(p.acs || 0)}</div>
                                </td>
                                <td className={adrColor(p.adr)}>{Math.round(p.adr || 0)}</td>
                                <td className={hsColor(p.hsPct)}>{fmtPct(p.hsPct)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

interface ScorePartyGroup {
    label: string;
    size: number;
    color: string;
    includesLocal: boolean;
    title: string;
}

function buildScorePartyGroups(
    players: ProfileMatchDetails["players"],
    knownLocalPartySubjects: Set<string>,
): Map<string, ScorePartyGroup> {
    const localSubject = players.find((player) => player.isLocal)?.subject.toLowerCase() || "";
    const localPartySubjects = new Set(knownLocalPartySubjects);
    if (localPartySubjects.size > 0 && localSubject) localPartySubjects.add(localSubject);

    const membersByParty = new Map<string, ProfileMatchDetails["players"]>();
    for (const player of players) {
        const subject = player.subject.toLowerCase();
        const partyId = localPartySubjects.has(subject)
            ? "__viewing_party__"
            : (player.partyId || "").trim();
        if (!partyId) continue;
        const members = membersByParty.get(partyId) || [];
        members.push(player);
        membersByParty.set(partyId, members);
    }

    const groups = [...membersByParty.entries()]
        .filter(([, members]) => members.length >= 2)
        .sort(([, a], [, b]) => {
            const aLocal = a.some((player) => player.isLocal);
            const bLocal = b.some((player) => player.isLocal);
            return Number(bLocal) - Number(aLocal) || b.length - a.length;
        });
    // Party identity is deliberately independent from the selected app accent and
    // from the ally/enemy team colours. The viewing party is sorted first, so it
    // always receives the same warm gold marker across themes and matches.
    const palette = ["#e8b84a", "#9b7cff", "#4fa8ff", "#ff7699", "#a7b0ba"];
    const bySubject = new Map<string, ScorePartyGroup>();

    groups.forEach(([, members], index) => {
        const size = members.length;
        const includesLocal = members.some((player) => player.isLocal);
        const label = size === 2 ? "Duo" : size === 3 ? "Trio" : `${Math.min(size, 5)}-stack`;
        const names = members
            .map((player) => player.gameName || "Hidden player")
            .join(", ");
        const group: ScorePartyGroup = {
            label,
            size,
            color: palette[index % palette.length],
            includesLocal,
            title: `${label} queued together: ${names}`,
        };
        for (const player of members) bySubject.set(player.subject.toLowerCase(), group);
    });

    return bySubject;
}
