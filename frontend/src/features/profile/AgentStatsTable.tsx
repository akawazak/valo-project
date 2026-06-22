"use client";

// AgentStatsTable — per-agent winrate / KDA / HS% / matches.
// Reads ProfileAgentStat[] from the /v1/profile/agent-stats endpoint.
// Sorted by matches desc (server-side). Row's left edge = agent icon.

import { useMemo } from "react";
import Image from "next/image";
import type { Agent } from "@/lib/types";
import type { ProfileAgentStat } from "@/services/api";

interface Props {
    agents: ProfileAgentStat[];
    agentLookup: Record<string, Agent>;
    emptyMessage?: string;
}

function pct(n: number): string {
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(1)}%`;
}

function ratio(n: number): string {
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(2);
}

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

function durationLabel(ms: number): string {
    if (!ms || ms <= 0) return "—";
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export default function AgentStatsTable({
    agents,
    agentLookup,
    emptyMessage = "No agent data yet.",
}: Props) {
    const rows = useMemo(
        () =>
            [...agents]
                .filter((a) => a.matches > 0)
                .sort((a, b) => b.matches - a.matches),
        [agents],
    );

    if (rows.length === 0) {
        return <div className="stats-table-empty">{emptyMessage}</div>;
    }

    return (
        <div className="stats-table-wrap">
            <table className="stats-table">
                <thead>
                    <tr>
                        <th className="stats-table-icon-col" aria-label="Agent" />
                        <th>Agent</th>
                        <th className="stats-table-num">Games</th>
                        <th className="stats-table-num">Wins</th>
                        <th className="stats-table-num">Winrate</th>
                        <th className="stats-table-num">KDA</th>
                        <th className="stats-table-num">K/D</th>
                        <th className="stats-table-num">HS%</th>
                        <th className="stats-table-num">Time</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((a) => {
                        const meta = agentLookup[a.characterId.toLowerCase()];
                        const icon =
                            meta?.displayIcon ||
                            `https://media.valorant-api.com/agents/${a.characterId}/displayicon.png`;
                        const name = meta?.displayName || a.characterId.slice(0, 8);
                        return (
                            <tr key={a.characterId}>
                                <td className="stats-table-icon-cell">
                                    <Image
                                        src={icon}
                                        alt={name}
                                        width={36}
                                        height={36}
                                        unoptimized
                                        className="stats-table-agent-icon"
                                    />
                                </td>
                                <td className="stats-table-agent-name">{name}</td>
                                <td className="stats-table-num">{a.matches}</td>
                                <td className="stats-table-num">{a.wins}</td>
                                <td className="stats-table-num">
                                    <div className="winrate-bar-container">
                                        <span className={a.winrate >= 55 ? "wr-good" : a.winrate < 45 ? "wr-bad" : "text-secondary"}>
                                            {pct(a.winrate)}
                                        </span>
                                        <div className="winrate-bar-track">
                                            <div
                                                className={`winrate-bar-fill ${a.winrate >= 55 ? "good" : a.winrate < 45 ? "bad" : "neutral"}`}
                                                style={{ width: `${a.winrate}%` }}
                                            />
                                        </div>
                                    </div>
                                </td>
                                <td className="stats-table-num">
                                    <span className={kdColor(a.kda)}>
                                        {ratio(a.kda)}
                                    </span>
                                </td>
                                <td className="stats-table-num">
                                    <span className={kdColor(a.kd)}>
                                        {ratio(a.kd)}
                                    </span>
                                </td>
                                <td className="stats-table-num">
                                    <span className={hsColor(a.hsPct)}>
                                        {pct(a.hsPct)}
                                    </span>
                                </td>
                                <td className="stats-table-num">{durationLabel(a.timePlayedMillis)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
