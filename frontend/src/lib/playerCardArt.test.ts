import { expect, it } from 'vitest';
import { getPlayerLevelBorder } from './playerCardArt';

it('uses the chosen border, real catalog thresholds and neutral fallback for unknown selections', () => {
    const borders = [{ uuid: 'level-80', startingLevel: 80 }, { uuid: 'level-1', startingLevel: 1 }, { uuid: 'level-20', startingLevel: 20 }];
    expect(getPlayerLevelBorder(borders, 19)?.uuid).toBe('level-1');
    expect(getPlayerLevelBorder(borders, 20)?.uuid).toBe('level-20');
    expect(getPlayerLevelBorder(borders, 88)?.uuid).toBe('level-80');
    expect(getPlayerLevelBorder(borders, 500)?.uuid).toBe('level-80');
    expect(getPlayerLevelBorder(borders, 88, 'LEVEL-20')?.uuid).toBe('level-20');
    expect(getPlayerLevelBorder(borders, 88, '00000000-0000-0000-0000-000000000000')?.uuid).toBe('level-80');
    expect(getPlayerLevelBorder(borders, 88, 'unknown-equipped-border')).toBeUndefined();
    expect(getPlayerLevelBorder(borders, 0)).toBeUndefined();
    expect(getPlayerLevelBorder(borders, Number.NaN)).toBeUndefined();
    expect(getPlayerLevelBorder([], 88)).toBeUndefined();
});
