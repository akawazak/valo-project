"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    getPartyStatus,
    fetchCachedPublicJson,
    getSocialStatus,
    PartyMember,
    PartyStatusResponse,
    SocialPresence,
    SocialStatusResponse,
} from "@/services/api";
import { useData } from "@/context/DataContext";
import { useFloatingWidgetDrag } from "@/hooks/useFloatingWidgetDrag";
import ProfilePanel from "@/features/profile/ProfilePanel";
import "./LivePartyStatus.css";

const POLL_MS = 5000;
type PartyPublicCard = { uuid?: string; displayIcon?: string; smallArt?: string; wideArt?: string };
type PartyPublicTierSet = { tiers?: Array<{ tier: number; tierName?: string; smallIcon?: string; largeIcon?: string }> };

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

type CardMeta = { images: string[] };
type TierMeta = { name: string; icon: string };
type PartyProfileTarget = {
    puuid: string;
    gameName: string;
    tagLine: string;
};
type PartyContextMenu = { x: number; y: number; profile: PartyProfileTarget };

function SafePartyImage({ sources, className, fallback, fallbackClassName, eager = false }: { sources: string[]; className?: string; fallback: string; fallbackClassName?: string; eager?: boolean }) {
    const [sourceIndex, setSourceIndex] = useState(0);
    const src = sources[sourceIndex];
    if (!src) return <span className={fallbackClassName}>{fallback}</span>;
    return <img src={src} alt="" className={className} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setSourceIndex(index => index + 1)} />;
}

function FriendsGlyph() {
    return (
        <svg className="live-party-friends-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8.1 11.1a3.15 3.15 0 1 0 0-6.3 3.15 3.15 0 0 0 0 6.3Zm7.7-1.3a2.55 2.55 0 1 0 0-5.1 2.55 2.55 0 0 0 0 5.1Zm-7.7 2.1c-3.2 0-5.8 1.75-5.8 4.25V19h11.6v-2.85c0-2.5-2.6-4.25-5.8-4.25Zm7.7.05c-.56 0-1.1.08-1.58.22 1.08.85 1.78 2.04 1.78 3.48V19H21v-2.28c0-2.77-2.3-4.77-5.2-4.77Z" fill="currentColor" />
        </svg>
    );
}

function profileFromIdentity(puuid: string, displayName: string): PartyProfileTarget {
    const [gameName, tagLine = ""] = displayName.split("#");
    return { puuid, gameName: gameName || "Player", tagLine };
}

