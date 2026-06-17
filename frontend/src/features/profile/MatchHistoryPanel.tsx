"use client";

// MatchHistoryPanel — driven by the persistent local-cache endpoints
// (GET /v1/profile/match-history, /v1/profile/match-details, plus
// /v1/profile/agent-stats + /v1/profile/map-stats for the summary tables).
// All field names below mirror backend/tracking/types.go exactly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import type { Agent } from "@/lib/types";
import {
    getProfileMatchHistory,
    getProfileMatchDetails,
    getAgentStats,
    getMapStats,
    postProfileSync,
    getProfileSyncStatus,
    ProfileMatchSummary,
    ProfileMatchDetails,
    ProfileAgentStatsResponse,
    ProfileMapStatsResponse,
    ProfileSyncStatus,
} from "@/services/api";
import AgentStatsTable from "./AgentStatsTable";
import MapStatsTable from "./MapStatsTable";

interface Props {
    onConnectAccount?: () => void;
}

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

function fmtDate(ms: number): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
function fmtLength(ms: number): string {
    if (!ms || ms < 0) return "—";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPct(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "—";
    return `${(n ?? 0).toFixed(1)}%`;
}
function fmtRatio(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "—";
    return (n ?? 0).toFixed(2);
}

// --- valorant-api.com agent + map metadata (per-session cache) ---
interface AgentMeta { name: string; icon: string; }
interface MapMeta { name: string; splash: string; }

let agentCache: Record<string, AgentMeta> | null = null;
let mapCache: Record<string, MapMeta> | null = null;
let agentPromise: Promise<Record<string, AgentMeta>> | null = null;
let mapPromise: Promise<Record<string, MapMeta>> | null = null;

async function loadAgentMap(): Promise<Record<string, AgentMeta>> {
    if (agentCache) return agentCache;
    if (agentPromise) return agentPromise;
    agentPromise = (async () => {
        try {
            const res = await fetch(
                "https://valorant-api.com/v1/agents?isPlayableCharacter=true",
            );
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
                m[mp.uuid.toLowerCase()] = {
                    name: mp.displayName,
                    splash: mp.splash || "",
                };
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

export default function MatchHistoryPanel({ onConnectAccount }: Props) {
    const { activeAccount } = useData();

    const [history, setHistory] = useState<ProfileMatchSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [pageSize, setPageSize] = useState(20);
    const [queue, setQueue] = useState<string>("");
    const [thisActOnly, setThisActOnly] = useState<boolean>(false);
    const [currentSeasonId, setCurrentSeasonId] = useState<string>("");

    const [details, setDetails] = useState<Record<string, ProfileMatchDetails>>({});
    const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const [agents, setAgents] = useState<Record<string, AgentMeta>>({});
    const [maps, setMaps] = useState<Record<string, MapMeta>>({});

    const [agentStats, setAgentStats] = useState<ProfileAgentStatsResponse | null>(null);
    const [mapStats, setMapStats] = useState<ProfileMapStatsResponse | null>(null);

    const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string>("");
    const [showRaw, setShowRaw] = useState(false);
    const [toast, setToast] = useState<string | null>(null);

    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const puuid = activeAccount?.puuid ?? "";
    const region = activeAccount?.region ?? "na";

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
    }, []);

    // Load static metadata once.
    useEffect(() => {
        let cancelled = false;
        Promise.all([loadAgentMap(), loadMaps()]).then(([a, m]) => {
            if (cancelled) return;
            setAgents(a);
            setMaps(m);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const refresh = useCallback(async () => {
        if (!puuid) return;
        setLoading(true);
        setError("");
        try {
            const q = queue || undefined;
            const histRes = await getProfileMatchHistory(0, pageSize, q, { puuid, region });
            setHistory(histRes.matches ?? []);
            setTotal(histRes.total ?? 0);
            if (histRes.matches?.length) setCurrentSeasonId(histRes.matches[0].seasonId);
            // Clear stale detail cache when filter changes.
            setDetails({});
            setExpanded(new Set());
            // Refresh summary tables for the current queue filter.
            const [aStats, mStats, sStatus] = await Promise.all([
                getAgentStats(q, { puuid, region }).catch(() => null),
                getMapStats(q, { puuid, region }).catch(() => null),
                getProfileSyncStatus({ puuid, region }).catch(() => null),
            ]);
            setAgentStats(aStats);
            setMapStats(mStats);
            setSyncStatus(sStatus);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load match history.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [puuid, region, queue, pageSize]);

    useEffect(() => {
        if (!puuid) {
            setHistory([]);
            setTotal(0);
            setDetails({});
            setExpanded(new Set());
            setAgentStats(null);
            setMapStats(null);
            setSyncStatus(null);
            return;
        }
        void refresh();
    }, [puuid, refresh]);

    const filteredHistory = useMemo(() => {
        if (!thisActOnly || !currentSeasonId) return history;
        return history.filter((m) => m.seasonId === currentSeasonId);
    }, [history, thisActOnly, currentSeasonId]);

    const toggleExpanded = useCallback(async (matchId: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(matchId)) next.delete(matchId);
            else next.add(matchId);
            return next;
        });
        // Lazy-fetch details the first time we expand.
        if (!details[matchId] && !loadingDetails.has(matchId) && puuid) {
            setLoadingDetails((prev) => new Set(prev).add(matchId));
            try {
                const det = await getProfileMatchDetails(matchId, { puuid, region });
                setDetails((prev) => ({ ...prev, [matchId]: det }));
            } catch (e) {
                console.warn("Failed to fetch match details", e);
                // Mark as attempted (empty) so we don't loop.
                setDetails((prev) => ({
                    ...prev,
                    [matchId]: {
                        matchId,
                        matchInfo: {} as ProfileMatchDetails["matchInfo"],
                        players: [],
                        servedFrom: "error",
                    },
                }));
            } finally {
                setLoadingDetails((prev) => {
                    const next = new Set(prev);
                    next.delete(matchId);
                    return next;
                });
            }
        }
    }, [details, loadingDetails, puuid, region]);

    const onSync = useCallback(async () => {
        if (!puuid || syncing) return;
        setSyncing(true);
        try {
            const res = await postProfileSync({ puuid, region });
            if (res.started) {
                showToast("Sync started — refreshing when ready…");
                for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    try {
                        const st = await getProfileSyncStatus({ puuid, region });
                        setSyncStatus(st);
                        if (!st.inFlight) break;
                    } catch {
                        /* ignore */
                    }
                }
                await refresh();
                showToast("Sync complete.");
            } else if (res.inFlight) {
                showToast("Sync already in flight — hang tight.");
            }
        } catch (e) {
            showToast(e instanceof Error ? e.message : "Sync failed.");
        } finally {
            setSyncing(false);
        }
    }, [puuid, region, syncing, refresh, showToast]);

    // Build the agent lookup shape AgentStatsTable expects (Agent[]).
    const agentLookup = useMemo<Record<string, Agent>>(() => {
        const out: Record<string, Agent> = {};
        for (const [k, v] of Object.entries(agents)) {
            out[k] = {
                uuid: k,
                displayName: v.name,
                displayIcon: v.icon,
                isBaseContent: false,
            };
        }
        return out;
    }, [agents]);

    const mapLookup = useMemo(() => {
        const out: Record<string, { displayName: string; splash?: string }> = {};
        for (const [k, v] of Object.entries(maps)) {
            out[k] = { displayName: v.name, splash: v.splash };
        }
        return out;
    }, [maps]);

    if (!activeAccount) {
        return (
            <div className="storefront-page scrollable-col">
                <section className="store-empty-hero clip-tactical">
                    <div>
                        <div className="tactical-kicker">// ACCOUNT REQUIRED</div>
                        <h1>Connect Riot to view your match history.</h1>
                        <p>Your last 20 games with KDA, agent, map, win/loss, and per-match breakdowns will appear here once you connect a Riot account.</p>
                    </div>
                    {onConnectAccount && (
                        <button type="button" className="connect-mega-btn clip-tactical-sm" onClick={onConnectAccount}>
                            Connect Riot Account
                        </button>
                    )}
                </section>
            </div>
        );
    }

    return (
        <div className="storefront-page scrollable-col">
            <div className="storefront-title-container d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
                <div>
                    <div className="tactical-kicker">// MATCH HISTORY</div>
                    <h2 className="mb-1 tactical-title">Recent Matches</h2>
                    <p className="text-muted small mb-0">
                        Showing {filteredHistory.length} of {total} cached games
                    </p>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    {syncStatus && (
                        <span className="sync-indicator" data-inflight={syncStatus.inFlight ? "true" : "false"}>
                            <span className="sync-dot" />
                            {syncStatus.totalMatches} cached
                        </span>
                    )}
                    <button
                        type="button"
                        className="btn-tactical"
                        onClick={onSync}
                        disabled={syncing || syncStatus?.inFlight}
                    >
                        {syncing ? (
                            <>
                                <span className="status-spinner" /> Syncing…
                            </>
                        ) : (
                            <>⟳ Sync</>
                        )}
                    </button>
                    <button type="button" className="btn-tactical-ghost" onClick={refresh} disabled={loading}>
                        {loading ? "⟳ Loading…" : "⟳ Refresh"}
                    </button>
                    <button
                        type="button"
                        className="btn-tactical-icon"
                        onClick={() => setShowRaw((v) => !v)}
                        title="Toggle raw JSON"
                    >
                        {showRaw ? "↦" : "{ }"}
                    </button>
                </div>
            </div>

            <div className="filter-bar clip-tactical-sm mb-3">
                <label className="filter-bar-label">
                    <span>Queue</span>
                    <select
                        className="form-select form-select-sm"
                        value={queue}
                        onChange={(e) => setQueue(e.target.value)}
                    >
                        {QUEUE_OPTIONS.map((q) => (
                            <option key={q.value} value={q.value}>{q.label}</option>
                        ))}
                    </select>
                </label>
                <label className="filter-bar-check">
                    <input
                        type="checkbox"
                        checked={thisActOnly}
                        onChange={(e) => setThisActOnly(e.target.checked)}
                        disabled={!currentSeasonId}
                    />
                    <span>This act only{currentSeasonId ? ` · ${currentSeasonId}` : ""}</span>
                </label>
                <label className="filter-bar-label">
                    <span>Page size</span>
                    <select
                        className="form-select form-select-sm"
                        value={pageSize}
                        onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                    >
                        {PAGE_SIZES.map((n) => (
                            <option key={n} value={n}>{n} games</option>
                        ))}
                    </select>
                </label>
            </div>

            {toast && <div className="profile-toast" role="status">{toast}</div>}
            {error && <div className="alert alert-warning mb-4">{error}</div>}

            {loading && filteredHistory.length === 0 && (
                <div className="text-center py-5">
                    <div className="spinner-border text-danger" style={{ width: "2.5rem", height: "2.5rem" }} />
                </div>
            )}

            {!loading && filteredHistory.length === 0 && !error && (
                <p className="text-muted small">No matches found. Click <strong>Sync</strong> to pull from Riot, or play a match and come back!</p>
            )}

            {filteredHistory.length > 0 && (
                <div className="match-history-list mb-5">
                    {filteredHistory.map((m) => {
                        const agent = agents[m.localPlayer?.characterId?.toLowerCase() ?? ""];
                        const agentName = agent?.name || m.localPlayer?.characterId?.slice(0, 8) || "Unknown";
                        const agentIcon = agent?.icon || `https://media.valorant-api.com/agents/${m.localPlayer?.characterId}/displayicon.png`;
                        const map = maps[m.mapID?.toLowerCase() ?? ""];
                        const mapName = map?.name || m.mapID?.split("/").pop() || "Unknown";
                        const isOpen = expanded.has(m.matchId);
                        const det = details[m.matchId];
                        const isLoadingDet = loadingDetails.has(m.matchId);
                        const lp = m.localPlayer;
                        return (
                            <div key={m.matchId} className={`match-card-wrap ${isOpen ? "expanded" : ""}`}>
                                <div
                                    className={`match-history-row clip-tactical-sm ${m.win ? "win" : "loss"}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => toggleExpanded(m.matchId)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            void toggleExpanded(m.matchId);
                                        }
                                    }}
                                >
                                    <div className="match-result-badge">
                                        {m.win ? "WIN" : "LOSS"}
                                    </div>
                                    <div className="match-agent">
                                        <Image
                                            src={agentIcon}
                                            alt={agentName}
                                            width={48}
                                            height={48}
                                            unoptimized
                                            className="match-agent-icon"
                                        />
                                        <div>
                                            <div className="match-agent-name">{agentName}</div>
                                            <div className="match-map-name">{mapName}</div>
                                        </div>
                                    </div>
                                    <div className="match-kda">
                                        <span className="kda-numbers">
                                            {lp ? `${lp.kills} / ${lp.deaths} / ${lp.assists}` : "—"}
                                        </span>
                                        <span className="kda-ratio">
                                            KDA {fmtRatio(lp?.kda)} · K/D {fmtRatio(lp?.kd)}
                                        </span>
                                        <span className="kda-ratio">
                                            HS {fmtPct(lp?.hsPct)} · ADR {Math.round(lp?.adr ?? 0)} · ACS {Math.round(lp?.acs ?? 0)}
                                        </span>
                                    </div>
                                    <div className="match-meta">
                                        <span className="match-queue">
                                            {QUEUE_LABEL[m.queueID?.toLowerCase()] || m.gameMode || m.queueID}
                                        </span>
                                        <span className="match-score">
                                            Score {lp?.score ?? 0}
                                        </span>
                                        <span className="match-time">
                                            {fmtLength(m.gameLengthMillis)} · {fmtDate(m.gameStartMillis)}
                                        </span>
                                    </div>
                                    <button
                                        type="button"
                                        className="match-expand-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void toggleExpanded(m.matchId);
                                        }}
                                        aria-label={isOpen ? "Collapse details" : "Expand details"}
                                    >
                                        {isOpen ? "▾" : "▸"}
                                    </button>
                                </div>

                                {isOpen && (
                                    <div className="expanded-detail-row clip-tactical-sm">
                                        <div className="expanded-detail-header">
                                            <strong>Match details</strong>
                                            {det && det.servedFrom && (
                                                <span className="text-muted small"> · served from {det.servedFrom}</span>
                                            )}
                                        </div>
                                        {isLoadingDet && (
                                            <div className="text-muted small">Loading 10 players…</div>
                                        )}
                                        {!isLoadingDet && det && det.players && det.players.length > 0 && (
                                            <div className="expanded-players-grid">
                                                {det.players.map((p, idx) => {
                                                    const a = agents[p.characterId?.toLowerCase() ?? ""];
                                                    const an = a?.name || p.characterId?.slice(0, 8) || "Unknown";
                                                    const ai = a?.icon || `https://media.valorant-api.com/agents/${p.characterId}/displayicon.png`;
                                                    // Win flag = blue or red matches localPlayer's team.
                                                    // MatchDetails has no per-player team, but blueWins tells us
                                                    // which side won. Without explicit team on each player we
                                                    // fall back to score comparison: this is best-effort.
                                                    const won = lp ? (m.win && lp.score >= p.score) || (!m.win && lp.score < p.score) : false;
                                                    return (
                                                        <div
                                                            key={`${p.characterId}-${idx}`}
                                                            className={`expanded-player ${won ? "win" : "loss"}`}
                                                        >
                                                            <Image
                                                                src={ai}
                                                                alt={an}
                                                                width={28}
                                                                height={28}
                                                                unoptimized
                                                                className="expanded-player-icon"
                                                            />
                                                            <span className="expanded-player-name">{an}</span>
                                                            <span className="expanded-player-kda">
                                                                {p.kills}/{p.deaths}/{p.assists}
                                                            </span>
                                                            <span className="expanded-player-ratio">
                                                                {fmtRatio(p.kda)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {!isLoadingDet && (!det || (det.players?.length ?? 0) === 0) && (
                                            <div className="text-muted small">No player details cached for this match yet.</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="row g-4 mb-4">
                <div className="col-12 col-lg-6">
                    <div className="tactical-kicker mb-2">// AGENT STATS {queue ? `· ${QUEUE_LABEL[queue] || queue}` : ""}</div>
                    <AgentStatsTable
                        agents={agentStats?.agents ?? []}
                        agentLookup={agentLookup}
                    />
                </div>
                <div className="col-12 col-lg-6">
                    <div className="tactical-kicker mb-2">// MAP STATS {queue ? `· ${QUEUE_LABEL[queue] || queue}` : ""}</div>
                    <MapStatsTable
                        maps={mapStats?.maps ?? []}
                        mapLookup={mapLookup}
                    />
                </div>
            </div>

            {showRaw && (
                <div className="raw-json-block clip-tactical-sm">
                    <div className="tactical-kicker">// RAW JSON · MATCH HISTORY (page)</div>
                    <pre>{JSON.stringify(filteredHistory, null, 2)}</pre>
                </div>
            )}
        </div>
    );
}