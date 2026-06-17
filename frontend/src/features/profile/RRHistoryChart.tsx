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
}

const PAD_LEFT = 36;
const PAD_RIGHT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

export default function RRHistoryChart({ snapshots, height = 180 }: Props) {
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
                        {only.rrAfter} RR
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
        if (s.rrAfter < minRR) minRR = s.rrAfter;
        if (s.rrAfter > maxRR) maxRR = s.rrAfter;
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
        .map((s, i) => `${i === 0 ? "M" : "L"} ${xOf(s.matchStartTime).toFixed(1)} ${yOf(s.rrAfter).toFixed(1)}`)
        .join(" ");

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
                            {t.rr}
                        </text>
                    </g>
                ))}

                {/* RR line */}
                <path d={lineD} className="rr-chart-line" />

                {/* Per-match dots */}
                {sorted.map((s, i) => (
                    <circle
                        key={`pt-${s.matchId}-${i}`}
                        cx={xOf(s.matchStartTime)}
                        cy={yOf(s.rrAfter)}
                        r={2.5}
                        className={`rr-chart-dot ${s.rrEarned >= 0 ? "win" : "loss"}`}
                    >
                        <title>
                            {new Date(s.matchStartTime).toLocaleString()} · {s.rrBefore}→{s.rrAfter}
                            {" "}({s.rrEarned >= 0 ? "+" : ""}{s.rrEarned} RR)
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
