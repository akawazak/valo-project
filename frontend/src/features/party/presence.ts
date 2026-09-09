import type { SocialPresence } from "@/services/api";

export type PresenceState = "game" | "online" | "away" | "dnd" | "mobile" | "chat" | "offline";

export function queueName(id = "") {
    const labels: Record<string, string> = {
        competitive: "Competitive",
        unrated: "Unrated",
        swiftplay: "Swiftplay",
        spikerush: "Spike Rush",
        deathmatch: "Deathmatch",
        teamdeathmatch: "Team Deathmatch",
        hurm: "Team Deathmatch",
        custom: "Custom Game",
        newmap: "New Map",
        snowball: "Snowball Fight",
        escalation: "Escalation",
        replication: "Replication",
        training: "The Range",
    };
    return labels[id.toLowerCase()] || id;
}

function normalizedProduct(product = "") {
    return product.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function productName(product = "") {
    const normalized = normalizedProduct(product);
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
    return ["", "riotclient", "riot_client", "riot_chat"].includes(normalizedProduct(product));
}

export function isGamePresence(presence: SocialPresence) {
    return !isClientProduct(presence.product) && presenceState(presence) !== "offline";
}

export function presenceState(presence: SocialPresence): PresenceState {
    const state = (presence.state || "").toUpperCase();
    const availability = (presence.availability || "").toLowerCase();
    const product = normalizedProduct(presence.product);
    if (state === "OFFLINE") return "offline";
    if (availability === "away") return "away";
    if (availability === "dnd") return "dnd";
    if (availability === "mobile") return "mobile";
    if (/(PREGAME|INGAME|IN_GAME|MATCH|CHAMP.?SELECT|GAMESTART)/.test(state)) return "game";
    if (isClientProduct(product)) {
        return /pc|windows|desktop/i.test(presence.platform || "") ? "chat" : "offline";
    }
    return "online";
}

export function presenceActivity(presence: SocialPresence) {
    const kind = presenceState(presence);
    const product = normalizedProduct(presence.product);
    const productLabel = productName(product);
    if (kind === "offline") return { label: "Offline", detail: "" };
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
