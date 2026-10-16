"use client";

import type { CareerPlaystyle, PlaystyleKey } from "@/services/api";
import { useCareerInsights } from "./useCareerInsights";
import i from "./Insights.module.css";

const AXES: Record<PlaystyleKey, { label: string; title: string; adjective: string; strength: string; growth: string; detail: (value: number, lobby: number) => string }> = {
    aim: { label: "Aim", title: "Sharpshooter", adjective: "Precise", strength: "win your gunfights", growth: "your aim", detail: (v, l) => `${Math.round(v * 100)}% headshots · lobby ${Math.round(l * 100)}%` },
    entry: { label: "Entry", title: "Entry fragger", adjective: "Aggressive", strength: "open rounds with the first kill", growth: "taking first contact", detail: (v, l) => `First kill in ${Math.round(v * 100)}% of rounds · lobby ${Math.round(l * 100)}%` },
    clutch: { label: "Clutch", title: "Closer", adjective: "Ice-cold", strength: "close out rounds alone", growth: "late-round 1vX", detail: (v, l) => v || l ? `${Math.round(v)}% of clutches won · lobby ${Math.round(l)}%` : "No clutches yet" },
    teamplay: { label: "Teamplay", title: "Team player", adjective: "Selfless", strength: "back your teammates up", growth: "trading your teammates", detail: (v, l) => `${v.toFixed(2)} assists + trades a round · lobby ${l.toFixed(2)}` },
    economy: { label: "Economy", title: "Value player", adjective: "Thrifty", strength: "get value out of every credit", growth: "damage for the money", detail: (v, l) => `${Math.round(v)} damage per 1,000 credits · lobby ${Math.round(l)}` },
    consistency: { label: "Consistency", title: "Anchor", adjective: "Steady", strength: "show up nearly every round", growth: "round-to-round impact", detail: (v, l) => `KAST ${Math.round(v * 100)}% · lobby ${Math.round(l * 100)}%` },
};

/** A one-line identity from the two strongest axes, and the gap worth working on. */
function identity(style: CareerPlaystyle) {
    const ranked = [...style.axes].sort((a, b) => b.score - a.score);
    const [top, second] = ranked, low = ranked[ranked.length - 1];
    const balanced = top.score - low.score < 10;
    const name = balanced ? "All-rounder" : `${AXES[second.key].adjective} ${AXES[top.key].title}`;
    const line = balanced
        ? "No single habit stands out. You play close to your lobbies everywhere."
        : `You ${AXES[top.key].strength}${second.score >= 55 ? ` and ${AXES[second.key].strength}` : ""}. Room to grow: ${AXES[low.key].growth}.`;
    const moves = style.axes.filter((axis) => axis.recentScore >= 0).map((axis) => ({ axis, delta: axis.recentScore - axis.score })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const change = moves[0] && Math.abs(moves[0].delta) >= 6 ? `${AXES[moves[0].axis.key].label} ${moves[0].delta > 0 ? "up" : "down"} ${Math.abs(moves[0].delta)} in your last ${style.recent} matches` : "";
    return { name, line, change };
}

// Lobby ranks cluster near 50, so the radar spans 25–75 to show the shape; labels keep the true scores.
const SIZE = 240, CENTER = SIZE / 2, RADIUS = 100, LOW = 25, HIGH = 75;
const point = (index: number, count: number, score: number) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const r = Math.min(1, Math.max(.06, (score - LOW) / (HIGH - LOW))) * RADIUS;
    return [CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r] as const;
};
const shape = (scores: number[]) => scores.map((score, index) => point(index, scores.length, score).join(",")).join(" ");

function Radar({ style }: { style: CareerPlaystyle }) {
    const count = style.axes.length;
    const hasRecent = style.axes.every((axis) => axis.recentScore >= 0);
    return <svg className={i.radar} viewBox={`-52 -10 ${SIZE + 104} ${SIZE + 20}`} role="img" aria-label={style.axes.map((axis) => `${AXES[axis.key].label} ${axis.score}`).join(", ")}>
        {[37.5, 50, 62.5, 75].map((ring) => <polygon key={ring} className={ring === 50 ? i.radarMid : i.radarRing} points={shape(style.axes.map(() => ring))} />)}
        {style.axes.map((axis, index) => { const [x, y] = point(index, count, HIGH); return <line key={axis.key} className={i.radarRing} x1={CENTER} y1={CENTER} x2={x} y2={y} />; })}
        <polygon className={i.radarShape} points={shape(style.axes.map((axis) => axis.score))} />
        {hasRecent ? <polygon className={i.radarRecent} points={shape(style.axes.map((axis) => axis.recentScore))} /> : null}
        {style.axes.map((axis, index) => { const [x, y] = point(index, count, axis.score); return <circle key={axis.key} className={i.radarDot} cx={x} cy={y} r="3" />; })}
        {style.axes.map((axis, index) => {
            const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
            const x = CENTER + Math.cos(angle) * (RADIUS + 22), y = CENTER + Math.sin(angle) * (RADIUS + 18);
            const anchor = Math.abs(Math.cos(angle)) < .2 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
            return <g key={axis.key} className={i.radarLabel}>
                <title>{AXES[axis.key].detail(axis.value, axis.lobby)}</title>
                <text x={x} y={y - 4} textAnchor={anchor}>{AXES[axis.key].label}</text>
                <text x={x} y={y + 11} textAnchor={anchor} className={i.radarScore} data-tone={axis.score >= 60 ? "good" : axis.score < 40 ? "bad" : undefined}>{axis.score}</text>
            </g>;
        })}
    </svg>;
}

/** The hero of Insights: what kind of player the cached matches describe. */
export default function PlaystyleCard({ puuid, region, queue }: { puuid: string; region: string; queue: string }) {
    const { data, error } = useCareerInsights(puuid, region, queue);
    const style = data?.playstyle;
    const who = style ? identity(style) : null;
    return <section className={`${i.card} ${i.styleCard}`}>
        <header className={i.cardHead}><h3>Your playstyle</h3>{style ? <p><span>vs your lobbies · {style.matches} matches</span></p> : null}</header>
        {style && who ? <>
            <Radar style={style} />
            <div className={i.styleCopy}>
                <strong>{who.name}</strong>
                <p>{who.line}</p>
                <small>{style.axes.every((axis) => axis.recentScore >= 0) ? <><i className={i.keyAll} />All matches <i className={i.keyRecent} />Last {style.recent}</> : "50 is typical for your lobbies"}</small>
                {who.change ? <small className={i.styleChange}>{who.change}</small> : null}
            </div>
        </> : <p className={i.cardEmpty}>{error ? "Couldn't read your matches." : data ? "Play 5 standard matches (with round data) to see your playstyle." : "Reading your matches…"}</p>}
    </section>;
}
