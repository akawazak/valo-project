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
                setParty(data);
                setStale(false);
                setRefreshKey((key) => key + 1);
                return;
            }

            if (data.phase === "error") {
                if (latestPartyRef.current) {
                    setParty(latestPartyRef.current);
                    setStale(true);
                } else {
                    setParty(data);
                    setStale(false);
                }
                setRefreshKey((key) => key + 1);
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

        let timer = 0;
        const schedule = () => {
            timer = window.setTimeout(async () => {
                await poll();
                if (active) schedule();
            }, document.hidden ? 20_000 : POLL_MS);
        };
        void poll().finally(schedule);
        return () => {
            active = false;
            window.clearTimeout(timer);
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

    const presences = sortedPresences(social);
    const onlineCount = presences.filter((presence) => presenceState(presence) !== "offline").length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    const hasParty = !!party && party.phase !== "none" && party.phase !== "error" && !!party.members?.length;
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
                friendCount={onlineCount}
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
                    <div className="live-party-kicker">{hasParty ? "Live Party" : "Party & Friends"}</div>
                    <div className="live-party-title">
                        {hasParty ? phaseLabel(party!.phase, party!.queueId) : socialTitle(social, presences)}
                    </div>
                </div>
                <div className="live-party-header-actions">
                    <div className="live-party-meta">
                        {(party?.source || social?.source) && (
                            <span>{(party?.source || social?.source) === "local" ? "Riot Client" : "Riot session"}</span>
                        )}
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
            <div className="live-party-overview">
                <PresenceStat
                    label={hasParty ? "Party" : "Friends"}
                    value={hasParty ? `${members.length}/5` : String(social?.friendCount || presences.length)}
                />
                <PresenceStat label="Online" value={String(onlineCount)} />
                <PresenceStat label="In match" value={String(inGameCount)} accent />
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
            {!hasParty && <PartyEmptyState party={party} />}
            <FriendPresenceList social={social} presences={presences} cardCache={cardCache} />
        </aside>
    );
}

function PresenceStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
    return (
        <div className={`live-party-overview-stat${accent ? " is-accent" : ""}`}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
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
                    {friendCount > 0 ? ` - ${friendCount} online` : ""}
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
    const onlineCount = presences.filter((presence) => presenceState(presence) !== "offline").length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    return (
        <button
            type="button"
            className="live-party-pill is-clickable is-friends"
            onClick={onOpen}
            aria-label="Open friend presence panel"
            title="Open friends"
        >
            <span className="live-party-pill-avatar live-party-pill-avatar--friends" aria-hidden="true">
                <span className="live-party-pill-avatar-letter">{onlineCount}</span>
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">Party & Friends</span>
                <span className="live-party-pill-title">{socialTitle(social, presences)}</span>
                <span className="live-party-pill-sub">
                    {inGameCount} in match - {social?.friendCount || presences.length} total
                </span>
            </span>
            <span className="live-party-pill-arrow" aria-hidden="true">&gt;</span>
        </button>
    );
}

