import { LocalClientError } from "@/lib/errors";
import { appFetch, LOCAL_URL } from "./api";

export type Settings = {
    autoSelectAgent: boolean;
    useLocalSso: boolean;
    autoSyncMatches: boolean;
    matchRetentionDays: 0 | 30 | 90 | 180 | 365;
    showOfflineFriends: boolean;
    showLiveMatch: boolean;
    showPartyWidget: boolean;
};

export type StorageStatus = {
    matchCacheBytes: number;
    logBytes: number;
    cachedMatches: number;
};

export async function getSettings(): Promise<Settings> {
    try {
        const response = await appFetch(LOCAL_URL+'/settings');
        if (!response.ok) {
            throw new Error('Failed to fetch settings. The local client might not be running or there was a server error.');
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function saveSettings(settings: Settings): Promise<void> {
    try {
        const response = await appFetch(LOCAL_URL+'/settings', {
            method: 'POST',
            body: JSON.stringify(settings),
        });
        if (!response.ok) {
            throw new Error('Failed to save settings. The local client might not be running or there was a server error.');
        }
    } catch (error) {
        console.error(error);
        throw new LocalClientError();
    }
}

export async function getStorageStatus(): Promise<StorageStatus> {
    const response = await appFetch(LOCAL_URL + '/storage');
    if (!response.ok) throw new Error(await response.text() || 'Failed to read storage usage.');
    return response.json();
}

export async function clearMatchCache(): Promise<StorageStatus> {
    const response = await appFetch(LOCAL_URL + '/storage/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'matches' }),
    });
    if (!response.ok) throw new Error(await response.text() || 'Failed to clear match cache.');
    return response.json();
}

