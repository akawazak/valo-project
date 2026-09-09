"use client";

import type { RiotAccount } from "@/lib/types";

const MAX_AUTH_DEBUG_EVENTS = 80;
const authDebugEvents: AuthDebugEvent[] = [];

type AuthDebugValue = string | number | boolean | null | undefined;

export interface AuthDebugEvent {
    ts: number;
    stage: string;
    outcome?: "start" | "success" | "failed" | "skipped" | "info";
    allowPopup?: boolean;
    visible?: boolean;
    code?: string;
    message?: string;
    extra?: Record<string, AuthDebugValue>;
}

function safeLabel(value: string | undefined, fallback: string) {
    const sanitized = (value || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
    return sanitized || fallback;
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
    };

    authDebugEvents.push(event);
    if (authDebugEvents.length > MAX_AUTH_DEBUG_EVENTS) {
        authDebugEvents.splice(0, authDebugEvents.length - MAX_AUTH_DEBUG_EVENTS);
    }

    if (typeof console !== "undefined") {
        console.info("[VantaVault auth]", {
            stage: event.stage,
            outcome: event.outcome,
            code: event.code,
        });
    }
}

export function buildAuthDebugSnapshot(accounts: RiotAccount[], activeAccount: RiotAccount | null) {
    const authSources = accounts.reduce<Record<string, number>>((counts, account) => {
        const source = safeLabel(account.authSource, "unknown");
        counts[source] = (counts[source] || 0) + 1;
        return counts;
    }, {});
    return JSON.stringify({
        generatedAt: new Date().toISOString(),
        accountCount: accounts.length,
        hasActiveAccount: Boolean(activeAccount),
        authSources,
        recentEvents: [...authDebugEvents],
    }, null, 2);
}
