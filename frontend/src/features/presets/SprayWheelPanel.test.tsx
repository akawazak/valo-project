import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/context/DataContext', () => ({ useData: () => ({
    ownedSprayIDs: [],
    sprays: [{ uuid: 'spray', displayName: 'Equipped spray', displayIcon: '/spray.png' }],
    flexes: [{ uuid: 'flex', displayName: 'STAT-COM Flex', displayIcon: '/flex.png' }],
}) }));
vi.mock('@/lib/spraySlots', () => import('../../lib/spraySlots'));
vi.mock('@/components/ResilientAssetImage', () => import('../../components/ResilientAssetImage'));
import SprayWheelPanel from './SprayWheelPanel';
import { FLEX_TYPE_ID, SPRAY_TYPE_ID } from '../../lib/spraySlots';

it('renders Flex and sprays in their own wheel positions and marks uncatalogued equipment', () => {
    const markup = renderToStaticMarkup(createElement(SprayWheelPanel, {
        currentSprays: [], onUpdateSprays: () => {}, currentExpressions: [
            { typeId: FLEX_TYPE_ID, assetId: 'flex', slotIndex: 0 },
            { typeId: SPRAY_TYPE_ID, assetId: 'spray', slotIndex: 1 },
            { typeId: SPRAY_TYPE_ID, assetId: 'missing-artwork', slotIndex: 2 },
        ],
    }));
    expect(markup).toContain('Slot 1: STAT-COM Flex');
    expect(markup).toContain('Slot 2: Equipped spray');
    expect(markup).toContain('Slot 3: Equipped expression (artwork unavailable)');
    expect(markup).toContain('Slot 4 (Empty)');
    expect(markup).not.toContain('Pre-Round');
    expect(markup).toContain('>Equipped</span>');
});
