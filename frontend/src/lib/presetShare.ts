import { Preset } from './types';
import { buildPresetApplyRequest } from './effectivePreset';

/** Resolve a variant to a standalone snapshot before sharing it. */
export function resolvePresetSnapshot(preset: Preset, allPresets: Preset[]): Preset {
    const visited = new Set<string>();
    const resolve = (current: Preset): Preset => {
        if (visited.has(current.uuid)) throw new Error('This preset has a circular parent reference.');
        visited.add(current.uuid);
        if (!current.parentUuid) return current;
        const parent = allPresets.find(item => item.uuid === current.parentUuid);
        if (!parent) throw new Error('The parent preset is unavailable. Restore it before exporting this variant.');
        const resolvedParent = resolve(parent);
        return { ...current, ...buildPresetApplyRequest(current, [resolvedParent]) };
    };
    return resolve(preset);
}

/**
 * Encodes a Preset object into a safe, portable Base64 string.
 * Handles Unicode characters correctly.
 */
export function exportPreset(preset: Preset, allPresets: Preset[] = []): string {
    const snapshot = resolvePresetSnapshot(preset, allPresets);
    const exportData = {
        name: preset.name,
        loadout: snapshot.loadout,
        agents: preset.agents || [],
        identity: snapshot.identity,
        sprays: snapshot.sprays || [],
        flexes: snapshot.flexes || [],
        expressions: snapshot.expressions || [],
    };
    const json = JSON.stringify(exportData);
    
    // Safely encode unicode string to base64
    const base64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
    }));
    return base64;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isId = (value: unknown) => typeof value === 'string' && UUID.test(value);
const isOptionalId = (value: unknown) => value === undefined || value === '' || isId(value);
const validSlots = (value: unknown, first: string, second: string) => value === undefined
    || (Array.isArray(value) && value.every(slot => isRecord(slot) && isId(slot[first]) && isId(slot[second])
        && (slot.slotIndex === undefined || (Number.isInteger(slot.slotIndex) && Number(slot.slotIndex) >= 0 && Number(slot.slotIndex) < 4)))
        && new Set(value.filter(slot => slot.slotIndex !== undefined).map(slot => slot.slotIndex)).size === value.filter(slot => slot.slotIndex !== undefined).length);

export function isValidPresetTemplate(value: unknown): value is Omit<Preset, 'uuid'> {
    if (!isRecord(value) || !isRecord(value.loadout)) return false;
    if (value.name !== undefined && typeof value.name !== 'string') return false;
    if (!Object.entries(value.loadout).every(([weaponId, item]) => isId(weaponId)
        && isRecord(item)
        && isId(item.skinId) && isId(item.skinLevelId) && isId(item.chromaId)
        && isOptionalId(item.charmID) && isOptionalId(item.charmLevelID))) return false;
    if (value.agents !== undefined && (!Array.isArray(value.agents) || !value.agents.every(isId))) return false;
    if (value.disabled !== undefined && typeof value.disabled !== 'boolean') return false;
    if (value.identity !== undefined && (!isRecord(value.identity)
        || !isOptionalId(value.identity.playerCardId) || !isOptionalId(value.identity.playerTitleId)
        || typeof value.identity.playerCardId !== 'string' || typeof value.identity.playerTitleId !== 'string'
        || (value.identity.accountLevel !== undefined && (!Number.isSafeInteger(value.identity.accountLevel)
            || Number(value.identity.accountLevel) < 0)))) return false;
    return validSlots(value.sprays, 'equipSlotId', 'sprayId')
        && validSlots(value.flexes, 'typeId', 'assetId')
        && validSlots(value.expressions, 'typeId', 'assetId');
}

/**
 * Decodes a Base64 string back into a Preset template (Omit<Preset, 'uuid'>).
 * Handles Unicode characters correctly.
 */
export function importPreset(base64Str: string): Omit<Preset, 'uuid'> {
    try {
        const decodedJson = decodeURIComponent(Array.prototype.map.call(atob(base64Str), (c) => {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        const parsed = JSON.parse(decodedJson);
        if (!isValidPresetTemplate(parsed)) throw new Error('Preset contents do not match the supported format.');
        return {
            name: parsed.name || 'Imported Preset',
            loadout: parsed.loadout || {},
            agents: parsed.agents || [],
            identity: parsed.identity,
            sprays: parsed.sprays || [],
            flexes: parsed.flexes || [],
            expressions: parsed.expressions || [],
        };
    } catch (e) {
        console.warn('Failed to parse preset import string:', e instanceof Error ? e.message : String(e));
        throw new Error('Invalid preset code format.');
    }
}
