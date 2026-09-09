"use client";

import { useId, useMemo, useState, type PointerEvent } from "react";
import type { ProfileRRSnapshot } from "@/services/api";

interface Props {
    snapshots: ProfileRRSnapshot[];
    height?: number;
    source?: "rr" | "tier";
    loading?: boolean;
}

const WIDTH = 720;
const PAD_LEFT = 54;
const PAD_RIGHT = 18;
const PAD_TOP = 22;
const PAD_BOTTOM = 34;
const RANKS = ["I", "B", "S", "G", "P", "D", "A", "Im"];
const RANK_NAMES = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
const TIER_COLORS = [
    "#64748b", "#64748b", "#64748b",
    "#6f7a87", "#84909d", "#9aa7b4",
    "#9a6348", "#b57955", "#cf9064",
    "#8996a6", "#a8b3c1", "#c7d0db",
    "#c99b2e", "#e3b63e", "#ffd761",
    "#189b98", "#2bb8b2", "#55d7ce",
    "#5c70d6", "#7588ef", "#96a5ff",
    "#168f62", "#24b77d", "#52d69e",
    "#9f3f8c", "#c451a7", "#eb6bc5",
    "#f3d176",
] as const;

function rankColor(tier: number) {
    return TIER_COLORS[Math.max(0, Math.min(TIER_COLORS.length - 1, Math.round(tier)))] || TIER_COLORS[0];
}

function rankTierLabel(tier: number) {
    if (tier < 3) return "Unranked";
    if (tier >= 27) return "Radiant";
    const group = RANK_NAMES[Math.floor((tier - 3) / 3)] || "Rank";
    return `${group} ${((tier - 3) % 3) + 1}`;
}

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

function fullRankPositionLabel(value: number) {
    const tier = Math.max(0, Math.floor(value / 100));
    const rr = Math.max(0, Math.round(value % 100));
    if (tier < 3) return `${rr} RR`;
    if (tier >= 27) return "Radiant";
    const group = RANK_NAMES[Math.floor((tier - 3) / 3)] || "Rank";
    return `${group} ${((tier - 3) % 3) + 1} · ${rr} RR`;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
    if (points.length < 2) return "";
    let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const middle = (current.x + next.x) / 2;
        path += ` C ${middle.toFixed(1)} ${current.y.toFixed(1)}, ${middle.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }
    return path;
}

function compactTimestamp(timestamp: number, sameDay: boolean) {
    const date = new Date(timestamp);
    if (sameDay) {
        return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${date.toLocaleTimeString(undefined, { hour: "numeric" })}`;
}

