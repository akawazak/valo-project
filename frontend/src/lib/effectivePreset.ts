import { IdentityV1, LoadoutItemV1, Preset, SpraySlot } from '@/lib/types';

export const DEFAULT_PRESET_ID = 'default-preset';

export type GameLoadoutMeta = {
    sprays: SpraySlot[];
    identity?: IdentityV1;
};

export function effectiveSprays(preset: Preset | null | undefined, game: GameLoadoutMeta): SpraySlot[] {
    if (preset?.sprays && preset.sprays.length > 0) {
        return preset.sprays;
    }
    return game.sprays;
}

export function effectiveIdentity(preset: Preset | null | undefined, game: GameLoadoutMeta): IdentityV1 {
    if (preset?.identity?.playerCardId || preset?.identity?.playerTitleId) {
        return preset.identity;
    }
    return game.identity ?? { playerCardId: '', playerTitleId: '' };
}

/** Merge parent preset guns with variant overrides for display and apply. */
export function mergePresetLoadout(
    preset: Preset | null | undefined,
    allPresets: Preset[],
    activeLoadout: Record<string, LoadoutItemV1>,
): Record<string, LoadoutItemV1> {
    if (!preset) return activeLoadout;
    if (preset.uuid === DEFAULT_PRESET_ID) return activeLoadout;

    if (preset.parentUuid) {
        const parent = allPresets.find(p => p.uuid === preset.parentUuid);
        return { ...(parent?.loadout ?? {}), ...activeLoadout };
    }

    return activeLoadout;
}
