import { describe, expect, it } from "vitest";
import type { ProfileMatchSummary, ProfileRRSnapshot } from "@/services/api";
import { groupSessions, matchOutcome, SESSION_GAP, summarizeMatches } from "./reviewStats";
const match = (id: string, start: number, changes: Partial<ProfileMatchSummary> = {}): ProfileMatchSummary => ({ matchId: id, gameStartMillis: start, gameLengthMillis: 30 * 60000, queueID: "competitive", isRanked: true, win: true, blueRoundsWon: 13, redRoundsWon: 9, mapID: "map", gameMode: "", seasonId: "act", tierAfter: 15, rrEarned: 0, localPlayer: { subject: "me", teamId: "Blue", gameName: "Player", tagLine: "QA", characterId: "agent", kills: 10, deaths: 5, assists: 2, score: 2200, headshots: 5, bodyshots: 15, legshots: 0, damageDealt: 2200, roundsPlayed: 22, competitiveTier: 15, isLocal: true, kd: 2, kda: 2.4, adr: 100, acs: 100, hsPct: 25 }, ...changes });
describe("session recap data", () => {
    it("groups across midnight and keeps exactly two hours in one session", () => {
        const start = Date.UTC(2026, 9, 12, 23, 45);
        const a = match("a", start), b = match("b", start + SESSION_GAP), c = match("c", start + SESSION_GAP * 2 + 1);
        expect(groupSessions([c, b, a, a]).map(session => session.map(m => m.matchId))).toEqual([["c"], ["a", "b"]]);
    });
    it("does not count draws, free-for-all or missing results as losses", () => {
        const items = [match("win", 1), match("loss", 2, { win: false }), match("draw", 3, { win: false, blueRoundsWon: 12, redRoundsWon: 12 }), match("ffa", 4, { queueID: "deathmatch", win: false }), match("unknown", 5, { blueRoundsWon: 0, redRoundsWon: 0, win: false })];
        expect(summarizeMatches(items)).toMatchObject({ wins: 1, losses: 1, draws: 1, decided: 2, winrate: 50 });
        expect(matchOutcome(match("teams", 1, { teamPlacement: 1, blueRoundsWon: 0, redRoundsWon: 0 }))).toBe("win");
        expect(matchOutcome(match("teams-unplaced", 1, { teamCount: 6, win: false, blueRoundsWon: 0, redRoundsWon: 0 }))).toBe("loss");
    });
    it("weights hit and round statistics instead of averaging percentages", () => {
        const a = match("a", 1), b = match("b", 2);
        b.localPlayer = { ...b.localPlayer, headshots: 90, bodyshots: 90, roundsPlayed: 11, score: 2200, damageDealt: 1100 };
        expect(summarizeMatches([a, b])).toMatchObject({ hs: 47.5, acs: 4400 / 33, adr: 100, kd: 2 });
    });
    it("reports missing RR separately from a recorded zero and excludes unrelated snapshots", () => {
        const a = match("a", 1), b = match("b", 2);
        const snapshot = (matchId: string, rrEarned: number): ProfileRRSnapshot => ({ matchId, rrEarned, seasonId: "act", tierBefore: 15, tierAfter: 15, rrBefore: 50, rrAfter: 50, afkPenalty: 0, performanceBonus: 0, matchStartTime: 1 });
        expect(summarizeMatches([a, b])).toMatchObject({ rr: null, rrRecorded: 0, ranked: 2 });
        expect(summarizeMatches([a, b], [snapshot("a", 0), snapshot("unrelated", 20)])).toMatchObject({ rr: 0, rrRecorded: 1, ranked: 2 });
    });
    it("keeps free-for-all scores out of round-weighted averages", () => {
        const team = match("team", 1), deathmatch = match("dm", 2, { queueID: "deathmatch", isRanked: false, blueRoundsWon: 0, redRoundsWon: 0 });
        deathmatch.localPlayer = { ...deathmatch.localPlayer, roundsPlayed: 1, score: 20000, damageDealt: 10000 };
        expect(summarizeMatches([team, deathmatch])).toMatchObject({ games: 2, roundGames: 1, acs: 100, adr: 100 });
    });
});
