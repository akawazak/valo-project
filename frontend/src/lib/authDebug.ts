"use client";

import type { RiotAccount } from "@/lib/types";

const MAX_AUTH_DEBUG_EVENTS = 80;
// Kept across restarts so a failed renewal can still be inspected after the
// app is reopened. Only stage names, outcomes and error codes are stored.
const AUTH_DEBUG_STORAGE_KEY = "vantavault_auth_debug_v1";
const authDebugEvents: AuthDebugEvent[] = loadStoredEvents();

type AuthDebugValue = string | number | boolean | null | undefined;

export interface AuthDebugEvent {
    ts: number;
    stage: string;
    outcome?: "start" | "success" | "failed" | "skipped" | "info";
    allowPopup?: boolean;
    visible?: boolean;
    code?: string;
    attempt?: number;
    message?: string;
    extra?: Record<string, AuthDebugValue>;
}

function safeLabel(value: string | undefined, fallback: string) {
    const sanitized = (value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
    return sanitized || fallback;
}

function loadStoredEvents(): AuthDebugEvent[] {
    try {
        if (typeof localStorage === "undefined") return [];
        const parsed = JSON.parse(localStorage.getItem(AUTH_DEBUG_STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((event): event is AuthDebugEvent => Boolean(event) && typeof event.ts === "number" && typeof event.stage === "string")
            .slice(-MAX_AUTH_DEBUG_EVENTS)
            .map((event) => ({
                ts: event.ts,
                stage: safeLabel(event.stage, "auth.event"),
                outcome: event.outcome,
                allowPopup: event.allowPopup,
                visible: event.visible,
                code: event.code ? safeLabel(event.code, "unknown") : undefined,
                attempt: typeof event.attempt === "number" ? event.attempt : undefined,
            }));
    } catch {
        return [];
    }
}

function persistEvents() {
    try {
        localStorage.setItem(AUTH_DEBUG_STORAGE_KEY, JSON.stringify(authDebugEvents));
    } catch {
        // Diagnostics are best effort; never let them break sign-in.
    }
}

export function pushAuthDebugEvent(
    stage: string,
    account?: Partial<RiotAccount> | null,
    details: Omit<AuthDebugEvent, "ts" | "stage"> = {},
) {
    void account;
    const event: AuthDebugEvent = {
        ts: Date.now(),
        stage: safeLabel(stage, "auth.event"),
        outcome: details.outcome,
        allowPopup: details.allowPopup,
        visible: details.visible,
        code: details.code ? safeLabel(details.code, "unknown") : undefined,
        attempt: details.attempt,
    };

    authDebugEvents.push(event);
    if (authDebugEvents.length > MAX_AUTH_DEBUG_EVENTS) {
        authDebugEvents.splice(0, authDebugEvents.length - MAX_AUTH_DEBUG_EVENTS);
    }
    persistEvents();

    if (typeof console !== "undefined") {
        console.info("[VantaVault auth]", {
            stage: event.stage,
            outcome: event.outcome,
            code: event.code,
        });
    }
}

const isoOrNull = (value?: number) => value ? new Date(value).toISOString() : null;

export function buildAuthDebugSnapshot(accounts: RiotAccount[], activeAccount: RiotAccount | null) {
    const authSources = accounts.reduce<Record<string, number>>((counts, account) => {
        const source = safeLabel(account.authSource, "unknown");
        counts[source] = (counts[source] || 0) + 1;
        return counts;
    }, {});
    // Accounts are numbered, never named: no PUUID, Riot ID, token or cookie.
    const accountTimeline = accounts.map((account, index) => ({
        account: index + 1,
        active: Boolean(activeAccount && activeAccount.puuid === account.puuid),
        source: safeLabel(account.authSource, "unknown"),
        hasSavedSession: Boolean(account.ssid || account.sessionId),
        tokenExpiresAt: isoOrNull(account.expiresAt),
        lastRenewedAt: isoOrNull(account.lastRenewedAt),
        lastCookieRotatedAt: isoOrNull(account.lastCookieRotatedAt),
        lastRefreshAttemptAt: isoOrNull(account.lastRefreshAttemptAt),
        lastRefreshErrorCode: account.lastRefreshErrorCode ? safeLabel(account.lastRefreshErrorCode, "unknown") : null,
    }));
    return JSON.stringify({
        generatedAt: new Date().toISOString(),
        accountCount: accounts.length,
        hasActiveAccount: Boolean(activeAccount),
        authSources,
        accounts: accountTimeline,
        recentEvents: authDebugEvents.map((event) => ({ ...event, at: new Date(event.ts).toISOString() })),
    }, null, 2);
}
