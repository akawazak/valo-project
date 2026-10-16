"use client";

import type { CSSProperties } from "react";
import { useData } from "@/context/DataContext";
import type { PlaystyleKey } from "@/services/api";
import { identity } from "./CareerCard";
import type { ComparisonData } from "./CareerReview";
import { profileBadges } from "./badgeRules";
import { summarizeMatches } from "./reviewStats";
import { useCareerInsights } from "./useCareerInsights";
import { usePlayerColours } from "./playerColours";
import c from "./CompareView.module.css";

const AXIS_LABEL: Record<PlaystyleKey, string> = { aim: "Aim", entry: "Entry", clutch: "Clutch", teamplay: "Teamplay", economy: "Economy", consistency: "Consistency" };
const CARD_ART = (id: string) => `https://media.valorant-api.com/playercards/${id}/largeart.png`;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Colour says whose number it is: your colour for you, theirs for them.
type Row = { label: string; values: [number | null, number | null]; digits: number; suffix?: string; max?: number; good: number; weak: number };

/** One tug-of-war bar per stat: each player's share of the combined value, the bigger side bold. */
function HeadToHead({ rows, compact }: { rows: Row[]; compact?: boolean }) {
    return <div className={c.rows} data-compact={compact || undefined}>{rows.map((row) => {
        const [a, b] = row.values.map((value) => value === null ? null : Number(value.toFixed(row.digits)));
        const lead = a === null || b === null || a === b ? -1 : a > b ? 0 : 1;
        const share = a !== null && b !== null && a + b > 0 ? (a / (a + b)) * 100 : 50;
        const text = (value: number | null) => value === null ? "—" : `${value.toFixed(row.digits)}${row.suffix || ""}`;
        return <div key={row.label} className={c.row}>
            <b data-side="0" data-lead={lead === 0 || undefined}>{text(a)}</b>
            <span className={c.duel}>
                <small>{row.label}</small>
                <span className={c.tug} aria-hidden="true"><i data-side="0" data-lead={lead === 0 || undefined} style={{ width: `${share}%` }} /><i data-side="1" data-lead={lead === 1 || undefined} /></span>
            </span>
            <b data-side="1" data-lead={lead === 1 || undefined}>{text(b)}</b>
        </div>;
    })}</div>;
}

