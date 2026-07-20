"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppNotification } from "@/lib/appNotifications";
import type { AppTab } from "@/lib/appTabs";
import styles from "./NotificationCenter.module.css";

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
    onNavigate,
}: {
    items: AppNotification[];
    unreadCount: number;
    onRead: (id: string) => void;
    onReadAll: () => void;
    onClear: () => void;
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

    return <div className={styles.root} ref={rootRef}>
        <button className={styles.trigger} type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9.8 21h4.4" /></svg>
            {unreadCount ? <span>{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
        </button>
        {open && typeof document !== "undefined" ? createPortal(<aside ref={drawerRef} className={styles.drawer} style={drawerPosition} aria-label="Notification center">
            <header><div><span>ACTIVITY</span><strong>Notifications</strong></div>{unreadCount ? <button type="button" onClick={onReadAll}>Mark all read</button> : null}</header>
            <div className={styles.list}>
                {items.length ? items.map((item) => <button key={item.id} type="button" className={styles.item} data-read={item.read} data-kind={item.kind} onClick={() => {
                    onRead(item.id);
                    if (item.action) onNavigate(item.action);
                    setOpen(false);
                }}>
                    {item.image ? <img src={item.image} alt="" /> : <i aria-hidden="true" />}
                    <span><strong>{item.title}</strong><small>{item.body}</small></span>
                    <time>{relativeTime(item.createdAt)}</time>
                </button>) : <div className={styles.empty}><strong>You&apos;re caught up</strong><span>Store finds, match syncs, and Riot messages will appear here.</span></div>}
            </div>
            {items.length ? <footer><button type="button" onClick={onClear}>Clear history</button></footer> : null}
        </aside>, document.body) : null}
    </div>;
}
