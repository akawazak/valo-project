"use client";

// MapStatsTable — per-map winrate / matches / score.
// Reads ProfileMapStat[] from the /v1/profile/map-stats endpoint.
// Sorted by matches desc (server-side).

import { useMemo } from "react";
import Image from "next/image";
import type { ProfileMapStat } from "@/services/api";

interface Props {
    maps: ProfileMapStat[];
    mapLookup: Record<string, { displayName: string; splash?: string }>;
    emptyMessage?: string;
}

function pct(n: number): string {
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(1)}%`;
}

export default function MapStatsTable({
    maps,
    mapLookup,
    emptyMessage = "No map data yet.",
}: Props) {
    const rows = useMemo(
        () =>
            [...maps]
                .filter((m) => m.matches > 0)
                .sort((a, b) => b.matches - a.matches),
        [maps],
    );

    if (rows.length === 0) {
        return <div className="stats-table-empty">{emptyMessage}</div>;
    }

    return (
        <div className="stats-table-wrap">
            <table className="stats-table">
                <thead>
                    <tr>
                        <th className="stats-table-icon-col" aria-label="Map" />
                        <th>Map</th>
                        <th className="stats-table-num">Games</th>
                        <th className="stats-table-num">Wins</th>
                        <th className="stats-table-num">Winrate</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((m) => {
                        const meta = mapLookup[m.mapID.toLowerCase()];
                        const splash =
                            meta?.splash ||
                            `https://media.valorant-api.com/maps/${m.mapID}/splash.png`;
                        const name = meta?.displayName || m.mapID.slice(0, 8);
                        return (
                            <tr key={m.mapID}>
                                <td className="stats-table-icon-cell">
                                    <Image
                                        src={splash}
                                        alt={name}
                                        width={48}
                                        height={28}
                                        unoptimized
                                        className="stats-table-map-thumb"
                                    />
                                </td>
                                <td className="stats-table-agent-name">{name}</td>
                                <td className="stats-table-num">{m.matches}</td>
                                <td className="stats-table-num">{m.wins}</td>
                                <td className="stats-table-num">
                                    <div className="winrate-bar-container">
                                        <span className={m.winrate >= 55 ? "wr-good" : m.winrate < 45 ? "wr-bad" : "text-secondary"}>
                                            {pct(m.winrate)}
                                        </span>
                                        <div className="winrate-bar-track">
                                            <div
                                                className={`winrate-bar-fill ${m.winrate >= 55 ? "good" : m.winrate < 45 ? "bad" : "neutral"}`}
                                                style={{ width: `${m.winrate}%` }}
                                            />
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