function FriendPresenceList({
    social,
    presences,
    cardCache,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
    cardCache: Record<string, CardMeta>;
}) {
    const [showOffline, setShowOffline] = useState(false);
    const activePresences = presences.filter((presence) => presenceState(presence) !== "offline");
    const offlinePresences = presences.filter((presence) => presenceState(presence) === "offline");

    if (!presences.length) {
        return (
            <div className="live-party-friends">
                <div className="live-party-section-title">Friends</div>
                <div className="live-party-friend-empty">{socialEmptyLabel(social)}</div>
            </div>
        );
    }

    return (
        <div className="live-party-friends">
            <div className="live-party-section-heading">
                <div className="live-party-section-title">Friends</div>
                <div className="live-party-section-counts">
                    <span>{activePresences.length} active</span>
                </div>
            </div>
            <div className="live-party-friend-scroll">
                <div className="live-party-friend-list">
                    {activePresences.map((presence, index) => (
                        <FriendPresenceRow
                            key={presence.puuid || `${presence.name}-${index}`}
                            presence={presence}
                            cardCache={cardCache}
                        />
                    ))}
                    {activePresences.length === 0 && (
                        <div className="live-party-friend-empty">No friends are active right now.</div>
                    )}
                </div>
                {offlinePresences.length > 0 && (
                    <div className="live-party-offline-group">
                        <button
                            type="button"
                            className="live-party-offline-toggle"
                            onClick={() => setShowOffline((current) => !current)}
                            aria-expanded={showOffline}
                        >
                            <span>
                                <strong>Offline</strong>
                                <small>{offlinePresences.length} friends</small>
                            </span>
                            <span aria-hidden="true">{showOffline ? "−" : "+"}</span>
                        </button>
                        {showOffline && (
                            <div className="live-party-friend-list is-offline-list">
                                {offlinePresences.map((presence, index) => (
                                    <FriendPresenceRow
                                        key={presence.puuid || `${presence.name}-offline-${index}`}
                                        presence={presence}
                                        cardCache={cardCache}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function FriendPresenceRow({
    presence,
    cardCache,
}: {
    presence: SocialPresence;
    cardCache: Record<string, CardMeta>;
}) {
    const state = presenceState(presence);
    const card = presence.cardId ? cardCache[presence.cardId.toLowerCase()] : undefined;
    return (
        <div
            className={`live-party-friend-row is-${state}${card?.wide ? " has-card-art" : ""}`}
            style={card?.wide ? {
                backgroundImage: `linear-gradient(90deg, rgba(4, 18, 29, .93) 0%, rgba(4, 18, 29, .76) 58%, rgba(4, 18, 29, .9) 100%), url(${card.wide})`,
            } : undefined}
        >
            <span className="live-party-friend-avatar" aria-hidden="true">
                {card?.small ? <img src={card.small} alt="" /> : <span>{(presence.name || "?").slice(0, 1).toUpperCase()}</span>}
                <i className="live-party-friend-dot" />
            </span>
            <span className="live-party-friend-main">
                <span className="live-party-friend-name">{presence.name || "Unknown friend"}</span>
                <span className="live-party-friend-sub">{presenceLabel(presence)}</span>
            </span>
            <span className="live-party-friend-state">
                {state === "game" ? "In match" : state === "online" ? "Online" : "Offline"}
            </span>
        </div>
    );
}

function PartyEmptyState({ party }: { party: PartyStatusResponse | null }) {
    const unavailable = party?.phase === "error";
    return (
        <div className={`live-party-empty${unavailable ? " is-unavailable" : ""}`}>
            <span className="live-party-empty-icon" aria-hidden="true">{unavailable ? "!" : "+"}</span>
            <span>
                <strong>{unavailable ? "Live party unavailable" : "No active party"}</strong>
                <small>{unavailable ? "This Riot session cannot read party status right now." : "Join or create a party in VALORANT and it will appear here automatically."}</small>
            </span>
        </div>
    );
}

function socialTitle(social: SocialStatusResponse | null, presences: SocialPresence[]) {
    if (!social) return "Connecting presence";
    if (social.status === "unavailable") return "Presence unavailable";
    return `${presences.filter((presence) => presenceState(presence) !== "offline").length} online`;
}

function socialEmptyLabel(social: SocialStatusResponse | null) {
    if (!social) return "Connecting to Riot presence...";
    if (social.status === "unavailable") return "Presence is unavailable for this session. Riot Client or a valid access-token session may be required.";
    return "No friends are online right now.";
}

function sortedPresences(social: SocialStatusResponse | null) {
    return (social?.presences || [])
        .filter((presence) => !!(presence.name || presence.product || presence.state || presence.queueId))
        .sort((a, b) => presencePriority(a) - presencePriority(b) || (a.name || "").localeCompare(b.name || ""));
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
