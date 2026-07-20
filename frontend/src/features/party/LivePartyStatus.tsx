"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
    getPartyStatus,
    fetchCachedPublicJson,
    getSocialStatus,
    actOnSocialRequest,
    sendSocialFriendRequest,
    PartyMember,
    PartyStatusResponse,
    SocialPresence,
    SocialStatusResponse,
	ChatConversation,
	getChatSummary,
	subscribeChatEvents,
	subscribeSocialEvents,
} from "@/services/api";
import { useData } from "@/context/DataContext";
import ProfilePanel from "@/features/profile/ProfilePanel";
import ChatModal from "./ChatModal";
import { presenceActivity, presenceState, queueName } from "./presence";
import { useFloatingWidgetDrag } from "@/hooks/useFloatingWidgetDrag";
import { playUiSound } from "@/lib/uiSounds";
import { publishAppNotification } from "@/lib/appNotifications";
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
type PartyOverlay =
    | { kind: "context"; x: number; y: number; profile: PartyProfileTarget }
    | { kind: "profile"; profile: PartyProfileTarget }
    | { kind: "chat"; peer: string | null }
    | null;
type ChatNotice = { peer: string; name: string; body: string; timestamp: number };

function SafePartyImage({ sources, className, fallback, fallbackClassName, eager = false }: { sources: string[]; className?: string; fallback: string; fallbackClassName?: string; eager?: boolean }) {
    const [sourceIndex, setSourceIndex] = useState(0);
    const src = sources[sourceIndex];
    if (!src) return <span className={fallbackClassName}>{fallback}</span>;
    return <img src={src} alt="" className={className} loading={eager ? "eager" : "lazy"} decoding="async" onError={() => setSourceIndex(index => index + 1)} />;
}

