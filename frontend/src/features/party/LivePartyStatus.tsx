"use client";

import { useEffect, useRef, useState } from "react";
import {
    getPartyStatus,
    getSocialStatus,
    PartyMember,
    PartyStatusResponse,
    SocialPresence,
    SocialStatusResponse,
} from "@/services/api";
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

function phaseShort(phase: PartyStatusResponse["phase"]) {
    if (phase === "matchmaking") return "Matchmaking";
    if (phase === "pregame") return "Agent select";
    if (phase === "coregame") return "In match";
    return "Party";
}

type CardMeta = { small: string; wide: string; art: string };
type TierMeta = { name: string; icon: string };

export default function LivePartyStatus() {
    const { activeAccount, isBackendOnline } = useData();
    const [party, setParty] = useState<PartyStatusResponse | null>(null);
    const [social, setSocial] = useState<SocialStatusResponse | null>(null);
    const [stale, setStale] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const latestPartyRef = useRef<PartyStatusResponse | null>(null);
    const lastPartyIdRef = useRef<string | null>(null);

    const [cardCache, setCardCache] = useState<Record<string, CardMeta>>({});
    const [tierCache, setTierCache] = useState<Record<number, TierMeta>>({});

    useEffect(() => {
        if (!activeAccount || !isBackendOnline) {
            latestPartyRef.current = null;
            setParty(null);
            setSocial(null);
            setStale(false);
            setExpanded(false);
            return;
        }

        let active = true;
        const poll = async () => {
            const [data, socialData] = await Promise.all([
                getPartyStatus().catch((err) => ({ phase: "error" as const, error: err instanceof Error ? err.message : String(err || "") })),
                getSocialStatus().catch(() => null),
            ]);
            if (!active) return;
            setSocial(socialData);

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

            // New party detected (different ID) — auto-collapse to the pill
            // so it doesn't burst onto the screen at full size.
            const newId = data.partyId || (data.members?.[0]?.puuid ?? null);
            if (newId && lastPartyIdRef.current && newId !== lastPartyIdRef.current) {
                setExpanded(false);
            }
            lastPartyIdRef.current = newId;

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

    // Load Valorant-API metadata (player cards + competitive tier icons).
    // Same public endpoint pattern as LiveMatchOverlay - no key required.
    useEffect(() => {
        let cancelled = false;

        fetch("https://valorant-api.com/v1/playercards")
            .then((res) => res.json())
            .then((d) => {
                if (cancelled) return;
                const m: Record<string, CardMeta> = {};
                for (const item of d.data || []) {
                    if (!item.uuid) continue;
                    m[item.uuid.toLowerCase()] = {
                        small: item.smallArt || item.displayIcon || "",
                        wide: item.wideArt || "",
                        art: item.largeArt || item.artwork || "",
                    };
                }
                setCardCache(m);
            })
            .catch((err) => console.error("Error loading playercards API", err));

        fetch("https://valorant-api.com/v1/competitivetiers")
            .then((res) => res.json())
            .then((d) => {
                if (cancelled) return;
                const latestEpisode = d.data?.[d.data.length - 1];
                const t: Record<number, TierMeta> = {};
                for (const tier of latestEpisode?.tiers || []) {
                    t[tier.tier] = {
                        name: tier.tierName || "",
                        icon: tier.smallIcon || tier.largeIcon || "",
                    };
                }
                setTierCache(t);
            })
            .catch((err) => console.error("Error loading competitive tiers API", err));

        return () => {
            cancelled = true;
        };
    }, []);

    const presences = visiblePresences(social);
    const hasParty = !!party && party.phase !== "none" && party.phase !== "error" && !!party.members?.length;
    const hasFriends = presences.length > 0;

    if (!hasParty && !hasFriends) {
        return null;
    }

    const members = party?.members ?? [];
    const local = members.find((m) => m.isLocal) || members[0];

    // Compact pill — small, bottom-left, click to expand into the detailed view.
    if (!expanded) {
        if (!hasParty) {
            return (
                <FriendsPill
                    social={social}
                    presences={presences}
                    onOpen={() => setExpanded(true)}
                />
            );
        }
        return (
            <PartyPill
                local={local}
                party={party!}
                friendCount={presences.length}
                card={cardCache[local.cardId?.toLowerCase()]}
                tier={tierCache[local.competitiveTier]}
                onOpen={() => setExpanded(true)}
            />
        );
    }

    return (
        <aside className={`live-party-widget${stale ? " is-stale" : ""}`} aria-live="polite">
            <div key={refreshKey} className="live-party-refresh" />
            <div className="live-party-header">
                <div>
                    <div className="live-party-kicker">{hasParty ? "Live Party" : "Friend Presence"}</div>
                    <div className="live-party-title">
                        {hasParty ? phaseLabel(party!.phase, party!.queueId) : `${social?.onlineCount || presences.length} online`}
                    </div>
                </div>
                <div className="live-party-header-actions">
                    <div className="live-party-meta">
                        {hasParty && <span>{members.length}/5</span>}
                        {hasFriends && <span>{presences.length} friends</span>}
                        {(party?.source || social?.source) && <span>{party?.source || social?.source}</span>}
                        {stale && <span>stale</span>}
                    </div>
                    <button
                        type="button"
                        className="live-party-minimize"
                        onClick={() => setExpanded(false)}
                        aria-label="Minimize party panel"
                        title="Minimize"
                    >
                        <span aria-hidden="true">–</span>
                    </button>
                </div>
            </div>
            {hasParty && (
                <div className="live-party-members">
                    {members.map((member) => (
                        <PartyMemberRow
                            key={member.puuid}
                            member={member}
                            card={cardCache[member.cardId?.toLowerCase()]}
                            tier={tierCache[member.competitiveTier]}
                        />
                    ))}
                </div>
            )}
            <FriendPresenceList social={social} presences={presences} />
        </aside>
    );
}

function PartyPill({
    local,
    party,
    friendCount,
    card,
    tier,
    onOpen,
}: {
    local: PartyMember;
    party: PartyStatusResponse;
    friendCount: number;
    card?: CardMeta;
    tier?: TierMeta;
    onOpen: () => void;
}) {
    const phaseClass = "is-" + (party.phase || "party");
    return (
        <button
            type="button"
            className={`live-party-pill is-clickable ${phaseClass}`}
            onClick={onOpen}
            aria-label="Open live party panel"
            title="Open party"
        >
            <span className="live-party-pill-avatar" aria-hidden="true">
                {card?.small ? (
                    <img src={card.small} alt="" className="live-party-pill-avatar-img" />
                ) : (
                    <span className="live-party-pill-avatar-letter">
                        {local.name.slice(0, 1).toUpperCase()}
                    </span>
                )}
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">{phaseShort(party.phase)}</span>
                <span className="live-party-pill-title">{local.name}</span>
                <span className="live-party-pill-sub">
                    {tier?.name ? tier.name : "Unranked"} - {party.members?.length || 0}/5
                    {friendCount > 0 ? ` - ${friendCount} friends` : ""}
                </span>
            </span>
            <span className="live-party-pill-arrow" aria-hidden="true">›</span>
        </button>
    );
}

function FriendsPill({
    social,
    presences,
    onOpen,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            className="live-party-pill is-clickable is-friends"
            onClick={onOpen}
            aria-label="Open friend presence panel"
            title="Open friends"
        >
            <span className="live-party-pill-avatar live-party-pill-avatar--friends" aria-hidden="true">
                <span className="live-party-pill-avatar-letter">{presences.length}</span>
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">Friends Online</span>
                <span className="live-party-pill-title">{social?.onlineCount || presences.length} online</span>
                <span className="live-party-pill-sub">
                    {social?.inGameCount || 0} in match - {social?.friendCount || presences.length} total
                </span>
            </span>
            <span className="live-party-pill-arrow" aria-hidden="true">&gt;</span>
        </button>
    );
}

function FriendPresenceList({
    social,
    presences,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
}) {
    if (!presences.length) {
        if (social?.status === "unavailable" && social.error) {
            return (
                <div className="live-party-friends">
                    <div className="live-party-section-title">Friends</div>
                    <div className="live-party-friend-empty">{social.error}</div>
                </div>
            );
        }
        return null;
    }

    return (
        <div className="live-party-friends">
            <div className="live-party-section-heading">
                <div className="live-party-section-title">Friends</div>
                <div className="live-party-section-counts">
                    <span>{social?.inGameCount || 0} in match</span>
                    <span>{social?.onlineCount || presences.length} online</span>
                </div>
            </div>
            <div className="live-party-friend-list">
                {presences.map((presence, index) => {
                    const state = presenceState(presence);
                    return (
                    <div className={`live-party-friend-row is-${state}`} key={presence.puuid || `${presence.name}-${index}`}>
                        <span className="live-party-friend-dot" aria-hidden="true" />
                        <span className="live-party-friend-main">
                            <span className="live-party-friend-name">{presence.name || "Unknown friend"}</span>
                            <span className="live-party-friend-sub">{presenceLabel(presence)}</span>
                        </span>
                        <span className="live-party-friend-state">
                            {state === "game" ? "In match" : state === "online" ? "Online" : "Offline"}
                        </span>
                    </div>
                    );
                })}
            </div>
        </div>
    );
}

function visiblePresences(social: SocialStatusResponse | null) {
    return (social?.presences || [])
        .filter((presence) => !!(presence.name || presence.product || presence.state || presence.queueId))
        .sort((a, b) => presencePriority(a) - presencePriority(b) || (a.name || "").localeCompare(b.name || ""))
        .slice(0, 8);
}

function presenceState(presence: SocialPresence): "game" | "online" | "offline" {
    if (presence.queueId || /in.?game|pregame|match/i.test(presence.state || "")) return "game";
    if ((presence.state || "").toLowerCase() === "offline") return "offline";
    return "online";
}

function presencePriority(presence: SocialPresence) {
    const state = presenceState(presence);
    return state === "game" ? 0 : state === "online" ? 1 : 2;
}

function presenceLabel(presence: SocialPresence) {
    const parts = [
        presence.product?.toLowerCase() === "valorant" ? "VALORANT" : presence.product || "Riot",
        presence.queueId ? queueName(presence.queueId) : presence.state,
    ].filter(Boolean);
    return parts.join(" - ");
}

function PartyMemberRow({
    member,
    card,
    tier,
}: {
    member: PartyMember;
    card?: CardMeta;
    tier?: TierMeta;
}) {
    const showArtBg = !!card?.art;
    return (
        <div
            className={`live-party-member${member.isLocal ? " is-local" : ""}${showArtBg ? " has-card-bg" : ""}`}
            style={showArtBg ? { backgroundImage: `url(${card!.art})` } : undefined}
        >
            {showArtBg && <div className="live-party-member-scrim" aria-hidden="true" />}

            <div className="live-party-avatar" aria-hidden="true">
                {card?.small ? (
                    <img src={card.small} alt="" className="live-party-avatar-img" />
                ) : (
                    <span className="live-party-avatar-letter">
                        {member.name.slice(0, 1).toUpperCase()}
                    </span>
                )}
            </div>

            <div className="live-party-member-main">
                <div className="live-party-member-name">
                    <span className="live-party-member-name-text">{member.name}</span>
                    {member.isLocal && <span>YOU</span>}
                    {member.isOwner && <span>LEAD</span>}
                </div>
                <div className="live-party-member-sub">
                    {member.accountLevel > 0 ? `Level ${member.accountLevel}` : "Level --"}
                    {" - "}
                    {tier?.name ? tier.name : "Unranked"}
                </div>
            </div>

            <div className="live-party-rank" aria-hidden="true">
                {tier?.icon ? (
                    <img src={tier.icon} alt="" className="live-party-rank-img" />
                ) : (
                    <span className="live-party-rank-letter">
                        {tier?.name ? tier.name.slice(0, 1) : "?"}
                    </span>
                )}
            </div>
        </div>
    );
}
