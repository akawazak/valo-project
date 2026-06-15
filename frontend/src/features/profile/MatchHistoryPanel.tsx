"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import { getMatchDetails, getMatchHistory, MatchHistoryResponse } from "@/services/api";

// Map and agent metadata from valorant-api.com (CDN — small payload, cached)
const MAP_NAME_FALLBACK: Record<string, string> = {
    "/Game/Maps/Ascent/Ascent": "Ascent",
    "/Game/Maps/Bind/Bind": "Bind",
    "/Game/Maps/Haven/Haven": "Haven",
    "/Game/Maps/Split/Split": "Split",
    "/Game/Maps/Icebox/Icebox": "Icebox",
    "/Game/Maps/Breeze/Breeze": "Breeze",
    "/Game/Maps/Fracture/Fracture": "Fracture",
    "/Game/Maps/Pearl/Pearl": "Pearl",
    "/Game/Maps/Lotus/Lotus": "Lotus",
    "/Game/Maps/Sunset/Sunset": "Sunset",
    "/Game/Maps/Abyss/Abyss": "Abyss",
};
const MAP_LIST: Record<string, string> = {
    "7eaecc1b-4337-bbf6-6ab9-04b8f06bf331": "Ascent",
    "2c9d57ec-4431-9c5d-8087-aa3c7c914776": "Bind",
    "2bee0dc9-4ffe-519b-1cbd-7cebe619a9d1": "Haven",
    "d960549e-485c-e861-8d71-aa9ac1e81d5a": "Split",
    "e2ad5c54-4114-a870-9641-8ea21279579a": "Icebox",
    "1c48427d-7655-c319-b23d-1a16f2c08284": "Breeze",
    "a5c3b7c0-2d33-c9c4-8e8c-4b2c1e3f5a7b": "Fracture",
    "fd267378-4d1d-484f-ff01-30d9ba5a7c9c": "Pearl",
    "689c7728-61f2-5a72-9b9f-6ca5fa3a1f7e": "Lotus",
    "92584f47-9c5b-4d0f-9c4a-3e7f8b6c2d5a": "Sunset",
    "224b0a95-48b9-f703-1d8c-7c0e2e1a3c1a": "Abyss",
};
const AGENT_UUID_TO_NAME: Record<string, string> = {
    "5f8d3a7f-467b-97f3-0623-8abacf02dbf7": "Astra",
    "f94c3b30-4656-395f-9f4e-4e10e23216bf": "Breach",
    "707eab51-5a3b-4e1d-9c2e-3a5b4c6d7e8f": "Brimstone",
    "9f0d8ba1-4a2b-8c3d-1e5f-6a7b8c9d0e1f": "Chamber",
    "22697a3d-45bf-8dd7-4fcf-1e1b6b6a8c2d": "Cypher",
    "b444168c-4e35-6d50-2c9a-3e4d5f6a7b8c": "Deadlock",
    "cc884928-4ac4-d0e1-7e8a-9a0b1c2d3e4f": "Fade",
    "a3f3b8a1-4d2e-5c6f-8a9b-0c1d2e3f4a5b": "Gekko",
    "7e3e7c1e-4d2b-1c5a-9f6e-0a1b2c3d4e5f": "Harbor",
    "6f1d2b9c-4a3d-7e5f-1a2b-3c4d5e6f7a8b": "Iso",
    "117ed9e3-49f3-6510-21cf-3b9b6c7d8e9f": "Jett",
    "a4c3b7d0-2e4f-1a2b-8c5d-9e0f1a2b3c4d": "KAY/O",
    "1dbf7c5a-4e2d-3f1a-9b5c-2d3e4f5a6b7c": "Killjoy",
    "0e38b510-41a8-3a4f-1e7c-9d2a3b4c5d6e": "Neon",
    "8e2d1b4c-5a3f-2e1d-9b7c-4d5e6f7a8b9c": "Omen",
    "5e2d1a3c-4b5f-2e7d-9c1a-3b4c5d6e7f8a": "Phoenix",
    "b9b2f8a1-4d3e-2c5f-8a9b-1c2d3e4f5a6b": "Raze",
    "7c8e9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b": "Reyna",
    "5f7d8e9a-2b3c-4d5e-6f7a-8b9c0d1e2f3a": "Sage",
    "b7c5d3e1-2a3f-4b5c-6d7e-8f9a0b1c2d3e": "Skye",
    "a0d9c8b7-4e5f-1a2b-3c4d-5e6f7a8b9c0d": "Sova",
    "8c1e2d3a-4b5f-6c7d-8e9f-0a1b2c3d4e5f": "Viper",
    "1b9e3b4a-2c5d-7e8f-9a0b-1c2d3e4f5a6b": "Yoru",
    "0b226a4e-4d3b-2a1f-9c8e-6f5d4c3b2a1f": "Clove",
    "b2a8c1d9-3e4f-5a6b-7c8d-9e0f1a2b3c4d": "Vyse",
    "3e6b4c5d-2a3f-4b5c-6d7e-8f9a0b1c2d3e": "Tejo",
    "d1b2c3a4-5e6f-7a8b-9c0d-1e2f3a4b5c6d": "Waylay",
};

