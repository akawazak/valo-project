import type { ProfileMatchSummary, ProfileRRSnapshot } from "@/services/api";

/** Matches the backend's session-form grouping: two hours between match starts. */
export const SESSION_GAP = 2 * 60 * 60 * 1000;

export function matchOutcome(match: ProfileMatchSummary): "win" | "loss" | "draw" | "placement" | "unknown" {
    if (match.placement != null || match.queueID.toLowerCase() === "deathmatch") return "placement";
    if (match.teamPlacement != null && match.teamPlacement > 0) return match.teamPlacement === 1 ? "win" : "loss";
    if ((match.teamCount || 0) > 1) return match.win ? "win" : "loss";
    if (match.blueRoundsWon + match.redRoundsWon === 0) return "unknown";
    if (match.blueRoundsWon === match.redRoundsWon) return "draw";
    return match.win ? "win" : "loss";
}

export function summarizeMatches(matches: ProfileMatchSummary[], rr: ProfileRRSnapshot[] = []) {
    let wins = 0, losses = 0, draws = 0, kills = 0, deaths = 0, assists = 0, shots = 0, headshots = 0, rounds = 0, score = 0, damage = 0, roundGames = 0;
    for (const match of matches) {
        const outcome = matchOutcome(match);
        if (outcome === "win") wins++;
        if (outcome === "loss") losses++;
        if (outcome === "draw") draws++;
        const p = match.localPlayer;
        kills += p.kills; deaths += p.deaths; assists += p.assists;
        headshots += p.headshots; shots += p.headshots + p.bodyshots + p.legshots;
        if (outcome !== "placement" && p.roundsPlayed > 0 && (match.blueRoundsWon + match.redRoundsWon > 0 || (p.roundsPlayed > 1 && p.damageDealt > 0))) {
            rounds += p.roundsPlayed; score += p.score; damage += p.damageDealt; roundGames++;
        }
    }
    const ranked = matches.filter(m => m.isRanked);
    const rrByMatch = new Map(rr.map(item => [item.matchId, item]));
    const recorded = ranked.flatMap(m => { const item = rrByMatch.get(m.matchId); return item ? [item] : []; });
    return { games: matches.length, wins, losses, draws, decided: wins + losses,
        winrate: wins + losses ? wins / (wins + losses) * 100 : null,
        kills, deaths, assists, kd: deaths ? kills / deaths : null,
        hs: shots ? headshots / shots * 100 : null, acs: rounds ? score / rounds : null, adr: rounds ? damage / rounds : null, roundGames,
        playedMillis: matches.reduce((sum, m) => sum + Math.max(0, m.gameLengthMillis), 0),
        rr: recorded.length ? recorded.reduce((sum, item) => sum + item.rrEarned, 0) : null,
        rrRecorded: recorded.length, ranked: ranked.length };
}

export function groupSessions(matches: ProfileMatchSummary[]) {
    const ordered = [...new Map(matches.filter(m => m.gameStartMillis > 0).map(m => [m.matchId, m])).values()]
        .sort((a, b) => a.gameStartMillis - b.gameStartMillis);
    const sessions: ProfileMatchSummary[][] = [];
    for (const match of ordered) {
        const current = sessions.at(-1);
        if (!current || match.gameStartMillis - current.at(-1)!.gameStartMillis > SESSION_GAP) sessions.push([match]);
        else current.push(match);
    }
    return sessions.reverse();
}
