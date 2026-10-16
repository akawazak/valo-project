"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fetchCachedPublicJson, type CareerPlaystyle, type PlaystyleKey, type ProfileMatchSummary, type ProfileRRSnapshot } from "@/services/api";
import type { InsightsSummary } from "./InsightsOverview";
import { useCareerInsights } from "./useCareerInsights";
import c from "./CareerCard.module.css";

const AXES: Record<PlaystyleKey, { label: string; title: string; adjective: string; strength: string; growth: string; what: string; detail: (value: number, lobby: number) => string }> = {
    aim: { label: "Aim", title: "Sharpshooter", adjective: "Precise", strength: "win your gunfights", growth: "your aim", what: "Headshot rate and damage per round. Each match ranks you against the other nine players on both, then averages the two.", detail: (v, l) => `${Math.round(v * 100)}% headshots · lobby ${Math.round(l * 100)}%` },
    entry: { label: "Entry", title: "Entry fragger", adjective: "Aggressive", strength: "open rounds with the first kill", growth: "taking first contact", what: "How often you take the first kill of a round. High means you open fights for the team; low means you play off your teammates.", detail: (v, l) => `First kill in ${Math.round(v * 100)}% of rounds · lobby ${Math.round(l * 100)}%` },
    clutch: { label: "Clutch", title: "Closer", adjective: "Ice-cold", strength: "close out rounds alone", growth: "late-round 1vX", what: "Win rate when you are the last one alive on your team, compared with how often players in your lobbies win the same spots. Defuses and spike detonations count.", detail: (v, l) => v || l ? `${Math.round(v)}% of clutches won · lobby ${Math.round(l)}%` : "No clutches yet" },
    teamplay: { label: "Teamplay", title: "Team player", adjective: "Selfless", strength: "back your teammates up", growth: "trading your teammates", what: "Assists plus trade kills, per round. A trade is killing the enemy who killed a teammate within 5 seconds.", detail: (v, l) => `${v.toFixed(2)} assists + trades a round · lobby ${l.toFixed(2)}` },
    economy: { label: "Economy", title: "Value player", adjective: "Thrifty", strength: "squeeze value out of every credit", growth: "damage for the money", what: "Damage you deal for every 1,000 credits you spend. High means cheap buys still get you damage; saved guns count as free.", detail: (v, l) => `${Math.round(v)} damage per 1,000 credits · lobby ${Math.round(l)}` },
    consistency: { label: "Consistency", title: "Anchor", adjective: "Steady", strength: "show up nearly every round", growth: "round-to-round impact", what: "KAST: rounds where you got a kill, an assist, survived or were traded. Shows how often you mattered, round after round.", detail: (v, l) => `KAST ${Math.round(v * 100)}% · lobby ${Math.round(l * 100)}%` },
};
// One colour per habit, carried through its radar point, label and meter.
const AXIS_COLOUR: Record<PlaystyleKey, string> = { aim: "#ff4655", entry: "#ff8a1f", clutch: "#ffc61f", teamplay: "#1fb6ff", economy: "#16d98f", consistency: "#9d6bff" };
const SCALE_NOTE = "50 is typical for your lobbies. 65 means you beat about 65% of the players you face.";
const STANDARD_QUEUES = new Set(["competitive", "unrated", "premier", "swiftplay", "newmap"]);
const tone = (score: number) => score >= 60 ? "good" : score < 40 ? "bad" : undefined;
const title = (text = "") => text.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

