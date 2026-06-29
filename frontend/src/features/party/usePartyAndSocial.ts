"use client";

import { useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import {
    getPartyStatus,
    getSocialStatus,
    type PartyStatusResponse,
    type SocialStatusResponse,
} from "@/services/api";

const POLL_MS = 5000;

/**
 * Shared polling for the floating Live Party and Friend Presence popups.
 *
 * Why one hook:
 *   - Both widgets poll the same endpoints at the same cadence. Without sharing,
 *     each widget would open its own interval and we'd hit /v1/party twice.
 *   - Mounting the widgets in <body> means they can render even when the user
 *     is on a tab other than Profile.
 *
 * Returns nulls until the first poll finishes so widgets can render their
 * loading state without flashing an "empty" state.
 */
export function usePartyAndSocial(): {
    party: PartyStatusResponse | null;
    social: SocialStatusResponse | null;
} {
    const { activeAccount, isBackendOnline } = useData();
    const [party, setParty] = useState<PartyStatusResponse | null>(null);
    const [social, setSocial] = useState<SocialStatusResponse | null>(null);

    useEffect(() => {
        if (!activeAccount || !isBackendOnline) {
            setParty(null);
            setSocial(null);
            return;
        }

        let alive = true;
        const poll = async () => {
            const [partyData, socialData] = await Promise.all([
                getPartyStatus().catch((err) => ({
                    phase: "error" as const,
                    error: err instanceof Error ? err.message : String(err || ""),
                })),
                getSocialStatus().catch(() => null),
            ]);
            if (!alive) return;
            setParty(partyData);
            setSocial(socialData);
        };

        poll();
        const interval = window.setInterval(poll, POLL_MS);
        return () => {
            alive = false;
            window.clearInterval(interval);
        };
    }, [activeAccount, isBackendOnline]);

    return { party, social };
}

export function queueNameLabel(id: string | undefined): string {
    if (!id) return "";
    const labels: Record<string, string> = {
        competitive: "Competitive",
        unrated: "Unrated",
        spikerush: "Spike Rush",
        deathmatch: "Deathmatch",
        teamdeathmatch: "Team Deathmatch",
        hurm: "Team Deathmatch",
        swiftplay: "Swiftplay",
        premier: "Premier",
        custom: "Custom",
    };
    return labels[id.toLowerCase()] || id;
}

export function phaseLabel(phase: PartyStatusResponse["phase"], queueId?: string): string {
    const queue = queueNameLabel(queueId);
    if (phase === "matchmaking") return queue ? `Matchmaking · ${queue}` : "Matchmaking";
    if (phase === "pregame") return queue ? `Agent Select · ${queue}` : "Agent Select";
    if (phase === "coregame") return queue ? `In Match · ${queue}` : "In Match";
    return queue ? `Party · ${queue}` : "Party";
}

export function phaseShortLabel(phase: PartyStatusResponse["phase"] | undefined): string {
    if (phase === "matchmaking") return "Matchmaking";
    if (phase === "pregame") return "Agent Select";
    if (phase === "coregame") return "In Match";
    if (phase === "party") return "In Party";
    return "Solo";
}
