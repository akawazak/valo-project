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

export function presenceState(presence: SocialPresence): PresenceState {
    const state = (presence.state || "").toUpperCase();
    const availability = (presence.availability || "").toLowerCase();
    if (state === "OFFLINE") return "offline";
    if (state === "PREGAME" || state === "INGAME") return "game";
    if (availability === "away") return "away";
    if (availability === "dnd") return "dnd";
    if (availability === "mobile") return "mobile";
    if ((presence.product || "").toLowerCase() !== "valorant") {
        return /pc|windows|desktop/i.test(presence.platform || "") ? "chat" : "offline";
    }
    return "online";
}

export function presenceActivity(presence: SocialPresence) {
    const kind = presenceState(presence);
    if (kind === "offline") return { label: "Offline", detail: "" };
    if (kind === "chat") return { label: "Riot Client", detail: "Online on PC" };
    if (kind === "mobile") return { label: "Mobile", detail: "Riot Mobile" };

    const state = (presence.state || "").toUpperCase();
    const partyState = (presence.partyState || "").toUpperCase();
    const queue = queueName(presence.queueId || "");
    const party = presence.partySize && presence.partySize > 1
        ? `${presence.partySize}${presence.maxPartySize ? `/${presence.maxPartySize}` : ""} in party`
        : "";

    if (state === "PREGAME") return { label: "Agent select", detail: [queue, party].filter(Boolean).join(" · ") };
    if (state === "INGAME") return { label: "In match", detail: [queue || "VALORANT", party].filter(Boolean).join(" · ") };
    if (/MATCHMAKING|STARTING_MATCHMAKING/.test(partyState)) return { label: "In queue", detail: [queue || "VALORANT", party].filter(Boolean).join(" · ") };
    if (/MATCHMADE_GAME_STARTING/.test(partyState)) return { label: "Match found", detail: [queue, party].filter(Boolean).join(" · ") };
    if (/CUSTOM_GAME/.test(partyState)) return { label: "Custom game lobby", detail: party };
    if (kind === "away") return { label: "Away", detail: [state === "MENUS" ? "In menus" : "VALORANT", party].filter(Boolean).join(" · ") };
    if (kind === "dnd") return { label: "Do not disturb", detail: [state === "MENUS" ? "In menus" : "VALORANT", party].filter(Boolean).join(" · ") };
    if (state === "MENUS") return { label: "In menus", detail: party };
    return { label: "Online", detail: ["VALORANT", party].filter(Boolean).join(" · ") };
}
