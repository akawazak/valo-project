import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

const STORAGE_KEY = 'valovault_launch_at_startup';

function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function getLaunchAtStartupPreference(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setLaunchAtStartupPreference(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

/** Sync OS autostart registration with saved preference (opt-in, default off). */
export async function syncLaunchAtStartup(): Promise<boolean> {
    const wantEnabled = getLaunchAtStartupPreference();
    if (!isTauriRuntime()) return wantEnabled;

    try {
        const osEnabled = await isEnabled();
        if (wantEnabled && !osEnabled) await enable();
        if (!wantEnabled && osEnabled) await disable();
        return wantEnabled;
    } catch {
        return false;
    }
}

export async function setLaunchAtStartup(enabled: boolean): Promise<void> {
    setLaunchAtStartupPreference(enabled);
    if (!isTauriRuntime()) return;

    try {
        if (enabled) await enable();
        else await disable();
    } catch (err) {
        console.error('Autostart registration failed:', err);
        setLaunchAtStartupPreference(false);
        throw err;
    }
}

export async function readLaunchAtStartupState(): Promise<boolean> {
    if (!isTauriRuntime()) return getLaunchAtStartupPreference();
    try {
        return await isEnabled();
    } catch {
        return getLaunchAtStartupPreference();
    }
}
