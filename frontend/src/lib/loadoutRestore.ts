import type { AccountRequestScope, ApplyLoadoutRequest, PlayerLoadoutData } from '@/services/api';
import { resolveExpressions, SPRAY_TYPE_ID, SPRAY_WHEEL_SLOTS } from './spraySlots';

export type LoadoutRestorePoint = { version: 1; savedAt: number; appliedName: string; request: ApplyLoadoutRequest };
export const restoreStorageKey = (owner: AccountRequestScope) => `vantavault:loadout-restore:v1:${owner.region.toLowerCase()}:${owner.puuid.toLowerCase()}`;

/** Restore only the fields this apply touches, so a weapon undo leaves everything else alone. */
export function captureLoadoutRestore(before: PlayerLoadoutData, change: ApplyLoadoutRequest, appliedName: string): LoadoutRestorePoint {
    const request: ApplyLoadoutRequest = { loadout: {} };
    for (const id of Object.keys(change.loadout)) {
        const item = before.loadout[id];
        if (!item?.skinId || !item.skinLevelId || !item.chromaId) throw new Error('Your previous equipment could not be saved. Refresh your loadout and try again.');
        request.loadout[id] = { ...item };
    }
    if (change.identity?.playerCardId || change.identity?.playerTitleId) {
        if (!before.identity?.playerCardId || !before.identity.playerTitleId) throw new Error('Your previous player card and title could not be saved. Refresh your loadout and try again.');
        request.identity = {
            playerCardId: change.identity.playerCardId ? before.identity.playerCardId : '',
            playerTitleId: change.identity.playerTitleId ? before.identity.playerTitleId : '',
        };
    }
    const wheel = resolveExpressions(before.expressions, before.sprays, before.flexes);
    const updates = change.expressions ?? [...resolveExpressions([], change.sprays ?? []), ...(change.flexes ?? [])];
    if (updates.length) {
        request.expressions = updates.filter(update => update.typeId && update.assetId).map(update => {
            const legacyIndex = SPRAY_WHEEL_SLOTS.findIndex(slot => slot.id.toLowerCase() === update.typeId.toLowerCase());
            const typeId = legacyIndex < 0 ? update.typeId : SPRAY_TYPE_ID;
            const candidates = wheel.filter(item => item.typeId.toLowerCase() === typeId.toLowerCase());
            const position = update.slotIndex ?? (legacyIndex >= 0 ? legacyIndex : candidates.length === 1 ? candidates[0].slotIndex : undefined);
            const old = position === undefined ? undefined : wheel.find(item => item.slotIndex === position);
            if (!old?.typeId || !old.assetId) throw new Error('Your previous expression wheel could not be saved. Refresh your loadout and try again.');
            return { ...old };
        });
    }
    return { version: 1, savedAt: Date.now(), appliedName, request };
}

export function readLoadoutRestore(owner: AccountRequestScope | null): LoadoutRestorePoint | null {
    if (!owner || typeof localStorage === 'undefined') return null;
    try {
        const point = JSON.parse(localStorage.getItem(restoreStorageKey(owner)) || 'null') as LoadoutRestorePoint | null;
        if (!point || point.version !== 1 || !Number.isFinite(point.savedAt) || typeof point.appliedName !== 'string' || !point.request?.loadout || typeof point.request.loadout !== 'object' || Array.isArray(point.request.loadout)) return null;
        const items = Object.values(point.request.loadout);
        if (items.some(item => !item || typeof item.skinId !== 'string' || typeof item.skinLevelId !== 'string' || typeof item.chromaId !== 'string')) return null;
        if (point.request.identity && (typeof point.request.identity.playerCardId !== 'string' || typeof point.request.identity.playerTitleId !== 'string')) return null;
        if (point.request.expressions && (!Array.isArray(point.request.expressions) || point.request.expressions.some(item => !item || typeof item.typeId !== 'string' || typeof item.assetId !== 'string' || !Number.isInteger(item.slotIndex)))) return null;
        return point;
    } catch { return null; }
}

export function writeLoadoutRestore(owner: AccountRequestScope, point: LoadoutRestorePoint | null) {
    if (point) localStorage.setItem(restoreStorageKey(owner), JSON.stringify(point));
    else localStorage.removeItem(restoreStorageKey(owner));
}
