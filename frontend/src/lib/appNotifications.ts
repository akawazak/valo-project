"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppTab } from "@/lib/appTabs";

export type AppNotificationKind = "wishlist" | "message" | "match" | "progression" | "system" | "error";

export interface AppNotification {
    id: string;
    kind: AppNotificationKind;
    title: string;
    body: string;
    createdAt: number;
    read: boolean;
    image?: string;
    action?: AppTab;
    accountPuuid?: string;
}

export type AppNotificationInput = Omit<AppNotification, "read" | "createdAt"> & {
    createdAt?: number;
};

const EVENT_NAME = "vantavault:notification";
const STORAGE_VERSION = "v1";
const MAX_ITEMS = 80;
// Problems are only worth showing while they are fresh; a day later they have either cleared or repeated.
const ERROR_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(item: AppNotification, now = Date.now()) {
    return item.kind !== "error" || now - item.createdAt < ERROR_TTL_MS;
}

/** Adds a notification. A repeat of the same problem moves the existing one back to the top instead of stacking. */
function merge(current: AppNotification[], input: AppNotificationInput): AppNotification[] {
    const existing = current.find((item) => item.id === input.id);
    if (existing && input.kind !== "error") return current;
    const item: AppNotification = { ...input, createdAt: input.createdAt || Date.now(), read: false };
    return [item, ...current.filter((entry) => entry.id !== input.id)].slice(0, MAX_ITEMS);
}

function storageKey(accountPuuid?: string) {
    return `vantavault:notifications:${STORAGE_VERSION}:${accountPuuid || "guest"}`;
}

function readStored(accountPuuid?: string): AppNotification[] {
    if (typeof window === "undefined") return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey(accountPuuid)) || "[]") as AppNotification[];
        return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.title && isFresh(item)).slice(0, MAX_ITEMS) : [];
    } catch {
        return [];
    }
}

export function publishAppNotification(input: AppNotificationInput) {
    if (typeof window === "undefined") return;
    const key = storageKey(input.accountPuuid);
    const stored = readStored(input.accountPuuid);
    const next = merge(stored, input);
    if (next !== stored) localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent<AppNotificationInput>(EVENT_NAME, { detail: input }));
}

export function useAppNotifications(accountPuuid?: string) {
    const [items, setItems] = useState<AppNotification[]>(() => readStored(accountPuuid));

    useEffect(() => {
        setItems(readStored(accountPuuid));
    }, [accountPuuid]);

    useEffect(() => {
        const onNotification = (event: Event) => {
            const input = (event as CustomEvent<AppNotificationInput>).detail;
            if (!input?.id || !input.title) return;
            if (input.accountPuuid && accountPuuid && input.accountPuuid !== accountPuuid) return;
            setItems((current) => merge(current, input));
        };
        window.addEventListener(EVENT_NAME, onNotification);
        return () => window.removeEventListener(EVENT_NAME, onNotification);
    }, [accountPuuid]);

    useEffect(() => {
        localStorage.setItem(storageKey(accountPuuid), JSON.stringify(items));
    }, [accountPuuid, items]);

    const markRead = useCallback((id: string) => {
        setItems((current) => current.map((item) => item.id === id ? { ...item, read: true } : item));
    }, []);
    const markAllRead = useCallback(() => setItems((current) => current.map((item) => ({ ...item, read: true }))), []);
    const dismiss = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
    const clear = useCallback(() => setItems([]), []);
    const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

    return { items, unreadCount, markRead, markAllRead, dismiss, clear };
}
