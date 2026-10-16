import type { Preset } from "@/lib/types";
import { isValidPresetTemplate, resolvePresetSnapshot } from "@/lib/presetShare";
import { captureAccountRequest, getHealth, getPresets, savePresets } from "./api";
import { getSettings, getStorageStatus, saveSettings, type Settings } from "./settings";

type BackupFile = {
    version: 1;
    createdAt: string;
    presets: Preset[];
    settings: Settings;
};

function downloadJson(name: string, value: unknown): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseBackup(text: string): BackupFile {
    const value = JSON.parse(text) as Partial<BackupFile>;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This is not a valid VantaVault backup.');
    const settings = value.settings as Partial<Settings> | undefined;
    if (settings && typeof settings.showUnownedCosmetics !== "boolean") {
        settings.showUnownedCosmetics = false;
    }
    if (
        value.version !== 1 ||
        !Array.isArray(value.presets) ||
        !settings ||
        typeof settings.autoSelectAgent !== "boolean" ||
        typeof settings.useLocalSso !== "boolean" ||
        typeof settings.autoSyncMatches !== "boolean" ||
        typeof settings.matchRetentionDays !== 'number' ||
        ![0, 30, 90, 180, 365].includes(settings.matchRetentionDays) ||
        typeof settings.showOfflineFriends !== "boolean" ||
        typeof settings.showLiveMatch !== "boolean" ||
        typeof settings.showPartyWidget !== "boolean" ||
        value.presets.some((preset) => !isValidPresetTemplate(preset)
            || typeof preset.uuid !== 'string' || !preset.uuid.trim()
            || typeof preset.name !== 'string'
            || (preset.parentUuid !== undefined && (typeof preset.parentUuid !== 'string' || !preset.parentUuid.trim())))
    ) {
        throw new Error("This is not a valid VantaVault backup.");
    }
    if (new Set(value.presets.map(preset => preset.uuid)).size !== value.presets.length) {
        throw new Error('This backup contains duplicate preset IDs.');
    }
    // Preserve stored deltas and parent IDs, but verify every chain can resolve.
    for (const preset of value.presets) resolvePresetSnapshot(preset, value.presets);
    return value as BackupFile;
}

export async function exportBackup(): Promise<boolean> {
    const request = captureAccountRequest();
    if (!request?.isCurrent()) throw new Error('Select an account before exporting a backup.');
    let presets, settings;
    try {
        [presets, settings] = await Promise.all([getPresets(request.owner), getSettings()]);
    } catch (error) {
        if (!request.isCurrent()) return false;
        throw error;
    }
    if (!request.isCurrent()) return false;
    downloadJson(`vantavault-backup-${new Date().toISOString().slice(0, 10)}.json`, {
        version: 1,
        createdAt: new Date().toISOString(),
        presets,
        settings,
    } satisfies BackupFile);
    return true;
}

export async function importBackup(file: File): Promise<boolean> {
    const request = captureAccountRequest();
    if (!request?.isCurrent()) throw new Error('Select an account before importing a backup.');
    try {
        const text = await file.text();
        if (!request.isCurrent()) return false;
        const backup = parseBackup(text);
        await savePresets(backup.presets, request.owner);
        if (!request.isCurrent()) return false;
        await saveSettings(backup.settings);
        return request.isCurrent();
    } catch (error) {
        if (!request.isCurrent()) return false;
        throw error;
    }
}

export async function exportDiagnostics(appVersion: string): Promise<void> {
    const [health, storage, settings] = await Promise.all([getHealth(), getStorageStatus(), getSettings()]);
    downloadJson(`vantavault-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, {
        createdAt: new Date().toISOString(),
        appVersion,
        backend: {
            online: health.online,
            localClientActive: health.localClientActive,
        },
        storage,
        settings,
    });
}
