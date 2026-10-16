import { describe, expect, it } from "vitest";
import type { ProfileMatchDetails, ProfilePlayerStats } from "@/services/api";
import { halfLength, roundEnd, roundOutcomes, sideStats } from "./matchBreakdown";

function player(subject: string, teamId: string, extra: Partial<ProfilePlayerStats> = {}): ProfilePlayerStats {
    return {
        subject, teamId, gameName: subject, tagLine: "1", characterId: "", kills: 0, deaths: 0, assists: 0,
        score: 0, headshots: 0, bodyshots: 0, legshots: 0, damageDealt: 0, roundsPlayed: 0, isLocal: false,
        competitiveTier: 0, kd: 0, kda: 0, adr: 0, acs: 0, hsPct: 0, ...extra,
    };
}

function kill(roundNum: number, roundTime: number, killer: string, victim: string, assistants: string[] = []) {
    return { roundNum, gameTime: roundTime, roundTime, killer, victim, victimX: 0, victimY: 0, assistants };
}

// Swiftplay: four rounds per half. "a" is on Red (attacks first), "b" on Blue.
const detail: ProfileMatchDetails = {
    matchId: "m1",
    servedFrom: "cache",
    matchInfo: { blueRoundsWon: 1, redRoundsWon: 5, blueWins: false } as ProfileMatchDetails["matchInfo"],
    players: [
        player("a", "Red", { isLocal: true, kills: 3, deaths: 1, roundsPlayed: 6, acs: 250, adr: 150, hsPct: 25, headshots: 1, bodyshots: 3 }),
        player("b", "Blue", { kills: 1, deaths: 3, roundsPlayed: 6, acs: 120, adr: 80, hsPct: 10, headshots: 1, bodyshots: 9 }),
    ],
    rounds: [
        { roundNum: 0, winningTeam: "Red", roundResult: "Eliminated", playerStats: [
            { subject: "a", score: 300, damage: [{ receiver: "b", damage: 150, headshots: 1, bodyshots: 0, legshots: 0 }], economy: { loadoutValue: 0, remaining: 0, spent: 0 }, ability: { grenade: 0, ability1: 0, ability2: 0, ultimate: 0 } },
            { subject: "b", score: 0, economy: { loadoutValue: 0, remaining: 0, spent: 0 }, ability: { grenade: 0, ability1: 0, ability2: 0, ultimate: 0 } },
        ] },
        { roundNum: 1, winningTeam: "Red", roundResult: "Bomb detonated", bombPlanter: "a" },
        { roundNum: 2, winningTeam: "Blue", roundResult: "Bomb defused", bombDefuser: "b" },
        { roundNum: 3, winningTeam: "Red", roundResult: "Eliminated" },
        { roundNum: 4, winningTeam: "Red", roundResult: "Round timer expired", playerStats: [
            { subject: "a", score: 100, damage: [{ receiver: "b", damage: 50, headshots: 0, bodyshots: 2, legshots: 0 }], economy: { loadoutValue: 0, remaining: 0, spent: 0 }, ability: { grenade: 0, ability1: 0, ability2: 0, ultimate: 0 } },
        ] },
    ],
    kills: [
        kill(0, 5000, "a", "b"),
        kill(0, 9000, "b", "a"),
        kill(4, 3000, "a", "b", ["a"]),
        kill(4, 1000, "b", "a"),
    ],
};

describe("matchBreakdown", () => {
    it("maps Riot round results to outcome kinds", () => {
        expect(roundEnd("Eliminated")).toBe("elim");
        expect(roundEnd("Bomb detonated")).toBe("boom");
        expect(roundEnd("Bomb defused")).toBe("defuse");
        expect(roundEnd("Round timer expired")).toBe("time");
        expect(roundEnd("Surrendered")).toBe("other");
    });

    it("uses the mode's half length", () => {
        expect(halfLength("swiftplay")).toBe(4);
        expect(halfLength("competitive")).toBe(12);
    });

    it("builds round outcomes with a running score and the half-time swap", () => {
        const rounds = roundOutcomes(detail, "Red", "swiftplay");
        expect(rounds.map((round) => round.won)).toEqual([true, true, false, true, true]);
        expect(rounds.map((round) => round.end)).toEqual(["elim", "boom", "defuse", "elim", "time"]);
        expect(rounds[4].afterSwap).toBe(true);
        expect(rounds[2].label).toBe("Round 3 · Lost by spike defused · 2–1");
    });

    it("counts first kills and first deaths per round", () => {
        const stats = sideStats(detail, "all", "swiftplay");
        expect(stats.get("a")).toMatchObject({ firstKills: 1, firstDeaths: 1, acs: 250 });
        expect(stats.get("b")).toMatchObject({ firstKills: 1, firstDeaths: 1 });
    });

    it("rebuilds stats from one side's rounds", () => {
        // Red attacks rounds 0-3 and defends from round 4 in Swiftplay.
        const attack = sideStats(detail, "attack", "swiftplay");
        expect(attack.get("a")).toMatchObject({ rounds: 1, kills: 1, deaths: 1, acs: 300, adr: 150, hsPct: 100, firstKills: 1 });
        const defense = sideStats(detail, "defense", "swiftplay");
        expect(defense.get("a")).toMatchObject({ rounds: 1, kills: 1, deaths: 1, assists: 1, acs: 100, adr: 50, hsPct: 0, firstDeaths: 1 });
    });
});
