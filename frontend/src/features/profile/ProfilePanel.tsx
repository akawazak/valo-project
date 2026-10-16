"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import ProfileLoading from "./ProfileLoading";
import rr from "./RoundReview.module.css";
import { isProfileSyncReady, loadProfileSnapshot } from "./profileSnapshot";
import { useData } from "@/context/DataContext";
import type { Weapon } from "@/lib/types";
import {
    type AccountXPResponse,
    type ProfileTeammateStat,
    type ProfileQueueStat,
    getProfileMatchDetails,
    getProfileMatchHistory,
    getProfileSeasonSummary,
    getProfileSyncStatus,
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
import { matchModeLabel, useGameModes, useQueues } from "@/lib/gameMeta";
import RRHistoryChart from "./RRHistoryChart";
import ProfileBadges from "./ProfileBadges";
import ProfileExtras, { type CareerView, type ProgressionSection } from "./ProfileExtras";
import DuoChemistry from "./DuoChemistry";
import { matchOutcome } from "./reviewStats";
import { OPEN_RECAP_FLAG } from "@/features/session/SessionEndToast";
import { FEATURE_FLAGS } from "@/lib/features";
import { hasRoundBreakdown, roundOutcomes, sideStats, type MatchSide, type RoundOutcome, type SideStats } from "./matchBreakdown";
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
    developerName?: string;
    isPlayableCharacter?: boolean;
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
const RANK_COLORS = ["#9aa3a8", "#c58a5c", "#c9d4da", "#e8c15a", "#3fd0e0", "#c37cf2", "#3fd08a", "#e8566a"];
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
/** Puts the chosen comparison target first; ProfileComparison opens on the first candidate. */
function orderCandidates<T extends { puuid: string }>(target: string, candidates: T[]): T[] {
    if (!target) return candidates;
    const key = target.toLowerCase();
    return [...candidates.filter((item) => item.puuid.toLowerCase() === key), ...candidates.filter((item) => item.puuid.toLowerCase() !== key)];
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

/** Riot round ceremonies worth calling out; CeremonyDefault and blanks are skipped. */
const ROUND_CEREMONIES: Record<string, string> = {
    CeremonyClutch: "Clutch",
    CeremonyAce: "Ace",
    CeremonyTeamAce: "Team ace",
    CeremonyFlawless: "Flawless",
    CeremonyThrifty: "Thrifty",
    CeremonyCloser: "Closer",
};

/** 1 → "1ST", 2 → "2ND", 11 → "11TH". */
function placeLabel(n: number): string {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[n % 10] || "TH";
    return `${n}${suffix}`;
}

function statCount(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/** True when a sync timestamp is within the last 15 minutes. */
function isRecent(ms: number | undefined): boolean {
    return Boolean(ms) && Date.now() - (ms ?? 0) < 15 * 60_000;
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

function fmtClock(ms: number): string {
    if (!ms) return "--";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Match history is grouped by calendar day so a long list stays scannable.
function dayStart(ms: number): number {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return 0;
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function dayHeadline(ms: number): string {
    const key = dayStart(ms);
    if (!key) return "Unknown date";
    const today = dayStart(Date.now());
    const diffDays = Math.round((today - key) / 86_400_000);
    const date = new Date(key);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
    const sameYear = date.getFullYear() === new Date(today).getFullYear();
    return date.toLocaleDateString(undefined, sameYear
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" });
}

function dayAgo(ms: number): string {
    const key = dayStart(ms);
    if (!key) return "";
    const diffDays = Math.round((dayStart(Date.now()) - key) / 86_400_000);
    if (diffDays <= 1) return "";
    if (diffDays < 7) return `${diffDays} days ago`;
    return "";
}

// Fixed game-identity hues per agent role. These deliberately ignore the active
// accent theme so the Duelist/Initiator/etc. colour language stays learnable.
const AGENT_ROLE_TONES: Record<string, string> = {
    duelist: "agentRoleDuelist",
    initiator: "agentRoleInitiator",
    controller: "agentRoleController",
    sentinel: "agentRoleSentinel",
    flex: "agentRoleFlex",
};

function agentRoleTone(role: string | undefined): keyof typeof s {
    const key = (role || "flex").trim().toLowerCase();
    const tone = AGENT_ROLE_TONES[key] || AGENT_ROLE_TONES.flex;
    return s[tone] as unknown as keyof typeof s;
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
            className={`${s.mapDuelMarker} ${dead ? s.mapDuelMarkerDead : ""} ${local ? s.mapDuelMarkerLocal : ""}`}
            style={{ left: `${point.left * 100}%`, top: `${point.top * 100}%` }}
            title={`${playerName}${dead ? local ? " were eliminated" : " was eliminated" : " got the elimination"}`}
            aria-label={`${playerName}${dead ? local ? " were eliminated" : " was eliminated" : " got the elimination"}`}
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
    const [reviewFight, setReviewFight] = useState<MatchKillEvent | null>(null);
    const [loadedAnalytics, setLoadedAnalytics] = useState<ProfileMatchDetails | null>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsError, setAnalyticsError] = useState("");
    const [rankDetails, setRankDetails] = useState<ProfileMatchDetails | null>(null);
    const [ranksLoading, setRanksLoading] = useState(false);
    const [ranksError, setRanksError] = useState("");
    const dialogRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!expanded) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [expanded]);
    useEffect(() => {
        if (expanded) dialogRef.current?.querySelector<HTMLButtonElement>('nav[aria-label="Match detail views"] button[aria-current="page"]')?.focus();
    }, [activeMatchTab, expanded]);
    const loadRanks = async () => {
        if (ranksLoading) return;
        if (rankDetails?.rankRetryAt && Date.now() < rankDetails.rankRetryAt) {
            setRanksError(`Try again after ${new Date(rankDetails.rankRetryAt).toLocaleTimeString()}.`);
            return;
        }
        setRanksLoading(true);
        setRanksError("");
        try {
            const result = await getProfileMatchDetails(match.matchId, { puuid: profilePuuid, region, ranks: true });
            setRankDetails(result);
            setRanksError(result.rankError || "");
        } catch {
            setRanksError("Could not load ranks. Try again.");
        } finally {
            setRanksLoading(false);
        }
    };
    const gameModes = useGameModes();
    const queueNames = useQueues();
    const agentMeta = agents[match.localPlayer.characterId?.toLowerCase?.() || ""];
    const mapMeta = maps[match.mapID?.toLowerCase?.() || ""];
    // Ability-draft modes (Gauntlet) give every player a placeholder agent ID.
    const draftMode = /abilitydraft/i.test(match.queueID || "") || /abilitydraft/i.test(match.gameMode || "");
    const agentName = agentMeta?.name || (draftMode ? "Drafted kit" : "Unknown agent");
    const mapName = mapMeta?.name || match.mapID?.slice(0, 8) || "Map";
    // Modes without rounds (e.g. Deathmatch) have no team result or per-round
    // stats, so the row shows neither instead of a fake loss and inflated ACS.
    const roundBased = match.blueRoundsWon + match.redRoundsWon > 0 && match.localPlayer.roundsPlayed > 0;
    // Deathmatch is ranked by kills across every player instead of a team score.
    const placement = !roundBased ? match.placement ?? 0 : 0;
    // Gauntlet duos have no team score, but Riot reports each duo's final standing.
    const duoPlace = !roundBased && !placement ? match.teamPlacement ?? 0 : 0;
    const standing = placement || duoPlace;
    const standingOf = placement ? match.playerCount : match.teamCount;
    const ffaWin = standing === 1;
    const decided = roundBased || (!standing && (match.teamCount ?? 0) > 0);
    const resultClass = standing ? (ffaWin ? s.winText : s.neutralText) : !decided ? s.neutralText : match.win ? s.winText : s.lossText;
    const rowResultClass = ffaWin ? s.matchRowWin : !decided ? "" : match.win ? s.matchRowWin : s.matchRowLoss;
    // Some team-less modes still play real rounds (Gauntlet), so per-round stats hold.
    const perRoundStats = roundBased || (match.localPlayer.roundsPlayed > 1 && match.localPlayer.damageDealt > 0);
    const resultLabel = standing ? (ffaWin ? "WON" : "PLACED") : !decided ? "PLAYED" : match.win ? "WIN" : "LOSS";
    const killsPerMinute = match.gameLengthMillis > 0 ? match.localPlayer.kills / (match.gameLengthMillis / 60_000) : 0;
    const killGap = placement && match.bestOtherKills !== undefined ? match.localPlayer.kills - match.bestOtherKills : null;
    const queueName = matchModeLabel(gameModes, match.queueID, match.gameMode, queueNames);

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
        if (tab === "map") setReviewFight(null);
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

    const [scoreSide, setScoreSide] = useState<MatchSide>("all");
    const breakdownDetail = loadedAnalytics ?? detail;
    const roundOutcomeList = useMemo(
        () => (breakdownDetail && roundBased ? roundOutcomes(breakdownDetail, match.localPlayer.teamId, match.queueID) : []),
        [breakdownDetail, match.localPlayer.teamId, match.queueID, roundBased],
    );
    const canSplitSides = Boolean(breakdownDetail && roundBased && hasRoundBreakdown(breakdownDetail));
    const kda = match.localPlayer.kda;
    const hsPct = match.localPlayer.hsPct;
    // Some modes (e.g. Deathmatch) report no hit locations at all.
    const hasShotData = match.localPlayer.headshots + match.localPlayer.bodyshots + match.localPlayer.legshots > 0;
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
        <div
            className={`${s.matchWrap} ${rowResultClass} ${expanded ? s.matchWrapExpanded : ""}`}
            data-result={ffaWin ? "win" : !decided ? "neutral" : match.win ? "win" : "loss"}
            data-loading={loading ? "true" : undefined}
        >
            <button type="button" className={s.matchRow} onClick={() => {
                if (!expanded) setActiveMatchTab("scoreboard");
                onToggle();
            }} aria-expanded={expanded}>
                <span className={s.matchRowSheen} aria-hidden="true" />
                <div className={s.matchResultBlock}>
                    <span className={s.matchResultChip}>
                        {decided ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {match.win ? <path d="M5 12l5 5 9-10" /> : <><path d="M7 7l10 10" /><path d="M17 7L7 17" /></>}
                            </svg>
                        ) : null}
                        <span className={resultClass}>{resultLabel}</span>
                    </span>
                    {roundBased ? (
                        <span className={s.matchScore} aria-label={`${ownRounds} to ${enemyRounds}`}>
                            <b className={match.win ? s.winText : s.lossText}>{ownRounds}</b>
                            <i>:</i>
                            <b>{enemyRounds}</b>
                        </span>
                    ) : standing ? (
                        <span className={s.matchScore} aria-label={`Placed ${placeLabel(standing).toLowerCase()} of ${standingOf}`} title={`${placeLabel(standing)} of ${standingOf} ${placement ? "players" : "teams"}`}>
                            <b className={ffaWin ? s.winText : undefined}>{standing}</b>
                            <i>/</i>
                            <b>{standingOf}</b>
                        </span>
                    ) : (
                        <span className={s.matchScoreStandin}>{match.localPlayer.roundsPlayed > 1 ? `${match.localPlayer.roundsPlayed} rounds` : "No score"}</span>
                    )}
                    <span className={s.matchResultMeta}>
                        {queueName} · {fmtLength(match.gameLengthMillis)}
                    </span>
                </div>

                <div className={s.matchMain}>
                    <div className={s.matchAgent}>
                        <span className={`${s.matchAgentPortrait} ${agentRoleTone(agentMeta?.role)}`}>
                            {agentMeta?.icon ? (
                                <Image src={agentMeta.icon} alt={agentName} width={56} height={56} unoptimized className={s.matchAgentIcon} />
                            ) : (
                                <span className={`${s.matchAgentIcon} ${s.matchAgentPlaceholder}`} aria-hidden="true">
                                    <svg viewBox="0 0 24 24"><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5" /><path d="M4 16.5L12 21l8-4.5" /></svg>
                                </span>
                            )}
                            {agentMeta?.roleIcon ? (
                                <Image src={agentMeta.roleIcon} alt="" width={18} height={18} unoptimized className={s.matchAgentRole} />
                            ) : null}
                        </span>
                        <div className={s.matchAgentMeta}>
                            <div className={s.matchAgentName}>{agentName}</div>
                            {agentMeta?.role || draftMode ? (
                                <span className={s.matchAgentKicker}>
                                    {agentMeta?.role || "Ability draft"}
                                </span>
                            ) : null}
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
                            <span className={s.matchStatSub}>{fmtRatio(kda)} K/D</span>
                        </div>
                        {placement ? <>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>KILLS/MIN</span>
                            <strong className={s.matchStatValue}>{killsPerMinute ? killsPerMinute.toFixed(1) : "—"}</strong>
                            <span className={s.matchStatSub}>per minute</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>{ffaWin ? "LEAD" : "TO 1ST"}</span>
                            <strong className={`${s.matchStatValue} ${ffaWin ? s.winText : ""}`}>{killGap === null ? "—" : `${killGap > 0 ? "+" : killGap < 0 ? "−" : ""}${Math.abs(killGap)}`}</strong>
                            <span className={s.matchStatSub}>{ffaWin ? "kills over 2nd" : "kills behind"}</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>SCORE</span>
                            <strong className={s.matchStatValue}>{match.localPlayer.score.toLocaleString()}</strong>
                            <span className={s.matchStatSub}>Riot DM score</span>
                        </div>
                        </> : <>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>HS%</span>
                            <strong className={s.matchStatValue}>{hasShotData ? fmtPct(hsPct) : "—"}</strong>
                            <span className={s.matchStatSub}>accuracy</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ADR</span>
                            <strong className={s.matchStatValue}>{perRoundStats ? adr : "—"}</strong>
                            <span className={s.matchStatSub}>dmg/rd</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ACS</span>
                            <strong className={`${s.matchStatValue} ${perRoundStats && acsColor(acs) === s.statElite ? s.statElite : ""}`}>{perRoundStats ? acs : "—"}</strong>
                            <span className={s.matchStatSub}>score/rd</span>
                        </div>
                        </>}
                    </div>
                </div>

                {/* Map tile also carries the time, rank and RR so the row has no empty end column. */}
                <div
                    className={s.matchMapTile}
                    style={mapMeta?.splash ? { backgroundImage: `url(${mapMeta.splash})` } : undefined}
                >
                    <strong className={s.matchTileMap}>{mapName}</strong>
                    <span className={s.matchTileSide}>
                        <span className={s.matchTileTime}>{fmtClock(match.gameStartMillis)}</span>
                        {matchTier > 0 ? (
                            <>
                                <span className={s.matchTileRank} title={matchRRLabel}>
                                    {matchRRIcon && (
                                        <Image src={matchRRIcon} alt="" width={22} height={22} unoptimized className={s.matchRankIcon} />
                                    )}
                                    <span className={s.matchTileRankName}>{matchRRLabel}</span>
                                </span>
                                <span className={s.matchTileRrRow}>
                                    {match.performanceBonus ? <span className={s.matchTileBonus} data-tone="good">+{match.performanceBonus} perf</span> : null}
                                    {match.afkPenalty ? <span className={s.matchTileBonus} data-tone="danger">{match.afkPenalty > 0 ? "-" : ""}{Math.abs(match.afkPenalty)} AFK</span> : null}
                                    <span className={`${s.matchTileRr} ${rrEarned > 0 ? s.rrGain : rrEarned < 0 ? s.rrLoss : s.rrNeutral}`}>
                                        {rrSign}
                                        {rrEarned}
                                        <em>RR</em>
                                    </span>
                                </span>
                            </>
                        ) : match.isRanked ? (
                            <span className={s.matchTileRankName}>No RR cached</span>
                        ) : null}
                    </span>
                    <span className={s.matchChevron} aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 6l6 6-6 6" />
                        </svg>
                    </span>
                </div>
            </button>

            {expanded && createPortal(
                <div className={s.matchModalBackdrop} role="presentation" onMouseDown={onToggle}>
                    <section
                        ref={dialogRef}
                        className={`${s.matchModal} ${match.win ? s.matchModalWin : s.matchModalLoss}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${mapName} match details`}
                        tabIndex={-1}
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggle();
                            }
                            if (event.key !== "Tab") return;
                            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                                'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
                            )).filter((element) => element.getClientRects().length > 0);
                            const first = controls[0];
                            const last = controls[controls.length - 1];
                            if (!first || !last) { event.preventDefault(); return; }
                            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                                event.preventDefault();
                                last.focus();
                            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
                                event.preventDefault();
                                first.focus();
                            }
                        }}
                    >
                        <header
                            className={s.matchModalHeader}
                            style={mapMeta?.splash ? { backgroundImage: `url(${mapMeta.splash})` } : undefined}
                        >
                            <div className={s.matchModalHeaderShade} />
                            <div className={s.matchModalHeading}>
                                <div className={s.matchModalTitle}>
                                    <h2>{mapName}</h2>
                                    <span className={s.matchResultTag} data-result={!roundBased ? "neutral" : match.win ? "win" : "loss"}>
                                        {roundBased ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                {match.win ? <path d="M5 12l5 5 9-10" /> : <><path d="M7 7l10 10" /><path d="M17 7L7 17" /></>}
                                            </svg>
                                        ) : null}
                                        {!roundBased ? "Completed" : match.win ? "Victory" : "Defeat"}
                                    </span>
                                </div>
                                <div className={s.matchMetaTags}>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 3L4 14h7l-1 7 9-11h-7z" /></svg>
                                        {queueName}
                                    </span>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                                        {fmtLength(match.gameLengthMillis)}
                                    </span>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                                        {fmtDate(match.gameStartMillis)}
                                    </span>
                                    {unusualCompletion ? <span className={s.matchMetaWarn}>{completionState}</span> : null}
                                    {!unusualCompletion && detail?.matchInfo.earlyCompletion ? <span className={s.matchMetaWarn} title="Riot marked this match as ended early">Ended early</span> : null}
                                    {detailedLocalPlayer?.partyRRPenalty ? <span className={s.matchMetaWarn} title="Riot applied a party-size RR penalty to your party in this match">Party RR penalty {detailedLocalPlayer.partyRRPenalty}</span> : null}
                                </div>
                            </div>
                            {roundBased ? (
                                <div className={s.matchScorePlates} aria-label={`Score ${ownRounds} to ${enemyRounds}`}>
                                    <span data-team="ally"><strong>{ownRounds}</strong><small>Your team</small></span>
                                    <i aria-hidden="true">:</i>
                                    <span data-team="enemy"><strong>{enemyRounds}</strong><small>Enemy</small></span>
                                </div>
                            ) : null}
                            <button type="button" className={s.matchModalClose} onClick={onToggle} aria-label="Close match details">×</button>
                        </header>
                        <nav className={s.matchDetailTabs} aria-label="Match detail views">
                            <button
                                type="button"
                                className={activeMatchTab === "scoreboard" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "scoreboard" ? "page" : undefined}
                                onClick={() => setActiveMatchTab("scoreboard")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                                Scoreboard
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "rounds" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "rounds" ? "page" : undefined}
                                onClick={() => void openAnalyticsTab("rounds")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
                                Round review
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "map" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "map" ? "page" : undefined}
                                onClick={() => void openAnalyticsTab("map")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
                                Map
                            </button>
                            {activeMatchTab === "scoreboard" && canSplitSides ? (
                                <div className={s.matchSideFilter} role="group" aria-label="Scoreboard side">
                                    {(["all", "attack", "defense"] as const).map((option) => (
                                        <button
                                            type="button"
                                            key={option}
                                            aria-pressed={scoreSide === option}
                                            onClick={() => setScoreSide(option)}
                                        >
                                            {option === "all" ? "All" : option === "attack" ? "Attack" : "Defense"}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {activeMatchTab === "scoreboard" && detail?.players.some(player => player.competitiveTier <= 0) && (
                                <button
                                    type="button"
                                    className={s.loadRanksButton}
                                    data-loaded={!!rankDetails && !rankDetails.rankError}
                                    onClick={() => void loadRanks()}
                                    disabled={ranksLoading || (!!rankDetails && !rankDetails.rankError)}
                                    title={rankDetails && !rankDetails.rankError ? "Missing match ranks supplemented with current ranks. A dash means no rank was returned." : "Look up current competitive ranks for players whose match rank is missing"}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                        <path d="m12 3 7 3v6c0 4-7 9-7 9s-7-5-7-9V6l7-3Z" />
                                        <path d="m8.5 11.5 2.5 2.5 4.5-5" />
                                    </svg>
                                    <span aria-live="polite">{ranksLoading ? "Loading ranks…" : rankDetails && !rankDetails.rankError ? "Ranks loaded" : "Load ranks"}</span>
                                </button>
                            )}
                        </nav>
                        {activeMatchTab === "scoreboard" && ranksError && (
                            <p className={s.rankLookupStatus} role="status">
                                {ranksError}
                            </p>
                        )}
                        <div className={s.matchModalBody}>
                            {activeMatchTab === "scoreboard" && roundOutcomeList.length ? (
                                <RoundHistory rounds={roundOutcomeList} ownRounds={ownRounds} enemyRounds={enemyRounds} />
                            ) : null}
                            {loading ? (
                                <div className={s.placeholder}>Loading scoreboard…</div>
                            ) : detail ? (
                                activeMatchTab === "scoreboard" ? (
                                    <Scoreboard
                                        detail={rankDetails ?? detail}
                                        breakdown={loadedAnalytics ?? detail}
                                        side={canSplitSides ? scoreSide : "all"}
                                        queueId={match.queueID}
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
                                        initialRoundNum={reviewFight?.roundNum}
                                        onInspectFight={(event) => { setReviewFight(event); setActiveMatchTab("map"); }}
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
                                        initialFight={reviewFight}
                                        onBackToRound={reviewFight ? () => setActiveMatchTab("rounds") : undefined}
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

export function RoundReview({
    detail,
    map,
    agents,
    weapons,
    initialRoundNum,
    onInspectFight,
}: {
    detail: ProfileMatchDetails;
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
    initialRoundNum?: number;
    onInspectFight?: (event: MatchKillEvent) => void;
}) {
    const rounds = useMemo(() => detail.rounds || [], [detail.rounds]);
    const local = detail.players.find((player) => player.isLocal);
    const localSubject = local?.subject.toLowerCase() || "";
    const localTeam = local?.teamId.toLowerCase() || "";
    const [selectedRoundNum, setSelectedRoundNum] = useState(initialRoundNum ?? rounds[0]?.roundNum ?? 0);
    // Which feed moment the map replays. It belongs to one round; another round starts at its first kill.
    const [moment, setMoment] = useState<{ round: number; id: string } | null>(null);
    const [replaying, setReplaying] = useState(false);
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
    const canPlot = Boolean(map?.displayIcon && typeof map.xMultiplier === "number" && typeof map.yMultiplier === "number" && typeof map.xScalarToAdd === "number" && typeof map.yScalarToAdd === "number");
    const plot = (x: number, y: number) => ({
        left: Math.max(0, Math.min(1, y * map!.xMultiplier! + map!.xScalarToAdd!)) * 100,
        top: Math.max(0, Math.min(1, x * map!.yMultiplier! + map!.yScalarToAdd!)) * 100,
    });
    const playerBySubject = useMemo(() => new Map(detail.players.map((player) => [player.subject.toLowerCase(), player])), [detail.players]);
    const allLocalDeaths = (detail.kills || []).filter((event) => event.victim.toLowerCase() === localSubject);
    const tradedDeaths = allLocalDeaths.filter((death) => (detail.kills || []).some((event) => event.roundNum === death.roundNum && event.roundTime >= death.roundTime && event.roundTime - death.roundTime <= 5_000 && event.victim.toLowerCase() === death.killer.toLowerCase() && playerBySubject.get(event.killer.toLowerCase())?.teamId.toLowerCase() === localTeam)).length;
    const totalAbilityEffects = rounds.reduce((sum, round) => {
        const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
        return sum + (stat?.ability.grenade || 0) + (stat?.ability.ability1 || 0) + (stat?.ability.ability2 || 0) + (stat?.ability.ultimate || 0);
    }, 0);
    const abilityUsage = useMemo(() => ([
        ["grenade", local?.abilityCasts?.grenade || 0],
        ["ability1", local?.abilityCasts?.ability1 || 0],
        ["ability2", local?.abilityCasts?.ability2 || 0],
        ["ultimate", local?.abilityCasts?.ultimate || 0],
    ] as const).filter(([, count]) => count > 0).map(([slot, count]) => ({
        count,
        name: agents[local?.characterId.toLowerCase() || ""]?.abilities?.[slot]?.name || ({ grenade: "Signature", ability1: "Ability 1", ability2: "Ability 2", ultimate: "Ultimate" } as const)[slot],
    })), [agents, local?.abilityCasts?.ability1, local?.abilityCasts?.ability2, local?.abilityCasts?.grenade, local?.abilityCasts?.ultimate, local?.characterId]);
    const totalAbilityCasts = abilityUsage.reduce((sum, ability) => sum + ability.count, 0);
    const roundFacts = useMemo(() => {
        let yourScore = 0;
        let enemyScore = 0;
        return rounds.map((round) => {
            const won = round.winningTeam.toLowerCase() === localTeam;
            if (won) yourScore += 1;
            else enemyScore += 1;
            const events = (detail.kills || [])
                .filter((event) => event.roundNum === round.roundNum)
                .sort((a, b) => a.roundTime - b.roundTime || a.gameTime - b.gameTime);
            const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
            const kills = events.filter((event) => event.killer.toLowerCase() === localSubject);
            const deaths = events.filter((event) => event.victim.toLowerCase() === localSubject);
            const assists = events.filter((event) => event.assistants?.some((assistant) => assistant.toLowerCase() === localSubject));
            const openingEvent = events[0];
            const openingResult = openingEvent?.killer.toLowerCase() === localSubject
                ? "won"
                : openingEvent?.victim.toLowerCase() === localSubject
                    ? "lost"
                    : "none";
            const traded = deaths.some((death) => events.some((event) => (
                event.roundTime >= death.roundTime
                && event.roundTime - death.roundTime <= 5_000
                && event.victim.toLowerCase() === death.killer.toLowerCase()
                && playerBySubject.get(event.killer.toLowerCase())?.teamId.toLowerCase() === localTeam
            )));
            const playerTeam = (subject: string) => playerBySubject.get(subject.toLowerCase())?.teamId.toLowerCase() || "";
            const allyLoadout = (round.playerStats || [])
                .filter((entry) => playerTeam(entry.subject) === localTeam)
                .reduce((sum, entry) => sum + (entry.economy.loadoutValue || 0), 0);
            const enemyLoadout = (round.playerStats || [])
                .filter((entry) => playerTeam(entry.subject) && playerTeam(entry.subject) !== localTeam)
                .reduce((sum, entry) => sum + (entry.economy.loadoutValue || 0), 0);
            const damage = stat?.damage?.reduce((sum, event) => sum + event.damage, 0) || 0;
            const localObjective = round.bombPlanter?.toLowerCase() === localSubject
                ? `Planted${round.plantSite ? ` ${round.plantSite}` : ""}`
                : round.bombDefuser?.toLowerCase() === localSubject
                    ? "Defused"
                    : "";
            return {
                round,
                won,
                stat,
                events,
                kills,
                deaths,
                assists,
                damage,
                openingResult,
                traded,
                allyLoadout,
                enemyLoadout,
                localObjective,
                yourScore,
                enemyScore,
            };
        });
    }, [detail.kills, localSubject, localTeam, playerBySubject, rounds]);
    const selectedFact = roundFacts.find((fact) => fact.round.roundNum === selectedRound?.roundNum) || roundFacts[0];
    const turningPoints = useMemo(() => {
        const notes: Array<{ roundNum: number; tone: "good" | "danger" | "neutral"; title: string; detail: string }> = [];
        const claimed = new Set<number>();
        const add = (note: (typeof notes)[number]) => {
            if (claimed.has(note.roundNum)) return;
            claimed.add(note.roundNum);
            notes.push(note);
        };
        for (let index = 0; index < roundFacts.length; index += 1) {
            const fact = roundFacts[index];
            const displayRound = fact.round.roundNum + 1;
            if (fact.openingResult === "won" && !fact.won) {
                add({ roundNum: fact.round.roundNum, tone: "danger", title: `R${displayRound} · Advantage lost`, detail: "You secured first blood, but the round did not convert." });
                continue;
            }
            if (fact.openingResult === "lost" && fact.won) {
                add({ roundNum: fact.round.roundNum, tone: "good", title: `R${displayRound} · Team recovery`, detail: "Your team recovered the round after you were first death." });
                continue;
            }
            if (fact.won && fact.enemyLoadout - fact.allyLoadout >= 3_000) {
                add({ roundNum: fact.round.roundNum, tone: "good", title: `R${displayRound} · Economy upset`, detail: `Won despite a ${Math.round((fact.enemyLoadout - fact.allyLoadout) / 100) / 10}k team-loadout deficit.` });
                continue;
            }
            if (index >= 2 && roundFacts[index - 1].won === roundFacts[index - 2].won && fact.won !== roundFacts[index - 1].won) {
                add({
                    roundNum: fact.round.roundNum,
                    tone: fact.won ? "good" : "danger",
                    title: `R${displayRound} · ${fact.won ? "Momentum recovered" : "Momentum broken"}`,
                    detail: fact.won ? "This win stopped a two-round losing run." : "This loss ended a two-round winning run.",
                });
            }
        }
        return notes.slice(0, 6);
    }, [roundFacts]);
    const reviewInsights = useMemo(() => {
        const insights: Array<{ id: string; tone: "good" | "danger" | "neutral"; label: string; value: string; evidence: string; tip: string; ratio?: number; ring: string }> = [];
        const lostRounds = roundFacts.filter((fact) => fact.stat && !fact.won).length;
        const openingFacts = roundFacts.filter((fact) => fact.openingResult !== "none");
        const openingWon = openingFacts.filter((fact) => fact.openingResult === "won");
        const openingConverted = openingWon.filter((fact) => fact.won).length;
        if (openingFacts.length) {
            const duelRate = Math.round((openingWon.length / openingFacts.length) * 100);
            insights.push({
                id: "opening-duels",
                tone: duelRate >= 55 ? "good" : duelRate < 40 ? "danger" : "neutral",
                label: "Opening duels",
                value: `${openingWon.length}/${openingFacts.length} won`,
                ratio: openingWon.length / openingFacts.length,
                ring: `${duelRate}%`,
                evidence: `${openingConverted}/${openingWon.length} opening advantages converted into round wins.`,
                tip: duelRate >= 55 ? "Keep choosing first contact when the setup gives you support." : "Take first contact closer to a teammate or after utility creates the advantage.",
            });
        }
        if (allLocalDeaths.length) {
            const tradeRate = Math.round((tradedDeaths / allLocalDeaths.length) * 100);
            insights.push({
                id: "trade-spacing",
                tone: tradeRate >= 55 ? "good" : tradeRate < 35 ? "danger" : "neutral",
                label: "Trade spacing",
                value: `${tradedDeaths} of ${allLocalDeaths.length} traded`,
                ratio: tradedDeaths / allLocalDeaths.length,
                ring: `${tradeRate}%`,
                evidence: `${tradedDeaths}/${allLocalDeaths.length} deaths were answered by a teammate within five seconds.`,
                tip: tradeRate >= 55 ? "Your spacing created reliable return kills; preserve it." : "Play within a teammate’s trade path instead of giving isolated fights.",
            });
        }
        const multiKillRounds = roundFacts.filter((fact) => fact.kills.length >= 2);
        if (multiKillRounds.length) {
            const converted = multiKillRounds.filter((fact) => fact.won).length;
            insights.push({
                id: "multikill-conversion",
                tone: converted === multiKillRounds.length ? "good" : converted / multiKillRounds.length < 0.6 ? "danger" : "neutral",
                label: "Multi-kill conversion",
                value: `${converted}/${multiKillRounds.length} rounds`,
                ratio: converted / multiKillRounds.length,
                ring: `${converted}/${multiKillRounds.length}`,
                evidence: `${multiKillRounds.length} rounds contained at least two of your kills.`,
                tip: converted === multiKillRounds.length ? "Your high-impact rounds consistently converted." : "After a multi-kill, reset around the objective instead of offering another isolated duel.",
            });
        }
        const lowDamageLosses = roundFacts.filter((fact) => fact.stat && !fact.won && fact.damage < 100);
        if (lowDamageLosses.length) {
            insights.push({
                id: "low-damage-losses",
                tone: "danger",
                label: "Low-damage losses",
                value: `${lowDamageLosses.length} round${lowDamageLosses.length === 1 ? "" : "s"}`,
                ratio: lostRounds ? lowDamageLosses.length / lostRounds : undefined,
                ring: lostRounds ? `${lowDamageLosses.length}/${lostRounds}` : String(lowDamageLosses.length),
                evidence: `Below 100 recorded damage in rounds ${lowDamageLosses.map((fact) => fact.round.roundNum + 1).join(", ")}.`,
                tip: "Use safer utility-assisted contact or reposition early enough to contribute before the round closes.",
            });
        }
        const weakBuyLosses = roundFacts.filter((fact) => !fact.won && fact.allyLoadout > 0 && fact.enemyLoadout - fact.allyLoadout >= 3_000);
        if (weakBuyLosses.length) {
            insights.push({
                id: "economy-deficit",
                tone: "neutral",
                label: "Economy pressure",
                value: `${weakBuyLosses.length} disadvantaged loss${weakBuyLosses.length === 1 ? "" : "es"}`,
                ratio: lostRounds ? weakBuyLosses.length / lostRounds : undefined,
                ring: String(weakBuyLosses.length),
                evidence: `Your team entered those rounds at least 3,000 loadout value behind.`,
                tip: "Treat these as lower-probability rounds: coordinate the buy, preserve weapons, and avoid judging aim from the result alone.",
            });
        }
        const objectiveRounds = roundFacts.filter((fact) => fact.localObjective);
        if (objectiveRounds.length) {
            const converted = objectiveRounds.filter((fact) => fact.won).length;
            insights.push({
                id: "objective-work",
                tone: converted / objectiveRounds.length >= 0.6 ? "good" : "neutral",
                label: "Objective work",
                value: `${converted}/${objectiveRounds.length} converted`,
                ratio: converted / objectiveRounds.length,
                ring: `${converted}/${objectiveRounds.length}`,
                evidence: objectiveRounds.map((fact) => `R${fact.round.roundNum + 1} ${fact.localObjective}`).join(" · "),
                tip: converted / objectiveRounds.length >= 0.6 ? "Your plant/defuse involvement produced round value." : "After the objective action, prioritize the safest post-plant or retake position.",
            });
        }
        if (totalAbilityCasts || totalAbilityEffects) {
            insights.push({
                id: "utility",
                tone: "neutral",
                label: "Utility record",
                value: totalAbilityCasts ? `${totalAbilityCasts} casts` : `${totalAbilityEffects} effects`,
                ring: String(totalAbilityCasts || totalAbilityEffects),
                evidence: abilityUsage.length ? abilityUsage.map((ability) => `${ability.name} ${ability.count}`).join(" · ") : `${totalAbilityEffects} round effects preserved.`,
                tip: "Use this as a factual usage count; the payload does not prove whether each cast had good timing.",
            });
        }
        const behavior = local?.behavior;
        if (behavior && (behavior.friendlyFireOutgoing > 0 || behavior.afkRounds > 0 || behavior.stayedInSpawnRounds > 0)) {
            const parts = [
                behavior.friendlyFireOutgoing ? `${behavior.friendlyFireOutgoing} friendly fire dealt` : "",
                behavior.friendlyFireIncoming ? `${behavior.friendlyFireIncoming} taken` : "",
                behavior.afkRounds ? `${behavior.afkRounds} AFK round${behavior.afkRounds === 1 ? "" : "s"}` : "",
                behavior.stayedInSpawnRounds ? `${behavior.stayedInSpawnRounds} round${behavior.stayedInSpawnRounds === 1 ? "" : "s"} in spawn` : "",
            ].filter(Boolean);
            insights.push({
                id: "riot-behavior",
                tone: behavior.afkRounds || behavior.friendlyFireOutgoing >= 100 ? "danger" : "neutral",
                label: "Riot behavior",
                value: behavior.friendlyFireOutgoing ? `${behavior.friendlyFireOutgoing} team damage` : behavior.afkRounds ? `${behavior.afkRounds} AFK` : `${behavior.stayedInSpawnRounds} in spawn`,
                evidence: parts.join(" · "),
                tip: behavior.friendlyFireOutgoing ? "Watch utility and spray lines around teammates; Riot tracks team damage." : "Riot reported idle or spawn time this match; check for connection or input issues.",
                ring: behavior.friendlyFireOutgoing ? "FF" : "!",
            });
        }
        const flaggedFacts = roundFacts.filter((fact) => fact.stat && (fact.stat.wasAfk || fact.stat.wasPenalized || fact.stat.stayedInSpawn));
        if (flaggedFacts.length) {
            insights.push({
                id: "riot-status",
                tone: "danger",
                label: "Riot status flags",
                value: `${flaggedFacts.length} round${flaggedFacts.length === 1 ? "" : "s"}`,
                ratio: flaggedFacts.length / roundFacts.length,
                ring: String(flaggedFacts.length),
                evidence: `AFK, penalty, or spawn state was reported in rounds ${flaggedFacts.map((fact) => fact.round.roundNum + 1).join(", ")}.`,
                tip: "This is Riot-reported state, not an intent judgment; review connection or interruption issues if it was unexpected.",
            });
        }
        return insights;
    }, [abilityUsage, allLocalDeaths.length, local?.behavior, roundFacts, totalAbilityCasts, totalAbilityEffects, tradedDeaths]);
    const teamOf = (subject?: string) => playerBySubject.get(subject?.toLowerCase() || "")?.teamId.toLowerCase() || "";
    const roundFeed = useMemo(() => {
        if (!selectedRound) return [];
        const sideOf = (subject?: string) => playerBySubject.get(subject?.toLowerCase() || "")?.teamId.toLowerCase() || "";
        const events = [...selectedKills].sort((a, b) => a.roundTime - b.roundTime || a.gameTime - b.gameTime);
        const enemyKills = new Map<string, number>();
        const feed: Array<{
            id: string;
            time: number;
            kind: "kill" | "plant" | "defuse";
            actor: string;
            target?: string;
            text?: string;
            tag?: "Opening" | "Trade" | "Ace" | "Alt fire";
            means?: string;
            meansIcon?: string;
            meansAbility?: boolean;
            ally: boolean;
            you: boolean;
        }> = events.map((event, index) => {
            const killer = event.killer.toLowerCase();
            const victim = event.victim.toLowerCase();
            if (sideOf(killer) !== sideOf(victim)) enemyKills.set(killer, (enemyKills.get(killer) || 0) + 1);
            const damageItem = event.damageItem?.trim().toLowerCase() || "";
            const killerAgent = agents[playerBySubject.get(killer)?.characterId.toLowerCase() || ""];
            const abilitySlot = riotAbilitySlotKey(event.damageType?.toLowerCase() || "", damageItem);
            const ability = abilitySlot ? killerAgent?.abilities?.[abilitySlot] : undefined;
            const usedWeapon = damageItem ? weaponById.get(damageItem) : undefined;
            const traded = events.slice(0, index).some((prior) => (
                event.roundTime >= prior.roundTime
                && event.roundTime - prior.roundTime <= 5_000
                && victim === prior.killer.toLowerCase()
                && sideOf(killer) === sideOf(prior.victim)
            ));
            return {
                id: fightEventKey(event),
                time: event.roundTime || event.gameTime,
                kind: "kill",
                actor: killer,
                target: victim,
                tag: enemyKills.get(killer) === 5 ? "Ace" : index === 0 ? "Opening" : traded ? "Trade" : event.secondaryFire ? "Alt fire" : undefined,
                means: ability?.name || usedWeapon?.displayName,
                meansIcon: ability?.icon || usedWeapon?.displayIcon,
                meansAbility: Boolean(ability?.icon),
                ally: sideOf(killer) === localTeam,
                you: killer === localSubject || victim === localSubject,
            };
        });
        if (selectedRound.bombPlanter) {
            const planter = selectedRound.bombPlanter.toLowerCase();
            feed.push({ id: "plant", time: selectedRound.plantRoundTime || 0, kind: "plant", actor: planter, text: `planted the spike${selectedRound.plantSite ? ` on ${selectedRound.plantSite}` : ""}`, ally: sideOf(planter) === localTeam, you: planter === localSubject });
        }
        if (selectedRound.bombDefuser) {
            const defuser = selectedRound.bombDefuser.toLowerCase();
            feed.push({ id: "defuse", time: selectedRound.defuseRoundTime || 0, kind: "defuse", actor: defuser, text: "defused the spike", ally: sideOf(defuser) === localTeam, you: defuser === localSubject });
        }
        // Stable sort keeps a plant after kills recorded on the same second.
        return feed.sort((a, b) => a.time - b.time);
    }, [agents, localSubject, localTeam, playerBySubject, selectedKills, selectedRound, weaponById]);
    const ace = roundFeed.find((item) => item.tag === "Ace");
    const ceremony = selectedRound ? ROUND_CEREMONIES[selectedRound.roundCeremony || ""] : undefined;
    // Riot credits a clutch to the winning team; the clutcher is its last survivor.
    const clutcher = (() => {
        if (ceremony !== "Clutch" || !selectedRound?.winningTeam) return undefined;
        const winners = detail.players.filter((player) => player.teamId.toLowerCase() === selectedRound.winningTeam.toLowerCase());
        const survivors = winners.filter((player) => !selectedKills.some((event) => event.victim.toLowerCase() === player.subject.toLowerCase()));
        return survivors.length === 1 ? survivors[0].subject.toLowerCase() : undefined;
    })();
    const playerName = (subject?: string) => !subject ? "Unknown player" : subject === localSubject ? "You" : playerBySubject.get(subject)?.gameName || "Player";
    const agentIcon = (subject?: string) => agents[playerBySubject.get(subject || "")?.characterId.toLowerCase() || ""]?.icon;
    const selectedSignals = selectedFact ? [
        selectedFact.openingResult === "won" ? { tone: "good", label: "Opening kill" } : selectedFact.openingResult === "lost" ? { tone: "danger", label: "First death" } : null,
        selectedFact.kills.length >= 2 ? { tone: "good", label: `${selectedFact.kills.length}K multi-kill` } : null,
        selectedFact.traded ? { tone: "good", label: "Death traded" } : selectedFact.deaths.length ? { tone: "danger", label: "Untraded death" } : null,
        ace ? { tone: "objective", label: ace.actor === localSubject ? "Your ace" : `${teamOf(ace.actor) === localTeam ? "Ace" : "Enemy ace"} · ${playerName(ace.actor)}` } : null,
        ceremony && !(ceremony === "Ace" && ace) ? {
            tone: roundWon ? "good" : "danger",
            label: clutcher === localSubject ? "Your clutch" : `${roundWon ? "" : "Enemy "}${roundWon ? ceremony : ceremony.toLowerCase()}${clutcher ? ` · ${playerName(clutcher)}` : ""}`,
        } : null,
        selectedFact.localObjective ? { tone: "objective", label: selectedFact.localObjective } : null,
        selectedFact.enemyLoadout - selectedFact.allyLoadout >= 3_000 ? { tone: "neutral", label: "Lower team buy" } : selectedFact.allyLoadout - selectedFact.enemyLoadout >= 3_000 ? { tone: "good", label: "Stronger team buy" } : null,
    ].filter((signal): signal is { tone: string; label: string } => Boolean(signal)) : [];
    const selectedRoundRead = (() => {
        if (!selectedFact) return "No detailed player receipt was recorded for this round.";
        if (selectedFact.openingResult === "won" && !selectedFact.won) return "You created the opening advantage, but the team did not convert it. After first blood, reduce unnecessary re-peeks and play the objective edge.";
        if (selectedFact.openingResult === "lost" && !selectedFact.traded) return "You were first death and the kill was not traded within five seconds. Take the same contact only with closer trade support or earlier utility.";
        if (selectedFact.kills.length >= 2 && !selectedFact.won) return "Your multi-kill did not convert. The next decision after gaining numbers mattered more than finding another duel.";
        if (!selectedFact.won && selectedFact.stat && selectedFact.damage < 100) return "Low-damage loss. Look for earlier, safer contribution — utility, a crossfire, or a supported first fight.";
        if (selectedFact.won && selectedFact.enemyLoadout - selectedFact.allyLoadout >= 3_000) return "Your team won against a stronger enemy loadout—one of the match’s clearest high-value rounds.";
        if (selectedFact.won && selectedFact.deaths.length === 0) return "You survived a converted round. Preserve the weapon and repeat the positioning that kept your impact available late.";
        return `${selectedFact.stat ? `${selectedFact.damage} damage` : "Damage unavailable"}, ${selectedFact.kills.length} kills, ${selectedFact.assists.length} assists, and ${selectedFact.deaths.length ? "a death" : "survival"} were recorded.`;
    })();

    const activeMomentId = moment?.round === selectedRound?.roundNum && roundFeed.some((item) => item.id === moment.id)
        ? moment.id
        : roundFeed.find((item) => item.kind === "kill")?.id ?? null;
    const activeMomentIndex = roundFeed.findIndex((item) => item.id === activeMomentId);
    const pickMoment = useCallback((id: string) => {
        if (selectedRound) setMoment({ round: selectedRound.roundNum, id });
    }, [selectedRound]);
    useEffect(() => {
        if (!replaying) return;
        if (activeMomentIndex >= roundFeed.length - 1) { setReplaying(false); return; }
        const timer = window.setTimeout(() => pickMoment(roundFeed[activeMomentIndex + 1].id), 1600);
        return () => window.clearTimeout(timer);
    }, [replaying, activeMomentIndex, roundFeed, pickMoment]);
    useEffect(() => { setReplaying(false); }, [selectedRoundNum]);

    if (!rounds.length) return <div className={s.mapAnalyticsEmpty}><strong>Round evidence is not cached yet.</strong><span>Open this view while connected to refresh the match details.</span></div>;

    const round = selectedRound!;
    const outcome = (round.roundResult || round.roundCeremony || "").replace(/bomb/gi, "Spike");
    const outcomeTime = round.bombDefuser && round.defuseRoundTime ? ` at ${fmtLength(round.defuseRoundTime)}` : "";
    const allyLoadout = selectedFact?.allyLoadout || 0;
    const enemyLoadout = selectedFact?.enemyLoadout || 0;
    const killById = new Map(selectedKills.map((event) => [fightEventKey(event), event]));
    const activeMoment = activeMomentIndex >= 0 ? roundFeed[activeMomentIndex] : undefined;
    const activeKill = activeMoment?.kind === "kill" ? killById.get(activeMoment.id) : undefined;
    const snapshot = activeKill ?? roundFeed.slice(0, activeMomentIndex + 1).reverse().map((item) => killById.get(item.id)).find(Boolean);
    const earlierKills = roundFeed.slice(0, activeMomentIndex).map((item) => killById.get(item.id)).filter((event): event is MatchKillEvent => Boolean(event) && event !== activeKill);
    const deadBefore = new Set(earlierKills.map((event) => event.victim.toLowerCase()));
    const replayReady = canPlot && Boolean(snapshot?.playerLocations?.length);
    const killerSpot = activeKill?.playerLocations?.find((location) => location.subject?.toLowerCase() === activeKill.killer.toLowerCase());
    const momentTime = (item: (typeof roundFeed)[number]) => item.time || 0;
    // Spread the moments over the part of the round they happened in, with a little room at the end.
    const roundLength = Math.max(20_000, ...roundFeed.map(momentTime)) * 1.08;

    // Halves follow the mode: Riot's red team attacks first and sides swap at the half, then every overtime round.
    const queueId = (detail.matchInfo.queueID || "").toLowerCase();
    const halfLength = queueId === "swiftplay" ? 4 : queueId === "spikerush" ? 3 : 12;
    const startsOnAttack = localTeam === "red";
    const halves = [
        { key: "first", label: startsOnAttack ? "Attack" : "Defense", side: startsOnAttack ? "attack" : "defense", facts: roundFacts.filter((fact) => fact.round.roundNum < halfLength) },
        { key: "second", label: startsOnAttack ? "Defense" : "Attack", side: startsOnAttack ? "defense" : "attack", facts: roundFacts.filter((fact) => fact.round.roundNum >= halfLength && fact.round.roundNum < halfLength * 2) },
        { key: "overtime", label: "Overtime", side: "overtime", facts: roundFacts.filter((fact) => fact.round.roundNum >= halfLength * 2) },
    ].filter((half) => half.facts.length);
    const finalFact = roundFacts[roundFacts.length - 1];
    const yourAgent = agents[local?.characterId.toLowerCase() || ""];
    const roundTags = selectedSignals.filter((signal) => signal.tone === "good" || signal.tone === "objective").slice(0, 3).map((signal) => signal.label);

    return <section className={rr.root} style={map?.splash ? { "--rr-map": `url("${map.splash}")` } as CSSProperties : undefined}>
        {reviewInsights.length ? <div className={rr.review} aria-label="Match review">
            {reviewInsights.map((insight) => <article key={insight.id} data-tone={insight.tone} title={`${insight.tip}${insight.evidence ? `\n${insight.evidence}` : ""}`}>
                <svg viewBox="0 0 40 40" aria-hidden="true">
                    <circle cx="20" cy="20" r="16" />
                    {insight.ratio !== undefined ? <circle cx="20" cy="20" r="16" pathLength={100} strokeDasharray={`${Math.max(1, Math.round(insight.ratio * 100))} 100`} transform="rotate(-90 20 20)" /> : null}
                </svg>
                <span><small>{insight.label}</small><b>{insight.value}</b></span>
            </article>)}
        </div> : null}
        {!hasDetailedRounds ? <p className={rr.note}>Objective timeline only. Buys and damage need a refresh while connected.</p> : null}

        <div className={rr.rounds} role="group" aria-label="Rounds">
            {halves.map((half) => <div key={half.key} className={rr.half} data-side={half.side} style={{ flexGrow: half.facts.length }}>
                <span className={rr.halfLabel}>{half.label}</span>
                <div>{half.facts.map((fact) => <button
                    key={fact.round.roundNum}
                    type="button"
                    className={rr.round}
                    data-win={fact.won || undefined}
                    aria-pressed={fact.round.roundNum === round.roundNum}
                    onClick={() => setSelectedRoundNum(fact.round.roundNum)}
                    title={`Round ${fact.round.roundNum + 1}: ${fact.won ? "won" : "lost"}, ${fact.kills.length} kill${fact.kills.length === 1 ? "" : "s"}${fact.deaths.length ? ", died" : ""}, score ${fact.yourScore}–${fact.enemyScore}`}
                >
                    <span className={rr.plate} aria-hidden="true">{fact.won ? "W" : "L"}</span>
                    <b>{fact.round.roundNum + 1}</b>
                    <span className={rr.pips} aria-hidden="true">{fact.kills.slice(0, 5).map((event) => <i key={fightEventKey(event)} />)}</span>
                </button>)}</div>
            </div>)}
            {finalFact ? <div className={rr.final} title="Final score"><b>{finalFact.yourScore}</b><span>–</span><b data-them>{finalFact.enemyScore}</b></div> : null}
        </div>

        <div className={rr.hero} data-win={roundWon || undefined}>
            {yourAgent?.full ? <Image className={rr.agent} src={yourAgent.full} alt="" width={290} height={290} unoptimized /> : null}
            <div className={rr.title}>
                <h3>Round {round.roundNum + 1} <em>· {roundWon ? "won" : "lost"}</em></h3>
                <p>{outcome ? <>{outcome}{outcomeTime}</> : "Round recorded"}{selectedFact ? <> · score {selectedFact.yourScore}–{selectedFact.enemyScore}</> : null}{roundTags.map((tag) => <b key={tag}> · {tag}</b>)}</p>
            </div>
            <dl className={rr.stats}>
                <div><dt>Kills</dt><dd>{localKills.length}</dd></div>
                <div><dt>Deaths</dt><dd>{localDeaths.length}</dd></div>
                <div><dt>Assists</dt><dd>{localAssists.length}</dd></div>
                <div><dt>Damage</dt><dd>{selectedStat ? damageDone : "—"}</dd></div>
                {selectedStat ? <div className={rr.gun}>
                    <dt>{weapon?.displayName || "No weapon"}{selectedStat.economy.armor ? "" : " · no armor"}{headshots ? ` · ${headshots} HS` : ""}</dt>
                    <dd>{weapon?.displayIcon ? <Image src={weapon.displayIcon} alt="" width={110} height={34} unoptimized /> : null}</dd>
                </div> : null}
            </dl>
        </div>

        <div className={rr.frame}>
            <section className={rr.cell}>
                <header className={rr.label}><b>01</b><span>Replay</span><small>{activeMoment ? fmtLength(activeMoment.time) : ""}</small></header>
                <div className={rr.mapWrap}>
                    <div className={rr.map} data-replay={replayReady || undefined}>
                        {map?.displayIcon ? <Image className={rr.mapImage} src={map.displayIcon} alt={`${map.name} tactical map`} fill sizes="560px" unoptimized /> : null}
                        {canPlot && map!.callouts.map((callout, index) => {
                            const { left, top } = mapCalloutPlotPosition(map!, callout);
                            return <span key={`${callout.superRegion}-${callout.name}-${index}`} className={rr.callout} style={{ left: `${left * 100}%`, top: `${top * 100}%` }} aria-hidden="true">{mapCalloutLabel(callout)}</span>;
                        })}
                        {replayReady && activeKill && killerSpot ? (() => {
                            const from = plot(killerSpot.x, killerSpot.y);
                            const to = plot(activeKill.victimX, activeKill.victimY);
                            return <svg className={rr.shot} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-side={activeMoment?.ally ? "ally" : "enemy"}>
                                <line x1={from.left} y1={from.top} x2={to.left} y2={to.top} />
                            </svg>;
                        })() : null}
                        {replayReady ? earlierKills.map((event) => {
                            const spot = plot(event.victimX, event.victimY);
                            return <i key={`dead-${fightEventKey(event)}`} className={rr.dead} data-side={teamOf(event.victim.toLowerCase()) === localTeam ? "ally" : "enemy"} style={{ left: `${spot.left}%`, top: `${spot.top}%` }} title={`${playerName(event.victim.toLowerCase())} died at ${fmtLength(event.roundTime)}`}>×</i>;
                        }) : null}
                        {replayReady ? snapshot!.playerLocations!.map((location) => {
                            const subject = location.subject?.toLowerCase() || "";
                            if (!subject || deadBefore.has(subject)) return null;
                            const victim = subject === activeKill?.victim.toLowerCase();
                            const spot = victim ? plot(activeKill!.victimX, activeKill!.victimY) : plot(location.x, location.y);
                            const icon = agentIcon(subject);
                            const shown = victim || subject === activeKill?.killer.toLowerCase() || subject === localSubject;
                            return <span key={subject} className={rr.player} data-side={teamOf(subject) === localTeam ? "ally" : "enemy"} data-you={subject === localSubject || undefined} data-victim={victim || undefined} data-killer={subject === activeKill?.killer.toLowerCase() || undefined} style={{ left: `${spot.left}%`, top: `${spot.top}%`, backgroundImage: icon ? `url("${icon}")` : undefined }} title={playerName(subject)}>
                                {shown ? <b>{playerName(subject)}</b> : null}
                            </span>;
                        }) : null}
                        {canPlot && !replayReady && selectedEvents.map((event) => {
                            const position = plot(event.victimX, event.victimY);
                            const isKill = event.killer.toLowerCase() === localSubject;
                            return <span key={fightEventKey(event)} className={rr.marker} data-kind={isKill ? "kill" : "death"} style={{ left: `${position.left}%`, top: `${position.top}%` }} title={isKill ? "Your kill" : "Your death"}>{isKill ? "+" : "×"}</span>;
                        })}
                        {canPlot && round.plantLocation && (round.plantLocation.x || round.plantLocation.y) ? (() => { const p = plot(round.plantLocation!.x, round.plantLocation!.y); return <i className={rr.spike} style={{ left: `${p.left}%`, top: `${p.top}%` }} title={`Spike planted${round.plantRoundTime ? ` at ${fmtLength(round.plantRoundTime)}` : ""}`}>◆</i>; })() : null}
                        {!canPlot ? <p className={rr.note}>This map has no position data yet.</p> : null}
                    </div>
                </div>
                {roundFeed.length ? <div className={rr.scrub}>
                    <button type="button" aria-label="Previous moment" disabled={activeMomentIndex <= 0} onClick={() => { setReplaying(false); pickMoment(roundFeed[activeMomentIndex - 1].id); }}>‹</button>
                    <button type="button" className={rr.play} aria-label={replaying ? "Pause the round" : "Play the round"} aria-pressed={replaying} onClick={() => {
                        if (!replaying && activeMomentIndex >= roundFeed.length - 1) pickMoment(roundFeed[0].id);
                        setReplaying((value) => !value);
                    }}>{replaying ? "❚❚" : "▶"}</button>
                    <div className={rr.track}>
                        <span style={{ width: `${activeMoment ? (momentTime(activeMoment) / roundLength) * 100 : 0}%` }} />
                        {roundFeed.map((item) => <button key={item.id} type="button" data-kind={item.kind} data-side={item.ally ? "ally" : "enemy"} data-active={item.id === activeMomentId || undefined} style={{ left: `${(momentTime(item) / roundLength) * 100}%` }} onClick={() => { setReplaying(false); pickMoment(item.id); }} aria-label={`${fmtLength(item.time)} ${item.kind === "kill" ? `${playerName(item.actor)} eliminated ${playerName(item.target)}` : item.text}`} />)}
                    </div>
                    <button type="button" aria-label="Next moment" disabled={activeMomentIndex >= roundFeed.length - 1} onClick={() => { setReplaying(false); pickMoment(roundFeed[activeMomentIndex + 1].id); }}>›</button>
                </div> : null}
            </section>

            <section className={rr.cell}>
                <header className={rr.label}><b>02</b><span>Kill feed</span><small>{selectedKills.length} kill{selectedKills.length === 1 ? "" : "s"} · click one to see it</small>{activeKill && onInspectFight ? <button type="button" className={rr.inspect} onClick={() => onInspectFight(activeKill)}>Open on Map ↗</button> : null}</header>
                {roundFeed.length ? <ol className={rr.feed} aria-label={`Round ${round.roundNum + 1} events`}>
                    {roundFeed.map((item) => <li key={item.id} data-kind={item.kind} data-side={item.ally ? "ally" : "enemy"} data-active={item.id === activeMomentId || undefined} onClick={() => { setReplaying(false); pickMoment(item.id); }}>
                        <time>{item.time ? fmtLength(item.time) : "0:00"}</time>
                        <span className={rr.who}><i style={{ backgroundImage: agentIcon(item.actor) ? `url("${agentIcon(item.actor)}")` : undefined }} /><b data-you={item.actor === localSubject || undefined}>{playerName(item.actor)}</b></span>
                        {item.target ? <>
                            <svg className={rr.arrow} viewBox="0 0 24 24" aria-label="eliminated"><path d="M5 12h12M13 7l5 5-5 5" /></svg>
                            <span className={rr.who} data-victim><i style={{ backgroundImage: agentIcon(item.target) ? `url("${agentIcon(item.target)}")` : undefined }} /><b data-you={item.target === localSubject || undefined}>{playerName(item.target)}</b></span>
                        </> : <span className={rr.text}>{item.text}</span>}
                        <span className={rr.means}>
                            {item.tag ? <em>{item.tag}</em> : item.kind !== "kill" ? <em data-kind={item.kind}>{item.kind === "plant" ? "Plant" : "Defuse"}</em> : null}
                            {item.kind === "kill" ? item.meansIcon ? <span className={rr.icon} data-ability={item.meansAbility || undefined} title={item.means}><Image src={item.meansIcon} alt={item.means || ""} width={72} height={22} unoptimized /></span> : <small>{item.means}</small> : null}
                        </span>
                    </li>)}
                </ol> : <p className={rr.note}>No kills or objective actions were recorded for this round.</p>}
                <div className={rr.take}>
                    <b>Takeaway</b>
                    <p>{selectedRoundRead}</p>
                    {allyLoadout || enemyLoadout ? <small>Team buy <span data-side="ally">{allyLoadout.toLocaleString()}</span> vs <span data-side="enemy">{enemyLoadout.toLocaleString()}</span>{selectedStat ? ` · you spent ${(selectedStat.economy.spent || 0).toLocaleString()}, kept ${(selectedStat.economy.remaining || 0).toLocaleString()}` : ""}</small> : null}
                </div>
            </section>
        </div>

        {turningPoints.length ? <section className={rr.turning}>
            <header className={rr.label}><b>03</b><span>Turning points</span><small>{turningPoints.length} moments that changed the match</small></header>
            <div>{turningPoints.map((point) => <button key={`${point.roundNum}-${point.title}`} type="button" data-tone={point.tone} aria-pressed={point.roundNum === round.roundNum} onClick={() => setSelectedRoundNum(point.roundNum)}>
                <strong>{point.title}</strong><small>{point.detail}</small>
            </button>)}</div>
        </section> : null}
    </section>;
}

export function MatchMapAnalytics({
    detail,
    kills,
    map,
    agents,
    weapons,
    loading,
    error,
    initialFight,
    onBackToRound,
}: {
    detail: ProfileMatchDetails;
    kills: MatchKillEvent[];
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
    loading: boolean;
    error: string;
    initialFight?: MatchKillEvent | null;
    onBackToRound?: () => void;
}) {
    const [filter, setFilter] = useState<"all" | "kill" | "death">("all");
    const [focusedArea, setFocusedArea] = useState<string | null>(null);
    const [focusedZone, setFocusedZone] = useState<string | null>(null);
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [duelFocus, setDuelFocus] = useState<DuelFocus | null>(initialFight ? { id: fightEventKey(initialFight), label: `Round ${initialFight.roundNum + 1} · ${fmtLength(initialFight.roundTime)}`, events: [initialFight], index: 0 } : null);
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
        const nearestFightCallout = map.callouts.reduce<MapMeta["callouts"][number] | undefined>((nearest, callout) => {
            const distance = (callout.x - selectedFight.victimX) ** 2 + (callout.y - selectedFight.victimY) ** 2;
            const nearestDistance = nearest ? (nearest.x - selectedFight.victimX) ** 2 + (nearest.y - selectedFight.victimY) ** 2 : Infinity;
            return distance < nearestDistance ? callout : nearest;
        }, undefined);
        return {
            killerPlayer,
            victimPlayer,
            killerAgent,
            victimAgent: agents[victimPlayer?.characterId?.toLowerCase() || ""],
            killerPoint: killerLocation ? toPlotPoint(killerLocation.x, killerLocation.y) : null,
            victimPoint: toPlotPoint(selectedFight.victimX, selectedFight.victimY),
            finisher,
            finisherName: isAbility ? ability?.name : weapon?.displayName,
            localDeath,
            roundWon,
            area: locatedFight?.area || (nearestFightCallout ? mapCalloutLabel(nearestFightCallout) : "Map area"),
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
                                {onBackToRound && initialFight ? <button type="button" className={s.mapBackToRound} onClick={onBackToRound}>Back to R{initialFight.roundNum + 1}</button> : null}
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
                                    <button
                                        key={`${point.round}-${point.gameTime}-${point.type}-${index}`}
                                        type="button"
                                        className={`${s.mapEvent} ${point.type === "kill" ? s.mapEventKill : s.mapEventDeath}`}
                                        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
                                        title={`${point.type === "kill" ? "Kill" : "Death"}, round ${point.round + 1}`}
                                        aria-label={`Inspect ${point.type}, round ${point.round + 1}, ${point.area}, ${fmtLength(point.event.roundTime)}`}
                                        onClick={() => selectDuelGroup(fightEventKey(point.event), `Round ${point.round + 1} · ${fmtLength(point.event.roundTime)}`, [point.event])}
                                    >
                                        <i className={s.mapHeat} aria-hidden="true" />
                                        <b className={s.mapPoint} aria-hidden="true" />
                                    </button>
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
                    {selectedFight && duelData ? <section className={s.mapFightDetail} aria-label="Selected fight receipt">
                        <header><strong>Round {selectedFight.roundNum + 1} · {fmtLength(selectedFight.roundTime)}</strong><small>Recorded elimination</small></header>
                        <p><strong>{duelData.killerPlayer?.isLocal ? "You" : duelData.killerPlayer?.gameName || "Unknown player"}</strong><span aria-label="eliminated">→</span><strong>{duelData.victimPlayer?.isLocal ? "You" : duelData.victimPlayer?.gameName || "Unknown player"}</strong></p>
                        <dl><div><dt>Location</dt><dd>{duelData.area}</dd></div><div><dt>Finisher</dt><dd>{duelData.finisherName || "Unavailable"}</dd></div><div><dt>Your team</dt><dd>{duelData.roundWon === null ? "Outcome unavailable" : duelData.roundWon ? "Round won" : "Round lost"}</dd></div></dl>
                    </section> : null}
                    <header className={s.mapInsightsHeader}>
                        <div>
                            <span>Fight report</span>
                            <strong>Where you fought</strong>
                        </div>
                        <small>Whole match · {analysis.kills + analysis.deaths} fights</small>
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

const ROUND_END_LABELS: Record<RoundOutcome["end"], string> = {
    elim: "Elimination",
    boom: "Spike detonated",
    defuse: "Spike defused",
    time: "Time ran out",
    other: "Other",
};

function RoundEndIcon({ end }: { end: RoundOutcome["end"] }) {
    const common = { width: 14, height: 14, viewBox: "0 0 24 24", "aria-hidden": true } as const;
    if (end === "boom") {
        return <svg {...common} fill="currentColor"><path d="M12 2l2.2 5.6L20 6l-3 5.2L22 14l-5.8 1.2L17 21l-5-3.4L7 21l.8-5.8L2 14l5-2.8L4 6l5.8 1.6z" /></svg>;
    }
    if (end === "defuse") {
        return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>;
    }
    if (end === "time") {
        return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>;
    }
    if (end === "other") {
        return <svg {...common} fill="currentColor"><circle cx="12" cy="12" r="4" /></svg>;
    }
    return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
}

// VLR-style round history: one row per team, the winner's cell carries how the round ended.
function RoundHistory({ rounds, ownRounds, enemyRounds }: { rounds: RoundOutcome[]; ownRounds: number; enemyRounds: number }) {
    const endsSeen = Array.from(new Set(rounds.map((round) => round.end)));
    return (
        <div className={s.roundHistory} role="group" aria-label="Round history">
            <div className={s.roundHistoryTeams} aria-hidden="true">
                <span data-team="ally"><i />Your team <b>{ownRounds}</b></span>
                <small>Round</small>
                <span data-team="enemy"><i />Enemy <b>{enemyRounds}</b></span>
            </div>
            <ol className={s.roundHistoryTrack}>
                {rounds.map((round) => (
                    <li key={round.roundNum} data-swap={round.afterSwap || undefined} title={round.label} aria-label={round.label}>
                        <span data-team="ally" data-won={round.won || undefined}>{round.won ? <RoundEndIcon end={round.end} /> : null}</span>
                        <small>{round.roundNum + 1}</small>
                        <span data-team="enemy" data-won={!round.won || undefined}>{round.won ? null : <RoundEndIcon end={round.end} />}</span>
                    </li>
                ))}
            </ol>
            <ul className={s.roundHistoryKey} aria-label="Round end key">
                {endsSeen.map((end) => (
                    <li key={end}><RoundEndIcon end={end} />{ROUND_END_LABELS[end]}</li>
                ))}
            </ul>
        </div>
    );
}

function Scoreboard({
    detail,
    breakdown,
    side,
    queueId,
    partyMembers,
    agents,
    tierAssets,
    onViewProfile,
}: {
    detail: ProfileMatchDetails;
    /** Source of rounds and kill events, which may arrive with a later analytics load. */
    breakdown: ProfileMatchDetails;
    side: MatchSide;
    queueId?: string;
    partyMembers: NonNullable<ProfileMatchSummary["partyMembers"]>;
    agents: Record<string, AgentMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const localPlayer = detail.players.find((p) => p.isLocal);
    const [hoveredParty, setHoveredParty] = useState<string | null>(null);
    const [focusedParty, setFocusedParty] = useState<string | null>(null);
    const [pinnedParty, setPinnedParty] = useState<string | null>(null);
    const activeParty = hoveredParty ?? focusedParty ?? pinnedParty;
    const localTeamId = localPlayer?.teamId || "Blue";
    const localIsBlue = localTeamId.toLowerCase() === "blue";
    const yourTeam = detail.players.filter((p) => p.teamId.toLowerCase() === localTeamId.toLowerCase());
    const enemyTeam = detail.players.filter((p) => p.teamId.toLowerCase() !== localTeamId.toLowerCase());
    const partyMemberSubjects = new Set(partyMembers.map((member) => member.subject.toLowerCase()));
    const partyGroups = buildScorePartyGroups(detail.players, partyMemberSubjects);
    // Free-for-all modes (e.g. Deathmatch) end 0:0 with every player on their
    // own team, so show one standings list ranked by kills instead.
    const teamRounds = detail.matchInfo.blueRoundsWon + detail.matchInfo.redRoundsWon > 0;
    const stats = useMemo(
        () => sideStats({ ...detail, rounds: breakdown.rounds, kills: breakdown.kills }, side, queueId),
        [breakdown.kills, breakdown.rounds, detail, queueId, side],
    );
    const showFirsts = (breakdown.kills?.length ?? 0) > 0;
    const acsOf = (p: ProfileMatchDetails["players"][number]) => stats.get(p.subject.toLowerCase())?.acs || 0;
    const sortPlayers = (rows: typeof detail.players) => teamRounds
        ? [...rows].sort((a, b) => acsOf(b) - acsOf(a) || b.score - a.score || b.kills - a.kills)
        : [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.assists - a.assists);
    const maxAcs = Math.max(1, ...detail.players.map(acsOf));
    // Only the lobby best in each column gets emphasis; everything else stays neutral.
    const statValues = detail.players.map((p) => stats.get(p.subject.toLowerCase())).filter((stat): stat is SideStats => Boolean(stat));
    const leaders: ScoreLeaders = {
        acs: maxAcs,
        adr: Math.max(0, ...statValues.map((stat) => Math.round(stat.adr))),
        hs: Math.max(0, ...statValues.filter((stat) => stat.hasShots).map((stat) => stat.hsPct)),
        firstKills: Math.max(0, ...statValues.map((stat) => stat.firstKills)),
    };

    // MVPs always reflect the whole match, whichever side filter is active.
    const mvpPlayer = useMemo(() => {
        if (!detail.players.length) return null;
        // Riot names one MVP per team; the stronger of them is the match MVP.
        const riotMvps = detail.players.filter((p) => p.teamMvp);
        if (riotMvps.length) {
            return riotMvps.reduce((best, p) => ((teamRounds ? (p.acs || 0) > (best.acs || 0) : p.kills > best.kills) ? p : best), riotMvps[0]);
        }
        if (!teamRounds) {
            return [...detail.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
        }
        return [...detail.players].reduce(
            (max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max),
            detail.players[0],
        );
    }, [detail.players, teamRounds]);

    const shared = {
        agents, mvpPlayer, partyGroups, tierAssets, onViewProfile, stats, maxAcs, showFirsts, leaders, activeParty, pinnedParty,
        onPartyHover: setHoveredParty,
        onPartyFocus: setFocusedParty,
        onPartyPin: (party: string) => setPinnedParty((current) => current === party ? null : party),
    };

    if (!teamRounds) {
        return (
            <div className={s.scoreboardStage} data-party-active={Boolean(activeParty) || undefined}>
                <div className={`${s.sbGrid} ${s.sbGridSingle}`}>
                    <ScoreTeam title="Standings" side="blue" players={sortPlayers(detail.players)} roundStats={false} {...shared} />
                </div>
            </div>
        );
    }

    return (
        <div className={s.scoreboardStage} data-party-active={Boolean(activeParty) || undefined}>
            <div className={s.sbGrid}>
                <ScoreTeam
                    title="Your team"
                    side="blue"
                    won={localIsBlue ? detail.matchInfo.blueWins : !detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.blueRoundsWon : detail.matchInfo.redRoundsWon}
                    players={sortPlayers(yourTeam)}
                    {...shared}
                />
                <ScoreTeam
                    title="Enemy team"
                    side="red"
                    won={localIsBlue ? !detail.matchInfo.blueWins : detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.redRoundsWon : detail.matchInfo.blueRoundsWon}
                    players={sortPlayers(enemyTeam)}
                    {...shared}
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
    roundStats = true,
    players,
    agents,
    mvpPlayer,
    partyGroups,
    tierAssets,
    onViewProfile,
    stats,
    maxAcs,
    showFirsts,
    leaders,
    activeParty,
    pinnedParty,
    onPartyHover,
    onPartyFocus,
    onPartyPin,
}: {
    title: string;
    side: "blue" | "red";
    won?: boolean;
    score?: number;
    /** False for free-for-all modes: hides round result, ACS, ADR and first kills, and numbers the standings. */
    roundStats?: boolean;
    players: ProfileMatchDetails["players"];
    agents: Record<string, AgentMeta>;
    mvpPlayer: ProfileMatchDetails["players"][number] | null;
    partyGroups: Map<string, ScorePartyGroup>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    stats: Map<string, SideStats>;
    maxAcs: number;
    showFirsts: boolean;
    leaders: ScoreLeaders;
    activeParty: string | null;
    pinnedParty: string | null;
    onPartyHover: (party: string | null) => void;
    onPartyFocus: (party: string | null) => void;
    onPartyPin: (party: string) => void;
}) {
    const statOf = (p: ProfileMatchDetails["players"][number]) => stats.get(p.subject.toLowerCase());
    // Team MVP: Riot's pick for this team when cached, otherwise the top
    // full-match ACS on the team without the match MVP.
    const riotTeamMvp = players.find((p) => p.teamMvp);
    const teamMvp = players.some((p) => p.subject === mvpPlayer?.subject)
        ? null
        : riotTeamMvp ?? (roundStats && players.length
            ? players.reduce((best, p) => ((p.acs || 0) > (best.acs || 0) ? p : best), players[0])
            : null);
    const teamKills = players.reduce((sum, p) => sum + (statOf(p)?.kills ?? p.kills), 0);
    const avgAcs = players.length ? Math.round(players.reduce((sum, p) => sum + (statOf(p)?.acs ?? 0), 0) / players.length) : 0;

    return (
        <div className={s.sbTeam} data-side={side}>
            <div className={s.sbHead}>
                <div className={s.sbBanner}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
                    </svg>
                    <span>{title}</span>
                    <small>{roundStats ? (won ? "Victory" : "Defeat") : `${players.length} players`}</small>
                </div>
                {roundStats ? <span className={s.sbTotals}>{teamKills} kills · {avgAcs} avg ACS</span> : null}
                {roundStats ? <strong className={s.sbScore}>{score}</strong> : null}
            </div>
            <div className={s.sbScroll}>
                <table className={s.sbTable} data-round-stats={roundStats}>
                    <thead>
                        <tr className={s.sbRow}>
                            <th scope="col">Player</th>
                            <th scope="col">Rank</th>
                            {roundStats ? <th scope="col">ACS</th> : null}
                            <th scope="col">K / D / A</th>
                            <th scope="col" title="Kills minus deaths">+/−</th>
                            {roundStats ? <th scope="col">ADR</th> : null}
                            <th scope="col">HS%</th>
                            {roundStats ? <th scope="col" title="First kills: opened the round with a kill">FK</th> : null}
                            {roundStats ? <th scope="col" title="First deaths: died first in the round">FD</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {players.map((p, idx) => {
                            const meta = agents[p.characterId?.toLowerCase?.() || ""];
                            const stat = statOf(p);
                            const kills = stat?.kills ?? p.kills;
                            const deaths = stat?.deaths ?? p.deaths;
                            const assists = stat?.assists ?? p.assists;
                            const diff = kills - deaths;
                            const acs = Math.round(stat?.acs ?? p.acs ?? 0);
                            const hasShots = stat?.hasShots ?? p.headshots + p.bodyshots + p.legshots > 0;
                            const hsPct = stat?.hsPct ?? p.hsPct;
                            const adr = Math.round(stat?.adr ?? p.adr ?? 0);
                            const firstKills = stat?.firstKills ?? 0;
                            const firstDeaths = stat?.firstDeaths ?? 0;
                            const name = p.gameName
                                ? `${p.gameName}${p.tagLine ? `#${p.tagLine}` : ""}`
                                : p.isLocal
                                    ? "You"
                                    : "Player";
                            const isMvp = Boolean(mvpPlayer && mvpPlayer.subject === p.subject);
                            const isTeamMvp = Boolean(teamMvp && teamMvp.subject === p.subject);
                            const party = partyGroups.get(p.subject.toLowerCase());
                            const displayedTier = p.competitiveTier || p.currentCompetitiveTier || 0;
                            const rankIcon = displayedTier > 0 ? rankIconUrl(displayedTier, tierAssets) : null;
                            const rowStyle = (party ? { "--party-color": party.color } : {}) as CSSProperties;
                            return (
                                <tr
                                    data-slot="score-player-row"
                                    key={p.subject || `${p.characterId}-${idx}`}
                                    className={`${s.sbRow} ${p.isLocal ? s.sbRowLocal : ""}`}
                                    style={rowStyle}
                                    data-party-highlighted={Boolean(party && activeParty === party.key) || undefined}
                                    onMouseEnter={() => onPartyHover(party?.key ?? null)}
                                    onMouseLeave={() => onPartyHover(null)}
                                    onFocus={() => onPartyFocus(party?.key ?? null)}
                                    onBlur={(event) => {
                                        if (!event.currentTarget.contains(event.relatedTarget)) onPartyFocus(null);
                                    }}
                                >
                                    <td className={s.sbPlayerCell}>
                                        {party ? (
                                            <button
                                                type="button"
                                                className={s.sbPartyRail}
                                                aria-label={party.title}
                                                aria-pressed={pinnedParty === party.key}
                                                title={`${party.title}. Click to keep this party highlighted.`}
                                                onClick={() => onPartyPin(party.key)}
                                            ><i aria-hidden="true" /></button>
                                        ) : null}
                                        {roundStats ? null : <span className={s.sbPlace} aria-label={`Place ${idx + 1}`}>{idx + 1}</span>}
                                        {meta?.icon ? (
                                            <Image src={meta.icon} alt="" width={38} height={38} unoptimized className={s.sbAgent} />
                                        ) : (
                                            <span className={s.sbAgent} />
                                        )}
                                        <span className={s.sbIdentity}>
                                            <span className={s.sbName}>
                                                {p.subject && p.gameName && !p.isLocal ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => onViewProfile({ puuid: p.subject, gameName: p.gameName, tagLine: p.tagLine || "" })}
                                                        title={`View ${name}'s profile`}
                                                    >
                                                        {name}
                                                    </button>
                                                ) : name}
                                            </span>
                                            <span className={s.sbTags}>
                                                <small>{meta?.name || "Agent"}</small>
                                                {party ? (
                                                    <span
                                                        className={s.sbParty}
                                                        title={party.title}
                                                        aria-label={party.title}
                                                    >
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                                                            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                                                        </svg>
                                                        {party.label}
                                                        <span className={s.sbPartyDots} aria-hidden="true">
                                                            {Array.from({ length: Math.min(party.size, 5) }, (_, dot) => <i key={dot} />)}
                                                        </span>
                                                    </span>
                                                ) : null}
                                                {isMvp ? (
                                                    <span className={`${s.sbTag} ${s.sbTagMvp}`}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" /></svg>
                                                        MVP
                                                    </span>
                                                ) : null}
                                                {isTeamMvp ? (
                                                    <span className={`${s.sbTag} ${s.sbTagTeamMvp}`}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" /></svg>
                                                        Team MVP
                                                    </span>
                                                ) : null}
                                                {p.isLocal ? <span className={`${s.sbTag} ${s.sbTagYou}`}>You</span> : null}
                                            </span>
                                        </span>
                                    </td>
                                    <td title={rankIcon ? `${tierLabel(displayedTier)} · ${p.competitiveTier > 0 ? "recorded in this match" : "current rank"}` : "Rank not provided"}>
                                        {rankIcon ? <Image src={rankIcon} alt={`${tierLabel(displayedTier)}${p.competitiveTier > 0 ? "" : " (current)"}`} width={32} height={32} unoptimized /> : <span className={s.sbMuted} aria-label="Rank not provided">—</span>}
                                    </td>
                                    {roundStats ? (
                                        <td className={`${s.sbAcs} ${acs === Math.round(leaders.acs) ? s.sbLead : ""}`}>
                                            <b>{acs}</b>
                                            <i aria-hidden="true"><span style={{ width: `${Math.min(100, (acs / maxAcs) * 100)}%` }} /></i>
                                        </td>
                                    ) : null}
                                    <td className={s.sbKda}>{kills}<i>/</i>{deaths}<i>/</i>{assists}</td>
                                    <td className={diff > 0 ? s.sbPositive : diff < 0 ? s.sbNegative : s.sbMuted}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{Math.abs(diff)}</td>
                                    {roundStats ? <td className={adr === leaders.adr ? s.sbLead : ""}>{adr}</td> : null}
                                    <td className={!hasShots ? s.sbMuted : hsPct === leaders.hs ? s.sbLead : ""}>{hasShots ? fmtPct(hsPct) : "—"}</td>
                                    {roundStats ? <td className={!showFirsts || !firstKills ? s.sbMuted : firstKills === leaders.firstKills ? s.sbLead : ""}>{showFirsts ? firstKills : "—"}</td> : null}
                                    {roundStats ? <td className={!showFirsts || !firstDeaths ? s.sbMuted : ""}>{showFirsts ? firstDeaths : "—"}</td> : null}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

interface ScoreLeaders {
    acs: number;
    adr: number;
    hs: number;
    firstKills: number;
}

interface ScorePartyGroup {
    key: string;
    label: string;
    size: number;
    color: string;
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

    groups.forEach(([key, members], index) => {
        const size = members.length;
        const label = size === 2 ? "Duo" : size === 3 ? "Trio" : `${Math.min(size, 5)}-stack`;
        const names = members
            .map((player) => player.gameName || "Hidden player")
            .join(", ");
        const group: ScorePartyGroup = {
            key,
            label,
            size,
            color: palette[index % palette.length],
            title: `${label} queued together: ${names}`,
        };
        for (const player of members) bySubject.set(player.subject.toLowerCase(), group);
    });

    return bySubject;
}
