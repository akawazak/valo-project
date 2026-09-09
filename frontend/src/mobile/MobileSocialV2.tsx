"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import {
  actOnSocialRequest,
  getChatConversations,
  getChatMessages,
  getChatSummary,
  getLiveMatch,
  getPartyStatus,
  getSocialStatus,
  markChatRead,
  requestChatSnapshot,
  sendChatMessage,
  sendSocialFriendRequest,
  subscribeChatEvents,
  subscribeSocialEvents,
  type ChatArchiveDiagnostic,
  type ChatConversation,
  type ChatMessage,
  type LiveMatchResponse,
  type PartyStatusResponse,
  type SocialPresence,
  type SocialStatusResponse,
} from "@/services/api";
import { presenceActivity, presenceState, productName, queueName } from "@/features/party/presence";
import {
  MobileBackHeader,
  MobileDataLoading,
  MobileIcon,
  MobilePageHeader,
  MobileSectionHeader,
  MobileSheetLayer,
  loadMobileMaps,
  loadMobileTiers,
  mobileAvatar,
} from "./MobileKit";
import type { MobileProfileTarget } from "./MobileProfileV2";

type ContactRow = {
  id: string;
  puuid: string;
  name: string;
  presence?: SocialPresence;
  conversation: ChatConversation;
  avatar: string;
  cardId?: string;
  group: "party" | "online" | "offline";
  section: string;
  partyDetail?: string;
};

type SocialCache = {
  savedAt: number;
  social?: SocialStatusResponse | null;
  party?: PartyStatusResponse | null;
  conversations?: ChatConversation[];
  cardByPuuid?: Record<string, string>;
};

function formatQueueElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function QueueClock({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt || startedAt > now + 5_000 || startedAt < now - 24 * 60 * 60 * 1_000) return null;
  return <>{formatQueueElapsed(now - startedAt)}</>;
}

function partyPhaseLabel(phase: PartyStatusResponse["phase"]) {
  if (phase === "matchmaking") return "Matchmaking";
  if (phase === "pregame") return "Agent select";
  if (phase === "coregame") return "Live match";
  return "Party lobby";
}