const QUEUE_NAME: Record<string, string> = {
    "competitive": "Competitive",
    "unrated": "Unrated",
    "spikerush": "Spike Rush",
    "deathmatch": "Deathmatch",
    "swiftplay": "Swiftplay",
    "teamdeathmatch": "Team Deathmatch",
    "premier": "Premier",
    "custom": "Custom",
};

function mapName(mapId: string): string {
    if (!mapId) return "Unknown";
    return MAP_LIST[mapId] || MAP_NAME_FALLBACK[mapId] || mapId.split("/").pop() || "Unknown";
}

function agentName(characterId: string): string {
    if (!characterId) return "Unknown";
    return AGENT_UUID_TO_NAME[characterId.toLowerCase()] || characterId.slice(0, 8);
}

function queueLabel(queueId: string): string {
    return QUEUE_NAME[queueId?.toLowerCase()] || queueId || "Unknown";
}

function formatDate(ms: number): string {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface MatchRow extends Record<string, any> {
    matchId: string;
    agent: string;
    agentIcon: string;
    mapName: string;
    mapImage: string;
    queue: string;
    won: boolean | null;
    roundsWon: number;
    roundsLost: number;
    score: number;
    kills: number;
    deaths: number;
    assists: number;
    kdaRatio: string;
    gameStartMillis: number;
}

export default function MatchHistoryPanel({ onConnectAccount }: { onConnectAccount?: () => void }) {
    const { activeAccount, agents } = useData();
    const [history, setHistory] = useState<MatchHistoryResponse | null>(null);
    const [details, setDetails] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(false);
    const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
    const [error, setError] = useState("");
    const [pageSize, setPageSize] = useState(20);

    const agentMap = useMemo(() => {
        const m: Record<string, any> = {};
        for (const a of agents) {
            if (a.uuid) m[a.uuid.toLowerCase()] = a;
        }
        return m;
    }, [agents]);

    const refresh = useCallback(async () => {
        if (!activeAccount) return;
        setLoading(true);
        setError("");
        try {
            const res = await getMatchHistory(0, pageSize);
            setHistory(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load match history.");
        } finally {
            setLoading(false);
        }
    }, [activeAccount, pageSize]);

    useEffect(() => {
        if (!activeAccount) {
            setHistory(null);
            setDetails({});
            return;
        }
        refresh();
    }, [activeAccount, refresh]);

    // Lazy-load per-match details (KDA + agent) for each entry — endpoint can be slow
    useEffect(() => {
        if (!history || !activeAccount) return;
        for (const h of history.History) {
            if (details[h.MatchID] || loadingDetails.has(h.MatchID)) continue;
            setLoadingDetails(prev => new Set(prev).add(h.MatchID));
            getMatchDetails(h.MatchID)
                .then(d => {
                    setDetails(prev => ({ ...prev, [h.MatchID]: d }));
                })
                .catch(() => {
                    // Mark as loaded with null so we don't keep retrying
                    setDetails(prev => ({ ...prev, [h.MatchID]: null }));
                })
                .finally(() => {
                    setLoadingDetails(prev => {
                        const next = new Set(prev);
                        next.delete(h.MatchID);
                        return next;
                    });
                });
        }
    }, [history, activeAccount, details, loadingDetails]);

    const rows: MatchRow[] = useMemo(() => {
        if (!history) return [];
        return history.History.map((h: any) => {
            const det = details[h.MatchID];
            const subject = activeAccount?.puuid?.toLowerCase();
            const me = det?.players?.find((p: any) => p.subject?.toLowerCase() === subject);
            const myTeam = det?.matchInfo?.teams?.find((t: any) => t.teamId === me?.teamId);
            const won = myTeam ? !!myTeam.won : null;
            const agent = me?.characterId || "";
            const agentMeta = agentMap[agent.toLowerCase()];
            const kills = me?.stats?.kills ?? 0;
            const deaths = me?.stats?.deaths ?? 0;
            const assists = me?.stats?.assists ?? 0;
            const kdaRatio = deaths > 0 ? ((kills + assists) / deaths).toFixed(2) : "∞";
            return {
                ...h,
                matchId: h.MatchID,
                agent: agentMeta?.displayName || agentName(agent),
                agentIcon: agentMeta?.displayIcon || `https://media.valorant-api.com/agents/${agent}/displayicon.png`,
                mapName: mapName(h.MapID),
                mapImage: `https://media.valorant-api.com/maps/${(h.MapID || "").toLowerCase()}/splash.png`,
                queue: queueLabel(h.QueueID),
                won,
                roundsWon: myTeam?.roundsWon ?? 0,
                roundsLost: myTeam?.roundsLost ?? 0,
                score: me?.stats?.score ?? 0,
                kills,
                deaths,
                assists,
                kdaRatio,
                gameStartMillis: h.GameStartTime,
            };
        });
    }, [history, details, activeAccount, agentMap]);

    if (!activeAccount) {
        return (
            <div className="storefront-page scrollable-col">
                <section className="store-empty-hero clip-tactical">
                    <div>
                        <div className="tactical-kicker">// ACCOUNT REQUIRED</div>
                        <h1>Connect Riot to view your match history.</h1>
                        <p>Your last 20 games with KDA, agent, map, and win/loss will appear here once you connect a Riot account.</p>
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
                    <p className="text-muted small mb-0">Last {rows.length} of {history?.Total ?? 0} games</p>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <select className="form-select form-select-sm" value={pageSize} onChange={e => setPageSize(parseInt(e.target.value, 10))} style={{ width: 110 }}>
                        <option value={10}>10 games</option>
                        <option value={20}>20 games</option>
                        <option value={50}>50 games</option>
                    </select>
                    <button type="button" className="btn-tactical" onClick={refresh} disabled={loading}>
                        {loading ? "⟳ Loading…" : "⟳ Refresh"}
                    </button>
                </div>
            </div>

            {error && <div className="alert alert-warning mb-4">{error}</div>}

            {loading && rows.length === 0 && (
                <div className="text-center py-5">
                    <div className="spinner-border text-danger" style={{ width: "2.5rem", height: "2.5rem" }} />
                </div>
            )}

            {!loading && rows.length === 0 && !error && (
                <p className="text-muted small">No matches found. Play a match and come back!</p>
            )}

            {rows.length > 0 && (
                <div className="match-history-list">
                    {rows.map((row) => {
                        const isLoading = loadingDetails.has(row.matchId);
                        const hasData = !!details[row.matchId];
                        const won = row.won;
                        return (
                            <div
                                key={row.matchId}
                                className={`match-history-row clip-tactical-sm ${won === true ? "win" : won === false ? "loss" : ""}`}
                            >
                                <div className="match-result-badge">
                                    {won === true ? "WIN" : won === false ? "LOSS" : "—"}
                                </div>
                                <div className="match-agent">
                                    <Image src={row.agentIcon} alt={row.agent} width={48} height={48} unoptimized className="match-agent-icon" />
                                    <div>
                                        <div className="match-agent-name">{row.agent}</div>
                                        <div className="match-map-name">{row.mapName}</div>
                                    </div>
                                </div>
                                <div className="match-kda">
                                    {isLoading ? (
                                        <span className="text-muted small">…</span>
                                    ) : hasData ? (
                                        <>
                                            <span className="kda-numbers">{row.kills}/{row.deaths}/{row.assists}</span>
                                            <span className="kda-ratio">{row.kdaRatio} KDA</span>
                                        </>
                                    ) : (
                                        <span className="text-muted small">—</span>
                                    )}
                                </div>
                                <div className="match-meta">
                                    <span className="match-queue">{row.queue}</span>
                                    {row.won !== null && (
                                        <span className="match-score">{row.roundsWon}–{row.roundsLost}</span>
                                    )}
                                    <span className="match-time">{formatDate(row.gameStartMillis)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
