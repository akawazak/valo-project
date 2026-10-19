import { invoke } from "@tauri-apps/api/core";

// Counts how many people use the app: a random install id and the app version,
// at most once a day. No Riot account, name, or game data is sent.
const STORAGE_KEY = "vv_usage_count";

export function usageCountEnabled(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
        return true;
    }
}

export function setUsageCountEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
        // Preference only; nothing to recover.
    }
}

export function sendUsagePing(): void {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    if (!usageCountEnabled()) return;
    void invoke("send_usage_ping").catch(() => undefined);
}
