import { ExpressionSlot, IdentityV1, LoadoutItemV1, Preset, SpraySlot } from '@/lib/types';

export const DEFAULT_PRESET_ID = 'default-preset';

export type GameLoadoutMeta = {
    sprays: SpraySlot[];
    flexes?: ExpressionSlot[];
    expressions?: ExpressionSlot[];
    identity?: IdentityV1;
};

export type PresetApplyRequest = {
    loadout: Record<string, LoadoutItemV1>;
    identity?: IdentityV1;
    sprays?: SpraySlot[];
    flexes?: ExpressionSlot[];
    expressions?: ExpressionSlot[];
};

/** Build the exact payload shared by desktop and Android, including variant inheritance. */
export function buildPresetApplyRequest(preset: Preset, allPresets: Preset[]): PresetApplyRequest {
    const loadout = { ...preset.loadout };
    let identity = preset.identity;
    let sprays = preset.sprays;
    let flexes = preset.flexes;
    let expressions = preset.expressions;
    if (preset.parentUuid) {
        const parent = allPresets.find(item => item.uuid === preset.parentUuid);
        if (parent) {
            for (const [weaponId, item] of Object.entries(parent.loadout)) {
                if (!loadout[weaponId]) loadout[weaponId] = item;
            }
            if (!identity) identity = parent.identity;
            if (!sprays?.length) sprays = parent.sprays;
            if (!flexes?.length) flexes = parent.flexes;
            if (!expressions?.length) expressions = parent.expressions;
        }
    }
    return { loadout, identity, sprays, flexes, expressions };
}

export function effectiveSprays(preset: Preset | null | undefined, game: GameLoadoutMeta): SpraySlot[] {
    if (preset?.sprays && preset.sprays.length > 0) {
        return [...preset.sprays];
    }
    return [...game.sprays];
}

export function effectiveFlexes(preset: Preset | null | undefined, game: GameLoadoutMeta): ExpressionSlot[] {
    if (preset?.flexes && preset.flexes.length > 0) {
        return [...preset.flexes];
    }
    return [...(game.flexes ?? [])];
}

export function effectiveExpressions(preset: Preset | null | undefined, game: GameLoadoutMeta): ExpressionSlot[] {
    if (preset?.expressions && preset.expressions.length > 0) {
        return [...preset.expressions];
    }
    return [...(game.expressions ?? [])];
}

export function effectiveIdentity(preset: Preset | null | undefined, game: GameLoadoutMeta): IdentityV1 {
    const identity = (preset?.identity?.playerCardId || preset?.identity?.playerTitleId)
        ? preset.identity
        : game.identity;
    return { ...(identity ?? { playerCardId: '', playerTitleId: '' }) };
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
