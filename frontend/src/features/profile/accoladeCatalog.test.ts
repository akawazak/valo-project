import { describe, expect, it } from "vitest";
import type { AccoladesResponse } from "@/services/api";
import { ACCOLADES, buildAccoladeTiles, pickActId, recordFor } from "./accoladeCatalog";

const DAMAGE = "6dc31cfd-41da-895f-9246-a8b63558cdb8";
const ASSISTS = "e43f9acb-448c-4aa1-1591-6db72c0b8dae";
const ACT = "8102cd81-43a0-d0d7-bd59-47b8fe9bed1b";

const response: AccoladesResponse = {
    definitions: [...Object.keys(ACCOLADES).map((id) => ({ id, threshold: id === DAMAGE ? 170 : id === ASSISTS ? 0.34 : 1 })), { id: "00000000-1111-2222-3333-444444444444", threshold: 5 }],
    lifetime: [{ id: DAMAGE, best: 203.21739, count: 1 }, { id: ASSISTS, best: 8, count: 1 }],
    acts: { [ACT]: [{ id: DAMAGE.toUpperCase(), best: 203.21739, count: 1 }] },
    matches: [],
};

describe("accolades", () => {
    it("lists the 12 known accolades in game order and skips unknown ids", () => {
        const tiles = buildAccoladeTiles(response, ACT);
        expect(tiles.map((tile) => tile.info.key)).toEqual(["mvp", "topfrag", "aces", "clutches", "kills", "headshots", "firstbloods", "masterful", "damage", "trades", "assists", "plants"]);
    });

    it("attaches act and lifetime records case-insensitively", () => {
        const tiles = buildAccoladeTiles(response, ACT);
        const damage = tiles.find((tile) => tile.id === DAMAGE)!;
        const assists = tiles.find((tile) => tile.id === ASSISTS)!;
        expect(recordFor(damage, "act")?.count).toBe(1);
        expect(recordFor(assists, "act")).toBeUndefined();
        expect(recordFor(assists, "lifetime")?.best).toBe(8);
    });

    it("words requirements and personal bests like the game", () => {
        const damage = buildAccoladeTiles(response, ACT).find((tile) => tile.id === DAMAGE)!;
        expect(damage.info.requirement(damage.threshold)).toBe("At least 170 damage per round");
        expect(damage.info.best(203.21739)).toEqual(["203", "per round"]);
        expect(ACCOLADES[ASSISTS].requirement(0.34)).toBe("At least 0.34 assists per round");
        expect(ACCOLADES["2c8b6129-4384-230d-c7e5-cda12019533c"].best(0.4483)).toEqual(["45%", "headshots"]);
    });

    it("uses the current act only when Riot has records for it", () => {
        expect(pickActId(response, ACT.toUpperCase())).toBe(ACT);
        expect(pickActId(response, "another-act")).toBeUndefined();
        expect(pickActId(response)).toBe(ACT);
    });
});
