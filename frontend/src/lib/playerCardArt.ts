import { PlayerCardAsset } from '@/lib/types';

/** Portrait art for in-game player card slots (not wide banner). */
export function getPlayerCardPortraitUrl(card: PlayerCardAsset | undefined): string | null {
    if (!card) return null;
    return card.largeArt || card.smallArt || card.displayIcon || card.wideArt || null;
}
