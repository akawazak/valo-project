import { Preset } from './types';

/**
 * Encodes a Preset object into a safe, portable Base64 string.
 * Handles Unicode characters correctly.
 */
export function exportPreset(preset: Preset): string {
    const exportData = {
        name: preset.name,
        loadout: preset.loadout,
        agents: preset.agents || [],
        identity: preset.identity,
        sprays: preset.sprays || [],
        flexes: preset.flexes || [],
        expressions: preset.expressions || [],
    };
    const json = JSON.stringify(exportData);
    
    // Safely encode unicode string to base64
    const base64 = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
    }));
    return base64;
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
        console.error('Failed to parse preset import string:', e);
        throw new Error('Invalid preset code format.');
    }
}