/** "Economy and entry are up on your usual." / "Aim is up, clutch is down." */
function lateLine(moves: Array<{ label: string; up: boolean }>) {
    const up = moves.filter((move) => move.up).map((move) => move.label), down = moves.filter((move) => !move.up).map((move) => move.label);
    const part = (labels: string[], word: string) => labels.length ? `${labels.join(" and ")} ${labels.length > 1 ? "are" : "is"} ${word}` : "";
    const text = [part(up, "up"), part(down, "down")].filter(Boolean).join(", ").toLowerCase();
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} on your usual.`;
}

// One-word archetype from the highest score; a lurker opens few fights but wins on aim or clutches.
const ARCHETYPE: Record<PlaystyleKey, string> = { aim: "Fragger", entry: "Entry", clutch: "Closer", teamplay: "Support", economy: "Eco fragger", consistency: "Anchor" };

export function identity(style: CareerPlaystyle) {
    const ranked = [...style.axes].sort((a, b) => b.score - a.score);
    const [top, second] = ranked, low = ranked[ranked.length - 1];
    if (top.score - low.score < 10) return { name: "All-rounder", strengths: [], growth: "" };
    const entry = style.axes.find((axis) => axis.key === "entry")?.score ?? 50;
    return {
        name: entry < 45 && (top.key === "aim" || top.key === "clutch") ? "Lurker" : ARCHETYPE[top.key],
        strengths: [AXES[top.key].strength, ...(second.score >= 55 ? [AXES[second.key].strength] : [])],
        growth: AXES[low.key].growth,
    };
}

// Riot's agent card colours and word-art background; tier names for the rank chip.
type AgentArt = { colours: string[]; background?: string };
let agentArtPromise: Promise<Record<string, AgentArt>> | null = null;
function loadAgentArt() {
    agentArtPromise ??= fetchCachedPublicJson<{ data?: Array<{ uuid?: string; background?: string; backgroundGradientColors?: string[] }> }>("https://valorant-api.com/v1/agents?isPlayableCharacter=true")
        .then((payload) => Object.fromEntries((payload?.data ?? []).flatMap((agent) => agent.uuid
            ? [[agent.uuid.toLowerCase(), { colours: (agent.backgroundGradientColors ?? []).map((colour) => `#${colour.slice(0, 6)}`), background: agent.background }]]
            : [])))
        .catch(() => { agentArtPromise = null; return {}; });
    return agentArtPromise;
}
let tierNamePromise: Promise<Record<number, string>> | null = null;
function loadTierNames() {
    tierNamePromise ??= fetchCachedPublicJson<{ data?: Array<{ tiers?: Array<{ tier: number; tierName?: string }> }> }>("https://valorant-api.com/v1/competitivetiers")
        .then((payload) => Object.fromEntries((payload?.data?.at(-1)?.tiers ?? []).map((tier) => [tier.tier, title(tier.tierName)])))
        .catch(() => { tierNamePromise = null; return {}; });
    return tierNamePromise;
}

const SIZE = 330, CENTER = SIZE / 2, RADIUS = 112, LOW = 25, HIGH = 75;
// Lobby ranks cluster near 50, so the radar spans 25–75 to show a shape; labels keep the true scores.
const point = (index: number, count: number, score: number, radius = RADIUS) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    const r = Math.min(1, Math.max(.06, (score - LOW) / (HIGH - LOW))) * radius;
    return [CENTER + Math.cos(angle) * r, CENTER + Math.sin(angle) * r] as const;
};
const shape = (scores: number[]) => scores.map((score, index) => point(index, scores.length, score).map((v) => v.toFixed(1)).join(",")).join(" ");

