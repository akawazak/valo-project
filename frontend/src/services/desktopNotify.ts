/** Windows toasts for things worth leaving the game for, sent through Tauri's notification plugin. */
const STORAGE_KEY = "vantavault:desktop-notifications";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function getDesktopNotificationsEnabled(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return localStorage.getItem(STORAGE_KEY) !== "off";
    } catch {
        return true;
    }
}

export function setDesktopNotificationsEnabled(enabled: boolean) {
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
    } catch {
        // The toggle still applies for this session.
    }
}

/** Shows a toast unless the app is already in front of the player, where the in-app bell covers it. */
export async function notifyDesktop(title: string, body: string) {
    if (!isTauri() || !getDesktopNotificationsEnabled()) return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (granted) sendNotification({ title, body });
    } catch (err) {
        console.warn("Desktop notification failed:", err instanceof Error ? err.message : String(err));
    }
}
