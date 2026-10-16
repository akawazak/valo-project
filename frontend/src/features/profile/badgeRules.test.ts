import { describe, expect, it } from "vitest";
import type { CareerInsights, PlaystyleKey, ProfileMatchSummary } from "@/services/api";
import { profileBadges } from "./badgeRules";

const match = (id: string, win: boolean, changes: Partial<ProfileMatchSummary> = {}): ProfileMatchSummary => ({ matchId: id, gameStartMillis: 1, gameLengthMillis: 1, queueID: "competitive", isRanked: true, win, blueRoundsWon: win ? 13 : 9, redRoundsWon: win ? 9 : 13, mapID: "map", gameMode: "", seasonId: "act", tierAfter: 15, rrEarned: 0, localPlayer: { subject: "me", teamId: "Blue", gameName: "P", tagLine: "QA", characterId: "jett", kills: 10, deaths: 5, assists: 2, score: 2200, headshots: 5, bodyshots: 15, legshots: 0, damageDealt: 2200, roundsPlayed: 22, competitiveTier: 15, isLocal: true, kd: 2, kda: 2.4, adr: 100, acs: 100, hsPct: 25 }, ...changes });
const tally = (attempts: number, wins: number) => ({ attempts, wins });
const insights = (scores: Partial<Record<PlaystyleKey, number>>, extra: Partial<CareerInsights> = {}): CareerInsights => ({
    puuid: "me", region: "eu", queue: "", matches: 100,
    clutches: { attempts: 0, wins: 0, bySize: [] }, weapons: [], weaponDeaths: [],
    buys: [{ type: "pistol", rounds: 40, wins: 26 }],
    sessions: { decided: 40, wins: 20, afterTwoLosses: tally(12, 3), byGame: [tally(12, 4), tally(10, 5), tally(8, 4), tally(6, 3), tally(4, 2)], byHour: [tally(12, 9), tally(0, 0), tally(0, 0), tally(10, 5), tally(10, 5), tally(8, 1)], sessions: 10 },
    playstyle: {
        matches: 100, recent: 20,
        axes: (["aim", "entry", "clutch", "teamplay", "economy", "consistency"] as PlaystyleKey[]).map((key) => ({ key, score: scores[key] ?? 50, recentScore: -1, value: key === "aim" ? 0.38 : key === "clutch" ? 30 : 0.5, lobby: key === "aim" ? 0.27 : key === "clutch" ? 18 : 0.4 })),
        firstDeath: { score: 72, value: 0.14, lobby: 0.1 },
    },
    ...extra,
});

describe("profile badges", () => {
    it("earns lobby-ranked badges only at 60+ and states the real percentage", () => {
        const ids = profileBadges(insights({ aim: 65, entry: 59 }), []).map((badge) => badge.id);
        expect(ids).toContain("headhunter");
        expect(ids).not.toContain("first-blood");
        const headhunter = profileBadges(insights({ aim: 65 }), []).find((badge) => badge.id === "headhunter");
        expect(headhunter?.rarity).toBe("Sharper aim than 65% of the players you face");
        expect(headhunter?.detail).toBe("38% headshots · lobby 27%");
    });

    it("flags first deaths, tilt and slow starts from the player's own record", () => {
        const ids = profileBadges(insights({}), []).map((badge) => badge.id);
        // 26/40 pistol rounds = 65%, after two losses 25% vs 50%, first game 33%, midnight block 75%.
        expect(ids).toEqual(expect.arrayContaining(["pistol-pro", "first-to-fall", "tilt-prone", "slow-starter", "night-owl"]));
        const order = profileBadges(insights({}), []).map((badge) => badge.tone);
        expect(order).toEqual([...order].sort((a, b) => ["good", "neutral", "bad"].indexOf(a) - ["good", "neutral", "bad"].indexOf(b)));
    });

    it("reads streaks, party split and one-tricks from recent matches", () => {
        const recent = [true, true, true, true, false].map((win, index) => match(`m${index}`, win));
        const older = Array.from({ length: 8 }, (_, index) => match(`o${index}`, index % 2 === 0, { partyMembers: [{ puuid: "friend" } as never] }));
        const ids = profileBadges(null, [...recent, ...older]).map((badge) => badge.id);
        expect(ids).toContain("on-fire");
        expect(ids).toContain("one-trick");
        expect(ids).toContain("lone-wolf");
        expect(profileBadges(null, recent.slice(0, 4)).map((badge) => badge.id)).not.toContain("on-fire");
    });

    it("gives nothing without data", () => {
        expect(profileBadges(null, [])).toEqual([]);
    });
});
