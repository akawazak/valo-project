"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import type { Agent, LoadoutItemV1 } from "@/lib/types";
import {
    getAgentStats,
    getMapStats,
    getProfileMatchDetails,
    getProfileMatchHistory,
    getProfileOverview,
    getProfileSyncStatus,
    getRRHistory,
    getContracts,
    getAccountHealth,
    getLiveMatch,
    getLiveLoadouts,
    postProfileSync,
    getPartyStatus,
    getMissions,
    getSocialStatus,
    getPlayerLoadoutData,
    AccountHealthResponse,
    ProfileAgentStatsResponse,
    ProfileMapStatsResponse,
    ProfileMatchDetails,
    ProfileMatchSummary,
    ProfileOverview,
    ProfilePlayerStats,
    ProfileRRHistory,
    ProfileSyncStatus,
    PlayerContractsResponse,
    LiveMatchResponse,
    LiveLoadoutsResponse,
    PartyStatusResponse,
    RiotMissionsResponse,
    SocialStatusResponse,
} from "@/services/api";
import AgentStatsTable from "./AgentStatsTable";
import MapStatsTable from "./MapStatsTable";
import RRHistoryChart from "./RRHistoryChart";
import TacticalPanel from "@/components/TacticalPanel";

interface Props {
    onConnectAccount?: () => void;
}
interface AgentMeta {
    name: string;
    icon: string;
    full?: string;
}

interface MapMeta {
    name: string;
    splash: string;
}

interface ContractMeta {
    name: string;
    icon: string;
    relationType: string;
    totalLevels: number;
    totalXp: number;
    // Per-level cumulative XP thresholds so the UI can show
    // "next level needs N XP". Indexed 0..levels.length-1, where
    // level[0].xp is the XP required to UNLOCK that level (0 for
    // the first level, 2000 for the second, etc).
    levels: ContractMetadataLevel[];
    // Reward label per level, e.g. "Skin", "Gun Buddy", "Player Card",
    // "Currency", "Spray", "Title". Resolved from
    // `level.reward.type` (no image lookup yet - that needs a
    // second valorant-api.com call per uuid).
    rewardLabels: string[];
    // Relation uuid so we can later fetch season/event end dates
    // for the "ends in X days" countdown.
    relationUuid: string;
    // Activation + expiration date for the contract itself (event
    // contracts typically set this; battlepasses leave it null).
    activationDate: string;
    expirationDate: string;
}

interface ContractMetadataLevel {
    xp?: number | string;
    xpRequired?: number | string;
    progressToComplete?: number | string;
    // Reward preview label (free-reward track).
    rewardType?: string;
    rewardAmount?: number | string;
}

interface VisibleContractProgress {
    id: string;
    totalProgressionEarned: number;
    totalProgressionEarnedVersion: number;
    highestRewardedLevel: number;
    progressionLevelReached?: number;
    progressionTowardsNextLevel?: number;
}

type MissionBucket = "daily" | "weekly" | "onboarding" | "other";
type ProgressTab = MissionBucket | "battlepass" | "events" | "contracts";

function isMissionProgressTab(tab: ProgressTab): tab is MissionBucket {
    return tab === "daily" || tab === "weekly" || tab === "onboarding" || tab === "other";
}

// Tick the clock every 30s so "Refills in 5d 4h" / "Ends in 26d"
// countdown labels update live without forcing a full re-render
// of the mission panel.
function useMinuteTick(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, []);
    return now;
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
const FALLBACK_RANK_ICON =
    "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/smallicon.png";

let agentCache: Record<string, AgentMeta> | null = null;
let mapCache: Record<string, MapMeta> | null = null;
let tierAssetCache: Map<number, { smallIcon: string }> | null = null;
let agentPromise: Promise<Record<string, AgentMeta>> | null = null;
let mapPromise: Promise<Record<string, MapMeta>> | null = null;
let tierPromise: Promise<Map<number, { smallIcon: string }>> | null = null;

// Lazy-loaded reward icon cache. Each tier reward in a battlepass /
// event-pass is identified by (type, uuid). We don't know the image
// up front - valorant-api.com returns it from a per-uuid endpoint -
// so we fetch on demand and cache in a session-scoped Map.
const rewardIconCache = new Map<string, string>();
const rewardIconInflight = new Map<string, Promise<string | null>>();

// Returns an icon URL for a single reward item. The label is the
// short human label (Skin, Gun Buddy, Player Card, Currency, Spray,
// Title). The uuid is the item's UUID from valorant-api.com.
function ContractRewardIcon({ rewardType, uuid }: { rewardType: string; uuid: string }) {
    const [url, setUrl] = useState<string | null>(() => rewardIconCache.get(`${rewardType}:${uuid}`) || null);
    const [tried, setTried] = useState<boolean>(false);

    useEffect(() => {
        if (!uuid) {
            setTried(true);
            return;
        }
        const key = `${rewardType}:${uuid}`;
        const cached = rewardIconCache.get(key);
        if (cached) {
            setUrl(cached);
            setTried(true);
            return;
        }
        const inflight = rewardIconInflight.get(key);
        if (inflight) {
            inflight.then((u) => {
                if (u) setUrl(u);
                setTried(true);
            });
            return;
        }

        // Map rewardType + uuid to the right valorant-api.com endpoint.
        // Each item type uses a different catalog endpoint.
        const endpoint = rewardEndpoint(rewardType);
        if (!endpoint) {
            setTried(true);
            return;
        }
        const promise = fetch(`https://valorant-api.com/v1/${endpoint}/${uuid}`)
            .then((res) => res.ok ? res.json() : null)
            .then((d) => {
                const icon = d?.data?.displayIcon || d?.data?.icon || d?.data?.smallArt || "";
                if (icon) {
                    rewardIconCache.set(key, icon);
                    return icon;
                }
                return null;
            })
            .catch(() => null)
            .finally(() => {
                rewardIconInflight.delete(key);
            });
        rewardIconInflight.set(key, promise);
        promise.then((u) => {
            if (u) setUrl(u);
            setTried(true);
        });
    }, [rewardType, uuid]);

    if (url) {
        return <img src={url} alt={rewardType} className="contract-tier-img" loading="lazy" />;
    }
    // First-load placeholder while the icon resolves. Keeps the slot
    // reserved so the strip doesn't reflow when images stream in.
    if (!tried) {
        return <div className="contract-tier-placeholder" aria-hidden="true" />;
    }
    return (
        <span className="contract-tier-fallback" aria-hidden="true">
            {rewardGlyph(rewardType)}
        </span>
    );
}

function rewardEndpoint(rewardType: string): string | null {
    switch (rewardType) {
        case "Skin": return "weapons/skins";
        case "Gun Buddy": return "buddies/levels";
        case "Player Card": return "playercards";
        case "Spray": return "sprays";
        case "Title": return "playertitles";
        case "Currency": return null; // icons are tiny and the in-game tier preview doesn't show them
        default: return null;
    }
}

function rewardGlyph(rewardType: string): string {
    switch (rewardType) {
        case "Skin": return "S";
        case "Gun Buddy": return "B";
        case "Player Card": return "C";
        case "Spray": return "*";
        case "Title": return "T";
        case "Currency": return "*";
        default: return "?";
    }
}

function tierLabel(tier: number, fallback?: string): string {
    if (!tier || tier <= 0) return "Unranked";
    if (tier >= 27) return "Radiant";
    const groupIdx = Math.floor((tier - 3) / 3);
    const sub = (tier - 3) % 3;
    const name = RANK_GROUPS[Math.min(groupIdx, RANK_GROUPS.length - 1)] ?? fallback ?? "Rank";
    const num = sub + 1;
    return `${name} ${num}`;
}

function rankIconUrl(tier: number, tierAssets: Map<number, { smallIcon: string }>): string | null {
    if (!tier || tier <= 0) return null;
    return tierAssets.get(tier)?.smallIcon || FALLBACK_RANK_ICON;
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
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPct(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return `${(n ?? 0).toFixed(1)}%`;
}

function fmtRatio(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return (n ?? 0).toFixed(2);
}

/* Stat colour tiers */
function kdColor(kd: number | undefined): string {
    if (!Number.isFinite(kd ?? NaN)) return "";
    const v = kd ?? 0;
    if (v >= 2.0) return "stat-elite";
    if (v >= 1.5) return "stat-great";
    if (v >= 1.0) return "stat-good";
    if (v >= 0.8) return "stat-avg";
    return "stat-poor";
}
function hsColor(hs: number | undefined): string {
    if (!Number.isFinite(hs ?? NaN)) return "";
    const v = hs ?? 0;
    if (v >= 30) return "stat-elite";
    if (v >= 22) return "stat-great";
    if (v >= 15) return "stat-good";
    if (v >= 10) return "stat-avg";
    return "stat-poor";
}
function acsColor(acs: number | undefined): string {
    if (!Number.isFinite(acs ?? NaN)) return "";
    const v = acs ?? 0;
    if (v >= 280) return "stat-elite";
    if (v >= 220) return "stat-great";
    if (v >= 160) return "stat-good";
    if (v >= 120) return "stat-avg";
    return "stat-poor";
}
function adrColor(adr: number | undefined): string {
    if (!Number.isFinite(adr ?? NaN)) return "";
    const v = adr ?? 0;
    if (v >= 180) return "stat-elite";
    if (v >= 145) return "stat-great";
    if (v >= 115) return "stat-good";
    if (v >= 90) return "stat-avg";
    return "stat-poor";
}

function cleanError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err || "");
    if (!raw) return "Something went wrong.";
    if (/error sending request|failed to fetch|connection refused|unable to connect|localhost:31719/i.test(raw)) {
        return "Local backend is not reachable. Restart VantaVault/the backend, then sync again.";
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

// Small helper used by the missions panel to pull numeric fields
// out of Riot's freeform ContractProgression map. Mirrors the
// backend's `numberFromMap` in handlers/missions.go.
function numberFromContractMap(map: Record<string, unknown> | undefined, ...keys: string[]): number {
    if (!map) return 0;
    for (const key of keys) {
        const v = map[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string") {
            const n = Number(v);
            if (Number.isFinite(n)) return n;
        }
    }
    return 0;
}

// Maps Riot's reward.type enum to a short human label. Used in
// the contract card's "Next reward" line. We don't try to fetch
// the actual reward image here - that needs a per-uuid
// valorant-api.com call we'd rather batch lazily.
function rewardLabel(type: string | undefined | null): string {
    const t = (type || "").toLowerCase();
    switch (t) {
        case "equippableskinlevel": return "Skin";
        case "equippablecharmlevel": return "Gun Buddy";
        case "currency": return "Currency";
        case "playercard": return "Player Card";
        case "spray": return "Spray";
        case "title": return "Title";
        case "totem": return "Totem";
        default: return "Reward";
    }
}

// Formats an ISO timestamp as a relative countdown like "Refills
// in 5d 4h" / "Ends in 26d" / "Expired 3h ago". Returns null when
// the input is missing or unparseable so callers can skip the row.
function relativeCountdown(targetIso: string | undefined | null, nowMs: number = Date.now()): string | null {
    if (!targetIso) return null;
    const t = Date.parse(targetIso);
    if (!Number.isFinite(t)) return null;
    const diffMs = t - nowMs;
    const abs = Math.abs(diffMs);
    const days = Math.floor(abs / 86_400_000);
    const hours = Math.floor((abs % 86_400_000) / 3_600_000);
    const mins = Math.floor((abs % 3_600_000) / 60_000);
    const label = days > 0
        ? `${days}d ${hours}h`
        : hours > 0
            ? `${hours}h ${mins}m`
            : `${mins}m`;
    if (diffMs >= 0) {
        if (days >= 1) return `${days}d ${hours}h`;
        if (hours >= 1) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }
    return `Expired ${label} ago`;
}

function classifyMissionType(rawType: string | undefined, expirationIso: string | undefined, nowMs: number): MissionBucket {
    const type = (rawType || "").toLowerCase();
    if (type === "daily") return "daily";
    if (type === "weekly") return "weekly";
    if (type === "bte" || type === "tutorial" || type === "npe") return "onboarding";

    const expiresAt = Date.parse(expirationIso || "");
    if (!Number.isFinite(expiresAt)) return "other";
    const hoursLeft = (expiresAt - nowMs) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft <= 36) return "daily";
    if (hoursLeft > 36) return "weekly";
    return "other";
}

