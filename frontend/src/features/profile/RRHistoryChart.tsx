"use client";

import { useEffect, useId, useMemo, useState, type PointerEvent } from "react";
import type { ProfileRRSnapshot } from "@/services/api";
import { useCompetitiveTiers, type CompetitiveTier } from "@/lib/gameMeta";

interface Props {
    snapshots: ProfileRRSnapshot[];
    height?: number;
    source?: "rr" | "tier";
    loading?: boolean;
}

const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 280;
const PAD_LEFT = 88;
const PAD_RIGHT = 16;
const PAD_TOP = 32;
const PAD_BOTTOM = 24;
// Per-game RR bars sit in their own strip under the line.
const BAR_GAP = 12;
const BAR_STRIP = 30;
const FORM_COUNT = 10;
const FALLBACK_COLOR = "#94a3b8";

type Tiers = Map<number, CompetitiveTier>;
type Result = "win" | "loss" | "neutral";

function rankColor(tiers: Tiers, tier: number) {
    return tiers.get(Math.round(tier))?.color || FALLBACK_COLOR;
}

function rankTierLabel(tiers: Tiers, tier: number) {
    return tiers.get(Math.round(tier))?.name || `Tier ${Math.round(tier)}`;
}

function rankPosition(tier: number, rr: number) {
    return Math.max(0, tier) * 100 + Math.max(0, rr);
}

function rankPositionLabel(tiers: Tiers, value: number, exactRR: boolean) {
    const tier = Math.max(0, Math.floor(value / 100));
    const rr = Math.max(0, Math.round(value % 100));
    return exactRR ? `${rankTierLabel(tiers, tier)} · ${rr} RR` : rankTierLabel(tiers, tier);
}

function resultOf(snapshot: ProfileRRSnapshot): Result {
    return snapshot.rrEarned > 0 ? "win" : snapshot.rrEarned < 0 ? "loss" : "neutral";
}

