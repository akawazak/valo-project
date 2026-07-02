import type { Preset } from "@/lib/types";
import { getHealth, getPresets, savePresets } from "./api";
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
    const settings = value.settings as Partial<Settings> | undefined;
    if (
        value.version !== 1 ||
        !Array.isArray(value.presets) ||
        !settings ||
        typeof settings.autoSelectAgent !== "boolean" ||
        typeof settings.useLocalSso !== "boolean" ||
        typeof settings.autoSyncMatches !== "boolean" ||
        ![0, 30, 90, 180, 365].includes(Number(settings.matchRetentionDays)) ||
        typeof settings.showOfflineFriends !== "boolean" ||
        typeof settings.showLiveMatch !== "boolean" ||
        typeof settings.showPartyWidget !== "boolean" ||
        value.presets.some((preset) => !preset || typeof preset.uuid !== "string" || typeof preset.name !== "string" || typeof preset.loadout !== "object")
    ) {
        throw new Error("This is not a valid VantaVault backup.");
    }
    return value as BackupFile;
}

export async function exportBackup(): Promise<void> {
    const [presets, settings] = await Promise.all([getPresets(), getSettings()]);
    downloadJson(`vantavault-backup-${new Date().toISOString().slice(0, 10)}.json`, {
        version: 1,
        createdAt: new Date().toISOString(),
        presets,
        settings,
    } satisfies BackupFile);
}

export async function importBackup(file: File): Promise<void> {
    const backup = parseBackup(await file.text());
    await saveSettings(backup.settings);
    await savePresets(backup.presets);
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
