"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import type { Agent } from "@/lib/types";
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

interface Props {
    onConnectAccount?: () => void;
}

interface AgentMeta {
    name: string;
    icon: string;
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
    // `level.reward.type` (no image lookup yet — that needs a
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

type ProgressTab = "daily" | "weekly" | "battlepass" | "events" | "contracts";

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
// up front — valorant-api.com returns it from a per-uuid endpoint —
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
        case "Spray": return "✦";
        case "Title": return "T";
        case "Currency": return "✦";
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

/* ── Stat colour tiers ── */
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
// the actual reward image here — that needs a per-uuid
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
    const { activeAccount, isBackendOnline, isClientHealthy } = useData();
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
    const [progressTab, setProgressTab] = useState<ProgressTab>("daily");
    const [liveStatus, setLiveStatus] = useState<LiveMatchResponse | null>(null);
    const [partyStatus, setPartyStatus] = useState<PartyStatusResponse | null>(null);
    const [loadoutStatus, setLoadoutStatus] = useState<LiveLoadoutsResponse | null>(null);
    const [accountHealth, setAccountHealth] = useState<AccountHealthResponse | null>(null);
    const [socialStatus, setSocialStatus] = useState<SocialStatusResponse | null>(null);
    const [liveUpdatedAt, setLiveUpdatedAt] = useState(0);

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
                    // the catalog — using it as the target made every
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
                getPlayerLoadoutData().catch(() => null),
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
            if (st?.lastError) setError(cleanError(st.lastError));
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setLoading(false);
        }
    }, [opts, pageSize, currentPuuid, queue]);

    useEffect(() => {
        autoSyncPuuidRef.current = "";
        setDetails({});
        setExpanded(new Set());
    }, [puuid]);

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
            await postProfileSync(opts);
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
    const peakRankIcon = rankIconUrl(peakTier, tierAssets);
    const summary = overview?.seasonSummary;
    const isBusy = loading || syncing || !!syncStatus?.inFlight;
    const topAgentMeta = summary?.topAgentCharacterId ? agents[summary.topAgentCharacterId.toLowerCase()] : undefined;
    const lastDelta = overview?.lastDeltas?.[0];
    const rrMovement = lastDelta ? `${lastDelta.rrEarned >= 0 ? "+" : ""}${lastDelta.rrEarned} RR` : "--";

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

    const cardData = identity?.playerCardId ? playerCards[identity.playerCardId.toLowerCase()] : null;
    const titleText = identity?.playerTitleId ? playerTitles[identity.playerTitleId.toLowerCase()] : "";
    const visibleMissions = useMemo(() => {
        return [...(missions?.Missions ?? [])].sort((a, b) => {
            if (a.Complete !== b.Complete) return a.Complete ? 1 : -1;
            return a.ID.localeCompare(b.ID);
        });
    }, [missions]);
    const missionWithMeta = useMemo(() => {
        return visibleMissions.map((mission) => {
            const meta = missionsMeta[mission.ID.toLowerCase()];
            // Normalize type from the catalog. The catalog returns
            // values like "Daily", "Weekly", "BTE", "Tutorial", "NPE".
            // We bucket everything that's NOT Weekly into "daily"
            // since BTE / Tutorial / NPE are daily-tier missions
            // from the player's perspective.
            const rawType = (meta?.type || "").toLowerCase();
            const type: "daily" | "weekly" = rawType.includes("weekly") ? "weekly" : "daily";

            // Target priority:
            //   1. Catalog's target (sum of objectives[].value, set by the
            //      metadata fetch above — fixed to no longer use the
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
    }, [missionsMeta, visibleMissions]);
    const missionCounts = useMemo(() => {
        const complete = visibleMissions.filter((mission) => mission.Complete).length;
        return {
            complete,
            active: visibleMissions.length - complete,
            total: visibleMissions.length,
            daily: missionWithMeta.filter((mission) => mission.type === "daily").length,
            weekly: missionWithMeta.filter((mission) => mission.type === "weekly").length,
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
    const currentProgressMissions = progressTab === "weekly"
        ? missionWithMeta.filter((mission) => mission.type === "weekly")
        : missionWithMeta.filter((mission) => mission.type === "daily");

    // Daily checkpoint summary: 4 diamond slots, filled = completed daily.
    // Mirrors the in-game Daily Checkpoints UI from the player-facing
    // missions screen.
    const dailyCheckpointSummary = useMemo(() => {
        const dailyMissions = missionWithMeta.filter((m) => m.type === "daily");
        const completed = dailyMissions.filter((m) => m.mission.Complete).length;
        // The in-game UI always shows 4 diamond slots for daily
        // checkpoints regardless of how many dailies Riot currently
        // returns, so we mirror that. If we got more than 4, show
        // the higher number so nothing gets hidden.
        const slots = Math.max(4, dailyMissions.length);
        return { completed, total: slots, dailyMissions };
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
    const liveLoadoutPlayers = loadoutStatus?.players?.length ?? 0;
    const liveLoadoutSkins = loadoutStatus?.players?.reduce((sum, player) => sum + (player.skinIds?.length ?? 0), 0) ?? 0;
    const serviceList = Object.values(accountHealth?.services ?? {});
    const serviceWarnCount = serviceList.filter((service) => !["ok", "unknown"].includes((service.status || "").toLowerCase())).length;
    const serviceOkCount = serviceList.filter((service) => (service.status || "").toLowerCase() === "ok").length;
    const ticker = accountHealth?.services?.ticker;

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

            <section
                className="profile-header clip-tactical mb-4"
                style={cardData?.wide ? { backgroundImage: `url(${cardData.wide})` } : undefined}
            >
                <div className="profile-header-identity">
                    {cardData?.icon ? (
                        <img src={cardData.icon} alt="Player Card" className="profile-avatar" />
                    ) : (
                        <div className="profile-avatar" />
                    )}
                    <div>
                        <div className="text-uppercase text-secondary small fw-bold">
                            {selectedPuuid ? "Shared Player Profile" : "Private local profile"}
                        </div>
                        <h1 className="profile-title mb-1">
                            {selectedPuuid && overview?.gameName
                                ? `${overview.gameName}`
                                : activeAccount?.gameName || "Unknown"}
                            <span>
                                #{selectedPuuid && overview?.tagLine
                                    ? overview.tagLine
                                    : activeAccount?.tagLine || ""}
                            </span>
                        </h1>
                        {titleText && <div className="profile-title-text">{titleText}</div>}
                        <div className="profile-subline">
                            <span>{region.toUpperCase()}</span>
                            <span>Level {overview?.account?.level || "--"}</span>
                            <span>Last sync {fmtDate(syncStatus?.lastSyncedAt || 0)}</span>
                            <span>{syncStatus?.totalMatches ?? total} cached matches</span>
                        </div>
                    </div>
                </div>
                <div className="profile-header-actions">
                    <select className="form-select form-select-sm bg-dark text-white border-secondary" value={queue} onChange={(e) => setQueue(e.target.value)}>
                        {QUEUE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <select className="form-select form-select-sm bg-dark text-white border-secondary" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                        {PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>{size} matches</option>
                        ))}
                    </select>
                    <button className="btn btn-outline-light btn-sm" onClick={refresh} disabled={isBusy}>
                        Refresh
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => runSync(true)} disabled={isBusy}>
                        {isBusy ? "Syncing..." : "Sync"}
                    </button>
                </div>
            </section>

            {(syncStatus?.inFlight || syncing) && (
                <div className="alert alert-info py-2">Syncing match history...</div>
            )}

            <section className="rank-tracker-grid mb-4">
                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <span>Current Rank</span>
                        <span>{rrMovement}</span>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {currentRankIcon ? (
                            <Image src={currentRankIcon} alt={currentRankLabel} width={72} height={72} unoptimized className="rank-icon" />
                        ) : (
                            <div className="rank-icon rank-icon-placeholder" />
                        )}
                        <div className="flex-grow-1">
                            <div className="rank-name">{currentRankLabel}</div>
                            <div className="rank-rr">{currentTier >= 27 ? "MAX" : `${currentRR} RR`}</div>
                            <div className="rank-meta">{overview?.currentRank?.numberOfWins ?? 0} wins / {overview?.currentRank?.numberOfGames ?? 0} games</div>
                            
                            {overview?.lastDeltas && overview.lastDeltas.length > 0 && (
                                <div className="form-trend-container">
                                    <span className="text-secondary small fw-bold me-1" style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)' }}>FORM:</span>
                                    {[...overview.lastDeltas].slice(0, 5).reverse().map((d, index) => {
                                        const won = d.rrEarned >= 0;
                                        const isDraw = d.rrEarned === 0;
                                        const label = isDraw ? "D" : won ? "W" : "L";
                                        const change = `${d.rrEarned > 0 ? "+" : ""}${d.rrEarned}`;
                                        return (
                                            <span
                                                key={`${d.matchId}-${index}`}
                                                className={`form-dot ${isDraw ? "draw" : won ? "win" : "loss"}`}
                                                title={`Match: ${change} RR · Tier ${d.tierAfter} after update`}
                                            >
                                                {label}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="rank-progress-wrap mt-2">
                                <div className="rank-progress">
                                    <div className="rank-progress-fill" style={{ width: `${Math.max(0, Math.min(100, currentRR))}%` }} />
                                </div>
                                <div className="rank-progress-label">{currentTier >= 27 ? "Radiant" : `${currentRR} / 100 RR`}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <span>Peak Rank</span>
                        <span>All cached acts</span>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {peakRankIcon ? (
                            <Image src={peakRankIcon} alt={peakRankLabel} width={58} height={58} unoptimized className="rank-icon rank-icon-small" />
                        ) : (
                            <div className="rank-icon rank-icon-small rank-icon-placeholder" />
                        )}
                        <div>
                            <div className="rank-name">{peakRankLabel}</div>
                            <div className="rank-rr">{overview?.peakRank?.seasonId ? `Season ${overview.peakRank.seasonId.slice(0, 8)}` : "No peak yet"}</div>
                            <div className="rank-meta">Highest tier recorded locally</div>
                        </div>
                    </div>
                </div>

                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <span>Competitive</span>
                        <span>{summary?.matches ?? 0} games</span>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {topAgentMeta?.icon ? (
                            <Image src={topAgentMeta.icon} alt={topAgentMeta.name} width={58} height={58} unoptimized className="rank-icon rank-icon-small" />
                        ) : (
                            <div className="rank-icon rank-icon-small rank-icon-placeholder" />
                        )}
                        <div>
                            <div className="rank-name">{fmtPct(summary?.winrate)} WR</div>
                            <div className="rank-rr">{fmtRatio(summary?.avgKda)} KDA / {fmtPct(summary?.avgHsPct)} HS</div>
                            <div className="rank-meta">{summary?.matches ? `Top competitive agent ${topAgentMeta?.name || "not cached yet"}` : "No competitive games cached yet"}</div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="live-systems-grid mb-4" aria-label="Live systems status">
                <LiveSystemCard
                    title="Match Watch"
                    status={liveStatus?.phase === "pregame" ? "Agent select detected" : liveStatus?.phase === "coregame" ? "Live match detected" : liveStatus?.error ? "Ready, no match found" : "Watching for match"}
                    detail={liveStatus?.phase === "pregame" || liveStatus?.phase === "coregame"
                        ? `${liveStatus.queueId || "Queue"}${liveStatus.source ? ` via ${liveStatus.source}` : ""}`
                        : isClientHealthy ? "Local client is connected. Match overlay appears when agent select or match starts." : "Local client is not connected. Open VALORANT for live match detection."}
                    tone={liveStatus?.phase === "pregame" || liveStatus?.phase === "coregame" ? "active" : isClientHealthy ? "idle" : "warn"}
                    pulse={!!activeAccount && isBackendOnline}
                    meta={liveUpdatedAt ? `Checked ${new Date(liveUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Not checked yet"}
                />
                <LiveSystemCard
                    title="Party Watch"
                    status={partyStatus?.phase === "party" ? "Party detected" : partyStatus?.phase === "matchmaking" ? "In matchmaking" : partyStatus?.phase === "pregame" ? "Party in agent select" : partyStatus?.phase === "coregame" ? "Party in match" : partyStatus?.phase === "error" ? "Ready, no party found" : "Watching for party"}
                    detail={partyStatus?.members?.length
                        ? `${partyStatus.members.length}/5 members${partyStatus.queueId ? ` in ${partyStatus.queueId}` : ""}${partyStatus.source ? ` via ${partyStatus.source}` : ""}`
                        : "Party widget appears automatically when Riot reports a party."}
                    tone={partyStatus?.members?.length ? "active" : partyStatus?.phase === "error" ? "warn" : "idle"}
                    pulse={!!activeAccount && isBackendOnline}
                    meta={partyStatus?.source ? `Source ${partyStatus.source}` : isBackendOnline ? "Token-first polling" : "Backend offline"}
                />
            </section>

            <section className="riot-signals-panel mb-4" aria-label="Riot API signals">
                <div className="riot-signals-header">
                    <div>
                        <span>Riot Signals</span>
                        <small>Read-only API checks for live and account systems</small>
                    </div>
                    <div className="riot-signals-time">
                        {liveUpdatedAt ? `Updated ${new Date(liveUpdatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting"}
                    </div>
                </div>
                <div className="riot-signals-grid">
                    <RiotSignalCard
                        label="Live Loadouts"
                        value={loadoutStatus?.phase === "pregame" ? "Agent Select" : loadoutStatus?.phase === "coregame" ? "In Match" : loadoutStatus?.phase === "error" ? "Unavailable" : "No live game"}
                        detail={liveLoadoutPlayers
                            ? `${liveLoadoutPlayers} players, ${liveLoadoutSkins} cosmetic ids visible`
                            : loadoutStatus?.phase === "none" ? "Hidden until Riot reports pregame or current game." : loadoutStatus?.error || "Waiting for match context."}
                        tone={loadoutStatus?.phase === "pregame" || loadoutStatus?.phase === "coregame" ? "active" : loadoutStatus?.phase === "error" ? "warn" : "idle"}
                        source={loadoutStatus?.source}
                    />
                    <RiotSignalCard
                        label="Penalties"
                        value={accountHealth?.penalties?.status === "clear" ? "Clear" : accountHealth?.penalties?.status === "warn" ? `${accountHealth.penalties.count} active` : "Unavailable"}
                        detail={accountHealth?.penalties?.detail || "Checks Riot restriction status without changing anything."}
                        tone={accountHealth?.penalties?.status === "warn" ? "warn" : accountHealth?.penalties?.status === "clear" ? "active" : "idle"}
                        source={accountHealth?.source}
                    />
                    <RiotSignalCard
                        label="Services"
                        value={serviceList.length ? `${serviceOkCount}/${serviceList.length} OK` : "Waiting"}
                        detail={serviceWarnCount > 0 ? `${serviceWarnCount} service flags need attention.` : "Config, store, party, friends, queue and platform flags are readable."}
                        tone={serviceWarnCount > 0 ? "warn" : serviceList.length ? "active" : "idle"}
                        source={accountHealth?.source}
                    />
                    <RiotSignalCard
                        label="Friends Presence"
                        value={socialStatus?.status === "ok" ? `${socialStatus.onlineCount}/${socialStatus.friendCount} online` : "Local only"}
                        detail={socialStatus?.status === "ok"
                            ? `${socialStatus.inGameCount} friends exposing VALORANT presence right now.`
                            : socialStatus?.error || "Open VALORANT to allow local chat presence checks."}
                        tone={socialStatus?.status === "ok" ? "active" : "idle"}
                        source={socialStatus?.source}
                    />
                    <RiotSignalCard
                        label="Service Ticker"
                        value={ticker?.status && ticker.status !== "ok" ? ticker.status : "Quiet"}
                        detail={ticker?.detail || "No Riot ticker message returned."}
                        tone={ticker?.status && !["ok", "unknown"].includes(ticker.status.toLowerCase()) ? "warn" : ticker ? "active" : "idle"}
                        source={accountHealth?.source}
                    />
                </div>
            </section>

            <div className="profile-layout-grid">
                <section className="profile-main-column">
                    <div className="rank-card clip-tactical mb-4 profile-progress-module">
                        <div className="rank-card-header profile-progress-header">
                            <div>
                                <span>Progress Center</span>
                                <small>Missions, battlepass, and contracts</small>
                            </div>
                            <div className="missions-header-meta">
                                <span>{missionCounts.active} active</span>
                                <span>{missionCounts.complete} complete</span>
                                {weeklyRefillLabel && (
                                    <span title={missions?.MissionMetadata?.WeeklyRefillTime || ""}>
                                        Weekly refills in {weeklyRefillLabel}
                                    </span>
                                )}
                                {dailyResetLabel && (
                                    <span title="Based on earliest unexpired daily mission">
                                        Dailies reset in {dailyResetLabel}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="progress-tab-bar" role="tablist" aria-label="Progress views">
                            {([
                                ["daily", `Daily (${missionCounts.daily})`],
                                ["weekly", `Weekly (${missionCounts.weekly})`],
                                ["battlepass", `Battlepass (${battlepassContracts.length})`],
                                ["events", `Events (${eventContracts.length})`],
                                ["contracts", `Other (${progressionContracts.length})`],
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
                            {(progressTab === "daily" || progressTab === "weekly") ? (
                                <>
                                    {/* Daily checkpoint UI - mirrors the in-game
                                        Daily Checkpoints display. Always renders
                                        4 slots (the in-game UI does too), even
                                        when Riot returns 0 active dailies. */}
                                    {progressTab === "daily" && (
                                        <div className="daily-checkpoint-strip">
                                            <div className="daily-checkpoint-header">
                                                <span className="daily-checkpoint-label">CHECKPOINTS</span>
                                                <span className="daily-checkpoint-xp">+1,000 XP · +150 PER CHECKPOINT</span>
                                            </div>
                                            <div className="daily-checkpoint-diamonds" role="list">
                                                {Array.from({ length: dailyCheckpointSummary.total }).map((_, i) => {
                                                    const isDone = i < dailyCheckpointSummary.completed;
                                                    return (
                                                        <div
                                                            key={i}
                                                            role="listitem"
                                                            className={`daily-checkpoint-diamond${isDone ? " is-complete" : ""}`}
                                                            aria-label={isDone ? "Checkpoint complete" : "Checkpoint pending"}
                                                        >
                                                            {isDone ? (
                                                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                                                    <path d="M5 12l5 5 9-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                                                                </svg>
                                                            ) : (
                                                                <span className="daily-checkpoint-num">{i + 1}</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {currentProgressMissions.length > 0 ? (
                                        <div className="missions-grid progress-rail">
                                            {currentProgressMissions.map(({ mission: m, meta, type, current, target, pct }) => {
                                                const title = meta?.title || (type === "weekly" ? "Weekly Mission" : "Daily Mission");
                                                const xp = meta?.xp || 0;
                                                return (
                                                    <div key={m.ID} className={`mission-item-container progress-item-card${m.Complete ? " mission-item-container--complete" : ""}`}>
                                                        <div className="progress-item-topline">
                                                            <span>{type}</span>
                                                            <strong>{m.Complete ? "Complete" : xp > 0 ? `+${xp.toLocaleString()} XP` : "Active"}</strong>
                                                        </div>
                                                        <div className="progress-item-title">{title}</div>
                                                        <div className="rank-progress-wrap mt-3">
                                                            <div className="rank-progress" style={{ height: "7px" }}>
                                                                <div className="rank-progress-fill" style={{ width: `${pct}%`, backgroundColor: type === "weekly" ? "var(--yellow)" : "var(--green)" }} />
                                                            </div>
                                                            <div className="progress-foot">
                                                                <span>{m.Complete ? "Finished" : "Progress"}</span>
                                                                <span>{current} / {target}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="progress-empty-state">
                                            <strong>No {progressTab} missions showing right now.</strong>
                                            <span>Riot sometimes returns only currently active missions. Refresh after a game or when missions rotate.</span>
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

                                        // XP-driven tier math. We don't trust
                                        // progressionLevelReached here because
                                        // (a) it's 0/1 for events and non-active
                                        // contracts, and (b) it doesn't tell us
                                        // WHERE in the XP scale we are. Walking
                                        // the levels[] array lets one path serve
                                        // both battlepasses AND event contracts.
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

                                        // Build a wider tier strip. We want
                                        // a few claimed (with checkmarks), the
                                        // current (highlighted), and several
                                        // upcoming tiers. Currency tiers are
                                        // filtered into a separate "rewards"
                                        // row so they don't share the same
                                        // visual treatment as cosmetic items.
                                        const stripStart = Math.max(0, currentTierIndex - 2);
                                        const stripEnd = Math.min(levels.length, currentTierIndex + 9);
                                        const stripWindow = levels.slice(stripStart, stripEnd);
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
                                        stripWindow.forEach((lvl, idx) => {
                                            const realIndex = stripStart + idx;
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
                                            <div key={contract.id} className={`contract-item-container progress-item-card${isActiveSpecial ? " contract-item-container--active" : ""}`}>
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
                                                            {endLabel && <span className="contract-item-timer"> · {endLabel}</span>}
                                                        </div>
                                                    </div>
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
                                                        {xpForNext != null && xpForNext > 0
                                                            ? `${xpForNext.toLocaleString()} XP to next reward`
                                                            : intoLevel > 0
                                                                ? `${intoLevel.toLocaleString()} XP into this level`
                                                                : "Maxed out"}
                                                    </span>
                                                    <span className="contract-item-progress-foot">Progress</span>
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
                                    <strong>No {progressTab === "battlepass" ? "battlepass" : "contract"} progress found.</strong>
                                    <span>Connect a refreshed Riot session or play a match, then refresh Profile.</span>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Daily & Weekly Missions — main column */}
                    <div className="rank-card clip-tactical mb-4">
                        <div className="rank-card-header">
                            <span>Recent RR</span>
                            <span>{rrHistory?.snapshots?.length ?? 0} ranked games</span>
                        </div>
                        <RRHistoryChart snapshots={rrHistory?.snapshots ?? []} />
                    </div>

                    <div className="rank-card clip-tactical">
                        <div className="rank-card-header">
                            <span>Recent Matches</span>
                            <span>{total} total</span>
                        </div>
                        {(() => {
                            // "Next Up" banner: shown when the user
                            // is in pregame or matchmaking, mirrors the
                            // agent pick on the live overlay so they know
                            // what's coming next before the row lands.
                            const isLivePregame = liveStatus?.phase === "pregame";
                            const isPartyQueueing = partyStatus?.phase === "matchmaking" || partyStatus?.phase === "pregame";
                            if (!isLivePregame && !isPartyQueueing) {
                                return null;
                            }
                            const nextQueue = liveStatus?.queueId || partyStatus?.queueId || "Queue";
                            const nextMap = maps[liveStatus?.mapId?.toLowerCase?.() || ""]?.name
                                || liveStatus?.mapId?.slice(0, 12);
                            const localLivePlayer = [...(liveStatus?.allyTeam ?? []), ...(liveStatus?.enemyTeam ?? [])]
                                .find((player) => player.isLocal);
                            const nextAgent = agents[localLivePlayer?.agentId?.toLowerCase?.() || ""]?.name;
                            return (
                                <div className="match-next-up-banner">
                                    <span className="match-next-up-kicker">NEXT UP</span>
                                    <div className="match-next-up-body">
                                        <strong>{QUEUE_LABEL[nextQueue] || nextQueue}</strong>
                                        {nextMap && <span className="match-next-up-meta">{nextMap}</span>}
                                        {nextAgent && <span className="match-next-up-meta">Playing as {nextAgent}</span>}
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
                                {history.map((match, idx) => (
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
                                        // Flag the most recent match (the one
                                        // that would be the user's "last game"
                                        // for queue-context / wraparound).
                                        isNext={idx === 0}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                <aside className="profile-side-column">
                    <div className="rank-card clip-tactical mb-4">
                        <div className="rank-card-header">
                            <span>Agent Stats</span>
                            <span>{QUEUE_LABEL[queue] || "All queues"}</span>
                        </div>
                        <AgentStatsTable agents={agentStats?.agents ?? []} agentLookup={agentLookup} emptyMessage="No agent stats cached yet." />
                    </div>
                    <div className="rank-card clip-tactical mb-4">
                        <div className="rank-card-header">
                            <span>Acts</span>
                            <span>Rank history</span>
                        </div>
                        <ActSummaryList acts={overview?.rankActs ?? []} currentSeasonId={overview?.currentSeasonId ?? ""} tierAssets={tierAssets} />
                    </div>
                    <div className="rank-card clip-tactical">
                        <div className="rank-card-header">
                            <span>Map Stats</span>
                            <span>{QUEUE_LABEL[queue] || "All queues"}</span>
                        </div>
                        <MapStatsTable maps={mapStats?.maps ?? []} mapLookup={mapLookup} emptyMessage="No map stats cached yet." />
                    </div>
                </aside>
            </div>
        </div>
    );
}

function LiveSystemCard({
    title,
    status,
    detail,
    tone,
    pulse,
    meta,
}: {
    title: string;
    status: string;
    detail: string;
    tone: "active" | "idle" | "warn";
    pulse: boolean;
    meta: string;
}) {
    return (
        <div className={`live-system-card live-system-card--${tone}`}>
            <div className="live-system-orb" aria-hidden="true">
                {pulse && <span />}
            </div>
            <div className="live-system-main">
                <div className="live-system-kicker">{title}</div>
                <div className="live-system-status">{status}</div>
                <div className="live-system-detail">{detail}</div>
            </div>
            <div className="live-system-meta">{meta}</div>
        </div>
    );
}

function RiotSignalCard({
    label,
    value,
    detail,
    tone,
    source,
}: {
    label: string;
    value: string;
    detail: string;
    tone: "active" | "idle" | "warn";
    source?: string;
}) {
    return (
        <div className={`riot-signal-card riot-signal-card--${tone}`}>
            <div className="riot-signal-topline">
                <span>{label}</span>
                {source && <small>{source}</small>}
            </div>
            <div className="riot-signal-value">{value}</div>
            <div className="riot-signal-detail">{detail}</div>
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
    isNext,
}: {
    match: MatchSummary;
    detail?: ProfileMatchDetails;
    expanded: boolean;
    loading: boolean;
    agents: Record<string, AgentMeta>;
    maps: Record<string, MapMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onToggle: () => void;
    onSelectPlayer?: (puuid: string, region: string) => void;
    localRegion: string;
    isNext?: boolean;
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
        <div className={`match-card-wrap ${expanded ? "expanded" : ""} ${isNext ? "is-next" : ""}`}>
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
                        <span className="match-stat-sub">{Math.round((match.localPlayer as any).headshots || 0)} / {(Math.round((match.localPlayer as any).headshots || 0) + Math.round((match.localPlayer as any).bodyshots || 0) + Math.round((match.localPlayer as any).legshots || 0)) || 0} hits</span>
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

                {/* Trailing "next" pill + expand chevron */}
                <div className="match-row-tail">
                    {isNext && <span className="match-next-pill">NEXT</span>}
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
