"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { fetchCachedPublicJson, type ProfileMatchSummary, type ProfileRankActSummary, type ProfileRRSnapshot } from "@/services/api";
import { matchOutcome } from "./reviewStats";
import i from "./Insights.module.css";

export interface InsightsSummary {
    net: number; avgGain: number; avgLoss: number; recentWins: number; recentGames: number;
    soloWR: number | null; stackWR: number | null; soloGames?: number; stackGames?: number;
    bestAgent?: { id: string; games: number; wins: number }; bestMap?: { id: string; games: number; wins: number };
}

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value)}`;
const label = (id: string, labels: Record<string, string>, fallback: string) => labels[id.toLowerCase()] || fallback;
const rate = (wins: number, games: number) => games ? Math.round((wins / games) * 100) : null;
const tone = (value: number | null) => value === null ? undefined : value >= 55 ? "good" : value < 45 ? "bad" : undefined;
const OUTCOME_LETTER = { win: "W", loss: "L", draw: "D", placement: "·", unknown: "·" };

// Riot ships each agent's card colours as RRGGBBAA; the best-agent card uses the first two.
let agentColourPromise: Promise<Record<string, string[]>> | null = null;
function loadAgentColours() {
    agentColourPromise ??= fetchCachedPublicJson<{ data?: Array<{ uuid?: string; backgroundGradientColors?: string[] }> }>("https://valorant-api.com/v1/agents?isPlayableCharacter=true")
        .then((payload) => Object.fromEntries((payload?.data ?? []).flatMap((agent) => agent.uuid && agent.backgroundGradientColors?.length
            ? [[agent.uuid.toLowerCase(), agent.backgroundGradientColors.map((colour) => `#${colour.slice(0, 6)}`)]]
            : [])))
        .catch(() => {
            agentColourPromise = null;
            return {};
        });
    return agentColourPromise;
}

function score(match: ProfileMatchSummary) {
    const red = match.localPlayer?.teamId?.toLowerCase() === "red";
    const own = red ? match.redRoundsWon : match.blueRoundsWon, other = red ? match.blueRoundsWon : match.redRoundsWon;
    return own + other ? `${own}–${other}` : "";
}

function PeopleIcon({ party }: { party: boolean }) {
    return party
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.4" /><path d="M2.5 19.5c.6-3.6 3.2-5.6 6.5-5.6s5.9 2 6.5 5.6z" /><circle cx="16.6" cy="9" r="2.7" /><path d="M16.2 13.9c2.8 0 4.8 1.8 5.3 5.1h-4.2c-.3-2-1.1-3.7-2.4-4.9.4-.1.8-.2 1.3-.2z" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20c.7-4.1 3.7-6.3 7.5-6.3s6.8 2.2 7.5 6.3z" /></svg>;
}

