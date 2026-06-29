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
    postProfileSync,
    type ProfileAgentStatsResponse,
    type ProfileMapStatsResponse,
    type ProfileMatchDetails,
    type ProfileMatchSummary,
    type ProfileOverview,
    type ProfileRRHistory,
    type ProfileSyncStatus,
} from "@/services/api";
import RRHistoryChart from "./RRHistoryChart";
import s from "./ProfilePanel.module.css";

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
interface SeasonMeta {
    name: string;
    parentUuid: string;
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

// Session-scoped caches for valorant-api.com metadata so we only fetch
// agents / maps / competitive-tier icons once per app session.
let agentCache: Record<string, AgentMeta> | null = null;
let mapCache: Record<string, MapMeta> | null = null;
let tierAssetCache: Map<number, { smallIcon: string }> | null = null;
let agentPromise: Promise<Record<string, AgentMeta>> | null = null;
let mapPromise: Promise<Record<string, MapMeta>> | null = null;
let tierPromise: Promise<Map<number, { smallIcon: string }>> | null = null;

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
    const season = seasons[id.toLowerCase()];
    if (!season) return id.slice(0, 8).toUpperCase();
    const parent = seasons[season.parentUuid.toLowerCase()];
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
            const res = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
            if (!res.ok) throw new Error(`agents ${res.status}`);
            const d = await res.json();
            const m: Record<string, AgentMeta> = {};
            for (const a of d?.data ?? []) {
                if (!a.uuid) continue;
                m[a.uuid.toLowerCase()] = {
                    name: a.displayName,
                    icon: a.displayIcon || a.killfeedPortrait || "",
                    full: a.fullPortrait || "",
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
                const meta = { name: mp.displayName, splash: mp.splash || "" };
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
    const { activeAccount } = useData();
    const puuid = activeAccount?.puuid ?? "";
    const region = activeAccount?.region ?? "na";

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
    const [seasons, setSeasons] = useState<Record<string, SeasonMeta>>({});
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const [identity, setIdentity] = useState<{ playerCardId: string; playerTitleId: string } | null>(null);
    const [playerCards, setPlayerCards] = useState<Record<string, { wide: string; icon: string; name: string }>>({});
    const [playerTitles, setPlayerTitles] = useState<Record<string, string>>({});

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
        fetch("https://valorant-api.com/v1/playercards")
            .then((res) => res.json())
            .then((d) => {
                if (cancelled) return;
                const cards: Record<string, { wide: string; icon: string; name: string }> = {};
                for (const c of d.data || []) {
                    if (c.uuid) {
                        cards[c.uuid.toLowerCase()] = {
                            wide: c.wideArt || "",
                            icon: c.displayIcon || "",
                            name: c.displayName || "",
                        };
                    }
                }
                setPlayerCards(cards);
            })
            .catch((e) => console.warn("Failed to load player cards metadata", e));
        fetch("https://valorant-api.com/v1/playertitles")
            .then((res) => res.json())
            .then((d) => {
                if (cancelled) return;
                const titles: Record<string, string> = {};
                for (const t of d.data || []) {
                    if (t.uuid) titles[t.uuid.toLowerCase()] = t.titleText || t.displayName || "";
                }
                setPlayerTitles(titles);
            })
            .catch((e) => console.warn("Failed to load player titles metadata", e));
        fetch("https://valorant-api.com/v1/seasons")
            .then((res) => res.json())
            .then((d) => {
                if (cancelled) return;
                const next: Record<string, SeasonMeta> = {};
                for (const season of d.data || []) {
                    if (!season.uuid) continue;
                    next[season.uuid.toLowerCase()] = {
                        name: season.displayName || "Act",
                        parentUuid: season.parentUuid || "",
                    };
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

    const refresh = useCallback(async () => {
        if (!puuid) {
            setOverview(null);
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
            // Overview hydrates ranked history from Riot before the RR query reads the cache.
            const ov = await getProfileOverview(opts);
            const [rr, mh, ag, mp, st] = await Promise.all([
                getRRHistory(undefined, opts),
                getProfileMatchHistory(0, pageSize, queue || undefined, opts),
                getAgentStats(queue || undefined, opts),
                getMapStats(queue || undefined, opts),
                getProfileSyncStatus(opts).catch(() => null),
            ]);
            setOverview(ov);
            setRRHistory(rr);
            setHistory(mh.matches || []);
            setTotal(mh.total || 0);
            setAgentStats(ag);
            setMapStats(mp);
            setSyncStatus(st);
            setIdentity(ov ? { playerCardId: ov.playerCardId || "", playerTitleId: ov.playerTitleId || "" } : null);
            if (st?.lastError) setError(cleanError(st.lastError));
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setLoading(false);
        }
    }, [opts, pageSize, puuid, queue]);

    useEffect(() => {
        setDetails({});
        setExpanded(new Set());
    }, [puuid]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const runSync = useCallback(
        async (manual: boolean) => {
            if (!puuid) return;
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
        },
        [opts, puuid, refresh, showToast],
    );

    // Auto-sync on first visit if nothing is cached yet.
    useEffect(() => {
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
    }, [loading, puuid, runSync, syncStatus, syncing]);

    const toggleDetails = useCallback(
        async (matchId: string) => {
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
        },
        [details, opts, puuid],
    );

    const currentTier = overview?.currentRank?.competitiveTier ?? 0;
    const currentRR = overview?.currentRank?.rankedRating ?? 0;
    const peakTier = overview?.peakRank?.competitiveTier ?? 0;
    const currentRankLabel = tierLabel(currentTier, overview?.currentRank?.tierName);
    const peakRankLabel = tierLabel(peakTier, overview?.peakRank?.tierName);
    const currentRankIcon = rankIconUrl(currentTier, tierAssets);
    const summary = overview?.seasonSummary;
    const isBusy = loading || syncing || !!syncStatus?.inFlight;
    const topAgentMeta = summary?.topAgentCharacterId ? agents[summary.topAgentCharacterId.toLowerCase()] : undefined;

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

    const agentLookup = useMemo(() => {
        const out: Record<string, Agent> = {};
        for (const [id, meta] of Object.entries(agents)) {
            out[id] = { uuid: id, displayName: meta.name, displayIcon: meta.icon, isBaseContent: false };
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

    const heroBg = cardData?.wide || topAgentMeta?.full;

    const stats: Array<{ label: string; value: string; accent?: boolean }> = [
        { label: "Rank", value: currentRankLabel, accent: true },
        { label: "Rating", value: currentTier >= 27 ? "MAX" : `${currentRR} RR` },
        { label: "Peak", value: peakRankLabel },
        { label: "Win Rate", value: fmtPct(summary?.winrate) },
        { label: "K/D", value: fmtRatio(summary?.avgKda) },
        { label: "Matches", value: String(summary?.matches ?? 0) },
    ];

    return (
        <div className={s.shell}>
            {toast && <div className={s.toast}>{toast}</div>}

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
                            {topAgentMeta?.icon ? (
                                <img src={topAgentMeta.icon} alt={topAgentMeta.name} className={s.railAvatarImg} />
                            ) : cardData?.icon ? (
                                <img src={cardData.icon} alt="Player Card" className={s.railAvatarImg} />
                            ) : (
                                <div className={`${s.railAvatarImg} ${s.railAvatarFallback}`} />
                            )}
                            <div className={s.railLevel}>{overview?.account?.level || "—"}</div>
                        </div>
                    </div>

                    <div className={s.railBody}>
                        <div className={s.railName}>
                            {activeAccount?.gameName || "Unknown"}
                            <span className={s.railTag}>#{activeAccount?.tagLine || ""}</span>
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
                        </div>
                    </div>
                </aside>

                {/* ── Main content ── */}
                <main className={s.main}>
                    {/* ── Tabs ── */}
                    <div className={s.body}>
                        <>
                                <div className={s.overviewTop}>
                                    <Panel title="Season Averages" subtitle="This act">
                                        <div className={s.metricGrid}>
                                            <Metric label="Win Rate" value={fmtPct(summary?.winrate)} tone={s.metricAccent} />
                                            <Metric label="K/D Ratio" value={fmtRatio(summary?.avgKda)} tone={kdColor(summary?.avgKda)} />
                                            <Metric label="Headshot %" value={fmtPct(summary?.avgHsPct)} tone={hsColor(summary?.avgHsPct)} />
                                            <Metric label="Matches" value={String(summary?.matches ?? 0)} />
                                            <Metric label="Top Agent" value={topAgentMeta?.name || summary?.topAgent || "—"} />
                                            <Metric label="Peak Rank" value={peakRankLabel} />
                                        </div>
                                    </Panel>

                                    <Panel title="Agent Pool" subtitle="Most played">
                                        <div className={s.agentMiniList}>
                                            {agentStats?.agents?.slice(0, 5).map((agent) => {
                                                const aMeta = agentLookup[agent.characterId.toLowerCase()];
                                                return (
                                                    <div key={agent.characterId} className={s.agentMini}>
                                                        {aMeta?.displayIcon && (
                                                            <img
                                                                src={aMeta.displayIcon}
                                                                alt=""
                                                                className={s.agentMiniIcon}
                                                            />
                                                        )}
                                                        <span className={s.agentMiniName}>
                                                            {aMeta?.displayName || "Agent"}
                                                        </span>
                                                        <span
                                                            className={`${s.agentMiniWr} ${
                                                                agent.winrate >= 50 ? s.winText : s.lossText
                                                            }`}
                                                        >
                                                            {fmtPct(agent.winrate)}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                            {!agentStats?.agents?.length && (
                                                <div className={s.placeholder}>No agent stats cached.</div>
                                            )}
                                        </div>
                                    </Panel>
                                </div>

                                <div className={s.progressionGrid}>
                                    <Panel
                                        title="RR Progression"
                                        subtitle={
                                            rrHistory?.snapshots?.length
                                                ? `${rrHistory.snapshots.length} ranked games tracked`
                                                : "Sync competitive games to build the graph"
                                        }
                                    >
                                        <RRHistoryChart snapshots={rrHistory?.snapshots ?? []} height={240} />
                                    </Panel>
                                    <Panel title="Act History" subtitle="Peak and final rank by act">
                                        {overview?.rankError && (
                                            <div className={s.rankNotice}>
                                                {overview.rankActs?.length ? "Showing cached history. " : "Live history unavailable. "}
                                                {cleanError(overview.rankError)}
                                            </div>
                                        )}
                                        <ActSummaryList
                                            acts={overview?.rankActs ?? []}
                                            currentSeasonId={overview?.currentSeasonId ?? ""}
                                            tierAssets={tierAssets}
                                            seasons={seasons}
                                        />
                                    </Panel>
                                </div>

                                <Panel title="Map Performance" subtitle="Win rate by map">
                                    <div className={s.mapStrip}>
                                        {mapStats?.maps?.slice(0, 8).map((mStat) => {
                                            const mMeta = mapLookup[mStat.mapID.toLowerCase()];
                                            const splash = mMeta?.splash;
                                            return (
                                                <div
                                                    key={mStat.mapID}
                                                    className={s.mapCard}
                                                    style={splash ? { backgroundImage: `url(${splash})` } : undefined}
                                                >
                                                    <div className={s.mapCardScrim} />
                                                    <div className={s.mapCardBody}>
                                                        <span className={s.mapCardName}>
                                                            {mMeta?.displayName || mStat.mapID.slice(0, 6)}
                                                        </span>
                                                        <span
                                                            className={`${s.mapCardWr} ${
                                                                mStat.winrate >= 50 ? s.winText : s.lossText
                                                            }`}
                                                        >
                                                            {fmtPct(mStat.winrate)}
                                                        </span>
                                                        <span className={s.mapCardGames}>{mStat.matches} games</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {!mapStats?.maps?.length && (
                                            <div className={s.placeholder}>No map stats cached.</div>
                                        )}
                                    </div>
                                </Panel>

                                <Panel
                                    title="Match History"
                                    subtitle={`${total} total`}
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
                                    {loading && history.length === 0 ? (
                                        <div className={s.placeholder}>Loading cached profile…</div>
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
                                                    tierAssets={tierAssets}
                                                    onToggle={() => toggleDetails(match.matchId)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </Panel>
                        </>
                    </div>
                </main>
            </div>
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

/* ── Match row with expandable scoreboard ── */

function MatchRow({
    match,
    detail,
    expanded,
    loading,
    agents,
    maps,
    tierAssets,
    onToggle,
}: {
    match: ProfileMatchSummary;
    detail?: ProfileMatchDetails;
    expanded: boolean;
    loading: boolean;
    agents: Record<string, AgentMeta>;
    maps: Record<string, MapMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onToggle: () => void;
}) {
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

    const kda = match.localPlayer.kda;
    const hsPct = match.localPlayer.hsPct;
    const adr = Math.round(match.localPlayer.adr || 0);
    const acs = Math.round(match.localPlayer.acs || 0);
    const kdaText = `${match.localPlayer.kills}/${match.localPlayer.deaths}/${match.localPlayer.assists}`;
    const partyMembers = (match.partyMembers || []).filter((member) => member.subject !== match.localPlayer.subject);
    const partyPreview = partyMembers.slice(0, 3);

    return (
        <div className={`${s.matchWrap} ${expanded ? s.matchWrapExpanded : ""}`}>
            <button type="button" className={`${s.matchRow} ${match.win ? s.matchRowWin : s.matchRowLoss}`} onClick={onToggle} aria-expanded={expanded}>
                <div className={s.matchResultBlock}>
                    <span className={`${s.matchResultText} ${resultClass}`}>{match.win ? "WIN" : "LOSS"}</span>
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
                        </div>
                    </div>

                    {partyMembers.length > 0 && (
                        <div className={s.matchPartyRow}>
                            <span className={s.matchPartyLabel}>Queued with</span>
                            <div className={s.matchPartyList}>
                                {partyPreview.map((member) => {
                                    const memberMeta = agents[member.characterId?.toLowerCase?.() || ""];
                                    const memberLabel = member.gameName
                                        ? `${member.gameName}${member.tagLine ? `#${member.tagLine}` : ""}`
                                        : member.subject.slice(0, 8);
                                    return (
                                        <span key={member.subject} className={s.matchPartyChip}>
                                            {memberMeta?.icon ? (
                                                <Image src={memberMeta.icon} alt={memberLabel} width={18} height={18} unoptimized className={s.matchPartyIcon} />
                                            ) : (
                                                <span className={s.matchPartyDot} aria-hidden="true" />
                                            )}
                                            {memberLabel}
                                        </span>
                                    );
                                })}
                                {partyMembers.length > partyPreview.length && (
                                    <span className={s.matchPartyMore}>+{partyMembers.length - partyPreview.length}</span>
                                )}
                            </div>
                        </div>
                    )}

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
                        </div>
                    ) : (
                        <div className={s.matchTimeCell}>
                            <span className={s.matchTime}>{match.isRanked ? "No RR change cached" : "Non-ranked match"}</span>
                        </div>
                    )}
                </div>

                <span className={s.matchChevron} aria-hidden="true">
                    {expanded ? "⌃" : loading ? "…" : "›"}
                </span>
            </button>

            {expanded && (
                <div className={s.matchDetail}>
                    {loading ? (
                        <div className={s.placeholder}>Loading scoreboard…</div>
                    ) : detail ? (
                        <Scoreboard detail={detail} agents={agents} tierAssets={tierAssets} />
                    ) : (
                        <div className={s.placeholder}>No details cached for this match.</div>
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
}: {
    detail: ProfileMatchDetails;
    agents: Record<string, AgentMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
}) {
    const blue = detail.players.filter((p) => p.teamId === "Blue");
    const red = detail.players.filter((p) => p.teamId === "Red");
    const sortPlayers = (rows: typeof detail.players) =>
        [...rows].sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || b.score - a.score || b.kills - a.kills);

    const mvpPlayer = useMemo(() => {
        if (!detail.players.length) return null;
        return [...detail.players].reduce(
            (max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max),
            detail.players[0],
        );
    }, [detail.players]);

    return (
        <div className={s.scoreGrid}>
            <ScoreTeam
                title="Blue"
                won={detail.matchInfo.blueWins}
                score={detail.matchInfo.blueRoundsWon}
                players={sortPlayers(blue)}
                agents={agents}
                mvpPlayer={mvpPlayer}
                tierAssets={tierAssets}
            />
            <ScoreTeam
                title="Red"
                won={!detail.matchInfo.blueWins}
                score={detail.matchInfo.redRoundsWon}
                players={sortPlayers(red)}
                agents={agents}
                mvpPlayer={mvpPlayer}
                tierAssets={tierAssets}
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
    tierAssets,
}: {
    title: string;
    won: boolean;
    score: number;
    players: ProfileMatchDetails["players"];
    agents: Record<string, AgentMeta>;
    mvpPlayer: ProfileMatchDetails["players"][number] | null;
    tierAssets: Map<number, { smallIcon: string }>;
}) {
    return (
        <div className={s.scoreTeam}>
            <div className={s.scoreTeamHeader}>
                <span>{title} Team</span>
                <strong className={won ? s.winText : s.lossText}>{score}</strong>
            </div>
            <table className={s.scoreTable}>
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
                        const name = p.gameName
                            ? `${p.gameName}${p.tagLine ? `#${p.tagLine}` : ""}`
                            : p.isLocal
                                ? "You"
                                : meta?.name || "Player";
                        const isMvp = mvpPlayer && mvpPlayer.characterId === p.characterId && mvpPlayer.teamId === p.teamId;
                        const rankIcon = rankIconUrl(p.competitiveTier, tierAssets);
                        return (
                            <tr key={`${p.characterId}-${idx}`} className={p.isLocal ? s.scoreLocal : ""}>
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
                                                {name}
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
                                    <div className={`${s.scoreSub} ${adrColor(p.adr)}`}>{Math.round(p.adr || 0)} ADR</div>
                                </td>
                                <td className={hsColor(p.hsPct)}>{fmtPct(p.hsPct)}</td>
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
    seasons,
}: {
    acts: Array<{ seasonId: string; wins: number; games: number; rankedRating: number; peakRank: number; finalRank: number }>;
    currentSeasonId: string;
    tierAssets: Map<number, { smallIcon: string }>;
    seasons: Record<string, SeasonMeta>;
}) {
    if (!acts.length) {
        return <div className={s.placeholder}>No competitive act data yet.</div>;
    }
    return (
        <div className={s.actList}>
            {acts.map((act) => {
                const name = seasonLabel(act.seasonId, seasons);
                const label = act.seasonId === currentSeasonId ? `Current · ${name}` : name;
                const rank = act.finalRank || act.peakRank;
                const winrate = act.games > 0 ? (act.wins / act.games) * 100 : 0;
                const rankIcon = rankIconUrl(rank, tierAssets);
                return (
                    <div key={act.seasonId} className={s.actRow}>
                        <div className={s.actRowLeft}>
                            {rankIcon ? (
                                <Image src={rankIcon} alt={tierLabel(rank, "Rank")} width={28} height={28} unoptimized className={s.actIcon} />
                            ) : (
                                <div className={`${s.actIcon} ${s.actIconPlaceholder}`} />
                            )}
                            <div>
                                <strong>{label}</strong>
                                <span>{act.games} games · {act.wins} wins · {fmtPct(winrate)}</span>
                            </div>
                        </div>
                        <div className={s.actRowRight}>
                            <strong>{tierLabel(rank, "Rank")}</strong>
                            <span>{act.rankedRating || 0} RR · Peak {tierLabel(act.peakRank, "Rank")}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