function formatQueueElapsed(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function QueueElapsed({ startedAt, prefix = "" }: { startedAt?: number; prefix?: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!startedAt) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    // Only display a time Riot actually supplied. A future or implausibly old
    // timestamp is omitted instead of starting a convincing but false timer.
    if (!startedAt || startedAt > now + 5_000 || startedAt < now - 24 * 60 * 60 * 1000) return null;
    return <>{prefix}{formatQueueElapsed(now - startedAt)}</>;
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
    const { activeAccount, isBackendOnline, isLocalClientActive, playerCards: knownPlayerCards } = useData();
    const [party, setParty] = useState<PartyStatusResponse | null>(null);
    const [social, setSocial] = useState<SocialStatusResponse | null>(null);
    const [stale, setStale] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [expanded, setExpanded] = useState(false);
	const [overlay, setOverlay] = useState<PartyOverlay>(null);
	const [chatUnread, setChatUnread] = useState(0);
	const [chatUnreadByPeer, setChatUnreadByPeer] = useState<Record<string, number>>({});
	const [partyConversation, setPartyConversation] = useState<ChatConversation | undefined>();
	const [chatNotice, setChatNotice] = useState<ChatNotice | null>(null);
    const partyWidgetRef = useRef<HTMLElement>(null);
    const profileModalRef = useRef<HTMLElement>(null);
    const latestPartyRef = useRef<PartyStatusResponse | null>(null);
    const lastPartyIdRef = useRef<string | null>(null);
	const previousUnreadRef = useRef<Record<string, number> | null>(null);
	const chatOpenRef = useRef(false);
	const chatNoticeTimerRef = useRef<number | null>(null);
	const [rememberedCardIds, setRememberedCardIds] = useState<Record<string, string>>({});
	const contextMenu = overlay?.kind === "context" ? overlay : null;
	const profileTarget = overlay?.kind === "profile" ? overlay.profile : null;
	const chatOpen = overlay?.kind === "chat";
	const chatPeer = overlay?.kind === "chat" ? overlay.peer : null;
	chatOpenRef.current = chatOpen;
	const floatingSocial = useFloatingWidgetDrag(`social-${activeAccount?.puuid || "default"}`);

	const applyChatSummary = useCallback((chatData: Awaited<ReturnType<typeof getChatSummary>> | null) => {
		if (!chatData) return;
		const nextUnread = Object.fromEntries(chatData.conversations.filter((item) => item.type === "dm" && item.peerPuuid && item.unreadCount > 0).map((item) => [item.peerPuuid!.toLowerCase(), item.unreadCount]));
		const previousUnread = previousUnreadRef.current;
		if (previousUnread && !chatOpenRef.current) {
			const newest = chatData.conversations
				.filter((item) => item.type === "dm" && item.peerPuuid && item.latestMessage?.direction === "incoming" && item.unreadCount > (previousUnread[item.peerPuuid.toLowerCase()] || 0))
				.sort((a, b) => (b.latestMessage?.timestamp || 0) - (a.latestMessage?.timestamp || 0))[0];
			if (newest?.peerPuuid && newest.latestMessage) {
				const senderName = newest.latestMessage.senderName || newest.displayName || "Riot friend";
				setChatNotice({
					peer: newest.peerPuuid,
					name: senderName,
					body: newest.latestMessage.body,
					timestamp: newest.latestMessage.timestamp,
				});
				playUiSound("message");
				publishAppNotification({
					id: `message:${newest.peerPuuid}:${newest.latestMessage.timestamp}`,
					kind: "message",
					title: `New message from ${senderName}`,
					body: "Open Riot chat to read it.",
					action: "profile",
					accountPuuid: activeAccount?.puuid,
				});
				if (chatNoticeTimerRef.current) window.clearTimeout(chatNoticeTimerRef.current);
				chatNoticeTimerRef.current = window.setTimeout(() => setChatNotice(null), 6000);
			}
		}
		previousUnreadRef.current = nextUnread;
		setChatUnread(chatData.unreadCount);
		setChatUnreadByPeer(nextUnread);
		setPartyConversation(chatData.conversations.find((item) => item.type === "party" && item.source === "local"));
	}, [activeAccount?.puuid]);

	useEffect(() => () => {
		if (chatNoticeTimerRef.current) window.clearTimeout(chatNoticeTimerRef.current);
	}, []);

    const [cardCache, setCardCache] = useState<Record<string, CardMeta>>({});
    const [tierCache, setTierCache] = useState<Record<number, TierMeta>>({});

    // The app already loads card metadata for profiles. Seed this view from
    // that shared cache so a message toast does not wait for (or depend on) a
    // second public API request before it can show the sender's player card.
    useEffect(() => {
        if (!knownPlayerCards.length) return;
        setCardCache((current) => {
            let changed = false;
            const next = { ...current };
            for (const card of knownPlayerCards) {
                const key = card.uuid.toLowerCase();
                if (next[key]?.images.length) continue;
                next[key] = {
                    images: [card.displayIcon, card.smallArt, card.wideArt, card.largeArt]
                        .filter((image): image is string => Boolean(image)),
                };
                changed = true;
            }
            return changed ? next : current;
        });
    }, [knownPlayerCards]);

    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setOverlay(null);
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
			if ((event.target as Element | null)?.closest?.("[data-party-portal]")) return;
            if ((event.target as Element | null)?.closest?.('[data-slot="social-status-trigger"]')) return;
            if (!partyWidgetRef.current?.contains(event.target as Node)) setExpanded(false);
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [expanded]);

    const togglePartyPanel = () => {
		const opening = !expanded;
		setOverlay(null);
		setExpanded(opening);
		if (opening && activeAccount && isBackendOnline) {
			void getSocialStatus().then(setSocial).catch(() => {
				// The existing stream/poll loop remains the fallback when Riot is
				// temporarily unavailable during this one-shot panel refresh.
			});
		}
    };

    const openProfile = (profile: PartyProfileTarget) => {
		setOverlay({ kind: "profile", profile });
    };

    const openContextMenu = (event: React.MouseEvent, profile: PartyProfileTarget) => {
        event.preventDefault();
        event.stopPropagation();
		const inset = 8;
		const menuWidth = 162;
		const menuHeight = 52;
		setOverlay({
			kind: "context",
			x: Math.max(inset, Math.min(event.clientX, window.innerWidth - menuWidth - inset)),
			y: Math.max(inset, Math.min(event.clientY, window.innerHeight - menuHeight - inset)),
			profile,
		});
    };

	const openChat = (peer?: string | null) => {
		setChatNotice(null);
		setOverlay({ kind: "chat", peer: peer || null });
	};

    useEffect(() => {
        if (!activeAccount || !isBackendOnline) {
            latestPartyRef.current = null;
            setParty(null);
            setSocial(null);
            setStale(false);
			setOverlay(null);
            setExpanded(false);
            return;
        }

        let active = true;
        const poll = async () => {
            const data = await getPartyStatus().catch((err) => ({ phase: "error" as const, error: err instanceof Error ? err.message : String(err || "") }));
            if (!active) return;

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
				setOverlay(null);
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
    }, [activeAccount, applyChatSummary, isBackendOnline]);

	useEffect(() => {
		if (!activeAccount || !isBackendOnline) return;
		let active = true;
		const refreshSocial = () => {
			void getSocialStatus().then((data) => { if (active) setSocial(data); }).catch(() => undefined);
		};
		const refreshChat = () => {
			void getChatSummary().then((data) => { if (active) applyChatSummary(data); }).catch(() => undefined);
		};
		refreshSocial();
		refreshChat();
		const socialController = new AbortController();
		const chatController = new AbortController();
		let socialTimer = 0;
		let chatTimer = 0;
		void subscribeSocialEvents(() => {
			clearTimeout(socialTimer);
			socialTimer = window.setTimeout(refreshSocial, 150);
		}, socialController.signal).catch(() => undefined);
		void subscribeChatEvents(() => {
			clearTimeout(chatTimer);
			chatTimer = window.setTimeout(refreshChat, 150);
		}, chatController.signal).catch(() => undefined);
		const safetyRefresh = window.setInterval(() => {
			if (document.hidden) return;
			refreshSocial();
			refreshChat();
		}, 15_000);
		return () => {
			active = false;
			clearTimeout(socialTimer);
			clearTimeout(chatTimer);
			window.clearInterval(safetyRefresh);
			socialController.abort();
			chatController.abort();
		};
	}, [activeAccount, applyChatSummary, isBackendOnline]);

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
                setCardCache((current) => ({ ...m, ...current }));
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

    const rawPresences = useMemo(() => sortedPresences(social), [social]);
	useEffect(() => {
		if (!activeAccount?.puuid) {
			setRememberedCardIds({});
			return;
		}
		try {
			const cached = window.localStorage.getItem(`vantavault:social-cards:v1:${activeAccount.puuid.toLowerCase()}`);
			const parsed: unknown = cached ? JSON.parse(cached) : {};
			setRememberedCardIds(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {});
		} catch {
			setRememberedCardIds({});
		}
	}, [activeAccount?.puuid]);
	useEffect(() => {
		if (!activeAccount?.puuid) return;
		const discovered: Record<string, string> = {};
		for (const presence of rawPresences) {
			if (presence.puuid && presence.cardId) discovered[presence.puuid.toLowerCase()] = presence.cardId;
		}
		for (const member of party?.members || []) {
			if (member.puuid && member.cardId) discovered[member.puuid.toLowerCase()] = member.cardId;
		}
		if (!Object.keys(discovered).length) return;
		setRememberedCardIds((current) => {
			let changed = false;
			const next = { ...current };
			for (const [puuid, cardId] of Object.entries(discovered)) {
				if (next[puuid] === cardId) continue;
				next[puuid] = cardId;
				changed = true;
			}
			if (!changed) return current;
			const entries = Object.entries(next);
			const bounded = Object.fromEntries(entries.slice(Math.max(0, entries.length - 500)));
			try {
				window.localStorage.setItem(`vantavault:social-cards:v1:${activeAccount.puuid.toLowerCase()}`, JSON.stringify(bounded));
			} catch { /* The in-memory cache still works when storage is unavailable. */ }
			return bounded;
		});
	}, [activeAccount?.puuid, party?.members, rawPresences]);
	const presences = useMemo(() => rawPresences.map((presence) => ({
		...presence,
		cardId: presence.cardId || rememberedCardIds[(presence.puuid || "").toLowerCase()],
	})), [rawPresences, rememberedCardIds]);
	const cardForPlayer = useCallback((puuid: string, cardId?: string) => {
		const resolved = cardId || rememberedCardIds[puuid.toLowerCase()];
		return resolved ? cardCache[resolved.toLowerCase()] : undefined;
	}, [cardCache, rememberedCardIds]);
	const chatContacts = useMemo(() => {
		const contacts = new Map<string, SocialPresence & { avatar?: string }>(presences
			.filter((presence) => Boolean(presence.puuid))
			.map((presence) => [presence.puuid!.toLowerCase(), {
				...presence,
				puuid: presence.puuid,
				name: presence.name,
				avatar: presence.cardId ? cardCache[presence.cardId.toLowerCase()]?.images[0] : undefined,
			}]));
		for (const member of party?.members || []) {
			if (!member.puuid || member.isLocal) continue;
			const key = member.puuid.toLowerCase();
			const existing = contacts.get(key);
			const card = cardForPlayer(member.puuid, member.cardId);
			contacts.set(key, {
				...existing,
				puuid: member.puuid,
				name: member.name || existing?.name || "Party member",
				avatar: card?.images[0] || existing?.avatar,
			});
		}
		return [...contacts.values()];
	}, [presences, party?.members, cardCache, cardForPlayer]);
	const chatNoticePresence = chatNotice
		? presences.find((presence) => presence.puuid?.toLowerCase() === chatNotice.peer.toLowerCase())
		: undefined;
	const chatNoticeName = chatNoticePresence?.name?.trim() || chatNotice?.name?.trim() || "Riot friend";
	const chatNoticeCardId = chatNotice
		? chatNoticePresence?.cardId || rememberedCardIds[chatNotice.peer.toLowerCase()]
		: undefined;
	const chatNoticeCard = chatNoticeCardId
		? cardCache[chatNoticeCardId.toLowerCase()]
		: undefined;
    const onlineCount = presences.filter((presence) => ["game", "online", "away", "dnd"].includes(presenceState(presence))).length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    const chatCount = presences.filter((presence) => presenceState(presence) === "chat").length;
    const hasParty = !!party && party.phase !== "none" && party.phase !== "error" && !!party.members?.length;
    const members = party?.members ?? [];
    const local = members.find((m) => m.isLocal) || members[0];
	const floatingSocialPortal = isLocalClientActive && typeof document !== "undefined" ? createPortal(
		<div
			ref={floatingSocial.setElement}
			className="live-party-floating-social"
			style={floatingSocial.style}
			onPointerDown={(event) => floatingSocial.onPointerDown(event)}
			onClickCapture={(event) => {
				if (!floatingSocial.consumeClick()) return;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{hasParty ? (
				<PartyPill
					local={local}
					party={party!}
					friendCount={onlineCount}
					card={cardForPlayer(local.puuid, local.cardId)}
					tier={tierCache[local.competitiveTier]}
					onOpen={togglePartyPanel}
				/>
			) : (
				<FriendsPill social={social} presences={presences} onOpen={togglePartyPanel} />
			)}
		</div>,
		document.body,
	) : null;
	const chatNoticePortal = chatNotice && typeof document !== "undefined" ? createPortal(
		<button type="button" className="live-party-chat-notice" data-slot="chat-notice" data-party-portal aria-live="polite" onClick={() => openChat(chatNotice.peer)}>
			<span className="live-party-chat-notice-icon" data-slot="chat-notice-avatar" aria-hidden="true">
				<SafePartyImage
					key={`${chatNotice.peer}:${chatNoticeCardId || "fallback"}`}
					sources={chatNoticeCard?.images || []}
					className="live-party-chat-notice-avatar"
					fallback={chatNoticeName.slice(0, 1).toUpperCase() || "?"}
					fallbackClassName="live-party-chat-notice-fallback"
					eager
				/>
			</span>
			<span data-slot="chat-notice-content"><strong>{chatNoticeName}</strong><small>{chatNotice.body}</small></span>
			<time dateTime={new Date(chatNotice.timestamp).toISOString()}>{formatSocialTime(chatNotice.timestamp)}</time>
		</button>,
		document.body,
	) : null;

    // Compact pill — small, bottom-left, click to expand into the detailed view.
    if (!expanded) {
        if (!hasParty) {
            return (
				<>
                <FriendsPill
                    social={social}
                    presences={presences}
                    onOpen={togglePartyPanel}
				/>
				{floatingSocialPortal}
				{chatNoticePortal}
				</>
            );
        }
        return (
			<>
            <PartyPill
                local={local}
                party={party!}
                friendCount={onlineCount}
                card={cardForPlayer(local.puuid, local.cardId)}
                tier={tierCache[local.competitiveTier]}
                onOpen={togglePartyPanel}
			/>
			{floatingSocialPortal}
			{chatNoticePortal}
			</>
        );
    }

    return <>
        {hasParty ? (
            <PartyPill
                local={local}
                party={party!}
                friendCount={onlineCount}
                card={cardForPlayer(local.puuid, local.cardId)}
                tier={tierCache[local.competitiveTier]}
                onOpen={togglePartyPanel}
            />
        ) : (
            <FriendsPill social={social} presences={presences} onOpen={togglePartyPanel} />
        )}
		{floatingSocialPortal}
        {typeof document !== "undefined" ? createPortal(
        <aside
            ref={partyWidgetRef}
            className={`live-party-widget${stale ? " is-stale" : ""}`}
            aria-live="polite"
        >
            <div key={refreshKey} className="live-party-refresh" />
            <div className="live-party-header">
                <div>
                    <div className="live-party-kicker">Party & Friends</div>
                    <div className="live-party-title">
                        {hasParty ? <>{phaseLabel(party!.phase, party!.queueId)}{party!.phase === "matchmaking" && <QueueElapsed startedAt={party!.queueStartedAt} prefix=" · " />}</> : socialTitle(social, presences)}
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
							setOverlay(null);
                            setExpanded(false);
                        }}
                        aria-label="Minimize party panel"
                        title="Minimize"
                    >
                        <span aria-hidden="true">–</span>
                    </button>
                </div>
            </div>
            <div className="live-party-widget-scroll">
            <div className="live-party-overview">
                <PresenceStat label={hasParty ? "Party" : "Friends"} value={hasParty ? `${members.length}/5` : String(social?.friendCount || presences.length)} />
                <PresenceStat label="In match" value={String(inGameCount)} accent />
                <PresenceStat label="Online" value={String(onlineCount + chatCount)} />
            </div>
            {hasParty && (
                <>
                    <div className="live-party-section-heading live-party-members-heading">
                        <div className="live-party-section-title">Live party</div>
                        <div className="live-party-section-counts"><span>{members.length}/5 members</span></div>
                    </div>
                    <div className="live-party-members">
                        {members.map((member) => (
                            <PartyMemberRow
                                key={member.puuid}
                                member={member}
                                card={cardForPlayer(member.puuid, member.cardId)}
                                tier={tierCache[member.competitiveTier]}
                                onOpenProfile={() => openProfile(profileFromIdentity(member.puuid, member.name))}
								onOpenChat={() => member.isLocal
									? openProfile(profileFromIdentity(member.puuid, member.name))
									: openChat(member.puuid)}
                                onContextMenu={(event) => openContextMenu(event, profileFromIdentity(member.puuid, member.name))}
                            />
                        ))}
                    </div>
					{partyConversation && <button type="button" className="live-party-open-chat" onClick={() => openChat(partyConversation.key)}>Open Party Chat{partyConversation.unreadCount ? ` (${partyConversation.unreadCount})` : ""}</button>}
                </>
            )}
            {!hasParty && <PartyEmptyState party={party} />}
            <FriendPresenceList
                social={social}
                presences={presences}
                cardCache={cardCache}
                showOfflineByDefault={showOfflineByDefault}
                onOpenProfile={openProfile}
				onOpenChat={(presence) => openChat(presence.puuid)}
				onOpenInbox={() => openChat(null)}
				unreadCount={chatUnread}
				unreadByPeer={chatUnreadByPeer}
                onContextMenu={openContextMenu}
            />
            </div>
            {contextMenu && typeof document !== "undefined" && createPortal(
                <div className="live-party-context-menu" data-party-portal style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" role="menuitem" onClick={() => setOverlay({ kind: "profile", profile: contextMenu.profile })}>Open Profile</button>
                </div>,
                document.body,
            )}
            {profileTarget && typeof document !== "undefined" && createPortal(
				<div className="live-party-profile-backdrop" data-party-portal role="presentation" onMouseDown={() => setOverlay(null)}>
                    <section ref={profileModalRef} className="live-party-profile-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
                        <button type="button" className="live-party-profile-close" onClick={() => setOverlay(null)} aria-label="Close profile">×</button>
                        <div className="live-party-profile-content">
                            <ProfilePanel
                                key={profileTarget.puuid}
                                requestedProfile={profileTarget}
                                onRequestedProfileChange={(profile) => setOverlay(profile ? { kind: "profile", profile } : null)}
                                autoSyncMatches={true}
                            />
                        </div>
                    </section>
                </div>,
                document.body,
            )}
			{typeof document !== "undefined" && createPortal(<ChatModal key={`${activeAccount?.puuid || "no-account"}:${chatPeer || "inbox"}:${chatOpen ? "open" : "closed"}`} open={chatOpen} accountPuuid={activeAccount?.puuid} initialPeer={chatPeer} contacts={chatContacts} onClose={() => setOverlay(null)} onUnreadChange={(count, partyChat) => { setChatUnread(count); setPartyConversation(partyChat); }} />, document.body)}
			{chatNoticePortal}
        </aside>
    , document.body) : null}
    </>;
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
            data-slot="social-status-trigger"
            onClick={onOpen}
            aria-label="Open live party panel"
            title="Open party"
        >
            <span className="live-party-pill-avatar" aria-hidden="true">
                <SafePartyImage key={(card?.images || []).join("|") || local.name} sources={card?.images || []} className="live-party-pill-avatar-img" fallback={local.name.slice(0, 1).toUpperCase()} fallbackClassName="live-party-pill-avatar-letter" eager />
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">{phaseShort(party.phase)}{party.phase === "matchmaking" && <QueueElapsed startedAt={party.queueStartedAt} prefix=" · " />}</span>
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
    const onlineCount = presences.filter((presence) => ["game", "online", "away", "dnd"].includes(presenceState(presence))).length;
    const inGameCount = presences.filter((presence) => presenceState(presence) === "game").length;
    const chatCount = presences.filter((presence) => presenceState(presence) === "chat").length;
    const totalCount = social?.friendCount || presences.length;
    return (
        <button
            type="button"
            className="live-party-pill is-clickable is-friends"
            data-slot="social-status-trigger"
            onClick={onOpen}
            aria-label="Open friend presence panel"
            title={`${onlineCount} online · ${totalCount} friends`}
        >
            <span className="live-party-pill-avatar live-party-pill-avatar--friends" aria-hidden="true">
                <FriendsGlyph />
                <strong className="live-party-friends-count">{onlineCount}</strong>
            </span>
            <span className="live-party-pill-body">
                <span className="live-party-pill-kicker">Social</span>
                <span className="live-party-pill-title">{onlineCount} online</span>
                <span className="live-party-pill-sub">
                    {inGameCount} in match{chatCount > 0 ? ` · ${chatCount} in client` : ""}
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
	onOpenChat,
	onOpenInbox,
	unreadCount,
	unreadByPeer,
    onContextMenu,
}: {
    social: SocialStatusResponse | null;
    presences: SocialPresence[];
    cardCache: Record<string, CardMeta>;
    showOfflineByDefault: boolean;
    onOpenProfile: (profile: PartyProfileTarget) => void;
	onOpenChat: (presence: SocialPresence) => void;
	onOpenInbox: () => void;
	unreadCount: number;
	unreadByPeer: Record<string, number>;
    onContextMenu: (event: React.MouseEvent, profile: PartyProfileTarget) => void;
}) {
    const [showOffline, setShowOffline] = useState(() => showOfflineByDefault || (typeof window !== "undefined" && window.localStorage.getItem("vantavault:friends:offline-open") === "true"));
    const [friendSearch, setFriendSearch] = useState("");
    const [valorantOnly, setValorantOnly] = useState(false);
    const [socialView, setSocialView] = useState<"friends" | "requests" | "activity">("friends");
    const [compactRows, setCompactRows] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("vantavault:friends:compact") === "true");
    useEffect(() => { if (showOfflineByDefault) setShowOffline(true); }, [showOfflineByDefault]);
    useEffect(() => { window.localStorage.setItem("vantavault:friends:offline-open", String(showOffline)); }, [showOffline]);
    useEffect(() => { window.localStorage.setItem("vantavault:friends:compact", String(compactRows)); }, [compactRows]);
    const activePresences = presences.filter((presence) => presenceState(presence) !== "offline");
    const offlinePresences = presences.filter((presence) => presenceState(presence) === "offline");
    const matchesFilters = (presence: SocialPresence) => {
        if (valorantOnly && !["game", "online", "away", "dnd"].includes(presenceState(presence))) return false;
        return (presence.name || "").toLowerCase().includes(friendSearch.trim().toLowerCase());
    };
    const visibleActivePresences = activePresences.filter(matchesFilters);
    const visibleOfflinePresences = offlinePresences.filter(matchesFilters);
    const valorantCount = activePresences.filter((presence) => presenceState(presence) !== "chat").length;
    const chatCount = activePresences.length - valorantCount;
    const requests = social?.requests || [];
    const activity = social?.activity || [];

    return (
        <div className="live-party-friends">
            <div className="live-party-section-heading">
				<div className="live-party-social-tabs" role="tablist" aria-label="Social view">
					<button type="button" role="tab" aria-selected={socialView === "friends"} className={socialView === "friends" ? "active" : ""} onClick={() => setSocialView("friends")}>Friends</button>
					<button type="button" role="tab" aria-selected={socialView === "requests"} className={socialView === "requests" ? "active" : ""} onClick={() => setSocialView("requests")}>Requests{requests.length > 0 && <span>{requests.length}</span>}</button>
					<button type="button" role="tab" aria-selected={socialView === "activity"} className={socialView === "activity" ? "active" : ""} onClick={() => setSocialView("activity")}>Activity</button>
				</div>
				<button type="button" className="live-party-inbox" onClick={onOpenInbox} aria-label="Open Riot chat inbox" title="Messages">✉{unreadCount > 0 && <span>{unreadCount}</span>}</button>
				<div className="live-party-section-counts">
                    <span>{valorantCount} VALORANT</span>
                    <span>{chatCount} Riot Client</span>
                </div>
            </div>
            {socialView === "friends" && <>
            <div className="live-party-friend-tools">
                <input value={friendSearch} onChange={(event) => setFriendSearch(event.target.value)} placeholder="Search friends" aria-label="Search friends" />
                <button type="button" className={valorantOnly ? "active" : ""} onClick={() => setValorantOnly((current) => !current)}>VALORANT</button>
                <button type="button" className={compactRows ? "active" : ""} onClick={() => setCompactRows((current) => !current)} aria-label="Toggle compact friend rows">Compact</button>
            </div>
            <div className={`live-party-friend-scroll${compactRows ? " is-compact" : ""}`}>
                <div className="live-party-friend-list">
                    {visibleActivePresences.map((presence) => (
                        <FriendPresenceRow
                            key={presence.puuid}
                            presence={presence}
                            cardCache={cardCache}
                            onOpenProfile={() => onOpenProfile(profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
							onOpenChat={() => onOpenChat(presence)}
							unreadCount={unreadByPeer[(presence.puuid || "").toLowerCase()] || 0}
                            onContextMenu={onContextMenu}
                        />
                    ))}
                    {visibleActivePresences.length === 0 && (
                        <div className="live-party-friend-empty">{presences.length ? "No friends match these filters." : socialEmptyLabel(social)}</div>
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
                                {visibleOfflinePresences.map((presence) => (
                                    <FriendPresenceRow
                                        key={presence.puuid}
                                        presence={presence}
                                        cardCache={cardCache}
                                        onOpenProfile={() => onOpenProfile(profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
								onOpenChat={() => onOpenChat(presence)}
									unreadCount={unreadByPeer[(presence.puuid || "").toLowerCase()] || 0}
                                        onContextMenu={onContextMenu}
                                    />
                                ))}
                                {visibleOfflinePresences.length === 0 && <div className="live-party-friend-empty">No offline friends match.</div>}
                            </div>
                        )}
                    </div>
                )}
            </div>
            </>}
			{socialView === "requests" && <SocialRequests requests={requests} events={activity} />}
			{socialView === "activity" && <SocialActivity events={activity} />}
        </div>
    );
}

function SocialRequests({ requests, events }: { requests: NonNullable<SocialStatusResponse["requests"]>; events: NonNullable<SocialStatusResponse["activity"]> }) {
	const reconnect = Array.from(new Map(events.filter((event) => event.type === "friendship_ended").map((event) => [event.peerPuuid, event])).values());
	const [requestStates, setRequestStates] = useState<Record<string, { state: "working" | "pending" | "error"; message?: string }>>({});
	const [resolvedRequests, setResolvedRequests] = useState<Set<string>>(() => new Set());
	const restoreTimers = useRef<Record<string, number>>({});
	const [riotID, setRiotID] = useState("");
	const [sendState, setSendState] = useState<{ state: "idle" | "working" | "done" | "error"; message?: string }>({ state: "idle" });
	const visibleRequests = requests.filter((request) => !resolvedRequests.has(request.puuid));
	const incoming = visibleRequests.filter((request) => request.direction === "incoming");
	const outgoing = visibleRequests.filter((request) => request.direction === "outgoing");
	useEffect(() => {
		const visible = new Set(requests.map((request) => request.puuid));
		setRequestStates((current) => Object.fromEntries(Object.entries(current).filter(([peer]) => visible.has(peer))));
		setResolvedRequests((current) => {
			const next = new Set(Array.from(current).filter((peer) => visible.has(peer)));
			return next.size === current.size ? current : next;
		});
	}, [requests]);
	useEffect(() => () => Object.values(restoreTimers.current).forEach((timer) => window.clearTimeout(timer)), []);
	const send = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const separator = riotID.lastIndexOf("#");
		const gameName = riotID.slice(0, separator).trim();
		const gameTag = riotID.slice(separator + 1).trim();
		if (separator <= 0 || !gameName || !gameTag) {
			setSendState({ state: "error", message: "Enter a Riot ID as Name#Tag." });
			return;
		}
		setSendState({ state: "working" });
		try {
			const result = await sendSocialFriendRequest(gameName, gameTag);
			setSendState({ state: "done", message: result.confirmed ? "Request sent to Riot." : "Request submitted to Riot." });
			setRiotID("");
		} catch (error) {
			setSendState({ state: "error", message: error instanceof Error ? error.message : "Request failed" });
		}
	};
	const act = async (puuid: string, action: "accept" | "deny" | "cancel" | "send") => {
		setRequestStates((current) => ({ ...current, [puuid]: { state: "working" } }));
		try {
			const result = await actOnSocialRequest(puuid, action);
			setRequestStates((current) => ({ ...current, [puuid]: result.confirmed
				? { state: "pending", message: "Confirmed by Riot" }
				: { state: "pending", message: "Waiting for Riot to return the request details" } }));
			if (result.confirmed && action !== "send") {
				setResolvedRequests((current) => new Set(current).add(puuid));
				window.clearTimeout(restoreTimers.current[puuid]);
				restoreTimers.current[puuid] = window.setTimeout(() => {
					setResolvedRequests((current) => {
						const next = new Set(current);
						next.delete(puuid);
						return next;
					});
				}, 6_000);
			} else if (!result.confirmed) {
				window.clearTimeout(restoreTimers.current[puuid]);
				restoreTimers.current[puuid] = window.setTimeout(() => {
					setRequestStates((current) => {
						const next = { ...current };
						delete next[puuid];
						return next;
					});
				}, 4_000);
			}
		} catch (error) {
			setRequestStates((current) => ({ ...current, [puuid]: { state: "error", message: error instanceof Error ? error.message : "Request action failed" } }));
		}
	};
	return <div className="live-party-social-scroll">
		<form className="live-party-friend-request-form" onSubmit={send}>
			<label htmlFor="live-party-riot-id">Send friend request</label>
			<div><input id="live-party-riot-id" value={riotID} onChange={(event) => setRiotID(event.target.value)} placeholder="Name#Tag" autoComplete="off" spellCheck={false} /><button type="submit" disabled={sendState.state === "working"}>{sendState.state === "working" ? "Sending…" : "Send"}</button></div>
			{sendState.message ? <small aria-live="polite" className={sendState.state === "error" ? "is-error" : ""}>{sendState.message}</small> : <small>Use the player&apos;s full Riot ID.</small>}
		</form>
		{!visibleRequests.length && !reconnect.length && <div className="live-party-social-empty"><strong>No pending requests</strong><span>Incoming and sent requests will appear here.</span></div>}
		{incoming.length > 0 && <SocialRequestGroup title="Incoming" requests={incoming} states={requestStates} onAction={act} />}
		{outgoing.length > 0 && <SocialRequestGroup title="Sent" requests={outgoing} states={requestStates} onAction={act} />}
		{reconnect.length > 0 && <section className="live-party-request-group">
			<header><strong>Reconnect</strong><span>{reconnect.length}</span></header>
			{reconnect.map((event) => { const actionState = requestStates[event.peerPuuid]; return <div className="live-party-request-row" key={event.peerPuuid}>
				<i aria-hidden="true">{(event.name || "?").slice(0, 1).toUpperCase()}</i>
				<span><strong>{event.name || "Unknown Riot account"}</strong><small>{actionState?.message || "Previously observed in your Riot friends list"}</small></span>
				<div className="live-party-request-actions"><button type="button" disabled={actionState?.state === "working" || actionState?.state === "pending"} onClick={() => act(event.peerPuuid, "send")}>{actionState?.state === "working" ? "Sending…" : "Send request"}</button></div>
			</div>})}
		</section>}
	</div>;
}

function SocialRequestGroup({ title, requests, states, onAction }: {
	title: string;
	requests: NonNullable<SocialStatusResponse["requests"]>;
	states: Record<string, { state: "working" | "pending" | "error"; message?: string }>;
	onAction: (puuid: string, action: "accept" | "deny" | "cancel") => void;
}) {
	return <section className="live-party-request-group">
		<header><strong>{title}</strong><span>{requests.length}</span></header>
		{requests.map((request) => {
			const actionState = states[request.puuid];
			return <div className="live-party-request-row" key={`${request.direction}:${request.puuid}`}>
			<i aria-hidden="true">{(request.name || "?").slice(0, 1).toUpperCase()}</i>
			<span><strong>{request.name || "Unknown Riot account"}</strong><small>{actionState?.message || (request.firstSeenAt ? `Observed ${formatSocialTime(request.firstSeenAt)}` : "Observed now")}</small></span>
			<div className="live-party-request-actions">
				{request.direction === "incoming" ? <>
					<button type="button" disabled={actionState?.state === "working" || actionState?.state === "pending"} onClick={() => onAction(request.puuid, "accept")}>Accept</button>
					<button type="button" className="is-quiet" disabled={actionState?.state === "working" || actionState?.state === "pending"} onClick={() => onAction(request.puuid, "deny")}>Deny</button>
				</> : <button type="button" className="is-quiet" disabled={actionState?.state === "working" || actionState?.state === "pending"} onClick={() => onAction(request.puuid, "cancel")}>Cancel</button>}
			</div>
		</div>})}
	</section>;
}

function SocialActivity({ events }: { events: NonNullable<SocialStatusResponse["activity"]> }) {
	const usefulEvents = events.filter((event) => event.type !== "friend_first_observed");
	if (!usefulEvents.length) return <div className="live-party-social-empty"><strong>No friend activity yet</strong><span>Sent, received, accepted, cancelled, and removed friend activity will appear here.</span></div>;
	return <div className="live-party-social-scroll live-party-activity-list">
		{usefulEvents.map((event) => <div className={`live-party-activity-row is-${event.type}`} key={event.id}>
			<i aria-hidden="true" />
			<span><strong>{event.name || "Unknown Riot account"}</strong><small>{socialEventLabel(event.type)}</small></span>
			<time dateTime={new Date(event.occurredAt).toISOString()}>{formatSocialTime(event.occurredAt)}</time>
		</div>)}
	</div>;
}

function socialEventLabel(type: NonNullable<SocialStatusResponse["activity"]>[number]["type"]) {
	switch (type) {
		case "friend_first_observed": return "First observed in your friends list";
		case "friend_readded": return "Friends again";
		case "friendship_ended": return "No longer in your friends list · who removed whom is unknown";
		case "request_received": return "Friend request received";
		case "request_sent": return "Friend request sent";
		case "request_cancelled": return "Friend request cancelled";
		case "request_accepted_by_you": return "You accepted their friend request";
		case "request_accepted_by_them": return "Accepted your friend request";
		case "request_closed_unknown": return "Request closed · outcome unknown";
	}
}

function formatSocialTime(timestamp: number) {
	const date = new Date(timestamp);
	const today = new Date();
	if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return date.toLocaleDateString([], { day: "2-digit", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function FriendPresenceRow({
    presence,
    cardCache,
    onOpenProfile,
	onOpenChat,
	unreadCount,
    onContextMenu,
}: {
    presence: SocialPresence;
    cardCache: Record<string, CardMeta>;
    onOpenProfile: () => void;
	onOpenChat: () => void;
	unreadCount: number;
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
			onClick={onOpenChat}
			onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenChat(); }}
            onContextMenu={(event) => onContextMenu(event, profileFromIdentity(presence.puuid || "", presence.name || "Player"))}
        >
            <span className="live-party-friend-avatar" aria-hidden="true">
                <SafePartyImage key={avatarSources.join("|") || presence.name} sources={avatarSources} fallback={(presence.name || "?").slice(0, 1).toUpperCase()} eager={state !== "offline"} />
                <i className="live-party-friend-dot" />
            </span>
            <span className="live-party-friend-main">
                <span className="live-party-friend-name">{presence.name || "Unknown friend"}</span>
				<span className="live-party-friend-sub">{presenceActivity(presence).detail || presenceActivity(presence).label}</span>
            </span>
			<span className="live-party-friend-state">
				{presenceActivity(presence).label}
			</span>
			{unreadCount > 0 && <span className="live-party-friend-unread" aria-label={`${unreadCount} unread messages`}>{unreadCount}</span>}
			<button type="button" className="live-party-profile-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenProfile(); }} aria-label={`Open ${presence.name || "friend"} profile`} title="Profile">i</button>
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
    const valorantCount = presences.filter((presence) => ["game", "online", "away", "dnd"].includes(presenceState(presence))).length;
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
	const unique = new Map<string, SocialPresence>();
	for (const presence of social?.presences || []) {
		const puuid = presence.puuid?.trim().toLowerCase();
		if (!puuid || unique.has(puuid)) continue;
		unique.set(puuid, { ...presence, puuid });
	}
	return [...unique.values()].sort((a, b) =>
		(a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }) || (a.puuid || "").localeCompare(b.puuid || ""),
	);
}

function PartyMemberRow({
    member,
    card,
    tier,
    onOpenProfile,
	onOpenChat,
    onContextMenu,
}: {
    member: PartyMember;
    card?: CardMeta;
    tier?: TierMeta;
    onOpenProfile: () => void;
	onOpenChat: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const avatarSources = card?.images || [];
    return (
        <div
            className={`live-party-member${member.isLocal ? " is-local" : ""}`}
            role="button"
            tabIndex={0}
			aria-label={member.isLocal ? `Open ${member.name} profile` : `Message ${member.name}`}
            onClick={onOpenChat}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenChat(); }}
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
                <div className={`live-party-ready-state${member.isReady ? " is-ready" : ""}`}>
                    <i aria-hidden="true" />{member.isReady ? "Ready" : "Not ready"}
                </div>
            </div>

            <div className="live-party-rank" aria-hidden="true">
                <SafePartyImage key={tier?.icon || tier?.name || "rank"} sources={tier?.icon ? [tier.icon] : []} className="live-party-rank-img" fallback={tier?.name ? tier.name.slice(0, 1) : "?"} fallbackClassName="live-party-rank-letter" eager />
            </div>
			<button type="button" className="live-party-profile-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenProfile(); }} aria-label={`Open ${member.name || "party member"} profile`} title="Profile">i</button>
        </div>
    );
}