export default function RRHistoryChart({ snapshots, height = 220, source = "rr", loading = false }: Props) {
    const gradientId = useId().replace(/:/g, "");
    const exactRR = source === "rr";
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const sorted = useMemo(
        () => [...snapshots]
            .filter((snapshot) => snapshot && Number.isFinite(snapshot.matchStartTime))
            .sort((left, right) => left.matchStartTime - right.matchStartTime),
        [snapshots],
    );

    const model = useMemo(() => {
        if (!sorted.length) return null;
        const values = sorted.map((snapshot) => rankPosition(snapshot.tierAfter, exactRR ? snapshot.rrAfter : 0));
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const padding = Math.max(exactRR ? 18 : 45, (maximum - minimum) * 0.18);
        const low = Math.max(0, Math.floor((minimum - padding) / 10) * 10);
        const high = Math.max(low + 20, Math.ceil((maximum + padding) / 10) * 10);
        const range = high - low;
        const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
        const plotHeight = height - PAD_TOP - PAD_BOTTOM;
        const xOf = (index: number) => sorted.length === 1
            ? PAD_LEFT + plotWidth / 2
            : PAD_LEFT + (index / (sorted.length - 1)) * plotWidth;
        const yOf = (value: number) => PAD_TOP + (1 - (value - low) / range) * plotHeight;
        const points = sorted.map((snapshot, index) => ({
            x: xOf(index),
            y: yOf(values[index]),
            value: values[index],
            color: rankColor(snapshot.tierAfter),
            snapshot,
        }));
        const line = smoothPath(points);
        const segments = points.slice(1).map((next, index) => {
            const current = points[index];
            const middle = (current.x + next.x) / 2;
            return {
                path: `M ${current.x.toFixed(1)} ${current.y.toFixed(1)} C ${middle.toFixed(1)} ${current.y.toFixed(1)}, ${middle.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`,
                key: `${next.snapshot.matchId}-${index}`,
                gradientId: `${gradientId}-rank-segment-${index}`,
                fromColor: current.color,
                toColor: next.color,
                fromX: current.x,
                toX: next.x,
            };
        });
        const baseline = yOf(low);
        const area = points.length > 1
            ? `${line} L ${points[points.length - 1].x.toFixed(1)} ${baseline.toFixed(1)} L ${points[0].x.toFixed(1)} ${baseline.toFixed(1)} Z`
            : "";
        const ticks = Array.from({ length: 5 }, (_, index) => {
            const value = low + ((high - low) * index) / 4;
            return { value, y: yOf(value), color: rankColor(Math.floor(value / 100)) };
        });
        const firstTier = Math.max(0, Math.floor(low / 100));
        const lastTier = Math.min(27, Math.floor(high / 100));
        const rankBands = Array.from({ length: lastTier - firstTier + 1 }, (_, index) => {
            const tier = firstTier + index;
            const bottomValue = Math.max(low, tier * 100);
            const topValue = Math.min(high, (tier + 1) * 100);
            const y = yOf(topValue);
            return {
                tier,
                y,
                height: Math.max(0, yOf(bottomValue) - y),
                color: rankColor(tier),
                label: rankTierLabel(tier),
            };
        }).filter((band) => band.height > 0);
        const transitions = points.slice(1).flatMap((point, index) => {
            const previous = points[index];
            if (point.snapshot.tierAfter === previous.snapshot.tierAfter) return [];
            return [{
                pointIndex: index + 1,
                x: point.x,
                y: point.y,
                color: point.color,
                label: rankTierLabel(point.snapshot.tierAfter),
                direction: point.snapshot.tierAfter > previous.snapshot.tierAfter ? "Promotion" : "Demotion",
            }];
        });
        const dateTickCount = Math.min(4, sorted.length);
        const dateIndexes = Array.from(new Set(Array.from({ length: dateTickCount }, (_, index) => (
            Math.round((index / Math.max(1, dateTickCount - 1)) * (sorted.length - 1))
        ))));
        const dateTicks = dateIndexes.map((pointIndex) => ({
            timestamp: sorted[pointIndex].matchStartTime,
            x: xOf(pointIndex),
        }));
        const sameDay = new Date(sorted[0].matchStartTime).toDateString()
            === new Date(sorted[sorted.length - 1].matchStartTime).toDateString();
        return { values, points, line, segments, area, ticks, rankBands, transitions, dateTicks, sameDay };
    }, [exactRR, gradientId, height, sorted]);

    if (!model) {
        return (
            <div className={`rr-chart empty${loading ? " loading" : ""}`} role="status" aria-live="polite">
                {loading ? <i className="rr-chart-loading-dot" aria-hidden="true" /> : null}
                <div className="rr-chart-empty-msg">{loading ? "Updating ranked progression…" : "No ranked games recorded yet."}</div>
            </div>
        );
    }

    const firstValue = model.values[0];
    const lastValue = model.values[model.values.length - 1];
    const peakValue = Math.max(...model.values);
    const netChange = exactRR
        ? sorted.reduce((total, snapshot) => total + snapshot.rrEarned, 0)
        : lastValue - firstValue;
    const activePoint = activeIndex === null ? null : model.points[activeIndex];
    const activeTransition = activeIndex === null
        ? null
        : model.transitions.find((transition) => transition.pointIndex === activeIndex);
    const currentColor = model.points[model.points.length - 1].color;
    const peakPoint = model.points.reduce((best, point) => point.value > best.value ? point : best, model.points[0]);
    const recentForm = sorted.slice(-5);

    const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * WIDTH;
        let nearest = 0;
        let nearestDistance = Infinity;
        for (let index = 0; index < model.points.length; index += 1) {
            const distance = Math.abs(model.points[index].x - x);
            if (distance < nearestDistance) {
                nearest = index;
                nearestDistance = distance;
            }
        }
        setActiveIndex(nearest);
    };

    return (
        <div className="rr-chart">
            <div className="rr-chart-summary">
                <span data-tone="current"><small>Current</small><strong style={{ color: currentColor }}>{fullRankPositionLabel(lastValue)}</strong></span>
                <span data-tone={netChange >= 0 ? "positive" : "negative"}><small>Net change</small><strong>{netChange > 0 ? "+" : ""}{netChange}{exactRR ? " RR" : ""}</strong></span>
                <span data-tone="peak"><small>Peak</small><strong style={{ color: peakPoint.color }}>{fullRankPositionLabel(peakValue)}</strong></span>
                <span data-tone="form"><small>Recent form</small><strong className="rr-chart-form" aria-label={`Last ${recentForm.length} results`}>
                    {recentForm.map((snapshot, index) => (
                        <i key={`${snapshot.matchId}-form-${index}`} data-result={snapshot.rrEarned > 0 ? "win" : snapshot.rrEarned < 0 ? "loss" : "neutral"}>
                            {snapshot.rrEarned > 0 ? "W" : snapshot.rrEarned < 0 ? "L" : "—"}
                        </i>
                    ))}
                </strong></span>
                <span><small>Sample</small><strong>{sorted.length} games</strong></span>
            </div>
            <div className="rr-chart-legend" aria-label="Chart legend">
                <span><i data-tone="rank" style={{ background: currentColor, color: currentColor }} />Line follows rank color</span>
                <span><i data-tone="gain" />Win</span>
                <span><i data-tone="loss" />Loss</span>
                <em>Equal spacing · one point per ranked game</em>
            </div>
            {model.transitions.length ? (
                <div className="rr-chart-milestones" aria-label="Rank changes">
                    <small>Rank changes</small>
                    {model.transitions.map((transition) => (
                        <span key={`${transition.pointIndex}-${transition.label}`} style={{ borderColor: `${transition.color}66`, color: transition.color }}>
                            <i>{transition.direction === "Promotion" ? "↑" : "↓"}</i>
                            {transition.direction} · {transition.label}
                        </span>
                    ))}
                </div>
            ) : null}
            <div className="rr-chart-stage">
                <svg
                    width="100%"
                    height={height}
                    viewBox={`0 0 ${WIDTH} ${height}`}
                    preserveAspectRatio="none"
                    onPointerMove={handlePointerMove}
                    onPointerLeave={() => setActiveIndex(null)}
                    role="img"
                    aria-label={`Rank history with ${sorted.length} recorded games. Current ${rankPositionLabel(lastValue)}, peak ${rankPositionLabel(peakValue)}.`}
                >
                    <defs>
                        <linearGradient id={`${gradientId}-area`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={peakPoint.color} stopOpacity="0.28" />
                            <stop offset="55%" stopColor={currentColor} stopOpacity="0.09" />
                            <stop offset="100%" stopColor={currentColor} stopOpacity="0" />
                        </linearGradient>
                        <linearGradient id={`${gradientId}-line`} x1="0" y1="0" x2="1" y2="0">
                            <stop offset="0%" stopColor="#38bdf8" />
                            <stop offset="55%" stopColor="#818cf8" />
                            <stop offset="100%" stopColor="#a78bfa" />
                        </linearGradient>
                        <filter id={`${gradientId}-glow`} x="-20%" y="-40%" width="140%" height="180%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                        </filter>
                        {model.segments.map((segment) => (
                            <linearGradient key={segment.gradientId} id={segment.gradientId} gradientUnits="userSpaceOnUse" x1={segment.fromX} x2={segment.toX}>
                                <stop offset="0%" stopColor={segment.fromColor} />
                                <stop offset="100%" stopColor={segment.toColor} />
                            </linearGradient>
                        ))}
                    </defs>

                    {model.rankBands.map((band) => (
                        <g key={`rank-band-${band.tier}`} className="rr-chart-rank-band">
                            <rect x={PAD_LEFT} y={band.y} width={WIDTH - PAD_LEFT - PAD_RIGHT} height={band.height} fill={band.color} />
                            {band.height >= 26 ? <text x={WIDTH - PAD_RIGHT - 6} y={band.y + 13} textAnchor="end" fill={band.color}>{band.label}</text> : null}
                        </g>
                    ))}
                    {model.ticks.map((tick) => (
                        <g key={`tick-${tick.value}`}>
                            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={tick.y} y2={tick.y} className="rr-chart-grid" />
                            <text x={PAD_LEFT - 9} y={tick.y + 4} textAnchor="end" className="rr-chart-axis-label" style={{ fill: tick.color }}>
                                {rankPositionLabel(exactRR ? tick.value : Math.round(tick.value / 100) * 100)}
                            </text>
                        </g>
                    ))}
                    {model.dateTicks.map((tick, index) => (
                        <g key={tick.timestamp}>
                            {index > 0 && index < model.dateTicks.length - 1 ? <line x1={tick.x} x2={tick.x} y1={PAD_TOP} y2={height - PAD_BOTTOM} className="rr-chart-grid rr-chart-grid-vertical" /> : null}
                            <text x={tick.x} y={height - 9} textAnchor={index === 0 ? "start" : index === model.dateTicks.length - 1 ? "end" : "middle"} className="rr-chart-axis-label">
                                {compactTimestamp(tick.timestamp, model.sameDay)}
                            </text>
                        </g>
                    ))}

                    {model.area ? <path d={model.area} fill={`url(#${gradientId}-area)`} className="rr-chart-area-fill" /> : null}
                    {model.line ? <path d={model.line} className="rr-chart-line-glow" filter={`url(#${gradientId}-glow)`} /> : null}
                    {model.line ? <path d={model.line} className="rr-chart-line" stroke={`url(#${gradientId}-line)`} /> : null}
                    {model.segments.map((segment) => (
                        <path key={segment.key} d={segment.path} className="rr-chart-segment" stroke={`url(#${segment.gradientId})`} />
                    ))}

                    {model.points.map((point, index) => (
                        <g key={`${point.snapshot.matchId}-${index}`}>
                            <circle cx={point.x} cy={point.y} r={activeIndex === index ? 6.3 : 4.6} className="rr-chart-rank-dot" style={{ stroke: point.color }} />
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={activeIndex === index ? 3.4 : 2.35}
                                className={`rr-chart-dot ${point.snapshot.rrEarned > 0 ? "win" : point.snapshot.rrEarned < 0 ? "loss" : "neutral"}${index === model.points.length - 1 ? " latest" : ""}`}
                            />
                        </g>
                    ))}
                    {model.transitions.map((transition) => (
                        <g key={`transition-${transition.pointIndex}`} className="rr-chart-rank-change">
                            <line x1={transition.x} x2={transition.x} y1={PAD_TOP} y2={height - PAD_BOTTOM} style={{ stroke: transition.color }} />
                            <path d={`M ${transition.x} ${Math.max(PAD_TOP + 8, transition.y - 10)} l 4 4 l -4 4 l -4 -4 Z`} style={{ fill: transition.color }} />
                        </g>
                    ))}
                    {activePoint ? (
                        <g className="rr-chart-focus" aria-hidden="true">
                            <line x1={activePoint.x} x2={activePoint.x} y1={PAD_TOP} y2={height - PAD_BOTTOM} />
                            <circle cx={activePoint.x} cy={activePoint.y} r={8} />
                        </g>
                    ) : null}
                </svg>
                {activePoint ? (
                    <div
                        className={`rr-chart-tooltip${activePoint.x > WIDTH * 0.68 ? " align-right" : ""}`}
                        style={{ left: `${(activePoint.x / WIDTH) * 100}%`, top: `${(activePoint.y / height) * 100}%` }}
                    >
                        <small>{new Date(activePoint.snapshot.matchStartTime).toLocaleString()}</small>
                        <strong>{fullRankPositionLabel(activePoint.value)}</strong>
                        <span data-tone={activePoint.snapshot.rrEarned >= 0 ? "positive" : "negative"}>
                            {exactRR ? `${activePoint.snapshot.rrEarned > 0 ? "+" : ""}${activePoint.snapshot.rrEarned} RR` : "Tier checkpoint"}
                        </span>
                        {activeTransition ? <em style={{ color: activeTransition.color }}>{activeTransition.direction} · {activeTransition.label}</em> : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