/** Compare, player-card style: the two real cards face off with ranks around the score and stats head to head. */
export default function CompareView({ data, selfPuuid, region, queue, agentNames, rankIcons = {}, rangeLabel }: {
    data: ComparisonData[]; selfPuuid?: string; region: string; queue: string; agentNames: Record<string, string>; rankIcons?: Record<number, string>; rangeLabel: string;
}) {
    const { playerTitles } = useData();
    const { palette } = usePlayerColours();
    const left = useCareerInsights(data[0].player.puuid, region, queue).data;
    const right = useCareerInsights(data[1].player.puuid, region, queue).data;
    const insights = [left, right];
    const stats = data.map((item) => summarizeMatches(item.matches));
    const titleText = (id?: string) => { const title = id ? playerTitles.find((item) => item.uuid.toLowerCase() === id.toLowerCase()) : undefined; return title?.titleText || title?.displayName || ""; };
    const styles = insights.map((item) => item?.playstyle);
    const bothStyles = styles[0] && styles[1];
    const playRows: Row[] = bothStyles ? styles[0]!.axes.map((axis) => ({
        label: AXIS_LABEL[axis.key], digits: 0, max: 100, good: 55, weak: 45,
        values: [axis.score, styles[1]!.axes.find((other) => other.key === axis.key)?.score ?? null],
    })) : [];
    const matchRows: Row[] = [
        { label: "Win rate", digits: 1, suffix: "%", values: [stats[0].winrate, stats[1].winrate], max: 100, good: 53, weak: 47 },
        { label: "K/D", digits: 2, values: [stats[0].kd, stats[1].kd], good: 1.1, weak: 0.9 },
        { label: "Combat score", digits: 0, values: [stats[0].acs, stats[1].acs], good: 230, weak: 180 },
        { label: "Headshots", digits: 1, suffix: "%", values: [stats[0].hs, stats[1].hs], good: 25, weak: 17 },
        { label: "Damage / round", digits: 0, values: [stats[0].adr, stats[1].adr], good: 150, weak: 120 },
    ];
    const scored = bothStyles ? playRows : matchRows;
    const leads = [0, 1].map((side) => scored.filter((row) => {
        const [a, b] = row.values.map((value) => value === null ? null : Number(value.toFixed(row.digits)));
        return a !== null && b !== null && a !== b && (side === 0 ? a > b : b > a);
    }).length);
    const names = data.map((item) => item.player.gameName || "Player");


    const card = (index: 0 | 1) => {
        const item = data[index];
        const style = styles[index];
        const archetype = style ? identity(style).name : "";
        const badges = profileBadges(insights[index] || null, item.matches).slice(0, 3);
        const counts = new Map<string, number>();
        item.matches.forEach((match) => { const agent = match.localPlayer?.characterId?.toLowerCase(); if (agent) counts.set(agent, (counts.get(agent) || 0) + 1); });
        const [topAgent] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        const isSelf = same(item.player.puuid, selfPuuid);
        return <article className={c.card} data-side={index} style={item.overview.playerCardId ? { "--card": `url("${CARD_ART(item.overview.playerCardId)}")` } as CSSProperties : undefined}>
            <span className={c.who}>{isSelf ? "You" : index === 0 ? "Player" : "Them"}</span>
            <div className={c.cardFoot}>
                {archetype ? <span className={c.plate}>{archetype}</span> : null}
                <div className={c.cardCopy}>
                    <h3>{names[index]}<small>#{item.player.tagLine || "—"}</small></h3>
                    {titleText(item.overview.playerTitleId) ? <p><em>{titleText(item.overview.playerTitleId)}</em></p> : null}
                    {topAgent ? <small className={c.agent}>Mostly {agentNames[topAgent[0]] || "one agent"} · {topAgent[1]} games</small> : null}
                    {badges.length ? <ul className={c.badges}>{badges.map((badge) => <li key={badge.id} data-tone={badge.tone} title={[badge.rarity, badge.detail].filter(Boolean).join(" · ")}>{badge.label}</li>)}</ul> : null}
                </div>
            </div>
        </article>;
    };
    // Current rank, or the career peak when the player has no rank this act.
    const rank = (index: 0 | 1) => {
        const { currentRank: current, peakRank: peak } = data[index].overview;
        const shown = current.competitiveTier > 0 ? current : peak?.competitiveTier > 0 ? peak : null;
        const icon = shown ? rankIcons[shown.competitiveTier] : undefined;
        return <div className={c.rank} data-peak={shown === peak || undefined}>
            {icon ? <img src={icon} alt="" /> : <i aria-hidden="true">?</i>}
            <b>{shown ? shown.tierName : "Unranked"}</b>
            <small>{current.competitiveTier > 0 ? `${current.rankedRating} RR` : shown ? "Peak · unranked this act" : "No ranked games"}</small>
        </div>;
    };

    // The left card is side 0. Whoever is you gets your colour, wherever they sit.
    const selfRight = same(data[1].player.puuid, selfPuuid) && !same(data[0].player.puuid, selfPuuid);
    const colours = { "--you": selfRight ? palette.them : palette.you, "--them": selfRight ? palette.you : palette.them } as CSSProperties;
    return <div className={c.compare} style={colours}>
        {card(0)}
        <section className={c.middle}>
            <div className={c.score} aria-label={`${names[0]} leads ${leads[0]}, ${names[1]} leads ${leads[1]}`}>
                {rank(0)}
                <b data-side="0" data-ahead={leads[0] > leads[1] || undefined}>{leads[0]}</b>
                <span className={c.vs}>VS</span>
                <b data-side="1" data-ahead={leads[1] > leads[0] || undefined}>{leads[1]}</b>
                {rank(1)}
            </div>

            {bothStyles ? <>
                <header className={c.head}><h4 title="Each player is ranked against the other players in their own matches. 50 is typical.">Playstyle</h4></header>
                <HeadToHead rows={playRows} />
            </> : null}
            <header className={c.head}><h4 title={rangeLabel}>Match stats</h4></header>
            <HeadToHead rows={matchRows} compact />

        </section>
        {card(1)}
    </div>;
}