/** The top of Insights: best agent, recent results on their maps, ranked RR, queue split, best map and acts. */
export default function InsightsOverview({ data, recent, rr, rankActs, seasonNames, agentNames, mapNames, agentVisuals = {}, mapVisuals, rankIcons = {}, hero }: {
    data: InsightsSummary; recent: ProfileMatchSummary[]; rr: ProfileRRSnapshot[]; rankActs: ProfileRankActSummary[];
    seasonNames: Record<string, string>; agentNames: Record<string, string>; mapNames: Record<string, string>;
    agentVisuals?: Record<string, string>; mapVisuals: Record<string, string>; rankIcons?: Record<number, string>;
    /** The playstyle radar, placed first. */
    hero?: ReactNode;
}) {
    const [agentColours, setAgentColours] = useState<Record<string, string[]>>({});
    useEffect(() => {
        let cancelled = false;
        void loadAgentColours().then((colours) => { if (!cancelled) setAgentColours(colours); });
        return () => { cancelled = true; };
    }, []);

    const losses = data.recentGames - data.recentWins;
    const recentRate = rate(data.recentWins, data.recentGames);
    const agentId = data.bestAgent?.id.toLowerCase() || "";
    const agentArt = agentId ? agentVisuals[agentId] : "";
    const [agentA = "#3a2a33", agentB = "#1a1f29"] = agentColours[agentId] || [];
    const mapArt = data.bestMap ? mapVisuals[data.bestMap.id.toLowerCase()] : "";
    const tier = rr[0]?.tierAfter || recent.find((match) => match.isRanked && match.tierAfter)?.tierAfter || 0;
    const rankIcon = tier ? rankIcons[tier] : "";
    const acts = rankActs.slice(0, 4);
    const queues = [
        { party: true, rate: data.stackWR, games: data.stackGames, label: "with a party" },
        { party: false, rate: data.soloWR, games: data.soloGames, label: "solo queue" },
    ];

    return <div className={i.overview}>
        {hero}
        <section className={i.agentCard} style={{ "--agent-a": agentA, "--agent-b": agentB } as CSSProperties}>
            {agentArt ? <img className={i.agentArt} src={agentArt} alt="" /> : null}
            <div className={i.cardCopy}>
                <span className={i.kicker}>Best agent</span>
                <strong className={i.cardName}>{data.bestAgent ? label(data.bestAgent.id, agentNames, "Agent") : "—"}</strong>
                {data.bestAgent
                    ? <small>{data.bestAgent.wins} of {data.bestAgent.games} games won · <b>{rate(data.bestAgent.wins, data.bestAgent.games)}%</b></small>
                    : <small>Play an agent twice in your last 10</small>}
            </div>
        </section>

        <section className={`${i.card} ${i.recent}`}>
            <header className={i.cardHead}>
                <h3>Recent matches</h3>
                <p><b data-tone="good">{data.recentWins} wins</b><b data-tone="bad">{losses} losses</b>{recentRate !== null ? <span>{recentRate}% win rate</span> : null}</p>
            </header>
            <ol className={i.matchStrip} aria-label="Last matches, newest first">{recent.slice(0, 10).map((match) => {
                const outcome = matchOutcome(match);
                const art = mapVisuals[match.mapID.toLowerCase()];
                return <li key={match.matchId} data-outcome={outcome} title={`${label(match.mapID, mapNames, "Map")} · ${outcome}`} style={art ? { "--map": `url("${art}")` } as CSSProperties : undefined}>
                    {outcome === "placement" && match.placement ? <><b>#{match.placement}</b><small>DM</small></> : <><b>{OUTCOME_LETTER[outcome]}</b><small>{score(match) || "—"}</small></>}
                </li>;
            })}</ol>
        </section>

        <section className={`${i.card} ${i.rankCard}`} data-tone={data.net > 0 ? "good" : data.net < 0 ? "bad" : undefined}>
            {rankIcon ? <img className={i.rankGlow} src={rankIcon} alt="" aria-hidden="true" /> : null}
            <h3>Ranked RR</h3>
            <div className={i.rankBody}>
                {rankIcon ? <img className={i.rankIcon} src={rankIcon} alt="" /> : null}
                <p><strong>{rr.length ? signed(data.net) : "—"}</strong>
                    <span>{rr.length ? `over ${rr.length} ranked games` : "Sync ranked matches to track RR"}</span>
                    {rr.length ? <small><b data-tone="good">{signed(data.avgGain)}</b> a win · <b data-tone="bad">{signed(data.avgLoss)}</b> a loss</small> : null}
                </p>
            </div>
        </section>

        <section className={`${i.card} ${i.queueCard}`}>
            <h3>Queue win rate</h3>
            <div className={i.queueRow}>{queues.map((queue) => <p key={queue.label} data-party={queue.party || undefined}>
                <i><PeopleIcon party={queue.party} /></i>
                <span><strong data-tone={tone(queue.rate)}>{queue.rate === null ? "—" : `${queue.rate}%`}</strong><small>{queue.label}{queue.games ? ` · ${queue.games} games` : ""}</small></span>
            </p>)}</div>
        </section>

        <section className={`${i.card} ${i.mapCard}`} style={mapArt ? { "--map": `url("${mapArt}")` } as CSSProperties : undefined}>
            <h3>Best map</h3>
            <div className={i.cardCopy}>
                <strong className={i.cardName}>{data.bestMap ? label(data.bestMap.id, mapNames, "Map") : "—"}</strong>
                {data.bestMap
                    ? <small>{data.bestMap.wins} of {data.bestMap.games} games won · <b>{rate(data.bestMap.wins, data.bestMap.games)}%</b></small>
                    : <small>Play a map twice in your last 10</small>}
            </div>
        </section>

        <section className={`${i.card} ${i.actCard}`}>
            <h3>Act win rates</h3>
            {acts.length ? <ol>{acts.map((act) => {
                const value = rate(act.wins, act.games);
                const icon = rankIcons[act.finalRank];
                return <li key={act.seasonId} title={`${act.wins} wins in ${act.games} games`}>
                    {icon ? <img src={icon} alt="" /> : null}
                    <span>{seasonNames[act.seasonId.toLowerCase()] || "Act"}</span>
                    <strong data-tone={tone(value)}>{value === null ? "—" : `${value}%`}</strong>
                    <small>{act.wins}W – {act.games - act.wins}L</small>
                </li>;
            })}</ol> : <p className={i.cardEmpty}>No competitive acts synced yet.</p>}
        </section>
    </div>;
}
