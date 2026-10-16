import type { CareerInsights, ProfileMatchSummary } from "@/services/api";
import { matchOutcome } from "./reviewStats";

export type BadgeTone = "good" | "neutral" | "bad";
export interface ProfileBadge {
    id: string;
    label: string;
    tone: BadgeTone;
    /** What earned it, from the player's own numbers. */
    detail: string;
    /** How the player compares with the people they face, when the data supports it. */
    rarity?: string;
}

const pct = (wins: number, total: number) => total ? Math.round((wins / total) * 100) : 0;
const TONE_ORDER: Record<BadgeTone, number> = { good: 0, neutral: 1, bad: 2 };

/**
 * Trait badges earned from real stats only. Lobby-ranked scores give an honest
 * "more than N% of the players you face"; everything else shows the player's own record.
 */
export function profileBadges(insights: CareerInsights | null, matches: ProfileMatchSummary[]): ProfileBadge[] {
    const badges: ProfileBadge[] = [];
    const style = insights?.playstyle;
    const axis = (key: string) => style?.axes.find((item) => item.key === key);

    const ranked = (key: string, id: string, label: string, verb: string, detail: (value: number, lobby: number) => string) => {
        const item = axis(key);
        if (item && item.score >= 60) badges.push({ id, label, tone: "good", detail: detail(item.value, item.lobby), rarity: `${verb} than ${item.score}% of the players you face` });
    };
    ranked("aim", "headhunter", "Headhunter", "Sharper aim", (v, l) => `${Math.round(v * 100)}% headshots · lobby ${Math.round(l * 100)}%`);
    ranked("entry", "first-blood", "First Blood", "Opens more rounds", (v, l) => `First kill in ${Math.round(v * 100)}% of rounds · lobby ${Math.round(l * 100)}%`);
    ranked("teamplay", "trade-partner", "Trade Partner", "Backs teammates up more", (v, l) => `${v.toFixed(2)} assists + trades a round · lobby ${l.toFixed(2)}`);
    ranked("economy", "eco-menace", "Eco Menace", "More damage per credit", (v, l) => `${Math.round(v)} damage per 1,000 credits · lobby ${Math.round(l)}`);
    ranked("consistency", "always-there", "Always There", "Matters in more rounds", (v, l) => `KAST ${Math.round(v * 100)}% · lobby ${Math.round(l * 100)}%`);
    const clutch = axis("clutch");
    if (clutch && clutch.score >= 60 && clutch.value) badges.push({ id: "ice-cold", label: "Ice Cold", tone: "good", detail: `${Math.round(clutch.value)}% of clutches won · lobby ${Math.round(clutch.lobby)}%` });
    const firstDeath = style?.firstDeath;
    if (firstDeath && firstDeath.score >= 65) badges.push({ id: "first-to-fall", label: "First to Fall", tone: "bad", detail: `Dies first in ${Math.round(firstDeath.value * 100)}% of rounds · lobby ${Math.round(firstDeath.lobby * 100)}%`, rarity: `Dies first more often than ${firstDeath.score}% of the players you face` });

    const pistol = insights?.buys.find((buy) => buy.type === "pistol");
    if (pistol && pistol.rounds >= 30 && pct(pistol.wins, pistol.rounds) >= 60) badges.push({ id: "pistol-pro", label: "Pistol Pro", tone: "good", detail: `${pct(pistol.wins, pistol.rounds)}% of pistol rounds won (${pistol.rounds} rounds)` });

    const sessions = insights?.sessions;
    if (sessions && sessions.decided >= 20) {
        const overall = pct(sessions.wins, sessions.decided);
        const tilt = sessions.afterTwoLosses;
        if (tilt.attempts >= 10 && pct(tilt.wins, tilt.attempts) <= overall - 6) badges.push({ id: "tilt-prone", label: "Tilt Prone", tone: "bad", detail: `${pct(tilt.wins, tilt.attempts)}% won after two losses in a row · ${overall}% overall` });
        const first = sessions.byGame[0];
        if (first && first.attempts >= 10 && pct(first.wins, first.attempts) <= overall - 6) badges.push({ id: "slow-starter", label: "Slow Starter", tone: "bad", detail: `${pct(first.wins, first.attempts)}% won in the first game of a session · ${overall}% overall` });
        const hours = sessions.byHour.map((tally, index) => ({ tally, index, rate: pct(tally.wins, tally.attempts) })).filter((entry) => entry.tally.attempts >= 10);
        const bestHour = hours.reduce<(typeof hours)[number] | null>((best, entry) => !best || entry.rate > best.rate ? entry : best, null);
        if (bestHour && (bestHour.index === 0 || bestHour.index === 5) && bestHour.rate >= overall + 5) badges.push({ id: "night-owl", label: "Night Owl", tone: "neutral", detail: `${bestHour.rate}% won ${bestHour.index === 0 ? "between midnight and 4 am" : "between 8 pm and midnight"} · ${overall}% overall` });
    }

    // From the latest synced matches (newest first).
    const decided = matches.filter((match) => { const outcome = matchOutcome(match); return outcome === "win" || outcome === "loss"; }).slice(0, 30);
    const lastFive = decided.slice(0, 5);
    if (lastFive.length === 5) {
        const wins = lastFive.filter((match) => match.win).length;
        if (wins >= 4) badges.push({ id: "on-fire", label: "On Fire", tone: "good", detail: `${wins} wins in the last 5 matches` });
        if (wins <= 1) badges.push({ id: "rough-patch", label: "Rough Patch", tone: "bad", detail: `${5 - wins} losses in the last 5 matches` });
    }
    const solo = decided.filter((match) => !(match.partyMembers?.length)), stacked = decided.filter((match) => (match.partyMembers?.length || 0) > 0);
    if (solo.length >= 5 && stacked.length >= 5) {
        const soloRate = pct(solo.filter((match) => match.win).length, solo.length), stackRate = pct(stacked.filter((match) => match.win).length, stacked.length);
        if (soloRate >= stackRate + 10) badges.push({ id: "lone-wolf", label: "Lone Wolf", tone: "neutral", detail: `${soloRate}% won solo · ${stackRate}% with a party` });
        if (stackRate >= soloRate + 10) badges.push({ id: "squad-up", label: "Squad Up", tone: "neutral", detail: `${stackRate}% won with a party · ${soloRate}% solo` });
    }
    if (decided.length >= 10) {
        const counts = new Map<string, number>();
        decided.forEach((match) => { const agent = match.localPlayer?.characterId?.toLowerCase(); if (agent) counts.set(agent, (counts.get(agent) || 0) + 1); });
        const [, top = 0] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
        if (top / decided.length > 0.6) badges.push({ id: "one-trick", label: "One-trick", tone: "neutral", detail: `Same agent in ${top} of the last ${decided.length} matches` });
    }

    return badges.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
}
