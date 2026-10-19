"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppNotification, AppNotificationKind } from "@/lib/appNotifications";
import type { AppTab } from "@/lib/appTabs";
import styles from "./NotificationCenter.module.css";

const KIND_LABEL: Record<AppNotificationKind, string> = {
    wishlist: "Wishlist",
    message: "Message",
    match: "Match",
    progression: "Progress",
    system: "Update",
    error: "Problem",
};

// Drawn for VantaVault, one per kind: the store's wishlist heart, the friends list's chat bubble,
// a crosshair for matches, rank-up chevrons, an update arrow and a plain "!" for problems.
const KIND_ICON: Record<AppNotificationKind, string> = {
    wishlist: "M12 20.5 4.2 13A5.2 5.2 0 0 1 11.6 5.7l.4.4.4-.4A5.2 5.2 0 0 1 19.8 13L12 20.5Z",
    message: "M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z",
    match: "M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5M12 12h.01",
    progression: "M6.5 12.5 12 7l5.5 5.5M6.5 18 12 12.5l5.5 5.5",
    system: "M12 19.5V5M6 11l6-6 6 6",
    error: "M12 5v9M12 19h.01",
};

// Real art where there is some: the skin itself, the sender's player card, or the VantaVault mark for the app's own news and problems.
function artFor(item: AppNotification) {
    if (item.image) return item.image;
    return item.kind === "system" || item.kind === "error" ? "/brand-mark.png" : "";
}

function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function relativeTime(value: number) {
    const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

export default function NotificationCenter({
    items,
    unreadCount,
    onRead,
    onReadAll,
    onClear,
    onDismiss,
    onNavigate,
}: {
    items: AppNotification[];
    unreadCount: number;
    onRead: (id: string) => void;
    onReadAll: () => void;
    onClear: () => void;
    onDismiss: (id: string) => void;
    onNavigate: (tab: AppTab) => void;
}) {
    const [open, setOpen] = useState(false);
    const [drawerPosition, setDrawerPosition] = useState({ top: 72, right: 24 });
    const rootRef = useRef<HTMLDivElement>(null);
    const drawerRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!open) return;
        const positionDrawer = () => {
            const rect = rootRef.current?.getBoundingClientRect();
            if (!rect) return;
            setDrawerPosition({ top: rect.bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
        };
        positionDrawer();
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!rootRef.current?.contains(target) && !drawerRef.current?.contains(target)) setOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", close);
        window.addEventListener("keydown", escape);
        window.addEventListener("resize", positionDrawer);
        return () => {
            document.removeEventListener("mousedown", close);
            window.removeEventListener("keydown", escape);
            window.removeEventListener("resize", positionDrawer);
        };
    }, [open]);

    const groups = useMemo(() => {
        const today = startOfToday();
        return [
            { label: "Today", items: items.filter((item) => item.createdAt >= today) },
            { label: "Earlier", items: items.filter((item) => item.createdAt < today) },
        ].filter((group) => group.items.length);
    // Recomputed when the drawer opens so "Today" stays right across midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, open]);

    return <div className={styles.root} ref={rootRef}>
        <button className={styles.trigger} type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9.8 21h4.4" /></svg>
            {unreadCount ? <span>{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
        </button>
        {open && typeof document !== "undefined" ? createPortal(<aside ref={drawerRef} className={styles.drawer} style={drawerPosition} aria-label="Notification center">
            <header>
                <strong>Notifications</strong>
                {unreadCount ? <span className={styles.newCount}>{unreadCount} new</span> : null}
                {unreadCount ? <button type="button" onClick={onReadAll}>Mark all read</button> : null}
            </header>
            <div className={styles.list}>
                {items.length ? groups.map((group) => <section key={group.label} aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <ul>
                        {group.items.map((item) => <li key={item.id} className={styles.item} data-read={item.read} data-kind={item.kind}>
                            <button type="button" className={styles.open} onClick={() => {
                                onRead(item.id);
                                if (item.action) onNavigate(item.action);
                                setOpen(false);
                            }}>
                                <span className={styles.media} data-art={Boolean(artFor(item))}>
                                    {artFor(item)
                                        ? <>
                                            <img src={artFor(item)} alt="" loading="lazy" data-brand={!item.image} onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                                            <i className={styles.badge} aria-hidden="true"><svg viewBox="0 0 24 24"><path d={KIND_ICON[item.kind]} /></svg></i>
                                        </>
                                        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d={KIND_ICON[item.kind]} /></svg>}
                                </span>
                                <span className={styles.text}>
                                    <span className={styles.meta}><b>{KIND_LABEL[item.kind]}</b><time dateTime={new Date(item.createdAt).toISOString()}>{relativeTime(item.createdAt)}</time></span>
                                    <strong>{item.title}</strong>
                                    {item.body ? <small>{item.body}</small> : null}
                                </span>
                            </button>
                            <button type="button" className={styles.dismiss} aria-label={`Dismiss ${item.title}`} onClick={() => onDismiss(item.id)}>
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
                            </button>
                        </li>)}
                    </ul>
                </section>) : <div className={styles.empty}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9.8 21h4.4" /></svg>
                    <strong>You&apos;re caught up</strong>
                    <span>Wishlist skins in your store, messages and updates show up here.</span>
                </div>}
            </div>
            {items.length ? <footer><button type="button" onClick={onClear}>Clear all</button></footer> : null}
        </aside>, document.body) : null}
    </div>;
}
