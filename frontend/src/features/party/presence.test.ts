import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/gameMeta", () => ({ queueLabel: (id?: string) => id === "competitive" ? "Competitive" : id || "" }));
import { friendMatchActivity } from "./presence";

const live = { product: "valorant", state: "INGAME", mapId: "/Game/Maps/Ascent/Ascent", queueId: "competitive", scoreAvailable: true, allyScore: 8, enemyScore: 6 };
describe("friend match presence", () => {
    it("resolves Riot map paths and identifies the friend's score", () => {
        expect(friendMatchActivity(live, { "/game/maps/ascent/ascent": "Ascent" })).toEqual({ detail: "Ascent · Competitive", score: "8–6" });
    });
    it("keeps a genuine 0–0 score", () => {
        expect(friendMatchActivity({ ...live, allyScore: 0, enemyScore: 0 })?.score).toBe("0–0");
    });
    it("does not reuse a lingering score in menus, agent select, offline, League or mobile", () => {
        for (const patch of [{ state: "MENUS" }, { state: "PREGAME" }, { state: "OFFLINE" }, { product: "league_of_legends" }, { availability: "mobile" }]) {
            expect(friendMatchActivity({ ...live, ...patch })).toBeNull();
        }
    });
    it("omits incomplete or invalid scores without hiding match activity", () => {
        for (const patch of [{ scoreAvailable: false }, { enemyScore: undefined }, { allyScore: -1 }, { allyScore: NaN }, { allyScore: 1.5 }]) {
            expect(friendMatchActivity({ ...live, ...patch })).toEqual({ detail: "Competitive", score: null });
        }
    });
});
