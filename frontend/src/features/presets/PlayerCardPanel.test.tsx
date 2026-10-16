import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({ stateIndex: 0, initialStates: new Map<number, unknown>() }));
vi.mock('react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react')>();
    return {
        ...actual,
        useState: <T,>(initial: T | (() => T)) => {
            const index = fixtures.stateIndex++;
            return actual.useState<T>(fixtures.initialStates.has(index) ? fixtures.initialStates.get(index) as T : initial);
        },
    };
});

vi.mock('@/context/DataContext', () => ({ useData: () => ({
    playerCards: [{ uuid: 'card', displayName: 'Portrait card', largeArt: '/portrait.png' }],
    playerTitles: [{ uuid: 'title', titleText: 'Big Guy' }],
}) }));
vi.mock('@/lib/playerCardArt', () => import('../../lib/playerCardArt'));
vi.mock('@/services/api', () => ({ fetchCachedPublicJson: vi.fn() }));
vi.mock('@/features/identity/IdentitySelector', () => ({ default: () => null }));
import PlayerCardPanel from './PlayerCardPanel';

beforeEach(() => {
    fixtures.stateIndex = 0;
    fixtures.initialStates.clear();
});

it('honors hidden and unavailable levels while preserving the portrait and full accessible Riot ID', () => {
    const props = { currentCardId: 'card', currentTitleId: 'title', onSelectCard: () => {}, onSelectTitle: () => {}, accountName: 'Game Name#tag' };
    const visible = renderToStaticMarkup(createElement(PlayerCardPanel, { ...props, accountLevel: 88 }));
    expect(visible).toContain('Account level 88');
    expect(visible).toContain('for Game Name#tag');
    expect(visible).toContain('>Game Name</span>');
    for (const state of [{ accountLevel: 88, hideAccountLevel: true }, {}, { accountLevel: 0 }]) {
        const markup = renderToStaticMarkup(createElement(PlayerCardPanel, { ...props, ...state }));
        expect(markup).not.toContain('Account level ');
        expect(markup).toContain('src="/portrait.png"');
        expect(markup).toContain('Big Guy');
    }
});

it('shows resolved rank artwork only for the currently displayed tier', () => {
    const props = { currentCardId: 'card', currentTitleId: 'title', onSelectCard: () => {}, onSelectTitle: () => {}, accountRank: 'Platinum 1' };
    fixtures.initialStates.set(2, { tier: 15, url: '/platinum-1.png' });
    const matching = renderToStaticMarkup(createElement(PlayerCardPanel, { ...props, accountRankTier: 15 }));
    expect(matching).toContain('src="/platinum-1.png"');
    expect(matching).toContain('aria-label="Platinum 1"');

    fixtures.stateIndex = 0;
    const changed = renderToStaticMarkup(createElement(PlayerCardPanel, { ...props, accountRank: 'Diamond 1', accountRankTier: 18 }));
    expect(changed).not.toContain('/platinum-1.png');
    expect(changed).not.toContain('player-card-portrait-rank');
    expect(changed).toContain('src="/portrait.png"');
});
