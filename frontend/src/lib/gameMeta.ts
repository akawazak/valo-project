"use client";

import { useEffect, useState } from "react";
import { fetchCachedPublicJson } from "../services/api";

// Shared valorant-api.com metadata. Game content (ranks, modes, weapon
// categories) always comes from the API so new patches show up without an
// app update; nothing here lists specific ranks, modes or weapons.

const TIERS_URL = "https://valorant-api.com/v1/competitivetiers";
const MODES_URL = "https://valorant-api.com/v1/gamemodes";
const QUEUES_URL = "https://valorant-api.com/v1/gamemodes/queues";

export interface CompetitiveTier {
    tier: number;
    name: string;
    division: string;
    color: string;
    icon: string;
}

export interface GameModeMeta {
    /** Asset folder below GameModes/, e.g. "FortCollins" or "_Development/Swiftplay_EndOfRoundCredits". */
    folder: string;
    name: string;
    icon: string;
}

export interface QueueMeta {
    /** Riot queue id, lowercase (e.g. "competitive", "skirmish2v2"). */
    id: string;
    name: string;
    icon: string;
}

interface PublicQueue {
    queueId?: string;
    dropdownText?: string;
    displayName?: string;
    displayIcon?: string;
}

interface PublicTierSet {
    tiers?: Array<{
        tier: number;
        tierName?: string;
        divisionName?: string;
        color?: string;
        smallIcon?: string;
    }>;
}

interface PublicGameMode {
    displayName?: string;
    assetPath?: string;
    displayIcon?: string;
    listViewIcon?: string;
}

