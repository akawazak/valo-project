"use client";

// RRHistoryChart — pure SVG line chart of ranked RR over time.
// Reads ProfileRRSnapshot[] from the /v1/profile/rr-history endpoint.
// No charting library; everything is rendered inline as <svg> elements
// (path / circles / axis ticks). Sized to fill its parent width.

import { useMemo } from "react";
import type { ProfileRRSnapshot } from "@/services/api";

interface Props {
    snapshots: ProfileRRSnapshot[];
    height?: number;
    source?: "rr" | "tier";
}

const PAD_LEFT = 36;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const RANKS = ["I", "B", "S", "G", "P", "D", "A", "Im"];

function rankPosition(tier: number, rr: number) {
    return Math.max(0, tier) * 100 + Math.max(0, rr);
}

function rankPositionLabel(value: number) {
    const tier = Math.max(0, Math.floor(value / 100));
    const rr = Math.max(0, Math.round(value % 100));
    if (tier < 3) return `${rr} RR`;
    if (tier >= 27) return "Rad";
    const group = RANKS[Math.floor((tier - 3) / 3)] || "R";
    return `${group}${((tier - 3) % 3) + 1} ${rr}`;
}

export default function RRHistoryChart({ snapshots, height = 180, source = "rr" }: Props) {
    const exactRR = source === "rr";
    const sorted = useMemo(
        () =>
            [...snapshots]
                .filter((s) => s && Number.isFinite(s.matchStartTime))
                .sort((a, b) => a.matchStartTime - b.matchStartTime),
        [snapshots],
    );

    // Empty state
    if (sorted.length === 0) {
        return (
            <div className="rr-chart empty">
                <div className="rr-chart-empty-msg">No ranked games recorded yet.</div>
            </div>
        );
    }

    // Single point — render a dot + label, no line.
    if (sorted.length === 1) {
        const only = sorted[0];
        return (
            <div className="rr-chart">
                <svg width="100%" height={height} viewBox={`0 0 600 ${height}`} preserveAspectRatio="none">
                    <circle cx={300} cy={height / 2} r={5} className="rr-chart-dot" />
                    <text x={310} y={height / 2 + 4} className="rr-chart-point-label">
                        {rankPositionLabel(rankPosition(only.tierAfter, exactRR ? only.rrAfter : 0))}
                    </text>
                </svg>
            </div>
        );
    }

    // Compute bounds
    const minTs = sorted[0].matchStartTime;
    const maxTs = sorted[sorted.length - 1].matchStartTime;
    const tsRange = Math.max(1, maxTs - minTs);

    let minRR = Infinity;
    let maxRR = -Infinity;
    for (const s of sorted) {
        const value = rankPosition(s.tierAfter, s.rrAfter);
        if (value < minRR) minRR = value;
        if (value > maxRR) maxRR = value;
    }
    // Pad the Y domain a touch so the line doesn't kiss the edges.
    const yPad = Math.max(10, (maxRR - minRR) * 0.15);
    const yLo = Math.max(0, Math.floor((minRR - yPad) / 10) * 10);
    const yHi = Math.ceil((maxRR + yPad) / 10) * 10;
    const yRange = Math.max(1, yHi - yLo);

    const width = 600;
    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;

    const xOf = (ts: number) =>
        PAD_LEFT + ((ts - minTs) / tsRange) * plotW;
    const yOf = (rr: number) =>
        PAD_TOP + (1 - (rr - yLo) / yRange) * plotH;

    const lineD = sorted
        .map((s, i) => `${i === 0 ? "M" : "L"} ${xOf(s.matchStartTime).toFixed(1)} ${yOf(rankPosition(s.tierAfter, s.rrAfter)).toFixed(1)}`)
        .join(" ");

    const areaD = sorted.length > 1
        ? `${lineD} L ${xOf(sorted[sorted.length - 1].matchStartTime).toFixed(1)} ${yOf(yLo).toFixed(1)} L ${xOf(sorted[0].matchStartTime).toFixed(1)} ${yOf(yLo).toFixed(1)} Z`
        : "";

    // Y axis ticks: 4 horizontal lines + labels
    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
        const rr = yLo + ((yHi - yLo) * i) / tickCount;
        return { rr: Math.round(rr), y: yOf(rr) };
    });

    // X axis: first + last date label
    const fmtDate = (ts: number) =>
        new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    return (
        <div className="rr-chart">
            <svg
                width="100%"
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="none"
            >
                <defs>
                    <linearGradient id="rrChartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent, #ff4655)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--accent, #ff4655)" stopOpacity="0.00" />
                    </linearGradient>
                </defs>

                {/* Gridlines + Y labels */}
                {ticks.map((t) => (
                    <g key={`tick-${t.rr}`}>
                        <line
                            x1={PAD_LEFT}
                            x2={width - PAD_RIGHT}
                            y1={t.y}
                            y2={t.y}
                            className="rr-chart-grid"
                        />
                        <text
                            x={PAD_LEFT - 6}
                            y={t.y + 4}
                            textAnchor="end"
                            className="rr-chart-axis-label"
                        >
                            {rankPositionLabel(exactRR ? t.rr : Math.round(t.rr / 100) * 100)}
                        </text>
                    </g>
                ))}

                {/* Area under the line */}
                {areaD && (
                    <path
                        d={areaD}
                        fill="url(#rrChartGrad)"
                        className="rr-chart-area-fill"
                    />
                )}

                {/* RR line */}
                <path d={lineD} className="rr-chart-line" />

                {/* Per-match dots */}
                {sorted.map((s, i) => (
                    <circle
                        key={`pt-${s.matchId}-${i}`}
                        cx={xOf(s.matchStartTime)}
                        cy={yOf(rankPosition(s.tierAfter, s.rrAfter))}
                        r={3}
                        className={`rr-chart-dot ${s.rrEarned >= 0 ? "win" : "loss"}`}
                    >
                        <title>
                            {exactRR ? <>
                            {new Date(s.matchStartTime).toLocaleString()} · {rankPositionLabel(rankPosition(s.tierBefore, s.rrBefore))}→{rankPositionLabel(rankPosition(s.tierAfter, s.rrAfter))}
                            {" "}({s.rrEarned >= 0 ? "+" : ""}{s.rrEarned} RR)
                            </> : <>
                                {new Date(s.matchStartTime).toLocaleString()} · tier checkpoint · {rankPositionLabel(s.tierAfter * 100)}
                            </>}
                        </title>
                    </circle>
                ))}

                {/* X axis date labels */}
                <text x={PAD_LEFT} y={height - 6} className="rr-chart-axis-label">
                    {fmtDate(minTs)}
                </text>
                <text
                    x={width - PAD_RIGHT}
                    y={height - 6}
                    textAnchor="end"
                    className="rr-chart-axis-label"
                >
                    {fmtDate(maxTs)}
                </text>
            </svg>
        </div>
    );
}