function Radar({ style }: { style: CareerPlaystyle }) {
    const count = style.axes.length;
    const hasRecent = style.axes.every((axis) => axis.recentScore >= 0);
    const main = shape(style.axes.map((axis) => axis.score));
    return <div className={c.radar}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <defs>
                <radialGradient id="ccFill" cx="50%" cy="50%" r="62%"><stop offset="0" stopColor="#ff4655" stopOpacity=".18" /><stop offset="1" stopColor="#ff4655" stopOpacity=".42" /></radialGradient>
                <filter id="ccGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7" /></filter>
            </defs>
            {[37.5, 50, 62.5, 75].map((ring) => <polygon key={ring} className={ring === 50 ? c.ringMid : c.ring} points={shape(style.axes.map(() => ring))} />)}
            {style.axes.map((axis, index) => { const [x, y] = point(index, count, HIGH); return <line key={axis.key} className={c.ring} x1={CENTER} y1={CENTER} x2={x} y2={y} />; })}
            <polygon className={c.glow} points={main} filter="url(#ccGlow)" />
            <polygon className={c.shape} points={main} />
            {hasRecent ? <polygon className={c.recent} points={shape(style.axes.map((axis) => axis.recentScore))} /> : null}
            {style.axes.map((axis, index) => { const [x, y] = point(index, count, axis.score); return <circle key={axis.key} className={c.dot} cx={x} cy={y} r="4.5" style={{ fill: AXIS_COLOUR[axis.key] }} />; })}
            {style.axes.map((axis, index) => {
                const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
                const x = CENTER + Math.cos(angle) * (RADIUS + 26), y = CENTER + Math.sin(angle) * (RADIUS + 20);
                const anchor = Math.abs(Math.cos(angle)) < .2 ? "middle" : Math.cos(angle) > 0 ? "start" : "end";
                return <g key={axis.key}>
                    <text className={c.axisName} x={x} y={y - 5} textAnchor={anchor} style={{ fill: AXIS_COLOUR[axis.key] }}>{AXES[axis.key].label}</text>
                    <text className={c.axisScore} x={x} y={y + 14} textAnchor={anchor} data-tone={tone(axis.score)}>{axis.score}</text>
                </g>;
            })}
        </svg>
        {/* Hover targets over the labels, placed with the same geometry as the SVG (percent of its box). */}
        {style.axes.map((axis, index) => {
            const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
            const shift = Math.abs(Math.cos(angle)) < .2 ? 0 : Math.cos(angle) > 0 ? 40 : -40;
            const x = CENTER + Math.cos(angle) * (RADIUS + 26) + shift, y = CENTER + Math.sin(angle) * (RADIUS + 20) + 4;
            return <span key={axis.key} className={c.hot} style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%` }} tabIndex={0}>
                <span className={c.tip} role="tooltip"><strong>{AXES[axis.key].label} · {axis.score}</strong><p>{AXES[axis.key].what}</p><small>{AXES[axis.key].detail(axis.value, axis.lobby)}</small></span>
            </span>;
        })}
    </div>;
}

/** Career insights as one career card: agent-art identity, playstyle radar and rows, Lately and the best recent game. */
export default function CareerCard({ puuid, region, queue, data, matches, rr, agentNames, mapNames, agentVisuals, mapVisuals, rankIcons = {}, agentIcons = {} }: {
    puuid: string; region: string; queue: string; data: InsightsSummary; matches: ProfileMatchSummary[]; rr: ProfileRRSnapshot[];
    agentNames: Record<string, string>; mapNames: Record<string, string>; agentVisuals: Record<string, string>; mapVisuals: Record<string, string>; rankIcons?: Record<number, string>;
    /** Small square agent icons for the best-agent thumbnail. */
    agentIcons?: Record<string, string>;
}) {
    const { data: insights, error } = useCareerInsights(puuid, region, queue);
    const [agentArt, setAgentArt] = useState<Record<string, AgentArt>>({});
    const [tierNames, setTierNames] = useState<Record<number, string>>({});
    const [artLoaded, setArtLoaded] = useState(false);
    const [portraitSrc, setPortraitSrc] = useState("");
    // Never hold the card behind the loader for a slow or blocked image.
    const [gaveUp, setGaveUp] = useState(false);
    useEffect(() => { const timer = window.setTimeout(() => setGaveUp(true), 8000); return () => window.clearTimeout(timer); }, []);
    useEffect(() => {
        let cancelled = false;
        void loadAgentArt().then((art) => { if (!cancelled) { setAgentArt(art); setArtLoaded(true); } });
        void loadTierNames().then((names) => { if (!cancelled) setTierNames(names); });
        return () => { cancelled = true; };
    }, []);

    const style = insights?.playstyle;
    const who = style ? identity(style) : null;
    const agentId = data.bestAgent?.id.toLowerCase() || "";
    const art = agentArt[agentId];
    const [agentA = "#5a2a1c", agentB = "#1d1a1c"] = art?.colours.length ? [art.colours[0], art.colours[2] || art.colours[1]] : [];
    const mapId = data.bestMap?.id.toLowerCase() || "";
    const latest = rr[0];
    const tier = latest?.tierAfter || matches.find((match) => match.isRanked && match.tierAfter)?.tierAfter || 0;
    const portrait = agentVisuals[agentId] || "";
    // Everything the card shows is in: the report (or its error), agent art, and the portrait image itself.
    const ready = Boolean(insights || error) && (gaveUp || (artLoaded && (!portrait || portraitSrc === portrait)));
    const rate = (best?: { wins: number; games: number }) => best ? `${best.wins} of ${best.games} won` : "";

    // Best of the last 30 standard matches by combat score.
    const best = matches.slice(0, 30)
        .filter((match) => STANDARD_QUEUES.has(match.queueID.toLowerCase()) && (match.localPlayer?.roundsPlayed || 0) >= 8)
        // A win beats any loss; then the higher combat score.
        .reduce<ProfileMatchSummary | null>((top, match) => !top || (match.win && !top.win) || (match.win === top.win && (match.localPlayer.acs || 0) > (top.localPlayer.acs || 0)) ? match : top, null);
    const bestScore = best ? (() => {
        const red = best.localPlayer.teamId?.toLowerCase() === "red";
        return `${red ? best.redRoundsWon : best.blueRoundsWon}–${red ? best.blueRoundsWon : best.redRoundsWon}`;
    })() : "";
    const moves = style ? style.axes.filter((axis) => axis.recentScore >= 0).map((axis) => ({ axis, delta: axis.recentScore - axis.score })).filter((move) => Math.abs(move.delta) >= 4).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2) : [];

    // The best map's splash, blurred, colours the stats side.
    const backdrop = mapVisuals[mapId] || (best ? mapVisuals[best.mapID.toLowerCase()] : "") || "";
    return <div className={c.card} data-ready={ready || undefined} aria-busy={!ready} style={{ "--agent-a": agentA, "--agent-b": agentB, ...(backdrop ? { "--backdrop": `url("${backdrop}")` } : {}) } as CSSProperties}>
        <div className={c.loader} aria-hidden={ready}>
            <svg viewBox="0 0 120 120">
                {[1, .72, .44].map((scale, index) => <polygon key={scale} style={{ animationDelay: `${index * .18}s` }} points={[0, 1, 2, 3, 4, 5].map((i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return `${(60 + Math.cos(a) * 50 * scale).toFixed(1)},${(60 + Math.sin(a) * 50 * scale).toFixed(1)}`; }).join(" ")} />)}
                <polygon className={c.loaderShape} points="60,22 96,44 88,80 60,96 34,76 28,42" />
            </svg>
            <p>Reading your matches</p>
            <small>Ranking your playstyle against your lobbies…</small>
        </div>
        <section className={c.art}>
            {art?.background ? <img className={c.wordArt} src={art.background} alt="" /> : null}
            {portrait ? <img className={c.portrait} src={portrait} alt="" onLoad={() => setPortraitSrc(portrait)} onError={() => setPortraitSrc(portrait)} /> : null}
            <div className={c.plate}>
                <span>{who ? (/^[AEIOU]/.test(who.name) ? "You play like an" : "You play like a") : "Your playstyle"}</span>
                <h3>{who ? who.name : "…"}</h3>
            </div>
            <div className={c.identity}>
                {who ? <>
                    <p>{who.strengths.length ? <>You {who.strengths.map((text, index) => <span key={text}>{index ? " and " : ""}<b>{text}</b></span>)}.</> : "No single habit stands out. You play close to your lobbies everywhere."}</p>
                    {who.growth ? <p className={c.grow}><span>Room to grow</span>{who.growth}</p> : null}
                </> : <p>{error ? "Couldn't read your matches." : style === undefined && insights ? "Play 5 standard matches with round data to see your playstyle." : "Reading your matches…"}</p>}
            </div>
            <div className={c.bests}>
                {data.bestAgent ? <p><i style={agentIcons[agentId] ? { backgroundImage: `url("${agentIcons[agentId]}")` } : undefined} /><span><small>Best agent</small><b>{agentNames[agentId] || "Agent"}</b><em>{rate(data.bestAgent)}</em></span></p> : null}
                {data.bestMap ? <p><i style={mapVisuals[mapId] ? { backgroundImage: `url("${mapVisuals[mapId]}")` } : undefined} /><span><small>Best map</small><b>{mapNames[mapId] || "Map"}</b><em>{rate(data.bestMap)}</em></span></p> : null}
            </div>
        </section>

        <section className={c.stats}>
            <header className={c.head}>
                <div><h3>Your playstyle</h3><p>Ranked against the other 9 players in your matches · hover a stat to see how it&apos;s measured</p></div>
                {tier ? <div className={c.rank}>
                    {rankIcons[tier] ? <img src={rankIcons[tier]} alt="" /> : null}
                    <span><b>{tierNames[tier] || "Ranked"}{latest ? ` · ${latest.rrAfter} RR` : ""}</b>{rr.length ? <small><em data-tone={data.net > 0 ? "good" : data.net < 0 ? "bad" : undefined}>{data.net > 0 ? "+" : data.net < 0 ? "−" : "±"}{Math.abs(data.net)} RR</em> last {rr.length} ranked</small> : null}</span>
                </div> : null}
            </header>

            {style ? <div className={c.body}>
                <div className={c.radarWrap}>
                    <Radar style={style} />
                    <p className={c.legend}><i />All {style.matches} matches{style.axes.every((axis) => axis.recentScore >= 0) ? <><i data-recent />Last {style.recent}</> : null}</p>
                </div>
                <div className={c.rows}>{style.axes.map((axis) => {
                    const delta = axis.recentScore >= 0 ? axis.recentScore - axis.score : 0;
                    return <div key={axis.key} className={c.row} tabIndex={0} data-tone={tone(axis.score)} style={{ "--ax": AXIS_COLOUR[axis.key] } as CSSProperties}>
                        <strong>{AXES[axis.key].label}</strong>
                        <b style={{ color: AXIS_COLOUR[axis.key] }}>{axis.score}</b>
                        <small>{AXES[axis.key].detail(axis.value, axis.lobby)}</small>
                        {Math.abs(delta) >= 4 ? <em data-tone={delta > 0 ? "good" : "bad"}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)} lately</em> : <span />}
                        <span className={c.meter}><i style={{ width: `${axis.score}%` }} /></span>
                        <span className={c.tip} role="tooltip"><strong>{AXES[axis.key].label} · {axis.score}</strong><p>{AXES[axis.key].what}</p><small>{SCALE_NOTE}</small></span>
                    </div>;
                })}</div>
            </div> : <div className={c.body} />}

            <div className={c.foot}>
                <div className={c.lately}>
                    <p><b>Lately</b><span>last {style?.recent || 20} matches</span></p>
                    {moves.length ? <>
                        <div>{moves.map(({ axis, delta }) => <span key={axis.key}><strong data-tone={delta > 0 ? "good" : "bad"}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)}</strong><small>{AXES[axis.key].label}</small></span>)}</div>
                        <small>{lateLine(moves.map(({ axis, delta }) => ({ label: AXES[axis.key].label, up: delta > 0 })))}</small>
                    </> : <small>Your recent matches look like the rest. Nothing moved by more than 3 points.</small>}
                </div>
                {best ? <div className={c.best} style={mapVisuals[best.mapID.toLowerCase()] ? { "--map": `url("${mapVisuals[best.mapID.toLowerCase()]}")` } as CSSProperties : undefined}>
                    {agentVisuals[best.localPlayer.characterId?.toLowerCase()] ? <img src={agentVisuals[best.localPlayer.characterId.toLowerCase()]} alt="" /> : null}
                    <div>
                        <small>Best of your last 30 games</small>
                        <strong>{agentNames[best.localPlayer.characterId?.toLowerCase()] || "Agent"} on {mapNames[best.mapID.toLowerCase()] || "map"}</strong>
                        <span><b>{best.localPlayer.kills} / {best.localPlayer.deaths} / {best.localPlayer.assists}</b><em>{Math.round(best.localPlayer.acs || 0)} <small>ACS</small></em></span>
                        <p><b data-tone={best.win ? "good" : "bad"}>{best.win ? "Won" : "Lost"} {bestScore}</b> · {title(best.queueID)} · {new Date(best.gameStartMillis).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                    </div>
                </div> : <div className={c.best} />}
            </div>
        </section>
    </div>;
}