export default function LivePartyStatus({ showOfflineByDefault = false }: { showOfflineByDefault?: boolean }) {
    const { activeAccount, isBackendOnline } = useData();
    const [party, setParty] = useState<PartyStatusResponse | null>(null);
    const [social, setSocial] = useState<SocialStatusResponse | null>(null);
    const [stale, setStale] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const [profileTarget, setProfileTarget] = useState<PartyProfileTarget | null>(null);
    const [contextMenu, setContextMenu] = useState<PartyContextMenu | null>(null);
    const compactPartyDrag = useFloatingWidgetDrag("party-compact");
    const expandedPartyDrag = useFloatingWidgetDrag("party-expanded");
    const [expandedPlacement, setExpandedPlacement] = useState<React.CSSProperties | undefined>(undefined);
    const partyWidgetRef = useRef<HTMLElement>(null);
    const profileModalRef = useRef<HTMLElement>(null);
    const latestPartyRef = useRef<PartyStatusResponse | null>(null);
    const lastPartyIdRef = useRef<string | null>(null);

    const [cardCache, setCardCache] = useState<Record<string, CardMeta>>({});
    const [tierCache, setTierCache] = useState<Record<number, TierMeta>>({});

    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener("pointerdown", close);
        window.addEventListener("blur", close);
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("blur", close);
        };
    }, [contextMenu]);

    useEffect(() => {
        if (!expanded) return;
        const close = (event: PointerEvent) => {
            // The profile is rendered through a portal, outside this widget's
            // DOM subtree. Its controls must not count as an outside click.
            if (profileModalRef.current?.contains(event.target as Node)) return;
            if (!partyWidgetRef.current?.contains(event.target as Node)) setExpanded(false);
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [expanded]);

    const openPartyPanel = (anchor: DOMRect) => {
        const edge = 12;
        const gap = 8;
        const roomAbove = Math.max(0, anchor.top - edge - gap);
        const roomBelow = Math.max(0, window.innerHeight - anchor.bottom - edge - gap);
        const openBelow = roomBelow >= roomAbove;
        const availableHeight = openBelow ? roomBelow : roomAbove;
        const dockRight = anchor.left + anchor.width / 2 >= window.innerWidth / 2;

        // Re-evaluate from the compact launcher every time. This prevents a
        // panel drag from leaving the next opening clipped at the viewport edge.
        expandedPartyDrag.resetPosition();
        setProfileTarget(null);
        setExpandedPlacement({
            left: dockRight ? "auto" : edge,
            right: dockRight ? edge : "auto",
            top: openBelow ? Math.max(edge, anchor.bottom + gap) : "auto",
            bottom: openBelow ? "auto" : Math.max(edge, window.innerHeight - anchor.top + gap),
            maxHeight: `${Math.max(180, Math.min(680, availableHeight))}px`,
        });
        setExpanded(true);
    };

    const openProfile = (profile: PartyProfileTarget) => {
        setContextMenu(null);
        setProfileTarget(profile);
    };

    const openContextMenu = (event: React.MouseEvent, profile: PartyProfileTarget) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY, profile });
    };

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

        fetchCachedPublicJson<{ data?: PartyPublicCard[] }>("https://valorant-api.com/v1/playercards")
            .then((d) => {
                if (cancelled) return;
                const m: Record<string, CardMeta> = {};
                for (const item of d.data || []) {
                    if (!item.uuid) continue;
                    m[item.uuid.toLowerCase()] = {
                        images: [item.displayIcon, item.smallArt, item.wideArt].filter((image): image is string => Boolean(image)),
                    };
                }
                setCardCache(m);
            })
            .catch((err) => console.error("Error loading playercards API", err));

        fetchCachedPublicJson<{ data?: PartyPublicTierSet[] }>("https://valorant-api.com/v1/competitivetiers")
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
    const onlineCount = presences.filter((presence) => ["game", "online"].includes(presenceState(presence))).length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    const chatCount = presences.filter((presence) => presenceState(presence) === "chat").length;
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
                    onOpen={(anchor) => {
                        if (!compactPartyDrag.consumeClick()) openPartyPanel(anchor);
                    }}
                    dragStyle={compactPartyDrag.style}
                    setElement={compactPartyDrag.setElement}
                    onPointerDown={compactPartyDrag.onPointerDown}
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
                onOpen={(anchor) => {
                    if (!compactPartyDrag.consumeClick()) openPartyPanel(anchor);
                }}
                dragStyle={compactPartyDrag.style}
                setElement={compactPartyDrag.setElement}
                onPointerDown={compactPartyDrag.onPointerDown}
            />
        );
    }

    return (
        <aside
            ref={(element) => {
                partyWidgetRef.current = element;
                expandedPartyDrag.setElement(element);
            }}
            className={`live-party-widget${stale ? " is-stale" : ""}`}
            style={expandedPartyDrag.style || expandedPlacement}
            aria-live="polite"
        >
            <div key={refreshKey} className="live-party-refresh" />
            <div className="live-party-header live-party-drag-handle" onPointerDown={(event) => expandedPartyDrag.onPointerDown(event, true)}>
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
                        onClick={() => {
                            setProfileTarget(null);
                            setExpanded(false);
                        }}
                        aria-label="Minimize party panel"
                        title="Minimize"
                    >
                        <span aria-hidden="true">–</span>
                    </button>
                </div>
            </div>
            <div className="live-party-overview">
                <PresenceStat label={hasParty ? "Party" : "Friends"} value={hasParty ? `${members.length}/5` : String(social?.friendCount || presences.length)} />
                <PresenceStat label="In match" value={String(inGameCount)} accent />
                <PresenceStat label="Online" value={String(onlineCount + chatCount)} />
            </div>
            {hasParty && (
                <div className="live-party-members">
                    {members.map((member) => (
                        <PartyMemberRow
                            key={member.puuid}
                            member={member}
                            card={cardCache[member.cardId?.toLowerCase()]}
                            tier={tierCache[member.competitiveTier]}
                            onOpenProfile={() => openProfile(profileFromIdentity(member.puuid, member.name))}
                            onContextMenu={(event) => openContextMenu(event, profileFromIdentity(member.puuid, member.name))}
                        />
                    ))}
                </div>
            )}
            {!hasParty && <PartyEmptyState party={party} />}
            <FriendPresenceList
                social={social}
                presences={presences}
                cardCache={cardCache}
                showOfflineByDefault={showOfflineByDefault}
                onOpenProfile={openProfile}
                onContextMenu={openContextMenu}
            />
            {contextMenu && (
                <div
                    className="live-party-context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    role="menu"
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <button type="button" role="menuitem" onClick={() => {
                        setProfileTarget(contextMenu.profile);
                        setContextMenu(null);
                    }}>Open Profile</button>
                </div>
            )}
            {profileTarget && typeof document !== "undefined" && createPortal(
                <div className="live-party-profile-backdrop" role="presentation" onMouseDown={() => setProfileTarget(null)}>
                    <section ref={profileModalRef} className="live-party-profile-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
                        <button type="button" className="live-party-profile-close" onClick={() => setProfileTarget(null)} aria-label="Close profile">×</button>
                        <div className="live-party-profile-content">
                            <ProfilePanel
                                key={profileTarget.puuid}
                                requestedProfile={profileTarget}
                                onRequestedProfileChange={setProfileTarget}
                                autoSyncMatches={true}
                            />
                        </div>
                    </section>
                </div>,
                document.body,
            )}
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
    dragStyle,
    setElement,
    onPointerDown,
}: {
    local: PartyMember;
    party: PartyStatusResponse;
    friendCount: number;
    card?: CardMeta;
    tier?: TierMeta;
    onOpen: (anchor: DOMRect) => void;
    dragStyle?: React.CSSProperties;
    setElement: (element: HTMLButtonElement | null) => void;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
    const phaseClass = "is-" + (party.phase || "party");
    return (
        <button
            ref={setElement}
            type="button"
            className={`live-party-pill is-clickable ${phaseClass}`}
            onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
            onPointerDown={onPointerDown}
            style={dragStyle}
            aria-label="Open live party panel"
            title="Open party"
        >
            <span className="live-party-pill-avatar" aria-hidden="true">
                <SafePartyImage key={(card?.images || []).join("|") || local.name} sources={card?.images || []} className="live-party-pill-avatar-img" fallback={local.name.slice(0, 1).toUpperCase()} fallbackClassName="live-party-pill-avatar-letter" eager />
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
    dragStyle,
    setElement,
    onPointerDown,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
    onOpen: (anchor: DOMRect) => void;
    dragStyle?: React.CSSProperties;
    setElement: (element: HTMLButtonElement | null) => void;
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}) {
    const onlineCount = presences.filter((presence) => ["game", "online"].includes(presenceState(presence))).length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    const chatCount = presences.filter((presence) => presenceState(presence) === "chat").length;
    return (
        <button
            ref={setElement}
            type="button"
            className="live-party-pill is-clickable is-friends"
            onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
            onPointerDown={onPointerDown}
            style={dragStyle}
            aria-label="Open friend presence panel"
            title="Open friends"
        >
            <span className="live-party-pill-avatar live-party-pill-avatar--friends" aria-hidden="true">
                <FriendsGlyph />
                <strong className="live-party-friends-count">{onlineCount}</strong>
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">Party & Friends</span>
                <span className="live-party-pill-title">{socialTitle(social, presences)}</span>
                <span className="live-party-pill-sub">
                    {inGameCount} in match - {chatCount} Riot Client - {social?.friendCount || presences.length} total
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
    showOfflineByDefault,
    onOpenProfile,
    onContextMenu,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
    cardCache: Record<string, CardMeta>;
    showOfflineByDefault: boolean;
    onOpenProfile: (profile: PartyProfileTarget) => void;
    onContextMenu: (event: React.MouseEvent, profile: PartyProfileTarget) => void;
}) {
    const [showOffline, setShowOffline] = useState(() => showOfflineByDefault || (typeof window !== "undefined" && window.localStorage.getItem("vantavault:friends:offline-open") === "true"));
    const [friendSearch, setFriendSearch] = useState("");
    const [valorantOnly, setValorantOnly] = useState(false);
    const [compactRows, setCompactRows] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("vantavault:friends:compact") === "true");
    useEffect(() => { if (showOfflineByDefault) setShowOffline(true); }, [showOfflineByDefault]);
    useEffect(() => { window.localStorage.setItem("vantavault:friends:offline-open", String(showOffline)); }, [showOffline]);
    useEffect(() => { window.localStorage.setItem("vantavault:friends:compact", String(compactRows)); }, [compactRows]);
    const activePresences = presences.filter((presence) => presenceState(presence) !== "offline");
    const offlinePresences = presences.filter((presence) => presenceState(presence) === "offline");
    const matchesFilters = (presence: SocialPresence) => {
        if (valorantOnly && !["game", "online"].includes(presenceState(presence))) return false;
        return (presence.name || "").toLowerCase().includes(friendSearch.trim().toLowerCase());
    };
    const visibleActivePresences = activePresences.filter(matchesFilters);
    const visibleOfflinePresences = offlinePresences.filter(matchesFilters);
    const valorantCount = activePresences.filter((presence) => presenceState(presence) !== "chat").length;
    const chatCount = activePresences.length - valorantCount;

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
                    <span>{valorantCount} VALORANT</span>
                    <span>{chatCount} Riot Client</span>
                </div>
            </div>
            <div className="live-party-friend-tools">
                <input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Search friends" aria-label="Search friends" />
                <button type="button" className={valorantOnly ? "active" : ""} onClick={() => setValorantOnly((current) => !current)}>VALORANT</button>
                <button type="button" className={compactRows ? "active" : ""} onClick={() => setCompactRows((current) => !current)} aria-label="Toggle compact friend rows">Compact</button>
            </div>
            <div className={`live-party-friend-scroll${compactRows ? " is-compact" : ""}`}>
                <div className="live-party-friend-list">
                    {visibleActivePresences.map((presence, index) => (
                        <FriendPresenceRow
                            key={presence.puuid || `${presence.name}-${index}`}
                            presence={presence}
                            cardCache={cardCache}
                            onOpenProfile={() => onOpenProfile(profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                    {visibleActivePresences.length === 0 && (
                        <div className="live-party-friend-empty">No friends match these filters.</div>
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
                                {visibleOfflinePresences.map((presence, index) => (
                                    <FriendPresenceRow
                                        key={presence.puuid || `${presence.name}-offline-${index}`}
                                        presence={presence}
                                        cardCache={cardCache}
                                        onOpenProfile={() => onOpenProfile(profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
                                        onContextMenu={onContextMenu}
                                    />
                                ))}
                                {visibleOfflinePresences.length === 0 && <div className="live-party-friend-empty">No offline friends match.</div>}
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
    onOpenProfile,
    onContextMenu,
}: {
    presence: SocialPresence;
    cardCache: Record<string, CardMeta>;
    onOpenProfile: () => void;
    onContextMenu: (event: React.MouseEvent, profile: PartyProfileTarget) => void;
}) {
    const state = presenceState(presence);
    const card = presence.cardId ? cardCache[presence.cardId.toLowerCase()] : undefined;
    const avatarSources = card?.images || [];
    return (
        <div
            className={`live-party-friend-row is-${state}`}
            role="button"
            tabIndex={0}
            onClick={onOpenProfile}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenProfile(); }}
            onContextMenu={(event) => onContextMenu(event, profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
        >
            <span className="live-party-friend-avatar" aria-hidden="true">
                <SafePartyImage key={avatarSources.join("|") || presence.name} sources={avatarSources} fallback={(presence.name || "?").slice(0, 1).toUpperCase()} eager={state !== "offline"} />
                <i className="live-party-friend-dot" />
            </span>
            <span className="live-party-friend-main">
                <span className="live-party-friend-name">{presence.name || "Unknown friend"}</span>
                <span className="live-party-friend-sub">{presenceLabel(presence)}</span>
            </span>
            <span className="live-party-friend-state">
                {state === "game" ? "In match" : state === "online" ? "VALORANT" : state === "chat" ? "Riot Client" : "Offline"}
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
    const valorantCount = presences.filter((presence) => ["game", "online"].includes(presenceState(presence))).length;
    if (valorantCount) return `${valorantCount} in VALORANT`;
    const chatCount = presences.filter((presence) => presenceState(presence) === "chat").length;
    return chatCount ? `${chatCount} on Riot Client` : "No active friends";
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

type PresenceState = "game" | "online" | "chat" | "offline";

function presenceState(presence: SocialPresence): PresenceState {
    if ((presence.state || "").toLowerCase() === "offline") return "offline";
    if ((presence.product || "").toLowerCase() !== "valorant") {
        return /pc|windows|desktop/i.test(presence.platform || "") ? "chat" : "offline";
    }
    return presence.queueId || /in.?game|pregame|match/i.test(presence.state || "") ? "game" : "online";
}

function presencePriority(presence: SocialPresence) {
    const state = presenceState(presence);
    return state === "game" ? 0 : state === "online" ? 1 : state === "chat" ? 2 : 3;
}

function presenceLabel(presence: SocialPresence) {
    if (presenceState(presence) === "chat") {
        return "Riot Client on PC";
    }
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
    onOpenProfile,
    onContextMenu,
}: {
    member: PartyMember;
    card?: CardMeta;
    tier?: TierMeta;
    onOpenProfile: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const avatarSources = card?.images || [];
    return (
        <div
            className={`live-party-member${member.isLocal ? " is-local" : ""}`}
            role="button"
            tabIndex={0}
            onClick={onOpenProfile}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenProfile(); }}
            onContextMenu={onContextMenu}
        >
            <div className="live-party-avatar" aria-hidden="true">
                <SafePartyImage key={avatarSources.join("|") || member.name} sources={avatarSources} className="live-party-avatar-img" fallback={member.name.slice(0, 1).toUpperCase()} fallbackClassName="live-party-avatar-letter" eager />
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
                <SafePartyImage key={tier?.icon || tier?.name || "rank"} sources={tier?.icon ? [tier.icon] : []} className="live-party-rank-img" fallback={tier?.name ? tier.name.slice(0, 1) : "?"} fallbackClassName="live-party-rank-letter" eager />
            </div>
        </div>
    );
}
