"use client";

import type { RiotAccount } from "@/lib/types";

const AUTH_DEBUG_STORAGE_KEY = "vantavault:auth-debug-events";
const MAX_AUTH_DEBUG_EVENTS = 80;

type AuthDebugValue = string | number | boolean | null | undefined;

export interface AuthDebugEvent {
    ts: number;
    stage: string;
    outcome?: "start" | "success" | "failed" | "skipped" | "info";
    puuidSuffix?: string;
    account?: string;
    session?: string;
    hasAccessToken?: boolean;
    hasEntitlementsToken?: boolean;
    hasSsid?: boolean;
    expiresInSec?: number | null;
    allowPopup?: boolean;
    visible?: boolean;
    code?: string;
    message?: string;
    extra?: Record<string, AuthDebugValue>;
}

function readEvents(): AuthDebugEvent[] {
    if (typeof window === "undefined") return [];
    try {
        const parsed = JSON.parse(window.localStorage.getItem(AUTH_DEBUG_STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeEvents(events: AuthDebugEvent[]) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(AUTH_DEBUG_STORAGE_KEY, JSON.stringify(events.slice(-MAX_AUTH_DEBUG_EVENTS)));
    } catch {
        // Auth diagnostics must never affect the auth flow.
    }
}

function shortPuuid(puuid?: string) {
    return puuid ? `…${puuid.slice(-6)}` : undefined;
}

function shortSession(sessionId?: string) {
    if (!sessionId) return undefined;
    if (sessionId.startsWith("account_")) return `account_*${sessionId.slice(-6)}`;
    if (sessionId.startsWith("session_")) return "legacy_session";
    return "custom_session";
}

function accountLabel(account?: Partial<RiotAccount>) {
    if (!account?.gameName) return undefined;
    return `${account.gameName}#${account.tagLine || ""}`;
}

export function pushAuthDebugEvent(
    stage: string,
    account?: Partial<RiotAccount> | null,
    details: Omit<AuthDebugEvent, "ts" | "stage" | "puuidSuffix" | "account" | "session" | "hasAccessToken" | "hasEntitlementsToken" | "hasSsid" | "expiresInSec"> = {},
) {
    const now = Date.now();
    const event: AuthDebugEvent = {
        ts: now,
        stage,
        puuidSuffix: shortPuuid(account?.puuid),
        account: accountLabel(account || undefined),
        session: shortSession(account?.sessionId),
        hasAccessToken: Boolean(account?.accessToken),
        hasEntitlementsToken: Boolean(account?.entitlementsToken),
        hasSsid: Boolean(account?.ssid),
        expiresInSec: account?.expiresAt ? Math.round((account.expiresAt - now) / 1000) : null,
        ...details,
    };

    const events = readEvents();
    events.push(event);
    writeEvents(events);

    if (typeof console !== "undefined") {
        console.info("[VantaVault auth]", {
            ...event,
            at: new Date(event.ts).toISOString(),
        });
    }
}

export function buildAuthDebugSnapshot(accounts: RiotAccount[], activeAccount: RiotAccount | null) {
    const now = Date.now();
    return JSON.stringify({
        generatedAt: new Date(now).toISOString(),
        activePuuidSuffix: shortPuuid(activeAccount?.puuid),
        accounts: accounts.map((account) => ({
            account: accountLabel(account),
            puuidSuffix: shortPuuid(account.puuid),
            active: activeAccount?.puuid === account.puuid,
            hasAccessToken: Boolean(account.accessToken),
            hasEntitlementsToken: Boolean(account.entitlementsToken),
            hasSsid: Boolean(account.ssid),
            session: shortSession(account.sessionId),
            expiresAt: account.expiresAt ? new Date(account.expiresAt).toISOString() : null,
            expiresInSec: account.expiresAt ? Math.round((account.expiresAt - now) / 1000) : null,
            lastRenewedAt: account.lastRenewedAt ? new Date(account.lastRenewedAt).toISOString() : null,
            lastRefreshAttemptAt: account.lastRefreshAttemptAt ? new Date(account.lastRefreshAttemptAt).toISOString() : null,
            lastRefreshErrorCode: account.lastRefreshErrorCode || null,
            lastRefreshError: account.lastRefreshError || null,
        })),
        recentEvents: readEvents(),
    }, null, 2);
}
