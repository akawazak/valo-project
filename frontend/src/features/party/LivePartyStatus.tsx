"use client";

import { useEffect, useRef, useState } from "react";
import { getPartyStatus, PartyStatusResponse } from "@/services/api";
import { useData } from "@/context/DataContext";
import "./LivePartyStatus.css";

const POLL_MS = 5000;

function phaseLabel(phase: PartyStatusResponse["phase"], queueId?: string) {
    const queue = queueId ? queueName(queueId) : "";
    if (phase === "matchmaking") return queue ? `Matchmaking - ${queue}` : "Matchmaking";
    if (phase === "pregame") return queue ? `Agent select - ${queue}` : "Agent select";
    if (phase === "coregame") return queue ? `In match - ${queue}` : "In match";
    return queue ? `Party - ${queue}` : "Party";
}

function queueName(id: string) {
    const key = id.toLowerCase();
    const labels: Record<string, string> = {
        competitive: "Competitive",
        unrated: "Unrated",
        swiftplay: "Swiftplay",
        spikerush: "Spike Rush",
        deathmatch: "Deathmatch",
        teamdeathmatch: "Team Deathmatch",
        hurm: "Team Deathmatch",
        custom: "Custom",
    };
    return labels[key] || id;
}

export default function LivePartyStatus() {
    const { activeAccount, isBackendOnline } = useData();
    const [party, setParty] = useState<PartyStatusResponse | null>(null);
    const [stale, setStale] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const latestPartyRef = useRef<PartyStatusResponse | null>(null);

    useEffect(() => {
        if (!activeAccount || !isBackendOnline) {
            latestPartyRef.current = null;
            setParty(null);
            setStale(false);
            return;
        }

        let active = true;
        const poll = async () => {
            const data = await getPartyStatus();
            if (!active) return;

            if (data.phase === "none") {
                latestPartyRef.current = null;
                setParty(null);
                setStale(false);
                return;
            }

            if (data.phase === "error") {
                if (latestPartyRef.current) {
                    setParty(latestPartyRef.current);
                    setStale(true);
                } else {
                    setParty(null);
                    setStale(false);
                }
                return;
            }

            latestPartyRef.current = data;
            setParty(data);
            setStale(false);
            setRefreshKey((key) => key + 1);
        };

        poll();
        const interval = window.setInterval(poll, POLL_MS);
        return () => {
            active = false;
            window.clearInterval(interval);
        };
    }, [activeAccount, isBackendOnline]);

    if (!party || party.phase === "none" || !party.members?.length) {
        return null;
    }

    const members = party.members;

    return (
        <aside className={`live-party-widget${stale ? " is-stale" : ""}`} aria-live="polite">
            <div key={refreshKey} className="live-party-refresh" />
            <div className="live-party-header">
                <div>
                    <div className="live-party-kicker">Live Party</div>
                    <div className="live-party-title">{phaseLabel(party.phase, party.queueId)}</div>
                </div>
                <div className="live-party-meta">
                    <span>{members.length}/5</span>
                    {party.source && <span>{party.source}</span>}
                    {stale && <span>stale</span>}
                </div>
            </div>
            <div className="live-party-members">
                {members.map((member) => (
                    <div key={member.puuid} className={`live-party-member${member.isLocal ? " is-local" : ""}`}>
                        <div className="live-party-avatar">{member.name.slice(0, 1).toUpperCase()}</div>
                        <div className="live-party-member-main">
                            <div className="live-party-member-name">
                                {member.name}
                                {member.isLocal && <span>YOU</span>}
                                {member.isOwner && <span>LEAD</span>}
                            </div>
                            <div className="live-party-member-sub">
                                {member.accountLevel > 0 ? `Level ${member.accountLevel}` : "Level --"}
                                {member.competitiveTier > 0 ? ` - Rank tier ${member.competitiveTier}` : " - Rank hidden"}
                                {member.isReady ? " - Ready" : ""}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </aside>
    );
}