export function titleCase(value: string) {
    return value
        .toLowerCase()
        .replace(/(^|[\s/_-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toUpperCase());
}

/** valorant-api colors are RRGGBBAA without a leading '#'. */
export function apiColor(value: string | undefined) {
    const hex = (value || "").replace(/^#/, "");
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return "";
    return `#${hex.slice(0, 6)}`;
}

export function parseCompetitiveTiers(sets: PublicTierSet[] | undefined): Map<number, CompetitiveTier> {
    const latest = sets?.[sets.length - 1];
    const tiers = new Map<number, CompetitiveTier>();
    for (const tier of latest?.tiers ?? []) {
        if (!tier.tierName || !Number.isFinite(tier.tier)) continue;
        tiers.set(tier.tier, {
            tier: tier.tier,
            name: titleCase(tier.tierName),
            division: titleCase(tier.divisionName || tier.tierName),
            color: apiColor(tier.color),
            icon: tier.smallIcon || "",
        });
    }
    return tiers;
}

function gameModeFolder(path: string) {
    const match = /GameModes\/(.+)\/[^/]+$/i.exec(path.replace(/\\/g, "/"));
    return match ? match[1] : "";
}

export function parseGameModes(modes: PublicGameMode[] | undefined): GameModeMeta[] {
    return (modes ?? []).flatMap((mode) => {
        const folder = gameModeFolder(mode.assetPath || "");
        if (!folder || !mode.displayName) return [];
        return [{ folder, name: mode.displayName, icon: mode.displayIcon || mode.listViewIcon || "" }];
    });
}

export function parseQueues(queues: PublicQueue[] | undefined): Map<string, QueueMeta> {
    const out = new Map<string, QueueMeta>();
    for (const queue of queues ?? []) {
        const id = queue.queueId?.trim().toLowerCase();
        const name = queue.dropdownText || queue.displayName;
        if (!id || !name) continue;
        out.set(id, { id, name, icon: queue.displayIcon || "" });
    }
    return out;
}

// Last loaded queue table, for synchronous labels (presence, Discord).
let cachedQueues = new Map<string, QueueMeta>();

/** Display name for a Riot queue id; unknown ids are title-cased. */
export function queueLabel(queueId: string | undefined, queues: Map<string, QueueMeta> = cachedQueues) {
    const id = (queueId || "").trim();
    if (!id) return "";
    return queues.get(id.toLowerCase())?.name || titleCase(id);
}

/** Finds the API game mode for a match's gameMode path ("/Game/GameModes/FortCollins/..."). */
export function findGameMode(modes: GameModeMeta[], gameModePath: string | undefined) {
    const path = (gameModePath || "").replace(/\\/g, "/").toLowerCase();
    if (!path) return undefined;
    let best: GameModeMeta | undefined;
    for (const mode of modes) {
        const folder = mode.folder.toLowerCase();
        if (!path.includes(`gamemodes/${folder}/`)) continue;
        if (!best || folder.length > best.folder.length) best = mode;
    }
    return best;
}

/**
 * Human label for a match. Queues that share the standard bomb mode
 * (competitive, unrated, premier...) are told apart by Riot's queue id;
 * every other mode uses the API's display name.
 */
export function matchModeLabel(
    modes: GameModeMeta[],
    queueId: string | undefined,
    gameModePath: string | undefined,
    queues: Map<string, QueueMeta> = cachedQueues,
) {
    const queue = (queueId || "").trim();
    const knownQueue = queues.get(queue.toLowerCase());
    if (knownQueue) return knownQueue.name;
    const mode = findGameMode(modes, gameModePath);
    const sharedStandardMode = !mode || /^bomb$/i.test(mode.folder);
    if (queue && sharedStandardMode) return titleCase(queue);
    if (mode) return mode.name;
    if (!queue) return "Custom";
    return titleCase(queue);
}

/** "EEquippableCategory::Rifle" -> "rifle". */
export function weaponCategoryKey(category: string | undefined) {
    return (category || "").split("::").pop()?.toLowerCase() || "";
}

let tiersPromise: Promise<Map<number, CompetitiveTier>> | null = null;
let modesPromise: Promise<GameModeMeta[]> | null = null;
let queuesPromise: Promise<Map<string, QueueMeta>> | null = null;

export function loadCompetitiveTiers() {
    tiersPromise ??= fetchCachedPublicJson<{ data?: PublicTierSet[] }>(TIERS_URL)
        .then((response) => parseCompetitiveTiers(response?.data))
        .catch((error) => {
            tiersPromise = null;
            throw error;
        });
    return tiersPromise;
}

export function loadGameModes() {
    modesPromise ??= fetchCachedPublicJson<{ data?: PublicGameMode[] }>(MODES_URL)
        .then((response) => parseGameModes(response?.data))
        .catch((error) => {
            modesPromise = null;
            throw error;
        });
    return modesPromise;
}

export function loadQueues() {
    queuesPromise ??= fetchCachedPublicJson<{ data?: PublicQueue[] }>(QUEUES_URL)
        .then((response) => {
            cachedQueues = parseQueues(response?.data);
            return cachedQueues;
        })
        .catch((error) => {
            queuesPromise = null;
            throw error;
        });
    return queuesPromise;
}

function useLoaded<T>(load: () => Promise<T>, empty: T, label: string) {
    const [value, setValue] = useState<T>(empty);
    useEffect(() => {
        let alive = true;
        load()
            .then((next) => { if (alive) setValue(next); })
            .catch((error) => console.warn(`Error loading ${label}`, error instanceof Error ? error.message : String(error)));
        return () => { alive = false; };
    }, [label, load]);
    return value;
}

const EMPTY_TIERS = new Map<number, CompetitiveTier>();
const EMPTY_MODES: GameModeMeta[] = [];
const EMPTY_QUEUES = new Map<string, QueueMeta>();

export function useCompetitiveTiers() {
    return useLoaded(loadCompetitiveTiers, EMPTY_TIERS, "competitive tiers");
}

export function useGameModes() {
    return useLoaded(loadGameModes, EMPTY_MODES, "game modes");
}

/** Loads queue names and re-renders when they arrive. */
export function useQueues() {
    return useLoaded(loadQueues, EMPTY_QUEUES, "queues");
}