function fallbackMapName(value = "") {
  const leaf = value.split("/").filter(Boolean).pop() || "";
  return leaf.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function contactSection(presence: SocialPresence | undefined, inParty: boolean) {
  if (inParty) return "Party";
  if (!presence || presenceState(presence) === "offline") return "Offline";
  const product = productName(presence.product);
  return product === "Riot" || product === "Riot Client" ? "Online" : product;
}

function sectionRank(label: string) {
  if (label === "Party") return 0;
  if (label === "VALORANT") return 10;
  if (label === "League of Legends") return 20;
  if (label === "Teamfight Tactics") return 30;
  if (label === "Online") return 80;
  if (label === "Offline") return 100;
  return 60;
}

function conversationIdentity(conversation: ChatConversation) {
  return conversation.type === "dm"
    ? `dm:${conversation.peerPuuid?.toLowerCase() || conversation.displayName.toLowerCase()}`
    : conversation.key;
}

function mergeConversations(items: ChatConversation[]) {
  const unique = new Map<string, ChatConversation>();
  for (const conversation of items) {
    const key = conversationIdentity(conversation);
    const previous = unique.get(key);
    if (!previous) {
      unique.set(key, conversation);
      continue;
    }
    const live = conversation.state === "live" ? conversation : previous;
    const other = live === conversation ? previous : conversation;
    unique.set(key, {
      ...other,
      ...live,
      latestMessage: live.latestMessage || other.latestMessage,
      unreadCount: Math.max(live.unreadCount, other.unreadCount),
      capabilities: {
        history: live.capabilities.history || other.capabilities.history,
        directMessages: live.capabilities.directMessages || other.capabilities.directMessages,
        party: live.capabilities.party || other.capabilities.party,
      },
    });
  }
  return [...unique.values()];
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  const next = [...byId.values()].sort((left, right) => left.timestamp - right.timestamp);
  if (
    next.length === current.length
    && next.every((message, index) =>
      message.id === current[index]?.id
      && message.status === current[index]?.status
      && message.body === current[index]?.body
      && message.timestamp === current[index]?.timestamp)
  ) {
    return current;
  }
  return next;
}

function ChatView({
  conversation,
  contact,
  onBack,
  onProfile,
  onRead,
}: {
  conversation: ChatConversation;
  contact?: ContactRow;
  onBack: () => void;
  onProfile: (target: MobileProfileTarget) => void;
  onRead: (conversationKey: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [snapshotState, setSnapshotState] = useState("");
  const [archiveDiagnostic, setArchiveDiagnostic] = useState<ChatArchiveDiagnostic>();
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState("");

  const pane = useRef<HTMLDivElement>(null);
  const loadedEarlier = useRef(false);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);

  const loadMessages = useCallback(async (foreground = false) => {
    if (foreground) setLoading(true);
    try {
      const response = await getChatMessages(conversation.key);
      const incoming = response.messages || [];
      setMessages((current) => mergeMessages(current, incoming));
      if (!loadedEarlier.current) setHistoryExhausted(incoming.length < 50);
      setSnapshotState(response.snapshotState || "");
      setArchiveDiagnostic(response.archiveDiagnostic);
      setError("");
      const markedRead = await markChatRead(conversation.key).then(() => true).catch(() => false);
      if (markedRead) onRead(conversation.key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Messages are unavailable.");
    } finally {
      if (foreground) setLoading(false);
    }
  }, [conversation.key, onRead]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setError("");
    setSnapshotState("");
    setArchiveDiagnostic(undefined);
    setHistoryExhausted(false);
    loadedEarlier.current = false;
    preserveScroll.current = null;
    void loadMessages(true)
      .then(async () => {
        if (cancelled) return;
        const snapshot = await requestChatSnapshot(conversation.key).catch(() => null);
        if (!cancelled && snapshot) setSnapshotState(snapshot.snapshotState || "");
      });
    const controller = new AbortController();
    let eventTimer = 0;
    void subscribeChatEvents(() => {
      clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void loadMessages(), 120);
    }, controller.signal).catch(() => undefined);
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadMessages();
    }, 3_500);
    return () => {
      cancelled = true;
      clearTimeout(eventTimer);
      controller.abort();
      window.clearInterval(timer);
    };
  }, [conversation.key, loadMessages]);

  useEffect(() => {
    const scrollState = preserveScroll.current;
    preserveScroll.current = null;
    requestAnimationFrame(() => {
      if (!pane.current) return;
      if (scrollState) {
        pane.current.scrollTop = scrollState.top + (pane.current.scrollHeight - scrollState.height);
      } else {
        pane.current.scrollTo({ top: pane.current.scrollHeight, behavior: "smooth" });
      }
    });
  }, [messages]);

  const loadEarlier = async () => {
    const oldest = messages[0]?.timestamp;
    if (!oldest || loadingEarlier || historyExhausted) return;
    setLoadingEarlier(true);
    setError("");
    if (pane.current) preserveScroll.current = { height: pane.current.scrollHeight, top: pane.current.scrollTop };
    try {
      const response = await getChatMessages(conversation.key, oldest);
      const incoming = response.messages || [];
      loadedEarlier.current = true;
      setHistoryExhausted(incoming.length < 50);
      setSnapshotState(response.snapshotState || snapshotState);
      setArchiveDiagnostic(response.archiveDiagnostic || archiveDiagnostic);
      if (incoming.length) {
        setMessages((current) => mergeMessages(current, incoming));
      } else {
        preserveScroll.current = null;
      }
    } catch (reason) {
      preserveScroll.current = null;
      setError(reason instanceof Error ? reason.message : "Earlier messages could not be loaded.");
    } finally {
      setLoadingEarlier(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const clientId = `vv-android-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const pending: ChatMessage = {
      id: clientId,
      clientId,
      conversationKey: conversation.key,
      body,
      direction: "outgoing",
      status: "pending",
      timestamp: Date.now(),
    };
    setDraft("");
    setMessages((current) => [...current, pending]);
    try {
      const sent = await sendChatMessage(conversation.key, body, clientId);
      setMessages((current) => current.map((item) => item.clientId === clientId ? sent : item));
    } catch (reason) {
      setMessages((current) => current.map((item) => item.clientId === clientId ? { ...item, status: "failed" } : item));
      setError(reason instanceof Error ? reason.message : "Message failed to send.");
    }
  };

  const retryHistory = async () => {
    setError("");
    setSnapshotState("requested");
    setArchiveDiagnostic(undefined);
    try {
      const snapshot = await requestChatSnapshot(conversation.key, true);
      setSnapshotState(snapshot.snapshotState || "requested");
      await loadMessages();
    } catch (reason) {
      setSnapshotState("failed");
      setError(reason instanceof Error ? reason.message : "Riot message history could not be requested.");
    }
  };

  const canSend = conversation.state === "live" &&
    (conversation.type === "party" ? conversation.capabilities.party : conversation.capabilities.directMessages);
  const target = contact ? {
    puuid: contact.puuid,
    gameName: contact.name.split("#")[0],
    tagLine: contact.name.split("#").slice(1).join("#"),
    cardId: contact.cardId,
  } : null;

  return (
    <div className="mv2-chat">
      <MobileBackHeader
        title={contact?.name || conversation.displayName}
        detail={contact?.presence ? presenceActivity(contact.presence).label : conversation.source === "archive" ? "Saved conversation" : "Riot chat"}
        onBack={onBack}
        action={target ? <button type="button" className="mv2-header-action" onClick={() => onProfile(target)}><MobileIcon name="profile" /></button> : undefined}
      />
      {error ? <div className="mv2-inline-error">{error}</div> : null}
      {snapshotState === "pending" || snapshotState === "requested" ? (
        <div className="mv2-chat-status">Fetching Riot message history… New messages will appear here automatically.</div>
      ) : null}
      {snapshotState === "complete" && archiveDiagnostic?.responseType === "result" ? (
        <div className="mv2-chat-history-state"><MobileIcon name="check" size={14} />Riot history checked · {messages.length} saved message{messages.length === 1 ? "" : "s"}</div>
      ) : null}
      {(snapshotState === "failed" || archiveDiagnostic?.responseType === "request_failed") && messages.length ? (
        <button type="button" className="mv2-chat-history-state failed" onClick={() => void retryHistory()}>
          Saved messages shown · Riot history unavailable · Retry
        </button>
      ) : null}
      <div className="mv2-chat-messages" ref={pane}>
        {messages.length && !historyExhausted ? (
          <button type="button" className="mv2-chat-load-earlier" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
            {loadingEarlier ? "Loading earlier messages…" : "Load earlier messages"}
          </button>
        ) : null}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDay = !previous || new Date(previous.timestamp).toDateString() !== new Date(message.timestamp).toDateString();
          return (
            <div key={`${message.id}:${message.timestamp}`} className="mv2-chat-message-wrap">
              {showDay ? <time className="mv2-chat-day">{new Date(message.timestamp).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</time> : null}
              <article className={message.direction}>
                {message.senderName && message.direction === "incoming" ? <strong>{message.senderName}</strong> : null}
                <p>{message.body}</p>
                <small>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{message.direction === "outgoing" ? ` · ${message.status}` : ""}</small>
              </article>
            </div>
          );
        })}
        {!messages.length && !loading ? (
          <div className="mv2-chat-empty">
            <MobileIcon name="message" size={34} />
            <strong>No saved messages yet</strong>
            <p>
              {snapshotState === "pending" || snapshotState === "requested"
                ? "Riot is still checking this conversation."
                : snapshotState === "complete" && archiveDiagnostic?.responseType === "result" && archiveDiagnostic.messageCount === 0
                  ? "Riot returned no retained messages for this conversation."
                  : snapshotState === "failed" || archiveDiagnostic?.responseType === "request_failed"
                    ? "Riot could not return this conversation's retained history."
                    : "Open a conversation to import any history Riot still retains."}
            </p>
            {snapshotState === "failed" || archiveDiagnostic?.responseType === "request_failed" ? (
              <button type="button" className="mv2-secondary" onClick={() => void retryHistory()}>Retry history</button>
            ) : null}
          </div>
        ) : null}
        {loading ? <p className="mv2-muted-row">Checking saved messages and Riot history…</p> : null}
      </div>
      <form className="mv2-chat-compose" onSubmit={submit}>
        {!canSend ? <small>{conversation.state === "connecting" ? "Chat is connecting…" : "Saved history is available, but live sending is offline."}</small> : null}
        <div>
          <input value={draft} disabled={!canSend} onChange={(event) => setDraft(event.target.value)} placeholder={canSend ? "Message" : "Sending unavailable"} aria-label="Message" />
          <button type="submit" disabled={!canSend || !draft.trim()} aria-label="Send message"><MobileIcon name="send" /></button>
        </div>
      </form>
    </div>
  );
}

export default function MobileSocialV2({
  onOpenProfile,
  onOpenLiveMatch,
  initialTarget,
  onInitialTargetConsumed,
  onUnreadCountChange,
}: {
  onOpenProfile: (target: MobileProfileTarget) => void;
  onOpenLiveMatch: (match: LiveMatchResponse | null) => void;
  initialTarget?: MobileProfileTarget | null;
  onInitialTargetConsumed?: () => void;
  onUnreadCountChange?: (count: number) => void;
}) {
  const { activeAccount, playerCards } = useData();
  const [social, setSocial] = useState<SocialStatusResponse | null>(null);
  const [party, setParty] = useState<PartyStatusResponse | null>(null);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selected, setSelected] = useState<ChatConversation | null>(null);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [friendId, setFriendId] = useState("");
  const [partyExpanded, setPartyExpanded] = useState(true);
  const [cardByPuuid, setCardByPuuid] = useState<Record<string, string>>({});
  const [mapMeta, setMapMeta] = useState<Map<string, { name: string; splash: string; icon: string }>>(new Map());
  const [tierMeta, setTierMeta] = useState<Map<number, { name: string; icon: string }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([loadMobileMaps(), loadMobileTiers()]).then(([maps, tiers]) => {
      if (!active) return;
      setMapMeta(maps);
      setTierMeta(tiers);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!activeAccount?.puuid) return;
    try {
      const cached = JSON.parse(localStorage.getItem(`vv-mobile-social:v2:${activeAccount.puuid}`) || "null") as SocialCache | null;
      setCardByPuuid(cached?.cardByPuuid || {});
      if (!cached?.savedAt) return;
      if (cached.social) setSocial(cached.social);
      if (cached.party) setParty(cached.party);
      if (cached.conversations?.length) setConversations(cached.conversations);
      setLoading(false);
    } catch {
      setCardByPuuid({});
      /* A bad cache should never block live social data. */
    }
  }, [activeAccount?.puuid]);

  useEffect(() => {
    if (!activeAccount?.puuid) return;
    const observed = [
      ...(social?.presences || []).flatMap((presence) => presence.puuid && presence.cardId
        ? [[presence.puuid.toLowerCase(), presence.cardId] as const]
        : []),
      ...(party?.members || []).flatMap((member) => member.puuid && member.cardId
        ? [[member.puuid.toLowerCase(), member.cardId] as const]
        : []),
    ];
    if (!observed.length) return;
    setCardByPuuid((current) => {
      const next = { ...current };
      let changed = false;
      for (const [puuid, cardId] of observed) {
        if (next[puuid] === cardId) continue;
        next[puuid] = cardId;
        changed = true;
      }
      if (!changed) return current;
      try {
        const cacheKey = `vv-mobile-social:v2:${activeAccount.puuid}`;
        const previous = JSON.parse(localStorage.getItem(cacheKey) || "{}") as SocialCache;
        localStorage.setItem(cacheKey, JSON.stringify({ ...previous, cardByPuuid: next, savedAt: Date.now() }));
      } catch { /* Avatar caching is best effort. */ }
      return next;
    });
  }, [activeAccount?.puuid, party?.members, social?.presences]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [selected?.key]);

  const refresh = useCallback(async (full = true) => {
    setLoading(true);
    const cacheKey = activeAccount?.puuid ? `vv-mobile-social:v2:${activeAccount.puuid}` : "";
    const cache = (patch: Partial<SocialCache>) => {
      if (!cacheKey) return;
      try {
        const previous = JSON.parse(localStorage.getItem(cacheKey) || "{}") as SocialCache;
        localStorage.setItem(cacheKey, JSON.stringify({ ...previous, ...patch, savedAt: Date.now() }));
      } catch { /* Best-effort cache. */ }
    };
    const socialRequest = getSocialStatus().then((value) => {
      setSocial(value);
      cache({ social: value });
      return value;
    });
    const conversationsRequest = (full ? getChatConversations() : getChatSummary()).then((value) => {
      setConversations((current) => {
        const next = mergeConversations([...(full ? [] : current), ...(value.conversations || [])]);
        cache({ conversations: next });
        return next;
      });
      return value;
    });
    const partyRequest = getPartyStatus().then((value) => {
      setParty(value);
      cache({ party: value });
      return value;
    });
    const results = await Promise.allSettled([socialRequest, conversationsRequest, partyRequest]);
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") setError(rejected.reason instanceof Error ? rejected.reason.message : "Social data is unavailable.");
    setLoading(false);
  }, [activeAccount?.puuid]);

  useEffect(() => {
    void refresh(false);
    const controller = new AbortController();
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(false), 150);
    };
    void subscribeSocialEvents(update, controller.signal).catch(() => undefined);
    void subscribeChatEvents(update, controller.signal).catch(() => undefined);
    const safety = window.setInterval(() => {
      if (!document.hidden) void refresh(false);
    }, 45_000);
    return () => {
      clearTimeout(timer);
      controller.abort();
      window.clearInterval(safety);
    };
  }, [refresh]);

  const contacts = useMemo(() => {
    const presenceByPuuid = new Map(
      (social?.presences || []).flatMap((presence) => presence.puuid ? [[presence.puuid.toLowerCase(), presence] as const] : []),
    );
    const conversationByPeer = new Map(
      conversations.flatMap((conversation) => conversation.type === "dm" && conversation.peerPuuid
        ? [[conversation.peerPuuid.toLowerCase(), conversation] as const]
        : []),
    );
    const transport = conversations.find((conversation) => conversation.type === "dm" && conversation.state === "live");
    const partyByPuuid = new Map((party?.members || []).map((member) => [member.puuid.toLowerCase(), member]));
    const puuids = new Set([...presenceByPuuid.keys(), ...conversationByPeer.keys(), ...partyByPuuid.keys()]);
    const rows: ContactRow[] = [];
    for (const puuid of puuids) {
      if (puuid === activeAccount?.puuid.toLowerCase()) continue;
      const presence = presenceByPuuid.get(puuid);
      const partyMember = partyByPuuid.get(puuid);
      const existing = conversationByPeer.get(puuid);
      const name = presence?.name || partyMember?.name || existing?.displayName || "Riot player";
      const conversation: ChatConversation = existing || {
        key: `dm:${puuid}`,
        type: "dm",
        displayName: name,
        peerPuuid: puuid,
        source: transport?.source || "remote",
        state: transport?.state || (social?.remoteStatus === "live" ? "live" : "connecting"),
        unreadCount: 0,
        capabilities: {
          history: Boolean(transport?.capabilities.history),
          directMessages: Boolean(transport?.capabilities.directMessages || social?.remoteStatus === "live"),
          party: false,
        },
      };
      const state = presence ? presenceState(presence) : "offline";
      const inParty = Boolean(partyMember);
      const cardId = presence?.cardId || partyMember?.cardId || cardByPuuid[puuid];
      rows.push({
        id: puuid,
        puuid,
        name,
        presence,
        conversation,
        avatar: mobileAvatar(cardId, playerCards),
        cardId,
        group: inParty ? "party" : state === "offline" ? "offline" : "online",
        section: contactSection(presence, inParty),
        partyDetail: partyMember ? (partyMember.isOwner ? "Party owner" : partyMember.isReady ? "Ready" : "Not ready") : undefined,
      });
    }
    return rows.sort((left, right) => {
      const rank = { party: 0, online: 1, offline: 2 };
      const groupOrder = rank[left.group] - rank[right.group];
      if (groupOrder) return groupOrder;
      const unreadOrder = right.conversation.unreadCount - left.conversation.unreadCount;
      if (unreadOrder) return unreadOrder;
      const messageOrder = (right.conversation.latestMessage?.timestamp || 0) - (left.conversation.latestMessage?.timestamp || 0);
      return messageOrder || left.name.localeCompare(right.name);
    });
  }, [activeAccount?.puuid, cardByPuuid, conversations, party?.members, playerCards, social?.presences, social?.remoteStatus]);

  const unreadCount = useMemo(
    () => conversations.reduce((total, conversation) => total + Math.max(0, conversation.unreadCount || 0), 0),
    [conversations],
  );

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? contacts.filter((contact) => contact.name.toLowerCase().includes(normalized)) : contacts;
  }, [contacts, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, ContactRow[]>();
    for (const contact of filtered) {
      const items = grouped.get(contact.section) || [];
      items.push(contact);
      grouped.set(contact.section, items);
    }
    return [...grouped.entries()]
      .map(([label, items]) => ({ label, items }))
      .sort((left, right) => sectionRank(left.label) - sectionRank(right.label) || left.label.localeCompare(right.label));
  }, [filtered]);

  const incomingRequests = useMemo(
    () => (social?.requests || []).filter((request) => request.direction === "incoming"),
    [social?.requests],
  );
  const outgoingRequests = useMemo(
    () => (social?.requests || []).filter((request) => request.direction === "outgoing"),
    [social?.requests],
  );

  const selfStatus = useMemo(() => {
    const presence = social?.selfPresence;
    const activity = presence ? presenceActivity(presence) : null;
    const activeParty = party && party.phase !== "none" && party.phase !== "error" ? party : null;
    const partySize = activeParty?.members?.length || presence?.partySize || 0;
    const phaseLabel = activeParty?.phase === "coregame"
      ? "In match"
      : activeParty?.phase === "pregame"
        ? "Agent select"
        : activeParty?.phase === "matchmaking"
          ? "In queue"
          : activity?.label || (social?.remoteStatus === "live" ? "VALORANT offline" : "Checking status");
    const details = [
      activity?.detail,
      partySize > 1 ? `${partySize}/${presence?.maxPartySize || 5} in party` : "",
    ].filter(Boolean);
    const localMember = activeParty?.members?.find((member) => member.isLocal);
    const cardId = presence?.cardId || localMember?.cardId || cardByPuuid[activeAccount?.puuid.toLowerCase() || ""];
    return {
      label: phaseLabel,
      detail: details.join(" · ") || (partySize === 1
        ? "Solo party"
        : social?.remoteStatus === "live" ? "Friends and messages are still available" : "Live presence is unavailable"),
      state: presence ? presenceState(presence) : activeParty ? "game" : "offline",
      partySize,
      avatar: mobileAvatar(cardId, playerCards),
    };
  }, [activeAccount?.puuid, cardByPuuid, party, playerCards, social?.remoteStatus, social?.selfPresence]);

  const activeParty = party && party.phase !== "none" && party.phase !== "error" ? party : null;

  const openLiveMatch = async () => {
    if (busy === "live-match") return;
    setBusy("live-match");
    setError("");
    try {
      const match = await getLiveMatch();
      if (match.error && match.phase === "none") throw new Error(match.error);
      onOpenLiveMatch(match.phase === "none" ? null : match);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The live match could not be loaded.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!initialTarget || selected) return;
    const contact = contacts.find((item) => item.puuid.toLowerCase() === initialTarget.puuid.toLowerCase());
    if (contact) {
      setSelected(contact.conversation);
      onInitialTargetConsumed?.();
      return;
    }
    const transport = conversations.find((conversation) => conversation.type === "dm" && conversation.state === "live");
    setSelected({
      key: `dm:${initialTarget.puuid.toLowerCase()}`,
      type: "dm",
      displayName: `${initialTarget.gameName}${initialTarget.tagLine ? `#${initialTarget.tagLine}` : ""}`,
      peerPuuid: initialTarget.puuid.toLowerCase(),
      source: transport?.source || "remote",
      state: transport?.state || (social?.remoteStatus === "live" ? "live" : "connecting"),
      unreadCount: 0,
      capabilities: {
        history: Boolean(transport?.capabilities.history),
        directMessages: Boolean(transport?.capabilities.directMessages || social?.remoteStatus === "live"),
        party: false,
      },
    });
    onInitialTargetConsumed?.();
  }, [contacts, conversations, initialTarget, onInitialTargetConsumed, selected, social?.remoteStatus]);

  const openProfile = (contact: ContactRow) => {
    const [gameName, ...tagParts] = contact.name.split("#");
    onOpenProfile({
      puuid: contact.puuid,
      gameName,
      tagLine: tagParts.join("#"),
      cardId: contact.cardId,
    });
  };

  const submitFriend = async (event: FormEvent) => {
    event.preventDefault();
    const [gameName, ...tagParts] = friendId.trim().split("#");
    const gameTag = tagParts.join("#");
    if (!gameName || !gameTag) {
      setError("Enter a Riot ID as Name#Tag.");
      return;
    }
    setBusy("friend");
    try {
      await sendSocialFriendRequest(gameName, gameTag);
      setFriendId("");
      setShowAdd(false);
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Friend request failed.");
    } finally {
      setBusy("");
    }
  };

  const requestAction = async (puuid: string, action: "accept" | "deny" | "cancel") => {
    setBusy(`${puuid}:${action}`);
    try {
      await actOnSocialRequest(puuid, action);
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the request.");
    } finally {
      setBusy("");
    }
  };

  const markConversationRead = useCallback((conversationKey: string) => {
    setConversations((current) => current.map((conversation) => (
      conversation.key === conversationKey ? { ...conversation, unreadCount: 0 } : conversation
    )));
  }, []);

  if (selected) {
    const contact = contacts.find((item) => item.conversation.key === selected.key || item.puuid === selected.peerPuuid);
    return <ChatView conversation={selected} contact={contact} onBack={() => setSelected(null)} onProfile={onOpenProfile} onRead={markConversationRead} />;
  }

  if (loading && !social && !contacts.length) {
    return (
      <div className="mv2-social">
        <MobilePageHeader title="Social" subtitle="Friends, party and requests" />
        <MobileDataLoading
          kind="social"
          title="Connecting your social hub"
          detail="Checking presence, party status and pending requests."
        />
      </div>
    );
  }

  const renderGroup = (label: string, items: ContactRow[]) => items.length ? (
    <section className="mv2-social-group" key={label}>
      <MobileSectionHeader title={label} detail={`${items.length}`} />
      <div className="mv2-contact-list">
        {items.map((contact) => {
          const activity = contact.presence ? presenceActivity(contact.presence) : null;
          const map = contact.presence?.mapId ? mapMeta.get(contact.presence.mapId.toLowerCase()) : undefined;
          const mapName = map?.name || fallbackMapName(contact.presence?.mapId);
          const tier = contact.presence?.competitiveTier ? tierMeta.get(contact.presence.competitiveTier) : undefined;
          const queueing = /MATCHMAKING|STARTING_MATCHMAKING/i.test(contact.presence?.partyState || "");
          const preview = contact.partyDetail || (activity ? [activity.label, activity.detail].filter(Boolean).join(" · ") : "Offline");
          return (
            <article key={contact.id}>
              <button type="button" className="mv2-contact-profile" onClick={() => openProfile(contact)} aria-label={`Open ${contact.name} profile`}>
                <span className={`mv2-contact-avatar is-${contact.group}`}>
                  {contact.avatar
                    ? <img src={contact.avatar} alt="" />
                    : <b aria-hidden="true">{contact.name.trim().slice(0, 1).toUpperCase() || "?"}</b>}
                  <i />
                </span>
                <span>
                  <strong>{contact.name}</strong>
                  <small>{preview}</small>
                  {mapName || tier?.name || contact.presence?.scoreAvailable || (queueing && contact.presence?.queueStartedAt) ? (
                    <em className="mv3-contact-live-meta">
                      {mapName ? <span>{mapName}</span> : null}
                      {contact.presence?.scoreAvailable ? <span>{contact.presence.allyScore || 0}-{contact.presence.enemyScore || 0}</span> : null}
                      {queueing && contact.presence?.queueStartedAt ? <span><QueueClock startedAt={contact.presence.queueStartedAt} /></span> : null}
                      {tier?.name ? <span>{tier.name}</span> : null}
                    </em>
                  ) : null}
                </span>
              </button>
              <button type="button" className="mv2-contact-message" onClick={() => setSelected(contact.conversation)} aria-label={`Message ${contact.name}`}>
                {contact.conversation.unreadCount ? <i>{contact.conversation.unreadCount}</i> : <MobileIcon name="message" size={21} />}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  ) : null;

  return (
    <div className="mv2-social">
      <MobilePageHeader
        title="Social"
        subtitle={social?.status === "ok" ? `${social.friendCount} friends · ${social.onlineCount} online · ${social.inGameCount} in match` : "Friends and party"}
        action={(
          <nav className="mv3-social-header-actions">
            <button type="button" data-active={showSearch} onClick={() => {
              setShowSearch((value) => !value);
              if (showSearch) setQuery("");
            }} aria-label={showSearch ? "Close people search" : "Search people"}><MobileIcon name={showSearch ? "close" : "search"} size={20} /></button>
            <button type="button" onClick={() => setShowAdd(true)} aria-label="Add Riot friend"><MobileIcon name="plus" /></button>
          </nav>
        )}
      />
      {error ? <div className="mv2-inline-error">{error}</div> : null}
      {showSearch ? <label className="mv2-search mv3-social-search">
        <MobileIcon name="search" size={20} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><MobileIcon name="close" size={18} /></button> : null}
      </label> : null}

      <section className={`mv3-self-presence is-${selfStatus.state}`} aria-label={`Your Riot status: ${selfStatus.label}`}>
        <span className="mv3-self-presence-avatar">
          <img src={selfStatus.avatar || "/brand-mark.svg"} alt="" data-fallback={!selfStatus.avatar || undefined} />
          <i />
        </span>
        <span>
          <small>Your status</small>
          <strong>{selfStatus.label}</strong>
          <em>{selfStatus.detail}</em>
        </span>
        {selfStatus.partySize > 1 ? <b>{selfStatus.partySize}/5</b> : null}
      </section>

      {activeParty ? (
        <section className="mv3-party-hub" data-phase={activeParty.phase}>
          <button type="button" className="mv3-party-hub-heading" onClick={() => setPartyExpanded((value) => !value)} aria-expanded={partyExpanded}>
            <span className="mv3-party-phase-icon"><MobileIcon name={activeParty.phase === "matchmaking" ? "search" : "party"} size={19} /></span>
            <span>
              <small>Your party</small>
              <strong>{partyPhaseLabel(activeParty.phase)}</strong>
              <em>
                {queueName(activeParty.queueId || "") || "VALORANT"}
                {activeParty.phase === "matchmaking" && activeParty.queueStartedAt ? <> · <QueueClock startedAt={activeParty.queueStartedAt} /></> : null}
              </em>
            </span>
            <b>{activeParty.members?.length || 0}/5</b>
            <MobileIcon name="chevron" size={18} />
          </button>
          {partyExpanded ? (
            <div className="mv3-party-hub-body">
              <div className="mv3-party-member-list">
                {(activeParty.members || []).map((member) => {
                  const avatar = mobileAvatar(member.cardId || cardByPuuid[member.puuid.toLowerCase()], playerCards);
                  const rank = tierMeta.get(member.competitiveTier);
                  const [gameName, ...tagParts] = member.name.split("#");
                  return (
                    <button type="button" key={member.puuid} onClick={() => onOpenProfile({ puuid: member.puuid, gameName, tagLine: tagParts.join("#"), cardId: member.cardId })}>
                      <span>{avatar ? <img src={avatar} alt="" /> : <b>{member.name.slice(0, 1).toUpperCase()}</b>}</span>
                      <span>
                        <strong>{member.name}{member.isLocal ? " · You" : ""}</strong>
                        <small>{member.isOwner ? "Party leader" : member.isReady ? "Ready" : "Not ready"}{member.accountLevel ? ` · Level ${member.accountLevel}` : ""}</small>
                      </span>
                      {rank?.icon ? <img className="mv3-party-rank" src={rank.icon} alt={rank.name} title={rank.name} /> : rank?.name ? <em>{rank.name}</em> : <MobileIcon name="chevron" size={17} />}
                    </button>
                  );
                })}
              </div>
              {activeParty.phase === "matchmaking" ? (
                <div className="mv3-party-live-action"><span><i /><strong>Searching for a match</strong></span><b><QueueClock startedAt={activeParty.queueStartedAt} /></b></div>
              ) : activeParty.phase === "pregame" || activeParty.phase === "coregame" ? (
                <button type="button" className="mv3-party-live-action is-button" onClick={() => void openLiveMatch()} disabled={busy === "live-match"}>
                  <span><i /><strong>{activeParty.phase === "pregame" ? "Agent select is live" : "Match in progress"}</strong></span>
                  <b>{busy === "live-match" ? "Loading…" : "Open"}</b>
                </button>
              ) : (
                <div className="mv3-party-live-action"><span><i /><strong>{(activeParty.members || []).filter((member) => member.isReady).length}/{activeParty.members?.length || 0} ready</strong></span><b>{queueName(activeParty.queueId || "") || "Lobby"}</b></div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mv2-requests mv3-request-board">
        <header>
          <span>
            <strong>Friend requests</strong>
            <small>{incomingRequests.length} incoming · {outgoingRequests.length} sent</small>
          </span>
          <button type="button" onClick={() => void refresh(true)} disabled={loading} aria-label="Check pending friend requests"><MobileIcon name="refresh" size={18} /></button>
        </header>
        {[...incomingRequests, ...outgoingRequests].map((request) => (
            <article key={`${request.direction}:${request.puuid}`}>
              <span><strong>{request.name}</strong><small>{request.direction === "incoming" ? "Incoming request" : "Sent request · waiting for response"}</small></span>
              {request.direction === "incoming" ? (
                <div>
                  <button type="button" onClick={() => void requestAction(request.puuid, "deny")} disabled={busy.startsWith(request.puuid)}><MobileIcon name="close" /></button>
                  <button type="button" className="primary" onClick={() => void requestAction(request.puuid, "accept")} disabled={busy.startsWith(request.puuid)}><MobileIcon name="check" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => void requestAction(request.puuid, "cancel")} disabled={busy.startsWith(request.puuid)}>Cancel</button>
              )}
            </article>
        ))}
        {!incomingRequests.length && !outgoingRequests.length ? <p>No pending friend requests.</p> : null}
      </section>

      {groups.map((group) => renderGroup(group.label, group.items))}
      {!filtered.length && !loading ? <p className="mv2-muted-row">{query ? "No people match this search." : "Your Riot friends will appear here."}</p> : null}
      {loading && !contacts.length ? <p className="mv2-muted-row">Connecting to Riot social…</p> : null}

      {showAdd ? (
        <MobileSheetLayer onClose={() => setShowAdd(false)}>
          <form className="mv2-sheet" onSubmit={submitFriend} onClick={(event) => event.stopPropagation()}>
            <i />
            <header className="mv2-sheet-heading">
              <h2>Add friend</h2>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="Close add friend"><MobileIcon name="close" /></button>
            </header>
            <p>Enter the complete Riot ID.</p>
            <label>Riot ID<input autoFocus value={friendId} onChange={(event) => setFriendId(event.target.value)} placeholder="Name#Tag" /></label>
            <button className="mv2-primary" type="submit" disabled={!friendId.includes("#") || busy === "friend"}>{busy === "friend" ? "Sending…" : "Send request"}</button>
          </form>
        </MobileSheetLayer>
      ) : null}
    </div>
  );
}
