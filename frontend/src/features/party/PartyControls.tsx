"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getAccountHealth, postPartyAction, type PartyAction, type PartyStatusResponse } from "@/services/api";
import { queueName } from "./presence";
import "./PartyControls.css";

/** Riot sends codes like RANKED_RESTRICTED; show them as words without guessing at a meaning. */
function codeLabel(code: string) {
    const words = code.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
    return words ? words[0].toUpperCase() + words.slice(1) : code;
}

function clock(seconds: number) {
    const s = Math.max(0, Math.ceil(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

type Standing = { status: string; count: number } | null;

/** Party buttons and account standing for the live party. Each button is one request; the backend re-checks it with Riot first. */
/** A friend who can be invited right now, with the same invite state the friend list shows. */
export type InvitableFriend = {
    puuid: string;
    name: string;
    detail?: string;
    avatar?: string;
    state: "idle" | "sending" | "sent" | "error";
    message?: string;
    onInvite: () => void;
};

export default function PartyControls({ party, onParty, friends = [] }: { party: PartyStatusResponse; onParty: (next: PartyStatusResponse) => void; friends?: InvitableFriend[] }) {
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const [standing, setStanding] = useState<Standing>(null);
    const [restrictedUntil, setRestrictedUntil] = useState(0);
    const [now, setNow] = useState(() => Date.now());

    const members = party.members ?? [];
    const local = members.find((member) => member.isLocal);
    const leader = !!local?.isOwner;
    const lobby = party.phase === "party" && !party.customGame;
    const queued = party.phase === "matchmaking";
    const eligible = party.eligibleQueues ?? [];
    const allReady = members.length > 0 && members.every((member) => member.isReady);
    const restricted = restrictedUntil > now;

    // Penalties: Riot only documents this as a list, so show whether it is empty and how many records there are, nothing more.
    useEffect(() => {
        let alive = true;
        const load = () => void getAccountHealth().then((health) => { if (alive) setStanding({ status: health.penalties.status, count: health.penalties.count }); }).catch(() => undefined);
        load();
        const timer = window.setInterval(load, 60_000);
        return () => { alive = false; window.clearInterval(timer); };
    }, []);

    useEffect(() => {
        setRestrictedUntil(party.restrictedSeconds ? Date.now() + party.restrictedSeconds * 1000 : 0);
    }, [party.restrictedSeconds]);

    useEffect(() => {
        if (!restrictedUntil) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [restrictedUntil]);

    useEffect(() => {
        if (message?.tone !== "ok") return;
        const timer = window.setTimeout(() => setMessage(null), 2500);
        return () => window.clearTimeout(timer);
    }, [message]);

    const run = async (action: PartyAction, done: string) => {
        if (busy) return;
        setBusy(action.action);
        setMessage(null);
        try {
            onParty(await postPartyAction(action));
            setMessage({ tone: "ok", text: done });
            return true;
        } catch (err) {
            setMessage({ tone: "error", text: err instanceof Error ? err.message : "The party action did not go through." });
            return false;
        } finally {
            setBusy(null);
        }
    };

    // The picker closes on Escape or a click outside it.
    useEffect(() => {
        if (!pickerOpen) return;
        const onDown = (event: PointerEvent) => { if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false); };
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPickerOpen(false); };
        window.addEventListener("pointerdown", onDown);
        window.addEventListener("keydown", onKey);
        return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
    }, [pickerOpen]);

    const leaderOnly = leader ? undefined : "Only the party leader can do this";
    const queueOptions = party.queueId && !eligible.includes(party.queueId) ? [party.queueId, ...eligible] : eligible;
    const open = (party.accessibility || "").toUpperCase() === "OPEN";

    const startBlocked = !leader ? leaderOnly : restricted ? "Queue restriction active" : !allReady ? "Everyone has to be ready" : !party.queueId || !eligible.includes(party.queueId) ? "Pick an available queue" : undefined;

    return <section className="party-controls" aria-label="Party controls">
        {(lobby || queued) && <div className="party-controls-row">
            <label className="party-controls-queue" title={!lobby ? "Cancel the queue to change it" : leaderOnly}>
                <Icon name="queue" />
                <select
                    value={party.queueId || ""}
                    aria-label="Queue"
                    disabled={!lobby || !leader || !!busy || !eligible.length}
                    onChange={(event) => void run({ action: "queue", queueId: event.target.value }, `Queue set to ${queueName(event.target.value)}.`)}
                >
                    {!party.queueId && <option value="">Choose a queue</option>}
                    {queueOptions.map((id) => <option key={id} value={id} disabled={!eligible.includes(id)}>{queueName(id)}</option>)}
                </select>
                <Icon name="chevron" />
            </label>
            {lobby && local && <button
                type="button"
                className={`party-controls-ready${local.isReady ? " is-on" : ""}`}
                aria-pressed={local.isReady}
                disabled={!!busy}
                title={local.isReady ? "Click to mark yourself not ready" : "Click to mark yourself ready"}
                onClick={() => void run({ action: local.isReady ? "unready" : "ready" }, local.isReady ? "Marked not ready." : "Marked ready.")}
            ><i aria-hidden="true" />{local.isReady ? "Ready" : "Not ready"}</button>}
        </div>}

        {lobby && <button
            type="button"
            className="party-controls-go"
            disabled={!!busy || !!startBlocked}
            title={startBlocked}
            onClick={() => void run({ action: "start" }, "Queue started.")}
        ><Icon name="play" />{busy === "start" ? "Starting…" : startBlocked && !leader ? "Waiting for the leader" : "Start queue"}</button>}
        {queued && <button type="button" className="party-controls-go is-cancel" disabled={!leader || !!busy} title={leaderOnly} onClick={() => void run({ action: "cancel" }, "Queue cancelled.")}>
            <Icon name="stop" />{busy === "cancel" ? "Cancelling…" : leader ? "Cancel queue" : "In queue"}
        </button>}

        {lobby && <div className="party-controls-row">
            <button
                type="button"
                className={`party-controls-toggle${open ? " is-on" : ""}`}
                aria-pressed={open}
                disabled={!leader || !!busy || !party.accessibility}
                title={leaderOnly || (open ? "Friends can join without an invite. Click to make it invite only." : "Only invited players can join. Click to open the party.")}
                onClick={() => void run({ action: open ? "close" : "open" }, open ? "Party set to invite only." : "Party opened.")}
            ><Icon name={open ? "unlock" : "lock"} />{open ? "Open" : "Invite only"}</button>
            <div className="party-controls-picker" ref={pickerRef}>
                <button
                    type="button"
                    className={`party-controls-invite-open${pickerOpen ? " is-open" : ""}`}
                    aria-expanded={pickerOpen}
                    aria-haspopup="dialog"
                    disabled={members.length >= 5}
                    title={members.length >= 5 ? "The party is full" : undefined}
                    onClick={() => setPickerOpen((value) => !value)}
                >
                    <Icon name="invite" />{members.length >= 5 ? "Party is full" : "Invite friends"}
                    {friends.length > 0 && members.length < 5 && <b>{friends.length}</b>}
                </button>
                {pickerOpen && <div className="party-controls-picker-list" role="dialog" aria-label="Invite friends">
                    {friends.length ? friends.map((friend) => <div key={friend.puuid} className="party-controls-friend">
                        <span className="party-controls-friend-avatar" aria-hidden="true" style={friend.avatar ? { backgroundImage: `url("${friend.avatar}")` } : undefined}>{friend.avatar ? null : friend.name.slice(0, 1).toUpperCase()}</span>
                        <span className="party-controls-friend-copy"><b>{friend.name.split("#")[0]}<small>#{friend.name.split("#")[1]}</small></b>{friend.detail && <small>{friend.detail}</small>}</span>
                        <button
                            type="button"
                            className={`party-controls-friend-invite is-${friend.state}`}
                            disabled={friend.state === "sending" || friend.state === "sent"}
                            title={friend.state === "error" ? friend.message : undefined}
                            onClick={friend.onInvite}
                        >{friend.state === "sending" ? "Sending" : friend.state === "sent" ? "Sent" : friend.state === "error" ? "Retry" : "Invite"}</button>
                    </div>) : <p className="party-controls-picker-empty">No friends can be invited right now. Friends show up here when they are in VALORANT and not in a match.</p>}
                </div>}
            </div>
        </div>}

        {party.customGame && <p className="party-controls-note">Custom game setup. Use VALORANT to manage teams and settings.</p>}
        {(party.phase === "pregame" || party.phase === "coregame") && <p className="party-controls-note">Party controls come back after the match.</p>}

        {message && <p className={`party-controls-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}

        <div className="party-controls-standing" aria-live="polite">
            {restricted
                ? <span className="is-warn"><Icon name="shield-alert" />Queue restricted · {clock((restrictedUntil - now) / 1000)} left</span>
                : standing?.status === "warn"
                    ? <span className="is-warn"><Icon name="shield-alert" />Riot reports {standing.count} active {standing.count === 1 ? "penalty" : "penalties"} · check VALORANT</span>
                    : standing?.status === "clear"
                        ? <span className="is-ok"><Icon name="shield" />Good standing · no active penalties</span>
                        : <span><Icon name="shield" />Account standing unavailable</span>}
            {!!party.queueIneligibilities?.length && <small>Blocked: {party.queueIneligibilities.map(codeLabel).join(", ")}</small>}
        </div>
    </section>;
}

/** Outline icons in the same style as the panel's chat icon. */
function Icon({ name }: { name: "queue" | "chevron" | "play" | "stop" | "lock" | "unlock" | "invite" | "shield" | "shield-alert" }) {
    const paths: Record<typeof name, ReactNode> = {
        queue: <><path d="M4 7h16M4 12h10M4 17h7" /></>,
        chevron: <path d="m7 10 5 5 5-5" />,
        play: <path d="M8 5.5v13l10-6.5z" />,
        stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
        lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
        unlock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
        invite: <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6" /></>,
        shield: <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
        "shield-alert": <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" /><path d="M12 8v5M12 16v.5" /></>,
    };
    return <svg className={`party-controls-icon is-${name}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