function signed(value: number) {
    return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}`;
}

function compactTimestamp(timestamp: number, sameDay: boolean) {
    const date = new Date(timestamp);
    if (sameDay) {
        return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function RRHistoryChart({ snapshots, height = 220, source = "rr", loading = false }: Props) {
    const gradientId = useId().replace(/:/g, "");
    const exactRR = source === "rr";
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const tiers = useCompetitiveTiers();
    const [stage, setStage] = useState<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(DEFAULT_WIDTH);

    // Draw the SVG at the stage's real pixel width instead of stretching a
    // fixed viewBox, so text, dots and bars keep their proportions. The stage
    // only mounts once data arrives, so observe it through a callback ref.
    useEffect(() => {
        if (!stage || typeof ResizeObserver === "undefined") return;
        const update = () => {
            const next = Math.max(MIN_WIDTH, Math.round(stage.clientWidth));
            setWidth((current) => current === next ? current : next);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(stage);
        return () => observer.disconnect();
    }, [stage]);
    const sorted = useMemo(
        () => [...snapshots]
            // Unranked or unknown-tier games have no place on a rank axis.
            .filter((snapshot) => snapshot && Number.isFinite(snapshot.matchStartTime) && snapshot.tierAfter > 0)
            .sort((left, right) => left.matchStartTime - right.matchStartTime),
        [snapshots],
    );

    const model = useMemo(() => {
        if (!sorted.length) return null;
        const showBars = exactRR && sorted.length > 1;
        const values = sorted.map((snapshot) => rankPosition(snapshot.tierAfter, exactRR ? snapshot.rrAfter : 0));
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const padding = Math.max(exactRR ? 16 : 45, (maximum - minimum) * 0.16);
        const low = Math.max(0, Math.floor((minimum - padding) / 10) * 10);
        const high = Math.max(low + 20, Math.ceil((maximum + padding) / 10) * 10);
        const range = high - low;
        const plotRight = width - PAD_RIGHT;
        const plotWidth = plotRight - PAD_LEFT;
        const plotBottom = height - PAD_BOTTOM - (showBars ? BAR_GAP + BAR_STRIP : 0);
        const plotHeight = Math.max(40, plotBottom - PAD_TOP);
        const step = sorted.length > 1 ? plotWidth / (sorted.length - 1) : plotWidth;
        const xOf = (index: number) => sorted.length === 1
            ? PAD_LEFT + plotWidth / 2
            : PAD_LEFT + index * step;
        const yOf = (value: number) => PAD_TOP + (1 - (value - low) / range) * plotHeight;
        const points = sorted.map((snapshot, index) => ({
            x: xOf(index),
            y: yOf(values[index]),
            value: values[index],
            color: rankColor(tiers, snapshot.tierAfter),
            result: resultOf(snapshot),
            snapshot,
        }));
        const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
        const segments = points.slice(1).map((next, index) => {
            const current = points[index];
            return {
                key: `${next.snapshot.matchId}-${index}`,
                path: `M ${current.x.toFixed(1)} ${current.y.toFixed(1)} L ${next.x.toFixed(1)} ${next.y.toFixed(1)}`,
                gradientId: `${gradientId}-segment-${index}`,
                fromColor: current.color,
                toColor: next.color,
                fromX: current.x,
                toX: next.x === current.x ? current.x + 1 : next.x,
            };
        });
        const area = points.length > 1
            ? `${line} L ${points[points.length - 1].x.toFixed(1)} ${plotBottom.toFixed(1)} L ${points[0].x.toFixed(1)} ${plotBottom.toFixed(1)} Z`
            : "";

        // One band per rank tier inside the visible range, labelled in its middle.
        const firstTier = Math.max(0, Math.floor(low / 100));
        const lastTier = Math.floor(high / 100);
        const bands = Array.from({ length: lastTier - firstTier + 1 }, (_, index) => {
            const tier = firstTier + index;
            const top = yOf(Math.min(high, (tier + 1) * 100));
            const bottom = yOf(Math.max(low, tier * 100));
            return {
                tier,
                top,
                height: Math.max(0, bottom - top),
                color: rankColor(tiers, tier),
                label: rankTierLabel(tiers, tier),
                boundary: tier * 100 > low ? bottom : null,
            };
        }).filter((band) => band.height > 0 && tiers.has(band.tier));

        // Promotion / demotion flags along the top edge; skip a label that would
        // collide with the previous one but keep its marker line.
        let lastLabelRight = -Infinity;
        const transitions = points.slice(1).flatMap((point, index) => {
            const previous = points[index];
            if (point.snapshot.tierAfter === previous.snapshot.tierAfter) return [];
            const up = point.snapshot.tierAfter > previous.snapshot.tierAfter;
            const label = `${up ? "▲" : "▼"} ${rankTierLabel(tiers, point.snapshot.tierAfter)}`;
            const labelWidth = label.length * 6.1 + 16;
            const labelX = Math.min(plotRight - labelWidth / 2, Math.max(PAD_LEFT + labelWidth / 2, point.x));
            const showLabel = labelX - labelWidth / 2 > lastLabelRight + 6;
            if (showLabel) lastLabelRight = labelX + labelWidth / 2;
            return [{
                pointIndex: index + 1,
                x: point.x,
                color: point.color,
                up,
                label,
                labelWidth,
                labelX,
                showLabel,
                direction: up ? "Promotion" : "Demotion",
                tierLabel: rankTierLabel(tiers, point.snapshot.tierAfter),
            }];
        });

        const stripTop = plotBottom + BAR_GAP;
        const stripMid = stripTop + BAR_STRIP / 2;
        const maxSwing = Math.max(1, ...sorted.map((snapshot) => Math.abs(snapshot.rrEarned)));
        const barWidth = Math.max(2, Math.min(14, step * 0.5));
        const bars = showBars
            ? points.map((point) => {
                const size = (Math.abs(point.snapshot.rrEarned) / maxSwing) * (BAR_STRIP / 2 - 1);
                return {
                    x: point.x - barWidth / 2,
                    width: barWidth,
                    y: point.snapshot.rrEarned >= 0 ? stripMid - size : stripMid,
                    height: Math.max(point.snapshot.rrEarned === 0 ? 0 : 1.5, size),
                    result: point.result,
                };
            })
            : [];

        const dateTickCount = Math.min(width < 520 ? 3 : 5, sorted.length);
        const dateIndexes = Array.from(new Set(Array.from({ length: dateTickCount }, (_, index) => (
            Math.round((index / Math.max(1, dateTickCount - 1)) * (sorted.length - 1))
        ))));
        const sameDay = new Date(sorted[0].matchStartTime).toDateString()
            === new Date(sorted[sorted.length - 1].matchStartTime).toDateString();
        const seenDates = new Set<string>();
        const dateTicks = dateIndexes.flatMap((pointIndex) => {
            const timestamp = sorted[pointIndex].matchStartTime;
            const label = compactTimestamp(timestamp, sameDay);
            if (seenDates.has(label)) return [];
            seenDates.add(label);
            return [{ timestamp, label, x: xOf(pointIndex) }];
        });
        const dotRadius = step < 16 ? 2.6 : 4;
        return {
            values, points, line, segments, area, bands, transitions, bars, dateTicks,
            plotBottom, plotRight, stripTop, stripMid, showBars, dotRadius,
        };
    }, [exactRR, gradientId, height, sorted, tiers, width]);

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
    const netChange = exactRR
        ? sorted.reduce((total, snapshot) => total + snapshot.rrEarned, 0)
        : lastValue - firstValue;
    const latestIndex = model.points.length - 1;
    const latestPoint = model.points[latestIndex];
    const peakIndex = model.points.reduce((best, point, index) => point.value > model.points[best].value ? index : best, 0);
    const peakPoint = model.points[peakIndex];
    const activePoint = activeIndex === null ? null : model.points[activeIndex];
    const activeTransition = activeIndex === null
        ? null
        : model.transitions.find((transition) => transition.pointIndex === activeIndex);

    const form = sorted.slice(-FORM_COUNT);
    const formWins = form.filter((snapshot) => snapshot.rrEarned > 0).length;
    const formLosses = form.filter((snapshot) => snapshot.rrEarned < 0).length;
    const latestResult = resultOf(sorted[sorted.length - 1]);
    let streak = 0;
    for (let index = sorted.length - 1; index >= 0 && resultOf(sorted[index]) === latestResult; index -= 1) streak += 1;
    const streakLabel = latestResult === "neutral" || streak < 2
        ? ""
        : `${streak} ${latestResult === "win" ? "win" : "loss"} streak`;

    const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width;
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
            <div className="rr-chart-head">
                <span>
                    <small>Now</small>
                    <strong style={{ color: latestPoint.color }}>{rankPositionLabel(tiers, lastValue, exactRR)}</strong>
                </span>
                <span>
                    <small>Peak</small>
                    <strong style={{ color: peakPoint.color }}>{rankPositionLabel(tiers, peakPoint.value, exactRR)}</strong>
                </span>
                <span className="rr-chart-net" data-tone={netChange > 0 ? "positive" : netChange < 0 ? "negative" : "flat"}>
                    <strong>{signed(netChange)}{exactRR ? " RR" : ""}</strong>
                    <small>net over {sorted.length} {sorted.length === 1 ? "game" : "games"}</small>
                </span>
            </div>

            <div className="rr-chart-stage" ref={setStage}>
                <svg
                    width="100%"
                    height={height}
                    viewBox={`0 0 ${width} ${height}`}
                    onPointerMove={handlePointerMove}
                    onPointerLeave={() => setActiveIndex(null)}
                    role="img"
                    aria-label={`Rank history over ${sorted.length} ranked games. Now ${rankPositionLabel(tiers, lastValue, exactRR)}, peak ${rankPositionLabel(tiers, peakPoint.value, exactRR)}, net ${signed(netChange)}${exactRR ? " RR" : ""}.`}
                >
                    <defs>
                        <linearGradient id={`${gradientId}-area`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={latestPoint.color} stopOpacity="0.2" />
                            <stop offset="100%" stopColor={latestPoint.color} stopOpacity="0" />
                        </linearGradient>
                        {model.segments.map((segment) => (
                            <linearGradient key={segment.gradientId} id={segment.gradientId} gradientUnits="userSpaceOnUse" x1={segment.fromX} x2={segment.toX} y1="0" y2="0">
                                <stop offset="0%" stopColor={segment.fromColor} />
                                <stop offset="100%" stopColor={segment.toColor} />
                            </linearGradient>
                        ))}
                    </defs>

                    {model.bands.map((band, index) => (
                        <g key={`band-${band.tier}`} className="rr-chart-band">
                            <rect
                                x={PAD_LEFT}
                                y={band.top}
                                width={model.plotRight - PAD_LEFT}
                                height={band.height}
                                fill={band.color}
                                opacity={index % 2 ? 0.07 : 0.035}
                            />
                            {band.boundary !== null ? (
                                <line x1={PAD_LEFT} x2={model.plotRight} y1={band.boundary} y2={band.boundary} stroke={band.color} className="rr-chart-boundary" />
                            ) : null}
                            {band.height >= 14 ? (
                                <text x={PAD_LEFT - 12} y={band.top + band.height / 2 + 3.5} textAnchor="end" className="rr-chart-band-label" fill={band.color}>
                                    {band.label}
                                </text>
                            ) : null}
                        </g>
                    ))}

                    {model.transitions.map((transition) => (
                        <g key={`transition-${transition.pointIndex}`} className="rr-chart-transition">
                            <line x1={transition.x} x2={transition.x} y1={PAD_TOP - 6} y2={model.plotBottom} stroke={transition.color} />
                            {transition.showLabel ? (
                                <g transform={`translate(${transition.labelX - transition.labelWidth / 2} 4)`}>
                                    <rect width={transition.labelWidth} height={19} rx={9.5} stroke={transition.color} />
                                    <text x={transition.labelWidth / 2} y={13} textAnchor="middle" fill={transition.color}>{transition.label}</text>
                                </g>
                            ) : null}
                        </g>
                    ))}

                    {model.area ? <path d={model.area} fill={`url(#${gradientId}-area)`} /> : null}
                    {model.segments.map((segment) => (
                        <path key={segment.key} d={segment.path} className="rr-chart-segment" stroke={`url(#${segment.gradientId})`} />
                    ))}

                    {peakIndex !== latestIndex && model.points.length > 2 ? (
                        <text x={peakPoint.x} y={Math.max(PAD_TOP + 2, peakPoint.y - 11)} textAnchor="middle" className="rr-chart-peak-label">PEAK</text>
                    ) : null}

                    {model.points.map((point, index) => (
                        <circle
                            key={`${point.snapshot.matchId}-${index}`}
                            cx={point.x}
                            cy={point.y}
                            r={activeIndex === index ? model.dotRadius + 2 : model.dotRadius}
                            className={`rr-chart-dot ${point.result}`}
                        />
                    ))}
                    <circle cx={latestPoint.x} cy={latestPoint.y} r={model.dotRadius + 6} className="rr-chart-latest-halo" stroke={latestPoint.color} />

                    {model.showBars ? (
                        <g className="rr-chart-bars">
                            <line x1={PAD_LEFT} x2={model.plotRight} y1={model.stripMid} y2={model.stripMid} className="rr-chart-bars-axis" />
                            <text x={PAD_LEFT - 12} y={model.stripMid + 3.5} textAnchor="end" className="rr-chart-axis-label">RR ±</text>
                            {model.bars.map((bar, index) => (
                                <rect
                                    key={`bar-${index}`}
                                    x={bar.x}
                                    y={bar.y}
                                    width={bar.width}
                                    height={bar.height}
                                    rx={1.5}
                                    className={`rr-chart-bar ${bar.result}${activeIndex === index ? " active" : ""}`}
                                />
                            ))}
                        </g>
                    ) : null}

                    {model.dateTicks.map((tick, index) => (
                        <text
                            key={tick.timestamp}
                            x={tick.x}
                            y={height - 6}
                            textAnchor={index === 0 ? "start" : index === model.dateTicks.length - 1 ? "end" : "middle"}
                            className="rr-chart-axis-label"
                        >
                            {tick.label}
                        </text>
                    ))}

                    {activePoint ? (
                        <line
                            x1={activePoint.x}
                            x2={activePoint.x}
                            y1={PAD_TOP}
                            y2={model.showBars ? model.stripTop + BAR_STRIP : model.plotBottom}
                            className="rr-chart-focus"
                            aria-hidden="true"
                        />
                    ) : null}
                </svg>
                {activePoint ? (
                    <div
                        className={`rr-chart-tooltip${activePoint.x > width * 0.68 ? " align-right" : ""}`}
                        style={{ left: `${(activePoint.x / width) * 100}%`, top: `${(activePoint.y / height) * 100}%` }}
                    >
                        <small>{new Date(activePoint.snapshot.matchStartTime).toLocaleString()}</small>
                        <strong style={{ color: activePoint.color }}>{rankPositionLabel(tiers, activePoint.value, exactRR)}</strong>
                        <span data-tone={activePoint.result === "win" ? "positive" : activePoint.result === "loss" ? "negative" : "flat"}>
                            {exactRR ? `${signed(activePoint.snapshot.rrEarned)} RR` : "Tier checkpoint"}
                        </span>
                        {activeTransition ? <em style={{ color: activeTransition.color }}>{activeTransition.direction} · {activeTransition.tierLabel}</em> : null}
                    </div>
                ) : null}
            </div>

            <div className="rr-chart-form-row">
                <div className="rr-chart-form-title">
                    <small>Recent form</small>
                    <span>
                        <b data-tone="positive">{formWins}W</b> · <b data-tone="negative">{formLosses}L</b>
                        {streakLabel ? <em data-tone={latestResult === "win" ? "positive" : "negative"}>{streakLabel}</em> : null}
                    </span>
                </div>
                <ol className="rr-chart-form-list" aria-label={`Last ${form.length} ranked games, oldest to newest`}>
                    {form.map((snapshot, index) => {
                        const result = resultOf(snapshot);
                        return (
                            <li key={`${snapshot.matchId}-form-${index}`} data-result={result} data-latest={index === form.length - 1 ? "true" : undefined}>
                                <b>{result === "win" ? "W" : result === "loss" ? "L" : "D"}</b>
                                {exactRR ? <span>{signed(snapshot.rrEarned)}</span> : null}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </div>
    );
}
