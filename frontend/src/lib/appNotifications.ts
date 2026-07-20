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

function storageKey(accountPuuid?: string) {
    return `vantavault:notifications:${STORAGE_VERSION}:${accountPuuid || "guest"}`;
}

function readStored(accountPuuid?: string): AppNotification[] {
    if (typeof window === "undefined") return [];
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey(accountPuuid)) || "[]") as AppNotification[];
        return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.title).slice(0, MAX_ITEMS) : [];
    } catch {
        return [];
    }
}

export function publishAppNotification(input: AppNotificationInput) {
    if (typeof window === "undefined") return;
    const key = storageKey(input.accountPuuid);
    const stored = readStored(input.accountPuuid);
    if (!stored.some((item) => item.id === input.id)) {
        const item: AppNotification = { ...input, createdAt: input.createdAt || Date.now(), read: false };
        localStorage.setItem(key, JSON.stringify([item, ...stored].slice(0, MAX_ITEMS)));
    }
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
            setItems((current) => {
                if (current.some((item) => item.id === input.id)) return current;
                return [{ ...input, createdAt: input.createdAt || Date.now(), read: false }, ...current].slice(0, MAX_ITEMS);
            });
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
    const clear = useCallback(() => setItems([]), []);
    const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

    return { items, unreadCount, markRead, markAllRead, clear };
}
