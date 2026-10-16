import { PlayerCardAsset } from '@/lib/types';

/** Portrait art for in-game player card slots (not wide banner). */
export function getPlayerCardPortraitUrl(card: PlayerCardAsset | undefined): string | null {
    if (!card) return null;
    return card.largeArt || card.smallArt || card.displayIcon || card.wideArt || null;
}

export type PlayerLevelBorder = {
    uuid: string;
    startingLevel: number;
    levelNumberAppearance?: string;
};

export function getPlayerLevelBorder(borders: PlayerLevelBorder[], accountLevel: number, preferredId?: string): PlayerLevelBorder | undefined {
    const selectedId = preferredId?.trim().toLowerCase();
    if (selectedId && selectedId !== '00000000-0000-0000-0000-000000000000') {
        return borders.find(border => border.uuid.toLowerCase() === selectedId);
    }
    if (!Number.isFinite(accountLevel) || accountLevel < 1) return undefined;
    return borders.filter(border => Number.isFinite(border.startingLevel) && border.startingLevel >= 1 && border.startingLevel <= accountLevel)
        .sort((a, b) => b.startingLevel - a.startingLevel)[0];
}
