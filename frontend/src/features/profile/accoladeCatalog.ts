import type { AccoladeRecord, AccoladesResponse } from "@/services/api";

export type AccoladeGroup = "core" | "performance";
export type AccoladeScope = "act" | "lifetime";

export interface AccoladeInfo {
    key: string;
    name: string;
    group: AccoladeGroup;
    /** What it takes, given Riot's threshold. */
    requirement: (threshold: number) => string;
    /** Personal best as [value, unit], like the game's "203 PER ROUND". */
    best: (value: number) => [string, string];
}

const perRound = (what: string) => (t: number) => `At least ${t} ${what} per round`;
const inAMatch = (v: number): [string, string] => [String(Math.round(v)), "in a match"];

// Riot sends ids and thresholds only. Names come from the in-game page; ids were
// matched against live values on 13.06 (trades, plants, first bloods, aces and
// clutches by elimination, so recheck if a label looks wrong).
export const ACCOLADES: Record<string, AccoladeInfo> = {
    "745b27f0-4bc2-13a4-4ee7-77be323155c2": { key: "mvp", name: "MVP", group: "core", requirement: () => "Finish the match as MVP", best: (v) => [String(Math.round(v)), "combat score"] },
    "1c926cba-48cb-8aeb-c68d-a1ba2d012784": { key: "topfrag", name: "Top Frag", group: "core", requirement: () => "Get the most kills in your match", best: (v) => [String(Math.round(v)), "kills"] },
    "244cf4ab-4c27-cc59-3323-c985858d6ddb": { key: "aces", name: "Aces", group: "core", requirement: () => "Kill all five enemies in one round", best: inAMatch },
    "0497d585-42ad-61a7-42bc-189571f40e2c": { key: "clutches", name: "Clutches", group: "core", requirement: () => "Win a round as the last one standing", best: inAMatch },
    "1b13755f-4d5a-2c9e-6a39-bea7e6c53e7f": { key: "kills", name: "Kills", group: "core", requirement: (t) => `At least ${t} ${t === 1 ? "kill" : "kills"} per round`, best: inAMatch },
    "2c8b6129-4384-230d-c7e5-cda12019533c": { key: "headshots", name: "Headshots", group: "core", requirement: (t) => `At least ${Math.round(t * 100)}% headshot rate`, best: (v) => [`${Math.round(v * 100)}%`, "headshots"] },
    "bfe96c47-44d0-e473-585d-749146d2d05e": { key: "firstbloods", name: "First Bloods", group: "core", requirement: perRound("first bloods"), best: inAMatch },
    "4815a8a2-4649-9bfe-afd2-38ae9cc22898": { key: "masterful", name: "Masterful", group: "performance", requirement: (t) => `At least ${t} combat score`, best: (v) => [String(Math.round(v)), "combat score"] },
    "6dc31cfd-41da-895f-9246-a8b63558cdb8": { key: "damage", name: "Damage", group: "performance", requirement: perRound("damage"), best: (v) => [String(Math.round(v)), "per round"] },
    "3bc0563a-4fe9-a15c-0078-23a3408d64b5": { key: "trades", name: "Trades", group: "performance", requirement: perRound("trades"), best: inAMatch },
    "e43f9acb-448c-4aa1-1591-6db72c0b8dae": { key: "assists", name: "Assists", group: "performance", requirement: perRound("assists"), best: inAMatch },
    "352a3ac8-4b2c-db6a-1f36-c0a67b428e65": { key: "plants", name: "Spike Plants", group: "performance", requirement: perRound("spike plants"), best: inAMatch },
};

/** In-game order within each group. */
const ORDER = ["mvp", "topfrag", "aces", "clutches", "kills", "headshots", "firstbloods", "masterful", "damage", "trades", "assists", "plants"];

export interface AccoladeTile {
    id: string;
    info: AccoladeInfo;
    threshold: number;
    act?: AccoladeRecord;
    lifetime?: AccoladeRecord;
}

/** Picks the act to show: the current one if Riot has records for it, otherwise the newest act present. */
export function pickActId(data: AccoladesResponse, currentActId?: string): string | undefined {
    const ids = Object.keys(data.acts || {});
    const current = currentActId?.toLowerCase();
    return ids.find((id) => id.toLowerCase() === current) || (current ? undefined : ids[0]);
}

/** Known accolades in game order, with this act's and lifetime records attached. Unknown ids are skipped. */
export function buildAccoladeTiles(data: AccoladesResponse, actId?: string): AccoladeTile[] {
    const thresholds = new Map((data.definitions || []).map((item) => [item.id.toLowerCase(), item.threshold]));
    const index = (records: AccoladeRecord[] | undefined) => new Map((records || []).map((record) => [record.id.toLowerCase(), record]));
    const act = index(actId ? data.acts?.[actId] : undefined);
    const lifetime = index(data.lifetime);
    return Object.entries(ACCOLADES)
        .map(([id, info]) => ({ id, info, threshold: thresholds.get(id) ?? 0, act: act.get(id), lifetime: lifetime.get(id) }))
        .filter((tile) => thresholds.size === 0 || thresholds.has(tile.id))
        .sort((a, b) => ORDER.indexOf(a.info.key) - ORDER.indexOf(b.info.key));
}

export const recordFor = (tile: AccoladeTile, scope: AccoladeScope) => (scope === "act" ? tile.act : tile.lifetime);