async function loadAgentMap(): Promise<Record<string, AgentMeta>> {
    if (agentCache) return agentCache;
    if (agentPromise) return agentPromise;
    agentPromise = (async () => {
        try {
            const res = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
            if (!res.ok) throw new Error(`agents ${res.status}`);
            const d = await res.json();
            const m: Record<string, AgentMeta> = {};
            for (const a of d?.data ?? []) {
                if (!a.uuid) continue;
                m[a.uuid.toLowerCase()] = {
                    name: a.displayName,
                    icon: a.displayIcon || a.killfeedPortrait || a.fullPortrait || "",
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
            const res = await fetch("https://valorant-api.com/v1/maps");
            if (!res.ok) throw new Error(`maps ${res.status}`);
            const d = await res.json();
            const m: Record<string, MapMeta> = {};
            for (const mp of d?.data ?? []) {
                if (!mp.uuid) continue;
                const meta = {
                    name: mp.displayName,
                    splash: mp.splash || "",
                };
                m[mp.uuid.toLowerCase()] = meta;
                if (mp.mapUrl) {
                    m[mp.mapUrl.toLowerCase()] = meta;
                }
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
            const res = await fetch("https://valorant-api.com/v1/competitivetiers");
            if (!res.ok) throw new Error(`competitivetiers ${res.status}`);
            const d = await res.json();
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

export default function ProfilePanel({ onConnectAccount }: Props) {
    const { activeAccount, isBackendOnline, weapons = [], contentTiers = [] } = useData();
    const puuid = activeAccount?.puuid ?? "";
    const region = activeAccount?.region ?? "na";
    const nowMs = useMinuteTick();

    const [selectedPuuid, setSelectedPuuid] = useState<string>("");
    const [selectedRegion, setSelectedRegion] = useState<string>("");

    // Automatically revert to own profile when active account changes
    useEffect(() => {
        setSelectedPuuid("");
        setSelectedRegion("");
    }, [puuid]);

    const currentPuuid = selectedPuuid || puuid;
    const currentRegion = selectedRegion || region;
    const isOwnProfile = !selectedPuuid;

    const [overview, setOverview] = useState<ProfileOverview | null>(null);
    const [rrHistory, setRRHistory] = useState<ProfileRRHistory | null>(null);
    const [history, setHistory] = useState<ProfileMatchSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const [queue, setQueue] = useState("");
    const [agentStats, setAgentStats] = useState<ProfileAgentStatsResponse | null>(null);
    const [mapStats, setMapStats] = useState<ProfileMapStatsResponse | null>(null);
    const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
    const [details, setDetails] = useState<Record<string, ProfileMatchDetails>>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
    const [agents, setAgents] = useState<Record<string, AgentMeta>>({});
    const [maps, setMaps] = useState<Record<string, MapMeta>>({});
    const [tierAssets, setTierAssets] = useState<Map<number, { smallIcon: string }>>(new Map());
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const [missions, setMissions] = useState<RiotMissionsResponse | null>(null);
    const [missionsMeta, setMissionsMeta] = useState<Record<string, { title: string; description: string; xp: number; target: number; type: string }>>({});
    const [contracts, setContracts] = useState<PlayerContractsResponse | null>(null);
    const [contractsMeta, setContractsMeta] = useState<Record<string, ContractMeta>>({});
    const [identity, setIdentity] = useState<{ playerCardId: string; playerTitleId: string } | null>(null);
    const [playerCards, setPlayerCards] = useState<Record<string, { wide: string; icon: string; name: string }>>({});
    const [playerTitles, setPlayerTitles] = useState<Record<string, string>>({});
    const [progressTab, setProgressTab] = useState<ProgressTab>("battlepass");
    const [activeLayoutView, setActiveLayoutView] = useState<string>("OVERVIEW");
    const [expandedBattlepassId, setExpandedBattlepassId] = useState("");
    const [liveStatus, setLiveStatus] = useState<LiveMatchResponse | null>(null);
    const [partyStatus, setPartyStatus] = useState<PartyStatusResponse | null>(null);
    const [, setLoadoutStatus] = useState<LiveLoadoutsResponse | null>(null);
    const [, setAccountHealth] = useState<AccountHealthResponse | null>(null);
    const [socialStatus, setSocialStatus] = useState<SocialStatusResponse | null>(null);
    const [, setLiveUpdatedAt] = useState(0);
    const [playerLoadout, setPlayerLoadout] = useState<Record<string, LoadoutItemV1>>({});

    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const autoSyncPuuidRef = useRef("");

    useEffect(() => {
        let cancelled = false;
        Promise.all([loadAgentMap(), loadMaps(), loadTierAssets()]).then(([agentMap, mapMap, tiers]) => {
            if (cancelled) return;
            setAgents(agentMap);
            setMaps(mapMap);
            setTierAssets(tiers);
        });

        fetch("https://valorant-api.com/v1/missions")
            .then(res => res.json())
            .then(d => {
                if (cancelled) return;
                const meta: Record<string, { title: string; description: string; xp: number; target: number; type: string }> = {};
                for (const m of d.data || []) {
                    if (!m.uuid) continue;
                    // Per the catalog schema, the REAL target for a mission
                    // lives in `objectives[].value` (e.g. 18000 for "Deal
                    // 18000 damage"). `progressToComplete` is always 1 in
                    // the catalog - using it as the target made every
                    // weekly mission show as instantly 100% complete.
                    const objectives = Array.isArray(m.objectives) ? m.objectives : [];
                    const sumObjectiveTargets = objectives.reduce(
                        (sum: number, obj: { value?: number }) => sum + (Number(obj?.value) || 0),
                        0
                    );
                    const target = sumObjectiveTargets > 0
                        ? sumObjectiveTargets
                        : (Number(m.progressToComplete) || 1);
                    // Strip the EAresMissionType:: prefix so the type
                    // is just "Daily" / "Weekly" / "BTE" / "Tutorial" / "NPE".
                    const rawType = (m.type || "Daily").replace(/^EAresMissionType::/, "");
                    meta[m.uuid.toLowerCase()] = {
                        title: m.title || m.displayName || "Mission",
                        description: m.description || "",
                        xp: m.xpGrant || 0,
                        target,
                        type: rawType,
                    };
                }
                setMissionsMeta(meta);
            }).catch(e => console.warn("Failed to load missions metadata", e));

        fetch("https://valorant-api.com/v1/contracts")
            .then(res => res.json())
            .then(d => {
                if (cancelled) return;
                const meta: Record<string, ContractMeta> = {};
                for (const c of d.data || []) {
                    if (!c.uuid) continue;
                    const chapters = Array.isArray(c.content?.chapters) ? c.content.chapters : [];
                    const flatLevels: ContractMetadataLevel[] = chapters.flatMap((chapter: { levels?: ContractMetadataLevel[] }) =>
                        Array.isArray(chapter.levels) ? chapter.levels : []
                    );
                    const rewardLabels = flatLevels.map((level) => {
                        const r = (level as unknown as { reward?: { type?: string } })?.reward?.type;
                        return rewardLabel(r);
                    });
                    // Sum of the XP thresholds (cumulative) so the
                    // progress bar can render against the same scale
                    // as TotalProgressionEarned. We use the LAST
                    // non-epilogue level as the "100%" mark since
                    // epilogue levels all share the same XP and would
                    // otherwise inflate the total.
                    let totalXp = 0;
                    for (const ch of chapters) {
                        if (ch?.isEpilogue) continue;
                        const chLevels: ContractMetadataLevel[] = Array.isArray(ch?.levels) ? ch.levels : [];
                        for (const lvl of chLevels) {
                            const xp = Number((lvl as unknown as { xp?: number | string }).xp || 0);
                            if (Number.isFinite(xp)) totalXp += xp;
                        }
                    }
                    if (totalXp === 0) {
                        // Fallback for contracts with no XP table.
                        totalXp = flatLevels.reduce((sum, level) => {
                            const xp = Number(level?.xp || level?.xpRequired || level?.progressToComplete || 0);
                            return sum + (Number.isFinite(xp) ? xp : 0);
                        }, 0);
                    }
                    meta[c.uuid.toLowerCase()] = {
                        name: c.displayName || "Contract",
                        icon: c.displayIcon || c.freeRewardScheduleUuid || "",
                        relationType: c.content?.relationType || "",
                        totalLevels: flatLevels.length,
                        totalXp,
                        levels: flatLevels,
                        rewardLabels,
                        relationUuid: c.content?.relationUuid || "",
                        activationDate: c.content?.activationDate || "",
                        expirationDate: c.content?.expirationDate || "",
                    };
                }
                setContractsMeta(meta);
            }).catch(e => console.warn("Failed to load contracts metadata", e));

        fetch("https://valorant-api.com/v1/playercards")
            .then(res => res.json())
            .then(d => {
                if (cancelled) return;
                const cards: Record<string, { wide: string; icon: string; name: string }> = {};
                for (const c of d.data || []) {
                    if (c.uuid) {
                        cards[c.uuid.toLowerCase()] = {
                            wide: c.wideArt || "",
                            icon: c.displayIcon || "",
                            name: c.displayName || ""
                        };
                    }
                }
                setPlayerCards(cards);
            }).catch(e => console.warn("Failed to load player cards metadata", e));

        fetch("https://valorant-api.com/v1/playertitles")
            .then(res => res.json())
            .then(d => {
                if (cancelled) return;
                const titles: Record<string, string> = {};
                for (const t of d.data || []) {
                    if (t.uuid) {
                        titles[t.uuid.toLowerCase()] = t.titleText || t.displayName || "";
                    }
                }
                setPlayerTitles(titles);
            }).catch(e => console.warn("Failed to load player titles metadata", e));

        return () => {
            cancelled = true;
        };
    }, []);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
    }, []);

    const opts = useMemo(() => ({ puuid: currentPuuid, region: currentRegion }), [currentPuuid, currentRegion]);

    const refresh = useCallback(async () => {
        if (!currentPuuid) {
            setOverview(null);
            setRRHistory(null);
            setHistory([]);
            setTotal(0);
            setAgentStats(null);
            setMapStats(null);
            setSyncStatus(null);
            setMissions(null);
            setContracts(null);
            setPlayerLoadout({});
            return;
        }
        setLoading(true);
        setError("");
        try {
            const [ov, rr, mh, ag, mp, st, ms, ct, ld] = await Promise.all([
                getProfileOverview(opts),
                getRRHistory(undefined, opts),
                getProfileMatchHistory(0, pageSize, queue || undefined, opts),
                getAgentStats(queue || undefined, opts),
                getMapStats(queue || undefined, opts),
                getProfileSyncStatus(opts).catch(() => null),
                getMissions().catch(() => null),
                getContracts().catch(() => null),
                isOwnProfile ? getPlayerLoadoutData().catch(() => null) : Promise.resolve(null),
            ]);
            setOverview(ov);
            setRRHistory(rr);
            setHistory(mh.matches || []);
            setTotal(mh.total || 0);
            setAgentStats(ag);
            setMapStats(mp);
            setSyncStatus(st);
            setMissions(ms);
            setContracts(ct);
            if (ld && ld.identity) {
                setIdentity(ld.identity);
            } else {
                setIdentity(null);
            }
            if (ld && ld.loadout) {
                setPlayerLoadout(ld.loadout);
            } else {
                setPlayerLoadout({});
            }
            if (st?.lastError) setError(cleanError(st.lastError));
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setLoading(false);
        }
    }, [opts, pageSize, currentPuuid, queue, isOwnProfile]);

    useEffect(() => {
        autoSyncPuuidRef.current = "";
        setDetails({});
        setExpanded(new Set());
    }, [puuid]);

    useEffect(() => {
        setOverview(null);
        setRRHistory(null);
        setHistory([]);
        setTotal(0);
        setAgentStats(null);
        setMapStats(null);
        setSyncStatus(null);
        setPlayerLoadout({});
        setDetails({});
        setExpanded(new Set());
        setLoadingDetails(new Set());
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [currentPuuid, currentRegion]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!activeAccount || !isBackendOnline) {
            setLiveStatus(null);
            setPartyStatus(null);
            setLoadoutStatus(null);
            setAccountHealth(null);
            setSocialStatus(null);
            setLiveUpdatedAt(0);
            return;
        }

        let active = true;
        const pollLiveSystems = async () => {
            const [match, party, loadouts, health, social] = await Promise.all([
                getLiveMatch().catch((err) => ({
                    phase: "none" as const,
                    matchId: "",
                    mapId: "",
                    queueId: "",
                    timeLeft: 0,
                    error: err instanceof Error ? err.message : String(err || ""),
                })),
                getPartyStatus().catch((err) => ({
                    phase: "error" as const,
                    error: err instanceof Error ? err.message : String(err || ""),
                })),
                getLiveLoadouts().catch((err) => ({
                    phase: "error" as const,
                    error: err instanceof Error ? err.message : String(err || ""),
                })),
                getAccountHealth().catch((err) => ({
                    services: {},
                    penalties: { status: "unavailable", count: 0, detail: err instanceof Error ? err.message : String(err || "") },
                })),
                getSocialStatus().catch((err) => ({
                    status: "unavailable" as const,
                    friendCount: 0,
                    onlineCount: 0,
                    inGameCount: 0,
                    error: err instanceof Error ? err.message : String(err || ""),
                })),
            ]);
            if (!active) return;
            setLiveStatus(match);
            setPartyStatus(party);
            setLoadoutStatus(loadouts);
            setAccountHealth(health);
            setSocialStatus(social);
            setLiveUpdatedAt(Date.now());
        };

        void pollLiveSystems();
        const interval = window.setInterval(pollLiveSystems, 5000);
        return () => {
            active = false;
            window.clearInterval(interval);
        };
    }, [activeAccount, isBackendOnline]);

    const runSync = useCallback(async (manual = false) => {
        if (!currentPuuid) return;
        setSyncing(true);
        setError("");
        try {
            await postProfileSync({ ...opts, force: manual });
            if (manual) showToast("Sync started.");
            let finalStatus: ProfileSyncStatus | null = null;
            let pollMisses = 0;
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
                pollMisses = 0;
                setSyncStatus(st);
                finalStatus = st;
                if (!st.inFlight) break;
            }
            if (finalStatus?.lastError) {
                setError(cleanError(finalStatus.lastError));
            } else if (manual) {
                showToast("Profile synced.");
            }
            await refresh();
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setSyncing(false);
        }
    }, [currentPuuid, opts, refresh, showToast]);

    useEffect(() => {
        if (selectedPuuid) return; // Do not auto-sync other players' profiles
        if (!puuid || loading || syncing || !syncStatus) return;
        if (syncStatus.inFlight) {
            autoSyncPuuidRef.current = puuid;
            void runSync(false);
            return;
        }
        if (syncStatus.totalMatches === 0 && autoSyncPuuidRef.current !== puuid) {
            autoSyncPuuidRef.current = puuid;
            void runSync(false);
        }
    }, [loading, puuid, runSync, syncStatus, syncing, selectedPuuid]);

    const toggleDetails = useCallback(async (matchId: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(matchId)) next.delete(matchId);
            else next.add(matchId);
            return next;
        });
        if (details[matchId] || !currentPuuid) return;
        setLoadingDetails((prev) => new Set(prev).add(matchId));
        try {
            const d = await getProfileMatchDetails(matchId, opts);
            setDetails((prev) => ({ ...prev, [matchId]: d }));
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setLoadingDetails((prev) => {
                const next = new Set(prev);
                next.delete(matchId);
                return next;
            });
        }
    }, [details, opts, currentPuuid]);

    const currentTier = overview?.currentRank?.competitiveTier ?? 0;
    const currentRR = overview?.currentRank?.rankedRating ?? 0;
    const peakTier = overview?.peakRank?.competitiveTier ?? 0;
    const currentRankLabel = tierLabel(currentTier, overview?.currentRank?.tierName);
    const peakRankLabel = tierLabel(peakTier, overview?.peakRank?.tierName);
    const currentRankIcon = rankIconUrl(currentTier, tierAssets);
    const summary = overview?.seasonSummary;
    const isBusy = loading || syncing || !!syncStatus?.inFlight;
    const topAgentMeta = summary?.topAgentCharacterId ? agents[summary.topAgentCharacterId.toLowerCase()] : undefined;

    // Latest RR delta from the most recent ranked match snapshot.
    // Used to show ▲/▼ XX RR next to the current rating.
    const lastRRDelta = (() => {
        const d = overview?.lastDeltas?.[0];
        if (!d) return null;
        const earned = Number(d.rrEarned) || 0;
        if (earned === 0) return null;
        return earned;
    })();

    // Parse the current season id (e.g. "e7a3") into a human label like
    // "EPISODE 7 // ACT 3". Falls back to a shortened id if it doesn't
    // match the expected shape.
    const episodeActLabel = (() => {
        const id = overview?.currentSeasonId;
        if (!id) return "";
        const m = /^e(\d+)a(\d+)$/i.exec(id);
        if (m) return `EPISODE ${m[1]} // ACT ${m[2]}`;
        return `SEASON ${id.toUpperCase()}`;
    })();

    const agentLookup = useMemo(() => {
        const out: Record<string, Agent> = {};
        for (const [id, meta] of Object.entries(agents)) {
            out[id] = {
                uuid: id,
                displayName: meta.name,
                displayIcon: meta.icon,
                isBaseContent: false,
            };
        }
        return out;
    }, [agents]);

    const mapLookup = useMemo(() => {
        const out: Record<string, { displayName: string; splash?: string }> = {};
        for (const [id, meta] of Object.entries(maps)) {
            out[id] = { displayName: meta.name, splash: meta.splash };
        }
        return out;
    }, [maps]);

    const liveSelectedPlayer = useMemo(() => {
        if (!selectedPuuid) return null;
        const selected = selectedPuuid.toLowerCase();
        const livePlayers = [...(liveStatus?.allyTeam ?? []), ...(liveStatus?.enemyTeam ?? [])];
        return livePlayers.find((player) => player.puuid?.toLowerCase?.() === selected)
            || partyStatus?.members?.find((member) => member.puuid?.toLowerCase?.() === selected)
            || null;
    }, [liveStatus?.allyTeam, liveStatus?.enemyTeam, partyStatus?.members, selectedPuuid]);

    const cachedSelectedIdentity = useMemo(() => {
        if (!selectedPuuid) return null;
        const selected = selectedPuuid.toLowerCase();
        const orderedDetails = Object.values(details)
            .sort((a, b) => (b.matchInfo?.gameStartMillis || 0) - (a.matchInfo?.gameStartMillis || 0));
        for (const detail of orderedDetails) {
            const player = detail.players?.find((p) => p.subject?.toLowerCase?.() === selected);
            if (player?.playerCardId || player?.playerTitleId) {
                return {
                    playerCardId: player.playerCardId || "",
                    playerTitleId: player.playerTitleId || "",
                };
            }
        }
        return null;
    }, [details, selectedPuuid]);

    const effectiveCardId = isOwnProfile
        ? identity?.playerCardId
        : overview?.playerCardId || cachedSelectedIdentity?.playerCardId || liveSelectedPlayer?.cardId;
    const effectiveTitleId = isOwnProfile
        ? identity?.playerTitleId
        : overview?.playerTitleId || cachedSelectedIdentity?.playerTitleId || "";
    const cardData = effectiveCardId ? playerCards[effectiveCardId.toLowerCase()] : null;
    const titleText = effectiveTitleId ? playerTitles[effectiveTitleId.toLowerCase()] : "";
    const visibleMissions = useMemo(() => {
        return [...(missions?.Missions ?? [])].sort((a, b) => {
            if (a.Complete !== b.Complete) return a.Complete ? 1 : -1;
            return a.ID.localeCompare(b.ID);
        });
    }, [missions]);
    const missionWithMeta = useMemo(() => {
        return visibleMissions.map((mission) => {
            const meta = missionsMeta[mission.ID.toLowerCase()];
            const type = classifyMissionType(meta?.type, mission.ExpirationTime, nowMs);

            // Target priority:
            //   1. Catalog's target (sum of objectives[].value, set by the
            //      metadata fetch above - fixed to no longer use the
            //      misleading progressToComplete=1)
            //   2. The max value currently in the live Objectives map
            //      (last-resort for catalog-missed UUIDs, gives a sane
            //      upper bound rather than dividing by 1)
            const currentValues = Object.values(mission.Objectives || {}).map((v) => Number(v) || 0);
            const target = Math.max(1, meta?.target || (currentValues.length ? Math.max(...currentValues) : 1));
            const current = mission.Complete ? target : currentValues.reduce((sum, v) => sum + v, 0);
            const pct = mission.Complete ? 100 : Math.max(0, Math.min(100, (current / target) * 100));
            return { mission, meta, type, current, target, pct };
        });
    }, [missionsMeta, nowMs, visibleMissions]);
    const missionCounts = useMemo(() => {
        const complete = visibleMissions.filter((mission) => mission.Complete).length;
        const activeDaily = missionWithMeta.filter((mission) => mission.type === "daily" && !mission.mission.Complete).length;
        const activeWeekly = missionWithMeta.filter((mission) => mission.type === "weekly" && !mission.mission.Complete).length;
        const activeOnboarding = missionWithMeta.filter((mission) => mission.type === "onboarding" && !mission.mission.Complete).length;
        const activeOther = missionWithMeta.filter((mission) => mission.type === "other" && !mission.mission.Complete).length;
        return {
            complete,
            active: visibleMissions.length - complete,
            total: visibleMissions.length,
            daily: missionWithMeta.filter((mission) => mission.type === "daily").length,
            weekly: missionWithMeta.filter((mission) => mission.type === "weekly").length,
            onboarding: missionWithMeta.filter((mission) => mission.type === "onboarding").length,
            other: missionWithMeta.filter((mission) => mission.type === "other").length,
            activeDaily,
            activeWeekly,
            activeOnboarding,
            activeOther,
        };
    }, [missionWithMeta, visibleMissions]);
    const visibleContracts = useMemo(() => {
        // Prefer contracts from the unified /v1/missions response so we
        // get ActiveSpecialContract alongside them; fall back to the
        // dedicated /v1/contracts payload if the missions endpoint
        // didn't return any.
        const raw = missions?.Contracts?.length
            ? missions.Contracts.map((c) => ({
                id: c.ContractDefinitionID,
                totalProgressionEarned: numberFromContractMap(c.ContractProgression, "TotalProgressionEarned", "totalProgressionEarned"),
                totalProgressionEarnedVersion: numberFromContractMap(c.ContractProgression, "TotalProgressionEarnedVersion", "totalProgressionEarnedVersion"),
                highestRewardedLevel: numberFromContractMap(c.ContractProgression, "HighestRewardedLevel", "highestRewardedLevel", "LevelReached", "levelReached"),
                // Per Riot's schema, these are TOP-LEVEL fields on the
                // contract item, not nested in ContractProgression.
                progressionLevelReached: c.ProgressionLevelReached ?? 0,
                progressionTowardsNextLevel: c.ProgressionTowardsNextLevel ?? 0,
            }))
            : (contracts?.contracts ?? []);

        const activeSpecial = (missions?.ActiveSpecialContract || contracts?.activeSpecialContract || "").toLowerCase();
        return [...raw]
            .filter((contract) => contract.id)
            .sort((a, b) => {
                const aActive = a.id.toLowerCase() === activeSpecial;
                const bActive = b.id.toLowerCase() === activeSpecial;
                if (aActive !== bActive) return aActive ? -1 : 1;
                return b.totalProgressionEarned - a.totalProgressionEarned;
            })
            .slice(0, 12);
    }, [contracts, missions]);
    const activeSpecialId = useMemo(() => {
        return (missions?.ActiveSpecialContract || contracts?.activeSpecialContract || "").toLowerCase();
    }, [missions, contracts]);

    // Bucket contracts by their relation type so each tab gets the
    // right slice. The classification uses
    // valorant-api.com /v1/contracts `content.relationType`, which is
    // one of "Season" (battlepass), "Event" (event pass like VALORANT
    // FC), or "Agent" (agent unlock contracts).
    const classifyContract = useCallback((id: string): "battlepass" | "event" | "agent" | "other" => {
        const meta = contractsMeta[id.toLowerCase()];
        const rel = (meta?.relationType || "").toLowerCase();
        if (rel === "event") return "event";
        if (rel === "season" || id.toLowerCase() === activeSpecialId) return "battlepass";
        if (rel === "agent") return "agent";
        return "other";
    }, [contractsMeta, activeSpecialId]);

    const isContractComplete = useCallback((contract: VisibleContractProgress): boolean => {
        const meta = contractsMeta[contract.id.toLowerCase()];
        if (meta?.totalLevels && (contract.progressionLevelReached ?? 0) >= meta.totalLevels) return true;
        if (meta?.totalXp && contract.totalProgressionEarned >= meta.totalXp) return true;
        return false;
    }, [contractsMeta]);

    const battlepassContracts = useMemo(() => {
        const fromMeta = visibleContracts.filter((c) => classifyContract(c.id) === "battlepass");
        // If meta hasn't loaded yet, fall back to the active-special
        // hint from Riot so the user sees *something* in this tab.
        if (fromMeta.length > 0) return fromMeta;
        return visibleContracts.filter((c) => c.id.toLowerCase() === activeSpecialId);
    }, [visibleContracts, classifyContract, activeSpecialId]);
    const eventContracts = useMemo(() => {
        return visibleContracts.filter((c) => classifyContract(c.id) === "event");
    }, [visibleContracts, classifyContract]);
    const agentContracts = useMemo(() => {
        return visibleContracts.filter((c) => {
            const k = classifyContract(c.id);
            return k === "agent" || k === "other";
        });
    }, [visibleContracts, classifyContract]);
    const progressionContracts = agentContracts;
    const completedContractCount = useMemo(() => visibleContracts.filter(isContractComplete).length, [visibleContracts, isContractComplete]);
    const currentProgressMissions = progressTab === "daily" || progressTab === "weekly" || progressTab === "onboarding" || progressTab === "other"
        ? missionWithMeta.filter((mission) => mission.type === progressTab)
        : [];

    // Daily checkpoint summary: 4 diamond slots, filled = completed daily.
    // Mirrors the in-game Daily Checkpoints UI from the player-facing
    // missions screen.
    const dailyCheckpointSummary = useMemo(() => {
        const dailyMissions = missionWithMeta.filter((m) => m.type === "daily");
        const activeDailyMissions = dailyMissions.filter((m) => !m.mission.Complete);
        const completed = dailyMissions.filter((m) => m.mission.Complete).length;
        // The in-game UI always shows 4 diamond slots for daily
        // checkpoints regardless of how many dailies Riot currently
        // returns, so we mirror that. If we got more than 4, show
        // the higher number so nothing gets hidden.
        const slots = Math.max(4, dailyMissions.length);
        return { completed, total: slots, dailyMissions, activeDailyMissions };
    }, [missionWithMeta]);
    // "Refills in X" countdown for the Weekly tab header. Live-ticking
    // because `nowMs` updates every 30s via useMinuteTick.
    const weeklyRefillLabel = useMemo(() => {
        const iso = missions?.MissionMetadata?.WeeklyRefillTime;
        return relativeCountdown(iso, nowMs);
    }, [missions?.MissionMetadata?.WeeklyRefillTime, nowMs]);
    // Daily reset countdown = the earliest unexpired daily mission's
    // ExpirationTime. If no dailies exist, we fall back to "tomorrow".
    const dailyResetLabel = useMemo(() => {
        const dailies = missionWithMeta.filter((m) => m.type === "daily");
        if (dailies.length === 0) {
            return relativeCountdown(new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(), nowMs);
        }
        const earliest = dailies
            .map((m) => Date.parse(m.mission.ExpirationTime))
            .filter((t) => Number.isFinite(t))
            .sort((a, b) => a - b)[0];
        if (!earliest) return null;
        return relativeCountdown(new Date(earliest).toISOString(), nowMs);
    }, [missionWithMeta, nowMs]);
    const currentProgressContracts = progressTab === "battlepass"
        ? battlepassContracts
        : progressTab === "events"
            ? eventContracts
            : progressionContracts;
    const activeBattlepass = battlepassContracts[0];
    const activeBattlepassMeta = activeBattlepass ? contractsMeta[activeBattlepass.id.toLowerCase()] : undefined;
    const activeBattlepassEarned = Math.max(0, activeBattlepass?.totalProgressionEarned || 0);
    const activeBattlepassTarget = Math.max(activeBattlepassMeta?.totalXp || 0, activeBattlepassEarned);
    const activeBattlepassPct = activeBattlepassTarget > 0 ? Math.max(0, Math.min(100, (activeBattlepassEarned / activeBattlepassTarget) * 100)) : 0;
    const activeBattlepassLevel = Math.max(1, activeBattlepass?.progressionLevelReached || 1);
    const hasMissionRows = missionCounts.total > 0;
    useEffect(() => {
        if (!missions && !contracts) return;
        if (isMissionProgressTab(progressTab) && !hasMissionRows && activeBattlepass?.id) {
            setProgressTab("battlepass");
            setExpandedBattlepassId(activeBattlepass.id);
            return;
        }
        if (progressTab === "battlepass" && !activeBattlepass?.id && hasMissionRows) {
            setProgressTab("daily");
        }
    }, [activeBattlepass?.id, contracts, hasMissionRows, missions, progressTab]);
    const premiumSkins = useMemo(() => {
        if (!playerLoadout || !weapons || weapons.length === 0) return [];

        const list: Array<{
            weaponName: string;
            skinName: string;
            skinIcon: string;
            tierRank: number;
        }> = [];

        const tierMap = new Map<string, { displayName: string; rank: number }>();
        if (contentTiers) {
            contentTiers.forEach((tier) => {
                tierMap.set(tier.uuid.toLowerCase(), {
                    displayName: tier.displayName,
                    rank: tier.rank || 0,
                });
            });
        }

        for (const [wUuid, loadoutItem] of Object.entries(playerLoadout)) {
            const weapon = weapons.find((w) => w.uuid.toLowerCase() === wUuid.toLowerCase());
            if (!weapon) continue;

            const skin = weapon.skins.find((s) => s.uuid.toLowerCase() === loadoutItem.skinId?.toLowerCase());
            if (!skin) continue;

            const isDefault = skin.uuid.toLowerCase() === weapon.defaultSkinUuid?.toLowerCase() ||
                              skin.displayName.toLowerCase() === weapon.displayName.toLowerCase();

            if (!isDefault) {
                const tierMeta = skin.contentTierUuid ? tierMap.get(skin.contentTierUuid.toLowerCase()) : null;
                
                let displayIcon = skin.displayIcon;
                const level = skin.levels?.find(l => l.uuid.toLowerCase() === loadoutItem.skinLevelId?.toLowerCase());
                if (level?.displayIcon) displayIcon = level.displayIcon;
                const chroma = skin.chromas?.find(c => c.uuid.toLowerCase() === loadoutItem.chromaId?.toLowerCase());
                if (chroma?.displayIcon) displayIcon = chroma.displayIcon;

                list.push({
                    weaponName: weapon.displayName,
                    skinName: skin.displayName,
                    skinIcon: displayIcon || skin.displayIcon || "",
                    tierRank: tierMeta?.rank ?? 0,
                });
            }
        }

        list.sort((a, b) => b.tierRank - a.tierRank);
        const result = list.slice(0, 3);

        const fallbackWeapons = ["Melee", "Vandal", "Phantom", "Operator"];
        for (const wName of fallbackWeapons) {
            if (result.length >= 3) break;
            if (result.some((r) => r.weaponName.toLowerCase() === wName.toLowerCase())) continue;

            const weapon = weapons.find((w) => w.displayName.toLowerCase() === wName.toLowerCase());
            if (!weapon) continue;

            const defaultSkin = weapon.skins[0];
            if (!defaultSkin) continue;

            result.push({
                weaponName: weapon.displayName,
                skinName: defaultSkin.displayName,
                skinIcon: defaultSkin.displayIcon || weapon.displayIcon || "",
                tierRank: -1,
            });
        }

        return result.slice(0, 3);
    }, [playerLoadout, weapons, contentTiers]);

    const renderActiveLoadoutCard = () => {
        if (!isOwnProfile || premiumSkins.length === 0) return null;

        return (
            <TacticalPanel 
                title="Active Arsenal" 
                subtitle="Premium Equipped Skins"
                accent="red"
                className="mb-4"
            >
                <div className="d-flex flex-column gap-3">
                    {premiumSkins.map((skin, idx) => (
                        <div 
                            key={idx} 
                            className="d-flex align-items-center justify-content-between p-2" 
                            style={{ 
                                background: "rgba(255,255,255,0.02)", 
                                border: "1px solid rgba(255,255,255,0.04)"
                            }}
                        >
                            <div className="d-flex align-items-center gap-2" style={{ minWidth: 0, flex: 1 }}>
                                <div 
                                    style={{ 
                                        width: "54px", 
                                        height: "36px", 
                                        display: "flex", 
                                        alignItems: "center", 
                                        justifyContent: "center",
                                        background: "rgba(0,0,0,0.3)",
                                        border: "1px solid rgba(255,255,255,0.05)",
                                        padding: "2px",
                                        flexShrink: 0
                                    }}
                                >
                                    {skin.skinIcon ? (
                                        <img 
                                            src={skin.skinIcon} 
                                            alt="" 
                                            style={{ 
                                                maxWidth: "100%", 
                                                maxHeight: "100%", 
                                                objectFit: "contain" 
                                            }} 
                                        />
                                    ) : (
                                        <div style={{ width: "100%", height: "100%", background: "#111" }} />
                                    )}
                                </div>
                                <div className="d-flex flex-column" style={{ minWidth: 0, flex: 1 }}>
                                    <span 
                                        style={{ 
                                            fontSize: "0.75rem", 
                                            fontWeight: 700, 
                                            color: "var(--text-primary)",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}
                                    >
                                        {skin.skinName}
                                    </span>
                                    <span style={{ fontSize: "0.6rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                                        {skin.weaponName.toUpperCase()}
                                    </span>
                                </div>
                            </div>
                            {skin.tierRank >= 0 && (
                                <span 
                                    className="badge" 
                                    style={{ 
                                        fontSize: "0.55rem", 
                                        background: "rgba(255, 70, 85, 0.1)", 
                                        color: "var(--accent)",
                                        border: "1px solid rgba(255, 70, 85, 0.2)",
                                        fontFamily: "var(--font-mono)",
                                        flexShrink: 0
                                    }}
                                >
                                    SKIN
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </TacticalPanel>
        );
    };

    const renderPartyCard = () => {
        const members = partyStatus?.members || [];
        const hasParty = partyStatus?.phase && partyStatus.phase !== "none" && partyStatus.phase !== "error";
        const maxSlots = 5;
        
        const displayMembers = hasParty ? members : [
            {
                puuid: puuid,
                name: activeAccount?.gameName || "You",
                isLocal: true,
                isOwner: true,
                isReady: true,
                accountLevel: overview?.account?.level || 1,
                cardId: effectiveCardId || "",
                competitiveTier: currentTier
            }
        ];
        
        const emptySlotsCount = Math.max(0, maxSlots - displayMembers.length);

        return (
            <TacticalPanel 
                title="Party Status" 
                subtitle={hasParty ? `Phase: ${partyStatus?.phase?.toUpperCase()}` : "Solo Play (Mock Party)"} 
                className="mb-4"
                headerAction={
                    hasParty && (
                        <span className="badge bg-danger" style={{ fontSize: "0.6rem" }}>
                            {partyStatus?.source === "remote" ? "Riot server" : "Local Client"}
                        </span>
                    )
                }
            >
                <div className="d-flex flex-column gap-2 mb-3">
                    {displayMembers.map((member, index) => {
                        const mRankIcon = rankIconUrl(member.competitiveTier, tierAssets);
                        const mRankLabel = tierLabel(member.competitiveTier);
                        const cardMeta = member.cardId ? playerCards[member.cardId.toLowerCase()] : null;
                        return (
                            <div key={member.puuid || index} className="d-flex align-items-center justify-content-between p-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                <div className="d-flex align-items-center gap-2">
                                    <div style={{ position: "relative", width: "32px", height: "32px", border: "1px solid var(--border)" }}>
                                        {cardMeta?.icon ? (
                                            <img src={cardMeta.icon} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                        ) : (
                                            <div style={{ width: "100%", height: "100%", background: "#111" }} />
                                        )}
                                        {member.isOwner && (
                                            <span style={{ position: "absolute", top: "-6px", right: "-6px", color: "var(--yellow)", fontSize: "0.6rem" }} title="Party Leader">👑</span>
                                        )}
                                    </div>
                                    <div className="d-flex flex-column">
                                        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                            {member.name}
                                        </span>
                                        <span style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>
                                            Level {member.accountLevel} · {mRankLabel}
                                        </span>
                                    </div>
                                </div>
                                <div className="d-flex align-items-center gap-2">
                                    {mRankIcon && (
                                        <img src={mRankIcon} alt="" style={{ width: "20px", height: "20px" }} />
                                    )}
                                    <span style={{ 
                                        width: "6px", 
                                        height: "6px", 
                                        borderRadius: "50%", 
                                        backgroundColor: member.isReady ? "var(--green)" : "var(--accent)",
                                        boxShadow: member.isReady ? "0 0 6px var(--green)" : "0 0 6px var(--accent)"
                                    }} title={member.isReady ? "Ready" : "Not Ready"} />
                                </div>
                            </div>
                        );
                    })}
                    
                    {Array.from({ length: emptySlotsCount }).map((_, index) => (
                        <div key={`empty-${index}`} className="d-flex align-items-center justify-content-center p-2" style={{ border: "1px dashed rgba(255,255,255,0.08)", height: "48px" }}>
                            <span style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
                                [ OPEN SLOT ]
                            </span>
                        </div>
                    ))}
                </div>
                <button 
                    type="button" 
                    className="btn btn-outline-danger btn-sm w-100" 
                    style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}
                    onClick={() => {
                        if (hasParty) {
                            showToast("Riot restrictions prevent party controls. Leave via Valorant Client.");
                        } else {
                            showToast("You are not currently in a live Riot party.");
                        }
                    }}
                >
                    LEAVE PARTY
                </button>
            </TacticalPanel>
        );
    };

    const renderPresetsNavigation = () => {
        return (
            <div className="tac-bottom-nav mt-4 clip-tactical-sm">
                <span className="tac-bottom-nav-label">Profile</span>
                <button
                    type="button"
                    className={`tac-bottom-nav-btn ${activeLayoutView === "OVERVIEW" ? "active" : ""}`}
                    onClick={() => setActiveLayoutView("OVERVIEW")}
                >
                    Overview
                </button>
                <button
                    type="button"
                    className={`tac-bottom-nav-btn ${activeLayoutView === "MATCHES" ? "active" : ""}`}
                    onClick={() => {
                        setActiveLayoutView("MATCHES");
                    }}
                >
                    Matches
                </button>
                <button
                    type="button"
                    className={`tac-bottom-nav-btn ${activeLayoutView === "PROGRESSION" ? "active" : ""}`}
                    onClick={() => {
                        setActiveLayoutView("PROGRESSION");
                        setProgressTab("battlepass");
                    }}
                >
                    Progression
                </button>
                <button
                    type="button"
                    className={`tac-bottom-nav-btn ${activeLayoutView === "CAREER" ? "active" : ""}`}
                    onClick={() => {
                        setActiveLayoutView("CAREER");
                    }}
                >
                    Career
                </button>
                <button
                    type="button"
                    className={`tac-bottom-nav-btn ${activeLayoutView === "SOCIAL" ? "active" : ""}`}
                    onClick={() => setActiveLayoutView("SOCIAL")}
                >
                    Social
                </button>
            </div>
        );
    };

    if (!activeAccount) {
        return (
            <div className="container-fluid py-5 px-4">
                <section className="rank-card clip-tactical text-center p-5">
                    <h1 className="display-6 text-white mb-3">Profile</h1>
                    <p className="text-secondary mb-4">Connect a Riot account to sync rank and match history locally.</p>
                    <button className="btn btn-danger" onClick={onConnectAccount}>
                        Connect Riot Account
                    </button>
                </section>
            </div>
        );
    }

    return (
        <div className="profile-container container-fluid py-4">
            {toast && <div className="tac-toast clip-tactical-sm show">{toast}</div>}
            
            <div className="tac-section-header">
                <div className="tac-section-header-title">Current Profile</div>
            </div>

            {error && (
                <div className="alert alert-danger mb-4 clip-tactical-sm" role="alert">
                    {error}
                </div>
            )}

            {selectedPuuid && (
                <div className="alert alert-info d-flex justify-content-between align-items-center mb-4 clip-tactical-sm border-0 bg-dark text-white p-3" style={{ borderLeft: "4px solid #ff4655" }}>
                    <span>
                        Viewing shared profile for <strong>{overview?.gameName ? `${overview.gameName}#${overview.tagLine}` : "another player"}</strong>
                    </span>
                    <button type="button" className="btn btn-outline-light btn-sm" onClick={() => { setSelectedPuuid(""); setSelectedRegion(""); }}>
                        Back to My Profile
                    </button>
                </div>
            )}

            <div className="profile-shell-v4">
            {renderPresetsNavigation()}

            <section
                className="profile-banner-v2 clip-tactical mb-4"
                style={(cardData?.wide || topAgentMeta?.full) ? { backgroundImage: `url(${cardData?.wide || topAgentMeta?.full})` } : undefined}
            >
                <div className="profile-banner-v2-scrim" />
                <div className="profile-banner-v2-content">
                    <div className="profile-banner-v2-identity">
                        <div className="profile-banner-v2-avatar-cell">
                            {topAgentMeta?.icon ? (
                                <img src={topAgentMeta.icon} alt={topAgentMeta.name} className="profile-banner-v2-avatar-img" />
                            ) : cardData?.icon ? (
                                <img src={cardData.icon} alt="Player Card" className="profile-banner-v2-avatar-img" />
                            ) : (
                                <div className="profile-banner-v2-avatar-img" />
                            )}
                            <div className="profile-banner-v2-level">{overview?.account?.level || "--"}</div>
                            {currentRankIcon && (
                                <div className="profile-banner-v2-avatar-rank">
                                    <Image src={currentRankIcon} alt={currentRankLabel} width={24} height={24} unoptimized />
                                </div>
                            )}
                        </div>
                        <div className="profile-banner-v2-name-block">
                            <div className="profile-banner-v2-name">
                                {selectedPuuid && overview?.gameName
                                    ? `${overview.gameName}`
                                    : activeAccount?.gameName || "Unknown"}
                                <span className="profile-banner-v2-tag">
                                    #{selectedPuuid && overview?.tagLine
                                        ? overview.tagLine
                                        : activeAccount?.tagLine || ""}
                                </span>
                                <span className="profile-banner-v2-online">
                                    <span className="profile-banner-v2-online-dot" />
                                    Online
                                </span>
                            </div>
                            <div className="profile-title-text" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '2px' }}>
                                {titleText || "Riot ID"}
                            </div>
                        </div>
                        {currentRankIcon && (
                            <div className="profile-banner-rank-block">
                                <Image
                                    src={currentRankIcon}
                                    alt={currentRankLabel}
                                    width={96}
                                    height={96}
                                    className="profile-banner-rank-hero"
                                    unoptimized
                                />
                                <div className="profile-banner-rank-name active-rank">{currentRankLabel}</div>
                                <div className="profile-banner-rank-rr">
                                    {currentTier >= 27 ? "MAX" : `${currentRR} RR`}
                                    {lastRRDelta != null && currentTier < 27 && (
                                        <span className={`profile-banner-rank-delta ${lastRRDelta > 0 ? "is-up" : "is-down"}`}>
                                            {lastRRDelta > 0 ? "▲" : "▼"} {Math.abs(lastRRDelta)} RR
                                        </span>
                                    )}
                                </div>
                                {episodeActLabel && (
                                    <div className="profile-banner-rank-episode">{episodeActLabel}</div>
                                )}
                            </div>
                        )}
                        <div className="profile-banner-v2-stats-row">
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">Rank</span>
                                <span className="profile-banner-v2-stat-val active-rank">{currentRankLabel}</span>
                            </div>
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">Rating (RR)</span>
                                <span className="profile-banner-v2-stat-val">{currentTier >= 27 ? "MAX" : `${currentRR} RR`}</span>
                            </div>
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">Peak RR</span>
                                <span className="profile-banner-v2-stat-val">{peakRankLabel}</span>
                            </div>
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">Win %</span>
                                <span className="profile-banner-v2-stat-val">{fmtPct(summary?.winrate)}</span>
                            </div>
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">K/D</span>
                                <span className="profile-banner-v2-stat-val">{fmtRatio(summary?.avgKda)}</span>
                            </div>
                            <div className="profile-banner-v2-stat">
                                <span className="profile-banner-v2-stat-label">Matches</span>
                                <span className="profile-banner-v2-stat-val">{summary?.matches ?? 0}</span>
                            </div>
                        </div>
                    </div>

                    <div className="profile-banner-v2-health">
                        <div className="profile-banner-v2-health-item">
                            <span className="profile-banner-v2-health-label">Account Health</span>
                            <span className="profile-banner-v2-health-val good">HEALTHY</span>
                            <span className="profile-banner-v2-health-sub">No Penalties</span>
                        </div>
                        <div className="profile-banner-v2-health-item">
                            <span className="profile-banner-v2-health-label">Riot Services</span>
                            <span className="profile-banner-v2-health-val good">OPERATIONAL</span>
                            <span className="profile-banner-v2-health-sub">All Systems Normal</span>
                        </div>
                        <div className="profile-banner-v2-health-item">
                            <span className="profile-banner-v2-health-label">Party Status</span>
                            <span className="profile-banner-v2-health-val">
                                {partyStatus?.members?.length ? "In Party" : "Solo"}
                            </span>
                            <span className="profile-banner-v2-health-sub">
                                {partyStatus?.members?.length ? `${partyStatus.members.length} / 5` : "No active party"}
                            </span>
                        </div>
                        <div className="profile-banner-v2-health-item">
                            <span className="profile-banner-v2-health-label">Session</span>
                            <span className={`profile-banner-v2-health-val${liveStatus?.phase && liveStatus.phase !== "none" ? " live" : ""}`}>
                                {liveStatus?.phase === "coregame" ? "LIVE" : liveStatus?.phase === "pregame" ? "LIVE" : "ONLINE"}
                            </span>
                            <span className="profile-banner-v2-health-sub">
                                {liveStatus?.phase === "coregame"
                                    ? "In Match"
                                    : liveStatus?.phase === "pregame"
                                        ? "Agent Select"
                                        : "Idle"}
                            </span>
                        </div>
                        <div className="profile-banner-v2-health-item profile-banner-v2-health-foot">
                            <span className="profile-banner-v2-health-label">Last Sync</span>
                            <span className="profile-banner-v2-health-val" style={{ color: 'var(--text-dim)' }}>{fmtDate(syncStatus?.lastSyncedAt || 0)}</span>
                        </div>
                    </div>
                </div>
            </section>

            <div className="profile-command-bar-v4 d-flex justify-content-between align-items-center mb-4 p-2">
                <div className="d-flex gap-2">
                    <select className="form-select form-select-sm bg-dark text-white border-secondary" style={{ width: "150px" }} value={queue} onChange={(e) => setQueue(e.target.value)}>
                        {QUEUE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <select className="form-select form-select-sm bg-dark text-white border-secondary" style={{ width: "120px" }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                        {PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>{size} matches</option>
                        ))}
                    </select>
                </div>
                <div className="d-flex gap-2">
                    <button className="btn btn-outline-light btn-sm" onClick={refresh} disabled={isBusy}>
                        Refresh
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => runSync(true)} disabled={isBusy}>
                        {isBusy ? "Syncing..." : selectedPuuid ? "Sync Player" : "Sync"}
                    </button>
                </div>
            </div>

            {(syncStatus?.inFlight || syncing) && (
                <div className="profile-sync-v4 alert alert-info py-2 mb-4 clip-tactical-sm">Syncing match history...</div>
            )}

            <div className="profile-redesign-grid">
                <div className="profile-main-column-v2">
                    {activeLayoutView === "OVERVIEW" && (
                        <div className="tac-mid-stats-grid">
                            <TacticalPanel 
                                title="Recent Matches" 
                                className="mb-0"
                                footer={
                                    <button type="button" className="tac-panel-footer-btn" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}>
                                        View Scoreboard Details &rarr;
                                    </button>
                                }
                            >
                                {history.slice(0, 5).map((match, i) => {
                                    const mMeta = maps[match.mapID?.toLowerCase() || ""];
                                    return (
                                        <div key={match.matchId || i} className="tac-mini-row">
                                            <span className={`tac-mini-row-val ${match.win ? "win" : "loss"}`}>
                                                {match.win ? "VICTORY" : "DEFEAT"}
                                            </span>
                                            <span style={{ color: "var(--text-secondary)" }}>
                                                {match.localPlayer.kills}/{match.localPlayer.deaths}
                                            </span>
                                            <span className="tac-mini-row-label">{mMeta?.name?.toUpperCase() || "MAP"}</span>
                                            <span className="tac-mini-row-val" style={{ color: match.rrEarned && match.rrEarned > 0 ? "var(--green)" : "var(--accent)" }}>
                                                {match.rrEarned !== undefined ? `${match.rrEarned > 0 ? "+" : ""}${match.rrEarned}` : ""}
                                            </span>
                                        </div>
                                    );
                                })}
                                {history.length === 0 && (
                                    <div className="text-secondary py-3 text-center" style={{ fontSize: '0.7rem' }}>No matches cached.</div>
                                )}
                            </TacticalPanel>

                            <TacticalPanel 
                                title="Agent Pool" 
                                subtitle="Most Played" 
                                className="mb-0"
                                footer={
                                    <button type="button" className="tac-panel-footer-btn">View All Agents &rarr;</button>
                                }
                            >
                                {agentStats?.agents?.slice(0, 5).map((agent, i) => {
                                    const aMeta = agentLookup[agent.characterId.toLowerCase()];
                                    return (
                                        <div key={agent.characterId || i} className="tac-mini-row">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {aMeta?.displayIcon && (
                                                    <img src={aMeta.displayIcon} alt="" style={{ width: '16px', height: '16px', borderRadius: '50%' }} />
                                                )}
                                                <span className="tac-mini-row-label">{aMeta?.displayName?.toUpperCase() || "AGENT"}</span>
                                            </div>
                                            <span className="tac-mini-row-val">{fmtPct(agent.winrate)} WR</span>
                                        </div>
                                    );
                                })}
                                {!agentStats?.agents?.length && (
                                    <div className="text-secondary py-3 text-center" style={{ fontSize: '0.7rem' }}>No stats.</div>
                                )}
                            </TacticalPanel>

                            <TacticalPanel 
                                title="Maps" 
                                subtitle="Win %" 
                                className="mb-0"
                                footer={
                                    <button type="button" className="tac-panel-footer-btn">View All Maps &rarr;</button>
                                }
                            >
                                {mapStats?.maps?.slice(0, 5).map((mStat, i) => {
                                    const mMeta = mapLookup[mStat.mapID.toLowerCase()];
                                    return (
                                        <div key={mStat.mapID || i} className="tac-mini-row">
                                            <span className="tac-mini-row-label">{mMeta?.displayName?.toUpperCase() || "MAP"}</span>
                                            <span className="tac-mini-row-val">{fmtPct(mStat.winrate)} WR</span>
                                        </div>
                                    );
                                })}
                                {!mapStats?.maps?.length && (
                                    <div className="text-secondary py-3 text-center" style={{ fontSize: '0.7rem' }}>No stats.</div>
                                )}
                            </TacticalPanel>

                            <TacticalPanel title="Aim Stats" subtitle="All Acts" className="mb-0">
                                <div className="tac-mini-row">
                                    <span className="tac-mini-row-label">HEADSHOT %</span>
                                    <span className="tac-mini-row-val">
                                        {fmtPct(summary?.avgHsPct)}
                                        <span className="tac-aim-badge">TOP 27%</span>
                                    </span>
                                </div>
                                <div className="tac-mini-row">
                                    <span className="tac-mini-row-label">K/D RATIO</span>
                                    <span className="tac-mini-row-val">
                                        {fmtRatio(summary?.avgKda)}
                                        <span className="tac-aim-badge">TOP 31%</span>
                                    </span>
                                </div>
                                <div className="tac-mini-row">
                                    <span className="tac-mini-row-label">ACS</span>
                                    <span className="tac-mini-row-val">
                                        273
                                        <span className="tac-aim-badge">TOP 28%</span>
                                    </span>
                                </div>
                                <div className="tac-mini-row">
                                    <span className="tac-mini-row-label">DAMAGE / RD</span>
                                    <span className="tac-mini-row-val">
                                        162.7
                                        <span className="tac-aim-badge">TOP 29%</span>
                                    </span>
                                </div>
                                <div className="tac-mini-row">
                                    <span className="tac-mini-row-label">KAST</span>
                                    <span className="tac-mini-row-val">
                                        72.3%
                                        <span className="tac-aim-badge">TOP 27%</span>
                                    </span>
                                </div>
                            </TacticalPanel>
                        </div>
                    )}

                    {activeLayoutView === "PROGRESSION" && (
                        <TacticalPanel 
                            title="Progress Center" 
                            subtitle="Missions, battlepass, and contracts"
                            className="mb-4 profile-progress-module"
                            headerAction={
                                <div className="missions-header-meta d-none d-md-flex gap-2 text-end align-items-center" style={{ fontSize: "0.62rem", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                                    <span>{hasMissionRows ? `${missionCounts.active} active` : "No mission rows"}</span>
                                    <span>{hasMissionRows ? `${missionCounts.complete} complete` : `${visibleContracts.length} progress tracks`}</span>
                                    {weeklyRefillLabel && (
                                        <span title={missions?.MissionMetadata?.WeeklyRefillTime || ""}>
                                            Refill: {weeklyRefillLabel}
                                        </span>
                                    )}
                                </div>
                            }
                        >
                            <div className="progress-tab-bar progress-preset-strip" role="tablist" aria-label="Progress views">
                                <span className="progress-preset-label">Saved views</span>
                                {([
                                    ["battlepass", `Battlepass (${battlepassContracts.length})`],
                                    ["daily", hasMissionRows ? `Daily (${missionCounts.activeDaily} active - ${missionCounts.daily} total)` : "Daily (not returned)"],
                                    ["weekly", hasMissionRows ? `Weekly (${missionCounts.activeWeekly} active - ${missionCounts.weekly} total)` : "Weekly (not returned)"],
                                    ["events", `Events (${eventContracts.length})`],
                                    ["contracts", `Contracts (${progressionContracts.length})`],
                                    ["onboarding", `Onboarding (${missionCounts.activeOnboarding} active / ${missionCounts.onboarding} total)`],
                                    ["other", `Other Missions (${missionCounts.activeOther} active / ${missionCounts.other} total)`],
                                ] as Array<[ProgressTab, string]>).map(([tab, label]) => (
                                    <button
                                        key={tab}
                                        type="button"
                                        className={progressTab === tab ? "is-active" : ""}
                                        onClick={() => setProgressTab(tab)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="rank-card-body p-3">
                                <div className="progress-command-grid" aria-label="Progress overview">
                                    <button type="button" className="progress-command-panel progress-command-panel--daily" onClick={() => setProgressTab("daily")}>
                                        <div className="progress-command-top">
                                            <span>Daily Checkpoints</span>
                                            <strong>{hasMissionRows ? `${dailyCheckpointSummary.completed}/${dailyCheckpointSummary.total}` : "--"}</strong>
                                        </div>
                                        <div className={`progress-mini-diamonds${hasMissionRows ? "" : " is-unknown"}`} aria-hidden="true">
                                            {Array.from({ length: Math.min(hasMissionRows ? dailyCheckpointSummary.total : 4, 6) }).map((_, i) => (
                                                <span key={i} className={i < dailyCheckpointSummary.completed ? "is-complete" : ""} />
                                            ))}
                                        </div>
                                        <small>{hasMissionRows ? (dailyResetLabel ? `Resets in ${dailyResetLabel}` : "Reset time unknown") : "Riot returned no daily rows"}</small>
                                    </button>
                                    <button type="button" className="progress-command-panel progress-command-panel--weekly" onClick={() => setProgressTab("weekly")}>
                                        <div className="progress-command-top">
                                            <span>Weekly Missions</span>
                                            <strong>{hasMissionRows ? `${missionCounts.activeWeekly} active` : "--"}</strong>
                                        </div>
                                        <div className="progress-command-meter">
                                            <span style={{ width: `${missionCounts.weekly ? ((missionCounts.weekly - missionCounts.activeWeekly) / missionCounts.weekly) * 100 : 0}%` }} />
                                        </div>
                                        <small>{hasMissionRows ? (weeklyRefillLabel ? `Refills in ${weeklyRefillLabel}` : "Weekly refill not returned") : "Riot returned no weekly rows"}</small>
                                    </button>
                                    <button
                                        type="button"
                                        className="progress-command-panel progress-command-panel--battlepass"
                                        onClick={() => {
                                            setProgressTab("battlepass");
                                            if (activeBattlepass?.id) setExpandedBattlepassId(activeBattlepass.id);
                                        }}
                                    >
                                        <div className="progress-command-top">
                                            <span>Battlepass</span>
                                            <strong>Tier {activeBattlepassLevel}</strong>
                                        </div>
                                        <div className="progress-command-meter">
                                            <span style={{ width: `${activeBattlepassPct}%` }} />
                                        </div>
                                        <small>{activeBattlepass ? "View full pass" : "No active pass returned"}</small>
                                    </button>
                                </div>
                                {isMissionProgressTab(progressTab) ? (
                                    <>
                                        {progressTab === "daily" && (
                                            <div className="daily-checkpoint-strip">
                                                <div className="daily-checkpoint-header">
                                                    <span className="daily-checkpoint-label">CHECKPOINTS</span>
                                                    <span className="daily-checkpoint-xp">
                                                        {hasMissionRows
                                                            ? `${dailyCheckpointSummary.completed} / ${dailyCheckpointSummary.total} complete${dailyCheckpointSummary.activeDailyMissions.length > 0 ? ` - ${dailyCheckpointSummary.activeDailyMissions.length} active` : " - all done"}`
                                                            : "No live daily mission rows returned"}
                                                    </span>
                                                </div>
                                                <div className="daily-checkpoint-diamonds" role="list">
                                                    {Array.from({ length: dailyCheckpointSummary.total }).map((_, i) => {
                                                        const isClaimed = i < dailyCheckpointSummary.completed;
                                                        const matchingMission = dailyCheckpointSummary.dailyMissions[i];
                                                        const mMeta = matchingMission ? missionsMeta[matchingMission.mission.ID.toLowerCase()] : null;
                                                        const label = matchingMission
                                                            ? `${mMeta?.title || "Daily"} · ${matchingMission.mission.Complete ? "Done" : "In Progress"}`
                                                            : `Checkpoint slot ${i + 1}`;
                                                        return (
                                                            <div
                                                                key={`checkpoint-${i}`}
                                                                role="listitem"
                                                                className={`daily-checkpoint-diamond${isClaimed ? " is-claimed" : ""}${matchingMission?.mission.Complete && !isClaimed ? " is-ready" : ""}`}
                                                                title={label}
                                                            >
                                                                <span className="daily-checkpoint-diamond-inner" />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {currentProgressMissions.length > 0 ? (
                                            <div className="missions-strip">
                                                {currentProgressMissions.map(({ mission, meta, current, target, pct }) => {
                                                    const ends = relativeCountdown(mission.ExpirationTime, nowMs);
                                                    const formattedXp = meta?.xp ? `+${meta.xp.toLocaleString()} XP` : "XP Reward";
                                                    return (
                                                        <div key={mission.ID} className={`mission-row clip-tactical-sm${mission.Complete ? " is-complete" : ""}`}>
                                                            <div className="mission-row-top">
                                                                <span className="mission-title">{meta?.title || "Valorant Mission"}</span>
                                                                <span className="mission-xp">{formattedXp}</span>
                                                            </div>
                                                            <div className="mission-desc">{meta?.description || "Riot Mission Objective"}</div>
                                                            <div className="mission-progress-wrap mt-2">
                                                                <div className="mission-progress-bar">
                                                                    <span style={{ width: `${pct}%` }} />
                                                                </div>
                                                                <div className="mission-progress-text">
                                                                    <span>{current.toLocaleString()} / {target.toLocaleString()}</span>
                                                                    {ends && <span className="mission-timer">{ends}</span>}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="progress-empty-state">
                                                <strong>
                                                    {!hasMissionRows
                                                        ? "Riot did not return mission rows for this account right now."
                                                        : progressTab === "weekly" && missionCounts.weekly > 0
                                                        ? "Weekly missions are complete."
                                                        : progressTab === "onboarding" && missionCounts.onboarding > 0
                                                            ? "Onboarding missions are complete."
                                                            : `No ${progressTab} missions showing right now.`}
                                                </strong>
                                                <span>{activeBattlepass ? "Battlepass progress is still available above." : "Completed missions still appear here when Riot returns them."}</span>
                                            </div>
                                        )}
                                    </>
                                ) : currentProgressContracts.length > 0 ? (
                                    <div className="contracts-strip progress-rail">
                                        {currentProgressContracts.map((contract) => {
                                            const meta = contractsMeta[contract.id.toLowerCase()];
                                            const isActiveSpecial = contract.id.toLowerCase() === activeSpecialId;
                                            const earned = Math.max(0, contract.totalProgressionEarned || 0);
                                            const target = Math.max(meta?.totalXp || 0, earned);
                                            const pct = target > 0 ? Math.max(0, Math.min(100, (earned / target) * 100)) : 0;
                                            const totalLevels = meta?.totalLevels || 0;
                                            const contractComplete = isContractComplete(contract);

                                            const levels = meta?.levels || [];
                                            let currentTierIndex = -1;
                                            for (let i = 0; i < levels.length; i++) {
                                                const lvlXp = Number((levels[i] as unknown as { xp?: number })?.xp || 0);
                                                if (earned >= lvlXp) currentTierIndex = i;
                                                else break;
                                            }
                                            const displayLevel = currentTierIndex >= 0
                                                ? currentTierIndex + 1
                                                : Math.max(1, contract.progressionLevelReached || 1);
                                            const nextLevelXp = currentTierIndex + 1 < levels.length
                                                ? Number((levels[currentTierIndex + 1] as unknown as { xp?: number })?.xp || 0)
                                                : null;
                                            const currentLevelXp = currentTierIndex >= 0 && currentTierIndex < levels.length
                                                ? Number((levels[currentTierIndex] as unknown as { xp?: number })?.xp || 0)
                                                : 0;
                                            const intoLevel = Math.max(0, earned - currentLevelXp);
                                            const xpForNext = nextLevelXp != null ? Math.max(0, nextLevelXp - earned) : null;
                                            const claimedLevelCount = levels.length > 0
                                                ? Math.max(0, Math.min(levels.length, currentTierIndex + 1))
                                                : Math.max(0, contract.progressionLevelReached || 0);
                                            const remainingLevelCount = totalLevels > 0 ? Math.max(0, totalLevels - claimedLevelCount) : 0;
                                            const nextRewardLevel = currentTierIndex + 1 < levels.length ? currentTierIndex + 2 : null;
                                            const statusLabel = contractComplete
                                                ? "Completed"
                                                : isActiveSpecial
                                                    ? "Current"
                                                    : "In progress";

                                            const stripStart = Math.max(0, currentTierIndex - 4);
                                            const stripEnd = Math.min(levels.length, Math.max(currentTierIndex + 10, 12));
                                            const isBattlepassView = progressTab === "battlepass";
                                            const isBattlepassExpanded = isBattlepassView && expandedBattlepassId === contract.id;
                                            const displayedLevels = isBattlepassExpanded ? levels : levels.slice(stripStart, stripEnd);
                                            const cosmeticTiers: Array<{
                                                tierNumber: number;
                                                xp: number;
                                                label: string;
                                                uuid: string;
                                                isCurrent: boolean;
                                                isClaimed: boolean;
                                                isFuture: boolean;
                                                type: string;
                                            }> = [];
                                            const currencyTiers: Array<{
                                                tierNumber: number;
                                                xp: number;
                                                amount: number;
                                                isCurrent: boolean;
                                                isClaimed: boolean;
                                                isFuture: boolean;
                                            }> = [];
                                            displayedLevels.forEach((lvl, idx) => {
                                                const realIndex = isBattlepassExpanded ? idx : stripStart + idx;
                                                const r = (lvl as unknown as { reward?: { type?: string; uuid?: string; amount?: number } })?.reward;
                                                const type = r?.type || "";
                                                const xpVal = Number((lvl as unknown as { xp?: number })?.xp || 0);
                                                const isCurrent = realIndex === currentTierIndex;
                                                const isClaimed = realIndex < currentTierIndex;
                                                const isFuture = realIndex > currentTierIndex;
                                                if (type === "Currency") {
                                                    currencyTiers.push({
                                                        tierNumber: realIndex + 1,
                                                        xp: xpVal,
                                                        amount: Number(r?.amount || 0),
                                                        isCurrent,
                                                        isClaimed,
                                                        isFuture,
                                                    });
                                                } else {
                                                    cosmeticTiers.push({
                                                        tierNumber: realIndex + 1,
                                                        xp: xpVal,
                                                        label: rewardLabel(type),
                                                        uuid: r?.uuid || "",
                                                        isCurrent,
                                                        isClaimed,
                                                        isFuture,
                                                        type,
                                                    });
                                                }
                                            });

                                            const endLabel = relativeCountdown(meta?.expirationDate, nowMs);

                                            return (
                                                <div
                                                    key={contract.id}
                                                    className={`contract-item-container progress-item-card${isBattlepassExpanded ? " contract-item-container--full" : ""}${isBattlepassView ? " contract-item-container--clickable" : ""}${isActiveSpecial ? " contract-item-container--active" : ""}${contractComplete ? " contract-item-container--complete" : ""}`}
                                                    onClick={isBattlepassView ? () => setExpandedBattlepassId(isBattlepassExpanded ? "" : contract.id) : undefined}
                                                    onKeyDown={isBattlepassView ? (event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setExpandedBattlepassId(isBattlepassExpanded ? "" : contract.id);
                                                        }
                                                    } : undefined}
                                                >
                                                    <div className="contract-item-top">
                                                        {meta?.icon ? (
                                                            <img src={meta.icon} alt="" className="contract-item-icon" />
                                                        ) : (
                                                            <div className="contract-item-icon contract-item-icon--fallback">{(meta?.name || "C").slice(0, 1)}</div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="contract-item-name">{meta?.name || (isActiveSpecial ? "Battlepass" : "Contract")}</div>
                                                            <div className="contract-item-meta">
                                                                {isActiveSpecial ? "Active battlepass" : meta?.relationType || "Progression"}
                                                                {endLabel && <span className="contract-item-timer"> - {endLabel}</span>}
                                                            </div>
                                                        </div>
                                                        <span className={`contract-status-chip${contractComplete ? " is-complete" : isActiveSpecial ? " is-current" : ""}`}>
                                                            {isBattlepassExpanded ? "Full pass" : statusLabel}
                                                        </span>
                                                    </div>
                                                    <div className="contract-progress-summary" aria-label="Contract progress summary">
                                                        <span><strong>{claimedLevelCount}</strong> claimed</span>
                                                        <span><strong>{displayLevel}</strong> current</span>
                                                        <span><strong>{remainingLevelCount}</strong> next</span>
                                                    </div>
                                                    <div className="contract-item-levels">
                                                        <span className="contract-item-level">
                                                            Level {displayLevel}{totalLevels ? ` / ${totalLevels}` : ""}
                                                        </span>
                                                        <span className="contract-item-xp">
                                                            {earned.toLocaleString()} XP{target > earned ? ` / ${target.toLocaleString()}` : ""}
                                                        </span>
                                                    </div>
                                                    <div className="rank-progress-wrap mt-2">
                                                        <div className="rank-progress" style={{ height: "8px" }}>
                                                            <div className="rank-progress-fill" style={{ width: `${pct}%`, backgroundColor: isActiveSpecial ? "var(--accent)" : "var(--green)" }} />
                                                        </div>
                                                    </div>
                                                    <div className="contract-item-foot">
                                                        <span className="contract-item-next">
                                                            {contractComplete
                                                                ? "All rewards claimed"
                                                                : xpForNext != null && xpForNext > 0
                                                                ? `${xpForNext.toLocaleString()} XP to next reward`
                                                                : intoLevel > 0
                                                                    ? `${intoLevel.toLocaleString()} XP into this level`
                                                                    : "Maxed out"}
                                                        </span>
                                                        <span className="contract-item-progress-foot">{nextRewardLevel ? `Next T${nextRewardLevel}` : "Complete"}</span>
                                                    </div>

                                                    {cosmeticTiers.length > 0 && (
                                                        <div className="contract-tier-row" aria-label="Cosmetic tier rewards">
                                                            <div className="contract-tier-row-label">Prizes</div>
                                                            <div className="contract-tier-grid" role="list">
                                                                {cosmeticTiers.map((tier) => (
                                                                    <div
                                                                        key={`cosmetic-${tier.tierNumber}`}
                                                                        role="listitem"
                                                                        className={`contract-tier${tier.isCurrent ? " is-current" : ""}${tier.isClaimed ? " is-claimed" : ""}`}
                                                                        title={`Tier ${tier.tierNumber} · ${tier.label} · ${tier.xp.toLocaleString()} XP`}
                                                                    >
                                                                        <div className="contract-tier-icon">
                                                                            {tier.isClaimed ? (
                                                                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                                                                    <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                                                                </svg>
                                                                            ) : (
                                                                                <ContractRewardIcon rewardType={tier.label} uuid={tier.uuid} />
                                                                            )}
                                                                        </div>
                                                                        <span className="contract-tier-label">T{tier.tierNumber}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {currencyTiers.length > 0 && (
                                                        <div className="contract-tier-row" aria-label="Currency rewards">
                                                            <div className="contract-tier-row-label">Radianite / Currency</div>
                                                            <div className="contract-currency-strip" role="list">
                                                                {currencyTiers.map((tier) => (
                                                                    <div
                                                                        key={`currency-${tier.tierNumber}`}
                                                                        role="listitem"
                                                                        className={`contract-currency-chip${tier.isCurrent ? " is-current" : ""}${tier.isClaimed ? " is-claimed" : ""}`}
                                                                        title={`Tier ${tier.tierNumber} · ${tier.amount} · ${tier.xp.toLocaleString()} XP`}
                                                                    >
                                                                        <span className="contract-currency-symbol" aria-hidden="true">◆</span>
                                                                        <span className="contract-currency-num">+{tier.amount}</span>
                                                                        <span className="contract-currency-tier">T{tier.tierNumber}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="progress-empty-state">
                                        <strong>No active {progressTab === "battlepass" ? "battlepass" : "contract"} progress found.</strong>
                                        <span>
                                            {completedContractCount > 0
                                                ? `${completedContractCount} completed contract${completedContractCount === 1 ? "" : "s"} hidden from the active view.`
                                                : "Connect a refreshed Riot session or play a match, then refresh Profile."}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </TacticalPanel>
                    )}

                    {activeLayoutView === "SOCIAL" && (
                        <div className="row">
                            <div className="col-md-6 mb-4">
                                <FriendPresenceList
                                    socialStatus={socialStatus}
                                    region={currentRegion}
                                    onSelectPlayer={(puid, reg) => {
                                        setSelectedPuuid(puid);
                                        setSelectedRegion(reg);
                                    }}
                                />
                            </div>
                            <div className="col-md-6 mb-4">
                                {renderPartyCard()}
                            </div>
                        </div>
                    )}

                    {activeLayoutView === "CAREER" && rrHistory && (
                        <TacticalPanel 
                            title="Recent RR" 
                            subtitle={`${rrHistory.snapshots?.length ?? 0} ranked games`} 
                            className="mb-4 profile-rr-module"
                        >
                            <div className="rank-card-body p-3">
                                <RRHistoryChart snapshots={rrHistory.snapshots ?? []} />
                            </div>
                        </TacticalPanel>
                    )}

                    {(activeLayoutView === "OVERVIEW" || activeLayoutView === "MATCHES") && (
                        <TacticalPanel 
                            title="Recent Matches (Full Details)" 
                            subtitle={`${total} total`}
                        >
                            <div className="rank-card-body p-3">
                                {(() => {
                                    const inQueue =
                                        liveStatus?.phase === "pregame" ||
                                        partyStatus?.phase === "matchmaking" ||
                                        partyStatus?.phase === "pregame";
                                    if (!inQueue) return null;
                                    const nextQueue = liveStatus?.queueId || partyStatus?.queueId || "Queue";
                                    const nextMap = maps[liveStatus?.mapId?.toLowerCase?.() || ""]?.name
                                        || liveStatus?.mapId?.slice(0, 12);
                                    return (
                                        <div className="match-next-up-banner">
                                            <span className="match-next-up-kicker">NEXT UP</span>
                                            <div className="match-next-up-body">
                                                <strong>{QUEUE_LABEL[nextQueue] || nextQueue}</strong>
                                                {nextMap && <span className="match-next-up-meta">{nextMap}</span>}
                                            </div>
                                            <span className="match-next-up-pulse" aria-hidden="true" />
                                        </div>
                                    );
                                })()}
                                {loading && history.length === 0 ? (
                                    <div className="text-secondary py-4">Loading cached profile...</div>
                                ) : history.length === 0 ? (
                                    <div className="text-secondary py-4">
                                        {syncStatus?.inFlight || syncing ? "Syncing match history..." : "No matches cached yet."}
                                    </div>
                                ) : (
                                    <div className="match-history-list">
                                {(activeLayoutView === "OVERVIEW" ? history.slice(0, 5) : history).map((match) => (
                                            <MatchRow
                                                key={match.matchId}
                                                match={match}
                                                detail={details[match.matchId]}
                                                expanded={expanded.has(match.matchId)}
                                                loading={loadingDetails.has(match.matchId)}
                                                agents={agents}
                                                maps={maps}
                                                tierAssets={tierAssets}
                                                onToggle={() => toggleDetails(match.matchId)}
                                                onSelectPlayer={(puid, reg) => {
                                                    setSelectedPuuid(puid);
                                                    setSelectedRegion(reg);
                                                }}
                                                localRegion={currentRegion}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </TacticalPanel>
                    )}

                </div>

                <div className="profile-side-column-v2">
                    {activeLayoutView === "OVERVIEW" && renderActiveLoadoutCard()}

                    {activeLayoutView !== "SOCIAL" && (
                        <TacticalPanel className="mb-4">
                            <FriendPresenceList
                                socialStatus={socialStatus}
                                region={currentRegion}
                                onSelectPlayer={(puid, reg) => {
                                    setSelectedPuuid(puid);
                                    setSelectedRegion(reg);
                                }}
                            />
                        </TacticalPanel>
                    )}

                    {activeLayoutView === "OVERVIEW" && renderPartyCard()}
                    
                    {(activeLayoutView === "OVERVIEW" || activeLayoutView === "CAREER") && (
                        <>
                            <TacticalPanel title="Agent Stats" subtitle={QUEUE_LABEL[queue] || "All queues"} className="mb-4">
                                <AgentStatsTable agents={agentStats?.agents ?? []} agentLookup={agentLookup} emptyMessage="No agent stats cached yet." />
                            </TacticalPanel>
                            <TacticalPanel title="Acts Summary" subtitle="Rank history" className="mb-4">
                                <ActSummaryList acts={overview?.rankActs ?? []} currentSeasonId={overview?.currentSeasonId ?? ""} tierAssets={tierAssets} />
                            </TacticalPanel>
                            <TacticalPanel title="Map Stats" subtitle={QUEUE_LABEL[queue] || "All queues"} className="mb-0">
                                <MapStatsTable maps={mapStats?.maps ?? []} mapLookup={mapLookup} emptyMessage="No map stats cached yet." />
                            </TacticalPanel>
                        </>
                    )}
                </div>
            </div>
            </div>
        </div>
    );
}

function FriendPresenceList({
    socialStatus,
    region,
    onSelectPlayer,
}: {
    socialStatus: SocialStatusResponse | null;
    region: string;
    onSelectPlayer: (puuid: string, region: string) => void;
}) {
    const isAvailable = socialStatus?.status === "ok";
    const allPresences = socialStatus?.presences ?? [];
    const online = allPresences.filter((p) => p.state && p.state.toLowerCase() !== "offline");
    const offline = allPresences.filter((p) => p.state && p.state.toLowerCase() === "offline");
    const [showOffline, setShowOffline] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const sourceLabel = socialStatus?.source === "local"
        ? "Local roster"
        : socialStatus?.remoteStatus === "config"
            ? "Token config"
            : "Token";
    const remoteDetail = socialStatus?.remoteChatHost
        ? `${socialStatus.remoteChatHost}${socialStatus.remoteChatPort ? `:${socialStatus.remoteChatPort}` : ""}`
        : "";

    return (
        <div className="friend-presence-panel" aria-label="Friend presence">
            <div className="friend-presence-header">
                <div>
                    <span>Friend Presence</span>
                    <small>
                        {isAvailable
                            ? `${sourceLabel} · ${socialStatus?.onlineCount ?? 0}/${socialStatus?.friendCount ?? 0} online`
                            : socialStatus?.remoteStatus === "config"
                                ? `${sourceLabel} ready`
                                : `${sourceLabel} unavailable`}
                    </small>
                    {remoteDetail && <small className="friend-presence-remote">{remoteDetail}</small>}
                </div>
                <div className="friend-presence-header-actions">
                    {isAvailable && (
                        <span className="friend-presence-count">{socialStatus?.inGameCount ?? 0} in VALORANT</span>
                    )}
                    {isAvailable && allPresences.length > 0 && (
                        <button
                            type="button"
                            className="friend-presence-toggle"
                            onClick={() => setCollapsed((v) => !v)}
                            title={collapsed ? "Expand friend list" : "Collapse friend list"}
                            aria-expanded={!collapsed}
                        >
                            {collapsed ? "▾" : "▴"}
                        </button>
                    )}
                </div>
            </div>
            {!isAvailable ? (
                <div className="friend-presence-empty">
                    {socialStatus?.remoteStatus === "config"
                        ? "Riot chat host resolved. Live roster still needs local Riot Client or XMPP support."
                        : socialStatus?.error || "Token can resolve chat config; live roster still needs local Riot Client or XMPP."}
                </div>
            ) : collapsed ? (
                <div className="friend-presence-empty">Friend list collapsed.</div>
            ) : allPresences.length === 0 ? (
                <div className="friend-presence-empty">No friends on this account yet.</div>
            ) : (
                <>
                    {online.length > 0 && (
                        <div className="friend-presence-list">
                            {online.map((presence, index) => {
                                const name = presence.name || (presence.puuid ? `Player ${presence.puuid.slice(0, 8)}` : "Unknown friend");
                                const canOpen = Boolean(presence.puuid);
                                return (
                                    <button
                                        key={presence.puuid || `online-${name}-${index}`}
                                        type="button"
                                        className="friend-presence-row"
                                        onClick={() => {
                                            if (presence.puuid) onSelectPlayer(presence.puuid, region);
                                        }}
                                        disabled={!canOpen}
                                        title={canOpen ? "Open cached profile for this player" : "No PUUID returned for this presence"}
                                    >
                                        <span className={`friend-presence-dot${presence.product?.toLowerCase() === "valorant" ? " is-valorant" : ""}`} aria-hidden="true" />
                                        <span className="friend-presence-main">
                                            <strong>{name}</strong>
                                            <small>
                                                {presence.product || "Online"}
                                                {presence.queueId ? ` · ${QUEUE_LABEL[presence.queueId] || presence.queueId}` : ""}
                                            </small>
                                        </span>
                                        <span className="friend-presence-state">{presence.state || "online"}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {offline.length > 0 && (
                        <div className="friend-presence-offline-section">
                            <button
                                type="button"
                                className="friend-presence-offline-toggle"
                                onClick={() => setShowOffline((v) => !v)}
                                aria-expanded={showOffline}
                            >
                                {showOffline ? "▾" : "▸"} {offline.length} offline
                            </button>
                            {showOffline && (
                                <div className="friend-presence-list friend-presence-list--offline">
                                    {offline.map((presence, index) => {
                                        const name = presence.name || (presence.puuid ? `Player ${presence.puuid.slice(0, 8)}` : "Unknown friend");
                                        const canOpen = Boolean(presence.puuid);
                                        return (
                                            <button
                                                key={presence.puuid || `offline-${name}-${index}`}
                                                type="button"
                                                className="friend-presence-row friend-presence-row--offline"
                                                onClick={() => {
                                                    if (presence.puuid) onSelectPlayer(presence.puuid, region);
                                                }}
                                                disabled={!canOpen}
                                                title={canOpen ? "Open cached profile for this player" : "No PUUID returned for this presence"}
                                            >
                                                <span className="friend-presence-dot" aria-hidden="true" />
                                                <span className="friend-presence-main">
                                                    <strong>{name}</strong>
                                                    <small>offline</small>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function MatchRow({
    match,
    detail,
    expanded,
    loading,
    agents,
    maps,
    tierAssets,
    onToggle,
    onSelectPlayer,
    localRegion,
}: {
    match: ProfileMatchSummary;
    detail?: ProfileMatchDetails;
    expanded: boolean;
    loading: boolean;
    agents: Record<string, AgentMeta>;
    maps: Record<string, MapMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onToggle: () => void;
    onSelectPlayer?: (puuid: string, region: string) => void;
    localRegion: string;
}) {
    const agentMeta = agents[match.localPlayer.characterId?.toLowerCase?.() || ""];
    const mapMeta = maps[match.mapID?.toLowerCase?.() || ""];
    const agentName = agentMeta?.name || match.localPlayer.characterId?.slice(0, 8) || "Agent";
    const mapName = mapMeta?.name || match.mapID?.slice(0, 8) || "Map";
    const result = match.win ? "WIN" : "LOSS";
    const resultClass = match.win ? "win" : "loss";
    const queueName = QUEUE_LABEL[match.queueID] || match.queueID || "Queue";

    const matchTier = match.tierAfter ?? 0;
    const matchRRIcon = rankIconUrl(matchTier, tierAssets);
    const matchRRLabel = tierLabel(matchTier);
    const rrEarned = match.rrEarned ?? 0;
    const rrSign = rrEarned > 0 ? "+" : rrEarned < 0 ? "" : "±";
    const rrClass = rrEarned > 0 ? "rr-gain" : rrEarned < 0 ? "rr-loss" : "rr-neutral";

    // Compact stat cells so the row stays one line on desktop.
    const kda = match.localPlayer.kda;
    const hsPct = match.localPlayer.hsPct;
    const adr = Math.round(match.localPlayer.adr || 0);
    const acs = Math.round(match.localPlayer.acs || 0);
    const kdaText = `${match.localPlayer.kills}/${match.localPlayer.deaths}/${match.localPlayer.assists}`;

    return (
        <div className={`match-card-wrap ${expanded ? "expanded" : ""}`}>
            <button
                type="button"
                className={`match-history-row clip-tactical-sm ${resultClass}`}
                onClick={onToggle}
                aria-expanded={expanded}
            >
                {mapMeta?.splash && (
                    <div
                        className="match-row-bg-crop"
                        style={{ backgroundImage: `url(${mapMeta.splash})` }}
                    />
                )}
                <div className="match-row-scrim" aria-hidden="true" />

                {/* Result / map thumbnail block */}
                <div className="match-result-block">
                    <div className={`match-result-badge ${resultClass}`}>
                        <span className="match-result-text">{result}</span>
                        <span className="match-result-meta">
                            {queueName} · {fmtLength(match.gameLengthMillis)}
                        </span>
                    </div>
                    {mapMeta?.splash ? (
                        <div
                            className="match-map-thumb"
                            style={{ backgroundImage: `url(${mapMeta.splash})` }}
                            aria-label={mapName}
                        />
                    ) : (
                        <div className="match-map-thumb match-map-thumb--fallback" />
                    )}
                </div>

                {/* Agent + map */}
                <div className="match-agent">
                    {agentMeta?.icon ? (
                        <Image src={agentMeta.icon} alt={agentName} width={44} height={44} unoptimized className="match-agent-icon" />
                    ) : (
                        <div className="match-agent-icon match-agent-placeholder" />
                    )}
                    <div className="match-agent-meta">
                        <div className="match-agent-name">{agentName}</div>
                        <div className="match-map-name">{mapName}</div>
                    </div>
                </div>

                {/* Stats grid: KDA / HS% / ADR / ACS */}
                <div className="match-stats">
                    <div className="match-stat">
                        <span className="match-stat-kicker">KDA</span>
                        <strong className="match-stat-value">{kdaText}</strong>
                        <span className={`match-stat-sub ${kdColor(kda)}`}>{fmtRatio(kda)}</span>
                    </div>
                    <div className="match-stat">
                        <span className="match-stat-kicker">HS%</span>
                        <strong className={`match-stat-value ${hsColor(hsPct)}`}>{fmtPct(hsPct)}</strong>
                        <span className="match-stat-sub">
                            {(() => {
                                const lp = detail?.players?.find((p) => p.isLocal) ?? match.localPlayer;
                                const head = lp.headshots || 0;
                                const body = lp.bodyshots || 0;
                                const leg = lp.legshots || 0;
                                const total = head + body + leg;
                                if (total === 0) return "no shot data";
                                return `${head} / ${total} hits`;
                            })()}
                        </span>
                    </div>
                    <div className="match-stat">
                        <span className="match-stat-kicker">ADR</span>
                        <strong className={`match-stat-value ${adrColor(adr)}`}>{adr}</strong>
                        <span className="match-stat-sub">dmg / rd</span>
                    </div>
                    <div className="match-stat">
                        <span className="match-stat-kicker">ACS</span>
                        <strong className={`match-stat-value ${acsColor(acs)}`}>{acs}</strong>
                        <span className="match-stat-sub">score / rd</span>
                    </div>
                </div>

                {/* Rank + RR delta (only for ranked) or time */}
                {matchTier > 0 ? (
                    <div className="match-rank-rr-cell">
                        <div className="match-rank-rr-row">
                            {matchRRIcon && (
                                <Image src={matchRRIcon} alt={matchRRLabel} width={24} height={24} unoptimized className="match-rank-mini-icon" />
                            )}
                            <span className="match-rank-rr-name">{matchRRLabel}</span>
                        </div>
                        <div className={`match-rr-badge ${rrClass}`}>
                            <span>{rrSign}{rrEarned}</span>
                        </div>
                    </div>
                ) : (
                    <div className="match-meta">
                        <span className="match-queue">{queueName}</span>
                        <span className="match-time">{fmtDate(match.gameStartMillis)}</span>
                    </div>
                )}

                {/* Trailing expand chevron */}
                <div className="match-row-tail">
                    <span className="match-expand-btn" aria-hidden="true">
                        {expanded ? "▲" : loading ? "…" : "▼"}
                    </span>
                </div>
            </button>
            {expanded && (
                <div className="match-detail-panel clip-tactical-sm">
                    {loading ? (
                        <div className="text-secondary">Loading scoreboard…</div>
                    ) : detail ? (
                        <Scoreboard
                            detail={detail}
                            agents={agents}
                            tierAssets={tierAssets}
                            onSelectPlayer={onSelectPlayer}
                            localRegion={localRegion}
                        />
                    ) : (
                        <div className="text-secondary">No details cached for this match yet.</div>
                    )}
                </div>
            )}
        </div>
    );
}

function Scoreboard({
    detail,
    agents,
    tierAssets,
    onSelectPlayer,
    localRegion,
}: {
    detail: ProfileMatchDetails;
    agents: Record<string, AgentMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onSelectPlayer?: (puuid: string, region: string) => void;
    localRegion: string;
}) {
    const blue = detail.players.filter((p) => p.teamId === "Blue");
    const red = detail.players.filter((p) => p.teamId === "Red");
    const sortPlayers = (rows: typeof detail.players) =>
        [...rows].sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || b.score - a.score || b.kills - a.kills);

    // Calculate MVP (highest ACS in the game)
    const mvpPlayer = useMemo(() => {
        if (!detail.players.length) return null;
        return [...detail.players].reduce((max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max), detail.players[0]);
    }, [detail.players]);

    // Calculate Team MVP for the opposing team
    const teamMvpPlayer = useMemo(() => {
        if (!mvpPlayer || !detail.players.length) return null;
        const opposingTeamPlayers = detail.players.filter((p) => p.teamId !== mvpPlayer.teamId);
        if (!opposingTeamPlayers.length) return null;
        return opposingTeamPlayers.reduce((max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max), opposingTeamPlayers[0]);
    }, [detail.players, mvpPlayer]);

    const localPlayer = detail.players.find((p) => p.isLocal);
    const localTeam = localPlayer?.teamId || "Blue";

    return (
        <div className="scoreboard-grid">
            <ScoreTeam
                title="Blue"
                won={detail.matchInfo.blueWins}
                score={detail.matchInfo.blueRoundsWon}
                players={sortPlayers(blue)}
                agents={agents}
                mvpPlayer={mvpPlayer}
                teamMvpPlayer={teamMvpPlayer}
                localTeam={localTeam}
                tierAssets={tierAssets}
                onSelectPlayer={onSelectPlayer}
                localRegion={localRegion}
            />
            <ScoreTeam
                title="Red"
                won={!detail.matchInfo.blueWins}
                score={detail.matchInfo.redRoundsWon}
                players={sortPlayers(red)}
                agents={agents}
                mvpPlayer={mvpPlayer}
                teamMvpPlayer={teamMvpPlayer}
                localTeam={localTeam}
                tierAssets={tierAssets}
                onSelectPlayer={onSelectPlayer}
                localRegion={localRegion}
            />
        </div>
    );
}

function ScoreTeam({
    title,
    won,
    score,
    players,
    agents,
    mvpPlayer,
    teamMvpPlayer,
    localTeam,
    tierAssets,
    onSelectPlayer,
    localRegion,
}: {
    title: string;
    won: boolean;
    score: number;
    players: ProfileMatchDetails["players"];
    agents: Record<string, AgentMeta>;
    mvpPlayer: ProfilePlayerStats | null;
    teamMvpPlayer: ProfilePlayerStats | null;
    localTeam: string;
    tierAssets: Map<number, { smallIcon: string }>;
    onSelectPlayer?: (puuid: string, region: string) => void;
    localRegion: string;
}) {
    return (
        <div className="score-team">
            <div className="score-team-header">
                <span>{title} Team</span>
                <strong className={won ? "wr-good" : "wr-bad"}>{score}</strong>
            </div>
            <table className="score-table">
                <thead>
                    <tr>
                        <th>Agent</th>
                        <th>K/D/A</th>
                        <th>ACS / ADR</th>
                        <th>HS%</th>
                    </tr>
                </thead>
                <tbody>
                    {players.map((p, idx) => {
                        const meta = agents[p.characterId?.toLowerCase?.() || ""];
                        const isTeammate = p.teamId === localTeam;
                        const suffix = p.isLocal ? "" : isTeammate ? " (Teammate)" : " (Enemy)";
                        
                        const name = p.gameName
                            ? `${p.gameName}${p.tagLine ? `#${p.tagLine}` : ""}`
                            : p.isLocal
                                ? "You"
                                : `${meta?.name || "Player"}${suffix}`;
                        
                        const isMvp = mvpPlayer && mvpPlayer.characterId === p.characterId && mvpPlayer.teamId === p.teamId;
                        const isTeamMvp = teamMvpPlayer && teamMvpPlayer.characterId === p.characterId && teamMvpPlayer.teamId === p.teamId;
                        const rankIcon = rankIconUrl(p.competitiveTier, tierAssets);

                        return (
                            <tr key={`${p.characterId}-${idx}`} className={p.isLocal ? "is-local" : ""}>
                                <td>
                                    <span className="score-player-cell">
                                        {meta?.icon ? (
                                            <Image src={meta.icon} alt={meta.name} width={24} height={24} unoptimized className="score-agent-icon" />
                                        ) : (
                                            <span className="score-agent-icon score-agent-placeholder" />
                                        )}
                                        <span>
                                            <span className="d-flex align-items-center gap-1">
                                                {rankIcon ? (
                                                    <Image
                                                        src={rankIcon}
                                                        alt={tierLabel(p.competitiveTier, "Rank")}
                                                        width={18}
                                                        height={18}
                                                        unoptimized
                                                        className="score-rank-icon"
                                                    />
                                                ) : null}
                                                <button
                                                    type="button"
                                                    className="btn-link-tac text-start p-0 border-0 bg-transparent text-white score-player-btn"
                                                    onClick={() => p.subject && onSelectPlayer?.(p.subject, localRegion)}
                                                    style={{ textDecoration: "none" }}
                                                >
                                                    {name}
                                                </button>
                                                {isMvp && <span className="mvp-badge">MVP</span>}
                                                {isTeamMvp && <span className="team-mvp-badge">Team MVP</span>}
                                            </span>
                                            <small>{meta?.name || "Agent"}</small>
                                        </span>
                                    </span>
                                </td>
                                <td>
                                    <div>{p.kills}/{p.deaths}/{p.assists}</div>
                                    <div className={`score-stat-sub ${kdColor(p.kd)}`}>{fmtRatio(p.kd)} KD</div>
                                </td>
                                <td>
                                    <div className={acsColor(p.acs)}>{Math.round(p.acs || 0)}</div>
                                    <div className={`score-stat-sub ${adrColor(p.adr)}`}>{Math.round(p.adr || 0)} ADR</div>
                                </td>
                                <td>
                                    <span className={hsColor(p.hsPct)} title={`${p.headshots} headshots / ${p.bodyshots} bodyshots / ${p.legshots} legshots`}>
                                        {fmtPct(p.hsPct)}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function ActSummaryList({
    acts,
    currentSeasonId,
    tierAssets,
}: {
    acts: Array<{ seasonId: string; wins: number; games: number; rankedRating: number; peakRank: number; finalRank: number }>;
    currentSeasonId: string;
    tierAssets: Map<number, { smallIcon: string }>;
}) {
    if (!acts.length) {
        return <div className="stats-table-empty">No live act rank data yet.</div>;
    }
    return (
        <div className="act-summary-list">
            {acts.map((act) => {
                const label = act.seasonId === currentSeasonId ? "Current Act" : `Act ${act.seasonId.slice(0, 8)}`;
                const rank = act.finalRank || act.peakRank;
                const winrate = act.games > 0 ? (act.wins / act.games) * 100 : 0;
                const rankIcon = rankIconUrl(rank, tierAssets);
                return (
                    <div key={act.seasonId} className="act-summary-row">
                        <div className="d-flex align-items-center gap-2">
                            {rankIcon ? (
                                <Image
                                    src={rankIcon}
                                    alt={tierLabel(rank, "Rank")}
                                    width={24}
                                    height={24}
                                    unoptimized
                                    className="act-summary-row-icon"
                                />
                            ) : (
                                <div className="act-summary-row-icon rank-icon-placeholder" style={{ width: 24, height: 24 }} />
                            )}
                            <div>
                                <strong>{label}</strong>
                                <span>{act.games} games / {act.wins} wins / {fmtPct(winrate)}</span>
                            </div>
                        </div>
                        <div>
                            <strong>{tierLabel(rank, "Rank")}</strong>
                            <span>{act.rankedRating || 0} RR / Peak {tierLabel(act.peakRank, "Rank")}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
