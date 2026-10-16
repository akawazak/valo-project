import type { SocialPresence } from "@/services/api";
import { queueLabel } from "@/lib/gameMeta";

export type PresenceState = "game" | "online" | "away" | "dnd" | "mobile" | "chat" | "offline";

/** Queue display name from valorant-api.com (see useQueues to load it). */
export function queueName(id = "") {
    return queueLabel(id);
}

function normalizedProduct(product = "") {
    return product.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Match fields can linger in Riot presence after returning to menus. */
export function friendMatchActivity(presence: SocialPresence, mapNames: Record<string, string> = {}) {
    if (normalizedProduct(presence.product) !== "valorant" || presenceState(presence) !== "game" || presence.state?.toUpperCase() !== "INGAME") return null;
    const map = presence.mapId ? mapNames[presence.mapId.toLowerCase()] : undefined;
    const validScore = presence.scoreAvailable === true
        && Number.isInteger(presence.allyScore) && Number.isInteger(presence.enemyScore)
        && presence.allyScore! >= 0 && presence.enemyScore! >= 0;
    return {
        detail: [map, queueName(presence.queueId)].filter(Boolean).join(" · ") || "VALORANT",
        score: validScore ? `${presence.allyScore}–${presence.enemyScore}` : null,
    };
}

/** Small brand-coloured mark for the game a friend is in (not official logos). */
export function gameMark(presence: SocialPresence): { key: string; code: string; color: string; label: string } | null {
    const product = normalizedProduct(presence.product);
    if (presenceState(presence) === "mobile" || RIOT_MOBILE_PRODUCTS.has(product)) return { key: "mobile", code: "", color: "#4aa8e0", label: "Riot Mobile" };
    const marks: Record<string, { key: string; code: string; color: string }> = {
        valorant: { key: "valorant", code: "VAL", color: "#ff4655" },
        league_of_legends: { key: "lol", code: "LoL", color: "#c8aa6e" },
        leagueoflegends: { key: "lol", code: "LoL", color: "#c8aa6e" },
        lol: { key: "lol", code: "LoL", color: "#c8aa6e" },
        teamfight_tactics: { key: "tft", code: "TFT", color: "#e8a33d" },
        teamfighttactics: { key: "tft", code: "TFT", color: "#e8a33d" },
        tft: { key: "tft", code: "TFT", color: "#e8a33d" },
        legends_of_runeterra: { key: "lor", code: "LoR", color: "#3fc6d9" },
        legendsofruneterra: { key: "lor", code: "LoR", color: "#3fc6d9" },
        lor: { key: "lor", code: "LoR", color: "#3fc6d9" },
        wild_rift: { key: "wr", code: "WR", color: "#5aa9ff" },
        wildrift: { key: "wr", code: "WR", color: "#5aa9ff" },
        "2xko": { key: "2xko", code: "2XKO", color: "#b06cff" },
        project_l: { key: "2xko", code: "2XKO", color: "#b06cff" },
    };
    const mark = marks[product];
    return mark ? { ...mark, label: productName(product) } : null;
}

/** Product IDs the Riot Mobile app reports; "ritoplus" appears while the app is backgrounded (Away). */
const RIOT_MOBILE_PRODUCTS = new Set(["ritoplus", "riot_mobile", "riotmobile"]);

export function productName(product = "") {
    const normalized = normalizedProduct(product);
    if (RIOT_MOBILE_PRODUCTS.has(normalized)) return "Riot Mobile";
    const labels: Record<string, string> = {
        valorant: "VALORANT",
        league_of_legends: "League of Legends",
        leagueoflegends: "League of Legends",
        lol: "League of Legends",
        teamfight_tactics: "Teamfight Tactics",
        teamfighttactics: "Teamfight Tactics",
        tft: "Teamfight Tactics",
        legends_of_runeterra: "Legends of Runeterra",
        legendsofruneterra: "Legends of Runeterra",
        lor: "Legends of Runeterra",
        wild_rift: "Wild Rift",
        wildrift: "Wild Rift",
        "2xko": "2XKO",
        project_l: "2XKO",
        riotclient: "Riot Client",
        riot_client: "Riot Client",
        riot_chat: "Riot Client",
        keystone: "Riot Client",
    };
    if (labels[normalized]) return labels[normalized];
    if (!normalized) return "Riot";
    return normalized
        .split("_")
        .filter(Boolean)
        .map((part) => part.length <= 3 ? part.toUpperCase() : `${part[0].toUpperCase()}${part.slice(1)}`)
        .join(" ");
}

export function presenceSection(presence: SocialPresence) {
    if (presenceState(presence) === "offline") return "Offline";
    const product = productName(presence.product);
    if (product === "Riot" || product === "Riot Client") {
        return presenceState(presence) === "mobile" ? "Riot Mobile" : "Riot Client";
    }
    return product;
}

export function presenceSectionRank(label: string) {
    if (label === "VALORANT") return 10;
    if (label === "League of Legends") return 20;
    if (label === "Teamfight Tactics") return 30;
    if (label === "Wild Rift") return 40;
    if (label === "Legends of Runeterra") return 50;
    if (label === "2XKO") return 60;
    if (label === "Riot Client") return 80;
    if (label === "Riot Mobile") return 90;
    if (label === "Offline") return 100;
    return 70;
}

function isClientProduct(product = "") {
    return ["", "riotclient", "riot_client", "riot_chat", "keystone"].includes(normalizedProduct(product));
}

export function isGamePresence(presence: SocialPresence) {
    return !isClientProduct(presence.product) && presenceState(presence) !== "offline";
}

export function presenceState(presence: SocialPresence): PresenceState {
    const state = (presence.state || "").toUpperCase();
    const availability = (presence.availability || "").toLowerCase();
    const product = normalizedProduct(presence.product);
    if (state === "OFFLINE") return "offline";
    if (availability === "mobile") return "mobile";
    // Riot sets "dnd" automatically during matches, so being in a game wins.
    if (/(PREGAME|INGAME|IN_GAME|MATCH|CHAMP.?SELECT|GAMESTART)/.test(state)) return "game";
    if (availability === "away") return "away";
    if (availability === "dnd") return "dnd";
    if (isClientProduct(product)) {
        return /pc|windows|desktop/i.test(presence.platform || "") ? "chat" : "offline";
    }
    return "online";
}

/** "5m ago", "3h ago", "2d ago", or a date once it is over a month old. */
export function lastOnlineLabel(at: number, now = Date.now()) {
    const minutes = Math.max(0, Math.floor((now - at) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 31) return `${days}d ago`;
    return `on ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(at).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" })}`;
}

/** Newest known activity for an offline friend, for sorting. */
export function lastActiveAt(presence: SocialPresence | undefined) {
    return Math.max(presence?.lastOnlineAt || 0, presence?.lastMatchAt || 0);
}

export function presenceActivity(presence: SocialPresence) {
    const kind = presenceState(presence);
    const product = normalizedProduct(presence.product);
    const productLabel = productName(product);
    if (kind === "offline") {
        // Prefer whichever is newer: seen online, or the start of their latest match.
        const played = (presence.lastMatchAt || 0) > (presence.lastOnlineAt || 0);
        const at = played ? presence.lastMatchAt : presence.lastOnlineAt;
        return { label: "Offline", detail: at ? `${played ? "Last played" : "Last online"} ${lastOnlineLabel(at)}` : "" };
    }
    if (kind === "chat") return { label: "Riot Client", detail: "Online on PC" };
    if (kind === "mobile") return { label: "Mobile", detail: "Riot Mobile" };

    const state = (presence.state || "").toUpperCase();
    const compactState = state.replace(/[^A-Z0-9]/g, "");
    const partyState = (presence.partyState || "").toUpperCase();
    const queue = queueName(presence.queueId || "");
    const party = presence.partySize && presence.partySize > 1
        ? `${presence.partySize}${presence.maxPartySize ? `/${presence.maxPartySize}` : ""} in party`
        : "";

    if (product !== "valorant") {
        if (/CHAMPIONSELECT|CHAMPSELECT/.test(compactState)) return { label: "Champion select", detail: productLabel };
        if (/INGAME|MATCH|GAMESTART/.test(compactState)) return { label: `In ${productLabel}`, detail: "In match" };
        if (/QUEUE|MATCHMAKING/.test(compactState)) return { label: `${productLabel} queue`, detail: "Looking for a match" };
        if (/LOBBY|PARTY/.test(compactState)) return { label: productLabel, detail: "In lobby" };
        if (kind === "away") return { label: "Away", detail: productLabel };
        if (kind === "dnd") return { label: "Do not disturb", detail: productLabel };
        return { label: productLabel, detail: state && !["ONLINE", "CHAT", "AVAILABLE"].includes(state) ? state.toLowerCase().replaceAll("_", " ") : "Playing" };
    }

    if (state === "PREGAME") return { label: "Agent select", detail: [queue, party].filter(Boolean).join(" · ") };
    if (state === "INGAME") return { label: "In match", detail: [queue || "VALORANT", party].filter(Boolean).join(" · ") };
    if (/MATCHMAKING|STARTING_MATCHMAKING/.test(partyState)) return { label: "In queue", detail: [queue || "VALORANT", party].filter(Boolean).join(" · ") };
    if (/MATCHMADE_GAME_STARTING/.test(partyState)) return { label: "Match found", detail: [queue, party].filter(Boolean).join(" · ") };
    if (/CUSTOM_GAME/.test(partyState)) return { label: "Custom game lobby", detail: party };
    if (kind === "away") return { label: "Away", detail: [state === "MENUS" ? "In menus" : "VALORANT", party].filter(Boolean).join(" · ") };
    if (kind === "dnd") return { label: "Do not disturb", detail: [state === "MENUS" ? "In menus" : "VALORANT", party].filter(Boolean).join(" · ") };
    if (state === "MENUS") return { label: "In menus", detail: party };
    return { label: "VALORANT", detail: ["Online", party].filter(Boolean).join(" · ") };
}
