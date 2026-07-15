"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArchiveDiagnostic, ChatConversation, ChatMessage, SocialPresence, clearChatHistory, getChatConversations, getChatMessages, getChatSummary, markChatRead, requestChatSnapshot, sendChatMessage, subscribeChatEvents, subscribeSocialEvents } from "@/services/api";
import { presenceActivity, presenceState } from "./presence";

type ChatContact = SocialPresence & { avatar?: string };
type Props = { open: boolean; accountPuuid?: string; initialPeer?: string | null; contacts?: ChatContact[]; onClose: () => void; onUnreadChange?: (count: number, party?: ChatConversation) => void };

function conversationIdentity(conversation: ChatConversation) {
	return conversation.type === "dm"
		? `dm:${conversation.peerPuuid?.toLowerCase() || conversation.displayName.toLowerCase()}`
		: conversation.key;
}

const messageDateFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const messageSentFormatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function calendarDay(timestamp: number) {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function messageDateLabel(timestamp: number) {
	return messageDateFormatter.format(new Date(timestamp));
}

export default function ChatModal({ open, accountPuuid, initialPeer, contacts = [], onClose, onUnreadChange }: Props) {
    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [selectedKey, setSelectedKey] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [archiveDiagnostic, setArchiveDiagnostic] = useState<ChatArchiveDiagnostic | undefined>();
	const [snapshotState, setSnapshotState] = useState("");
    const [search, setSearch] = useState("");
    const [draft, setDraft] = useState("");
    const [error, setError] = useState("");
	const [sendError, setSendError] = useState("");
    const [loading, setLoading] = useState(false);
	const [loadingMessagesFor, setLoadingMessagesFor] = useState("");
    const [showList, setShowList] = useState(true);
    const [newBelow, setNewBelow] = useState(false);
    const messagePane = useRef<HTMLDivElement>(null);
    const nearBottom = useRef(true);
	const messageRequest = useRef(0);
	const selectedKeyRef = useRef("");
	const messageCache = useRef(new Map<string, ChatMessage[]>());
	const unreadCallback = useRef(onUnreadChange);
	const contactsRef = useRef(contacts);
	useEffect(() => { unreadCallback.current = onUnreadChange; }, [onUnreadChange]);
	useEffect(() => { contactsRef.current = contacts; }, [contacts]);
	useEffect(() => { selectedKeyRef.current = selectedKey; }, [selectedKey]);
	useEffect(() => {
		if (!open) return;
		messageRequest.current += 1;
		messageCache.current.clear();
		setSelectedKey("");
		setMessages([]);
		setArchiveDiagnostic(undefined);
		setSnapshotState("");
		setSearch("");
		setDraft("");
		setSendError("");
		setShowList(true);
	}, [open, accountPuuid, initialPeer]);
    const contactNames = useMemo(() => new Map(contacts.filter((item) => item.puuid && item.name).map((item) => [item.puuid!.toLowerCase(), item.name!])), [contacts]);
    const contactAvatars = useMemo(() => new Map(contacts.filter((item) => item.puuid && item.avatar).map((item) => [item.puuid!.toLowerCase(), item.avatar!])), [contacts]);
    const contactPresences = useMemo(() => new Map(contacts.filter((item) => item.puuid).map((item) => [item.puuid!.toLowerCase(), item])), [contacts]);
    const displayName = useCallback((conversation?: ChatConversation) => conversation ? contactNames.get((conversation.peerPuuid || "").toLowerCase()) || conversation.displayName : "", [contactNames]);
    const avatar = useCallback((conversation?: ChatConversation) => contactAvatars.get((conversation?.peerPuuid || "").toLowerCase()) || "", [contactAvatars]);
    const selected = conversations.find((item) => item.key === selectedKey);

    const refreshConversations = useCallback(async (full = false) => {
        const data = full ? await getChatConversations() : await getChatSummary();
		let next = [...(data.conversations || [])];
		const transport = next.find((item) => item.type === "dm" && item.state === "live");
		for (const contact of contactsRef.current) {
			const peerPuuid = contact.puuid?.trim().toLowerCase();
			if (!peerPuuid) continue;
			const existing = next.find((item) => item.type === "dm" && (item.peerPuuid?.toLowerCase() === peerPuuid || item.displayName.toLowerCase() === contact.name?.toLowerCase()));
			if (existing) {
				existing.peerPuuid = peerPuuid;
				if (contact.name) existing.displayName = contact.name;
				continue;
			}
			next.push({ key: `dm:${peerPuuid}`, type: "dm", displayName: contact.name || "Unknown friend", peerPuuid, source: transport?.source || "archive", state: transport?.state || "archive", unreadCount: 0, capabilities: { history: false, directMessages: Boolean(transport?.capabilities.directMessages), party: false } });
		}
		const unique = new Map<string, ChatConversation>();
		for (const conversation of next) {
			const identity = conversationIdentity(conversation);
			const previous = unique.get(identity);
			if (!previous) { unique.set(identity, conversation); continue; }
			const preferred = conversation.state === "live" && previous.state !== "live" ? conversation : previous;
			const other = preferred === conversation ? previous : conversation;
			unique.set(identity, { ...other, ...preferred, latestMessage: preferred.latestMessage || other.latestMessage, unreadCount: Math.max(preferred.unreadCount, other.unreadCount), capabilities: { history: preferred.capabilities.history || other.capabilities.history, directMessages: preferred.capabilities.directMessages || other.capabilities.directMessages, party: preferred.capabilities.party || other.capabilities.party } });
		}
		next = [...unique.values()];
		setConversations((current) => {
			if (full) return next;
			// The summary endpoint intentionally reads SQLite only, so its archived
			// rows do not carry live transport capabilities. It may update unread
			// counts and latest messages, but it must not downgrade a connection
			// established by the full remote roster response.
			const activeTransport = new Map(current
				.filter((conversation) => conversation.source !== "archive" || conversation.state !== "archive")
				.map((conversation) => [conversationIdentity(conversation), conversation]));
			return next.map((conversation) => {
				const active = activeTransport.get(conversationIdentity(conversation));
				if (!active) return conversation;
				return {
					...conversation,
					source: active.source,
					state: active.state,
					capabilities: active.capabilities,
					latestMessage: conversation.latestMessage || active.latestMessage,
				};
			});
		});
		unreadCallback.current?.(next.reduce((sum, item) => sum + item.unreadCount, 0), next.find((item) => item.type === "party" && item.source === "local"));
        setSelectedKey((current) => {
			const requested = initialPeer ? next.find((item) => item.key === initialPeer || item.peerPuuid?.toLowerCase() === initialPeer.toLowerCase())?.key : "";
			const firstActive = next.find((item) => {
				const contact = item.peerPuuid ? contactsRef.current.find((candidate) => candidate.puuid?.toLowerCase() === item.peerPuuid?.toLowerCase()) : undefined;
				return contact && presenceState(contact) !== "offline";
			});
			const firstSaved = next.find((item) => item.latestMessage || item.unreadCount);
            return next.some((item) => item.key === current) ? current : requested || firstActive?.key || firstSaved?.key || next[0]?.key || "";
        });
	}, [initialPeer]);

    const refreshMessages = useCallback(async (key: string, foreground = false) => {
        if (!key) return;
		const request = ++messageRequest.current;
		if (foreground) setLoadingMessagesFor(key);
		try {
			const response = await getChatMessages(key);
			if (request !== messageRequest.current) return;
			const next = response.messages;
			setArchiveDiagnostic(response.archiveDiagnostic);
			setSnapshotState(response.snapshotState || "");
			setMessages((current) => {
				if (!nearBottom.current && next.length > current.length) setNewBelow(true);
				const returned = new Set(next.flatMap((item) => [item.id, item.clientId].filter((id): id is string => Boolean(id))));
				const recentOutgoing = current.filter((item) => item.conversationKey === key && item.direction === "outgoing" && item.timestamp > Date.now() - 300_000 && !returned.has(item.id) && (!item.clientId || !returned.has(item.clientId)));
				const merged = [...next, ...recentOutgoing].sort((a, b) => a.timestamp - b.timestamp);
				messageCache.current.set(key, merged);
				return merged;
			});
			void markChatRead(key).catch(() => undefined);
		} finally {
			if (foreground) setLoadingMessagesFor((current) => current === key ? "" : current);
		}
    }, []);

    useEffect(() => {
        if (!open) return;
        setLoading(true); setError("");
        void refreshConversations(false)
			.catch((err) => setError(err instanceof Error ? err.message : "Chat is unavailable."))
			.finally(() => {
				setLoading(false);
				void refreshConversations(true).catch(() => undefined);
			});
		const controller = new AbortController();
		let eventTimer = 0;
		let socialEventTimer = 0;
        void subscribeChatEvents(() => {
			clearTimeout(eventTimer);
			eventTimer = window.setTimeout(() => {
				void refreshConversations(false).catch(() => undefined);
				const activeKey = selectedKeyRef.current;
				if (activeKey) void refreshMessages(activeKey).catch(() => undefined);
			}, 150);
        }, controller.signal).catch(() => undefined);
		// Remote conversation capabilities come from the XMPP roster/session,
		// not from archived chat rows. A remote account can finish connecting
		// after this modal opens, so refresh the live roster whenever the social
		// stream becomes ready or reports a change. Without this, the archived
		// `directMessages: false` value remains stuck until the modal is reopened.
		void subscribeSocialEvents(() => {
			clearTimeout(socialEventTimer);
			socialEventTimer = window.setTimeout(() => {
				void refreshConversations(true).catch(() => undefined);
			}, 150);
		}, controller.signal).catch(() => undefined);
		return () => { clearTimeout(eventTimer); clearTimeout(socialEventTimer); controller.abort(); };
    }, [open, refreshConversations, refreshMessages]);

    useEffect(() => {
        if (!open || !selectedKey) return;
		setMessages(messageCache.current.get(selectedKey) || []);
		setArchiveDiagnostic(undefined);
		setSnapshotState("");
		setNewBelow(false);
        void refreshMessages(selectedKey, true)
			.then(async () => {
				const snapshot = await requestChatSnapshot(selectedKey);
				setSnapshotState(snapshot.snapshotState || "");
			})
			.catch((err) => setError(err instanceof Error ? err.message : "Chat is unavailable."));
    }, [open, selectedKey, refreshMessages]);
    useEffect(() => { if (nearBottom.current) requestAnimationFrame(() => messagePane.current?.scrollTo({ top: messagePane.current.scrollHeight })); }, [messages]);

    const filtered = useMemo(() => {
        const query = search.trim().toLowerCase();
        const visible = conversations.filter((conversation) => {
            if (query && !displayName(conversation).toLowerCase().includes(query)) return false;
            if (conversation.key === selectedKey) return true;
            if (conversation.type === "party") return Boolean(conversation.latestMessage || conversation.unreadCount);
            const contact = conversation.peerPuuid ? contactPresences.get(conversation.peerPuuid.toLowerCase()) : undefined;
            if (contact && presenceState(contact) !== "offline") return true;
            return Boolean(conversation.latestMessage || conversation.unreadCount);
        });
        const rank = (conversation: ChatConversation) => {
            const contact = conversation.peerPuuid ? contactPresences.get(conversation.peerPuuid.toLowerCase()) : undefined;
            const state = contact ? presenceState(contact) : "offline";
            return state === "game" ? 0 : state === "online" ? 1 : state === "chat" ? 2 : 3;
        };
        return visible.sort((a, b) => {
            const stateOrder = rank(a) - rank(b);
            if (stateOrder) return stateOrder;
            if (rank(a) === 3) {
                const recentOrder = (b.latestMessage?.timestamp || 0) - (a.latestMessage?.timestamp || 0);
                if (recentOrder) return recentOrder;
            }
            return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });
        });
    }, [contactPresences, conversations, displayName, search, selectedKey]);
    if (!open) return null;

    const send = async (retry?: ChatMessage) => {
        const body = (retry?.body || draft).trim(); if (!selected || !body) return;
        const clientId = retry?.clientId || `vv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const pending: ChatMessage = { id: clientId, clientId, conversationKey: selected.key, body, direction: "outgoing", status: "pending", timestamp: Date.now() };
        setMessages((current) => [...current.filter((item) => item.clientId !== clientId), pending]); if (!retry) setDraft("");
		setSendError("");
		try { const sent = await sendChatMessage(selected.key, body, clientId); setMessages((current) => current.map((item) => item.clientId === clientId ? sent : item)); if (sent.error) setSendError(sent.error); }
		catch (failure) {
			const failed = failure as Error & { messageRecord?: ChatMessage };
			setSendError(failed.message || "Message failed to send.");
			setMessages((current) => current.map((item) => item.clientId === clientId ? { ...item, ...failed.messageRecord, status: "failed" } : item));
		}
    };

    const canSend = !!selected && selected.state === "live" && (selected.type === "party" ? selected.capabilities.party : selected.capabilities.directMessages);
    const availability = selected?.source === "local" ? "Riot Client · history and live messages" : selected?.source === "remote" ? "Remote · live DMs" : "Archived history";
	const selectedPresence = selected?.peerPuuid ? contactPresences.get(selected.peerPuuid.toLowerCase()) : undefined;
	const selectedActivity = selectedPresence ? presenceActivity(selectedPresence) : undefined;

	const archiveStatus = !archiveDiagnostic ? "" : archiveDiagnostic.responseType === "pending" ? "History request pending" : archiveDiagnostic.responseType === "deferred" ? "Another history lookup is in progress" : archiveDiagnostic.responseType === "paused" ? "History lookup paused for this session" : archiveDiagnostic.responseType === "request_failed" ? "History lookup unavailable; keeping saved messages" : archiveDiagnostic.responseType === "result" ? `History IQ result · ${archiveDiagnostic.messageCount} message elements` : `History IQ ${archiveDiagnostic.responseType}${archiveDiagnostic.errorCode ? ` ${archiveDiagnostic.errorCode}` : ""}${archiveDiagnostic.errorText ? ` · ${archiveDiagnostic.errorText}` : ""}`;
	const snapshotStatus = snapshotState === "pending" ? "Saving this conversation…" : snapshotState === "requested" ? "History request sent. This chat remains usable while Riot responds." : snapshotState === "failed" ? "Riot history was unavailable; saved messages are still here." : "";
	const retrySnapshot = async () => {
		if (!selected) return;
		setError("");
		try { const snapshot = await requestChatSnapshot(selected.key, true); setSnapshotState(snapshot.snapshotState || ""); }
		catch (err) { setError(err instanceof Error ? err.message : "Chat is unavailable."); }
	};

    return <div className="live-party-chat-backdrop" data-party-portal onMouseDown={onClose}>
        <section className="live-party-chat-modal" role="dialog" aria-modal="true" aria-label="Riot chat" onMouseDown={(event) => event.stopPropagation()}>
            <aside className={`live-party-chat-list${!showList ? " is-mobile-hidden" : ""}`}>
                <header><div><small>RIOT CHAT</small><strong>Messages</strong><span>{filtered.length} conversations</span></div><button onClick={onClose} aria-label="Close chat">×</button></header>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
                <div className="live-party-chat-conversations">
                    {filtered.map((conversation) => { const contact = conversation.peerPuuid ? contactPresences.get(conversation.peerPuuid.toLowerCase()) : undefined; const activity = contact ? presenceActivity(contact) : undefined; return <button key={conversation.key} className={conversation.key === selectedKey ? "is-active" : ""} onClick={() => { setSelectedKey(conversation.key); setShowList(false); }}>
                        <span className={`live-party-chat-avatar${contact ? ` is-${presenceState(contact)}` : ""}`}>{conversation.type === "party" ? "P" : (displayName(conversation) || "?")[0]}{avatar(conversation) && <img src={avatar(conversation)} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />}{contact && <i />}</span>
                        <span><strong>{displayName(conversation)}</strong><small>{conversation.latestMessage?.body || (conversation.type === "party" ? "Party chat" : activity ? [activity.label, activity.detail].filter(Boolean).join(" · ") : "Start a conversation")}</small></span>
                        {conversation.unreadCount > 0 && <em>{conversation.unreadCount}</em>}
                    </button>; })}
					{loading && <p>Loading conversations…</p>}
                    {!loading && !filtered.length && <p>No conversations yet.</p>}
                </div>
                <button className="live-party-chat-clear-all" onClick={async () => { if (confirm("Clear all archived chat history?")) { await clearChatHistory(); messageCache.current.clear(); await refreshConversations(); } }}>Clear all history</button>
            </aside>
            <main className={`live-party-chat-view${showList ? " is-mobile-hidden" : ""}`}>
                <header><button className="live-party-chat-back" onClick={() => setShowList(true)} aria-label="Back to conversations">‹</button>{selected && <span className={`live-party-chat-header-avatar${selectedPresence ? ` is-${presenceState(selectedPresence)}` : ""}`} aria-hidden="true">{(displayName(selected) || "?")[0]}{avatar(selected) && <img src={avatar(selected)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}{selectedPresence && <i />}</span>}<div><strong>{displayName(selected) || "Select a conversation"}</strong><small>{selectedActivity ? <><b>{selectedActivity.label}</b>{selectedActivity.detail ? ` · ${selectedActivity.detail}` : ""}</> : selected ? availability : "Your Riot conversations"}</small></div>{selected && <button onClick={async () => { if (confirm(`Clear history with ${displayName(selected)}?`)) { await clearChatHistory(selected.key); messageCache.current.delete(selected.key); setMessages([]); await refreshConversations(); } }} title="Clear conversation">Clear</button>}</header>
				{error && <div className="live-party-chat-error">{error}</div>}
				{sendError && <div className="live-party-chat-error">Send failed: {sendError}</div>}
				{selected?.source === "remote" && archiveStatus && loadingMessagesFor !== selected.key && <div className="live-party-chat-archive-status">{archiveStatus}</div>}
				{snapshotStatus && loadingMessagesFor !== selected?.key && <div className="live-party-chat-archive-status">{snapshotStatus}{snapshotState === "failed" && <button type="button" onClick={() => void retrySnapshot()}>Try once</button>}</div>}
                <div className="live-party-chat-messages" ref={messagePane} onScroll={(event) => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80; if (nearBottom.current) setNewBelow(false); }}>
					{messages.map((message, index) => {
						const showDate = index === 0 || calendarDay(messages[index - 1].timestamp) !== calendarDay(message.timestamp);
						const sentAt = new Date(message.timestamp);
						return <Fragment key={`${message.id}-${message.timestamp}`}>
							{showDate && <div className="live-party-chat-date"><span>{messageDateLabel(message.timestamp)}</span></div>}
							<div className={`live-party-chat-message is-${message.direction}`}><div>{message.body}</div><small><time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString()}>{messageSentFormatter.format(sentAt)}</time>{message.direction === "outgoing" ? ` · ${message.status}` : ""}</small>{message.status === "failed" && <button onClick={() => void send(message)}>Retry</button>}</div>
						</Fragment>;
					})}
					{!messages.length && selected && (loadingMessagesFor === selected.key ? <div className="live-party-chat-empty"><span className="live-party-chat-loading" aria-hidden="true" /><strong>Checking saved messages…</strong><p>This only loads the conversation you opened.</p></div> : <div className="live-party-chat-empty"><span aria-hidden="true">{(displayName(selected) || "?")[0]}{avatar(selected) && <img src={avatar(selected)} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span><strong>No messages saved yet</strong><p>{snapshotState === "pending" || snapshotState === "requested" ? "Riot has not returned any history. You can keep using the rest of VantaVault." : "New messages appear here while VantaVault is connected."}</p></div>)}
                </div>
                {newBelow && <button className="live-party-chat-new" onClick={() => { nearBottom.current = true; setNewBelow(false); messagePane.current?.scrollTo({ top: messagePane.current.scrollHeight, behavior: "smooth" }); }}>New messages</button>}
                <div className="live-party-chat-compose">{!canSend && selected && <small>{selected.type === "party" ? "Open Riot Client to use Party chat." : selected.state === "connecting" ? "Chat is connecting…" : "Archived history is available while chat is offline."}</small>}<textarea value={draft} disabled={!canSend} placeholder={canSend ? "Message…" : "Sending unavailable"} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /><button disabled={!canSend || !draft.trim()} onClick={() => void send()} aria-label="Send message">Send</button></div>
            </main>
        </section>
    </div>;
}
