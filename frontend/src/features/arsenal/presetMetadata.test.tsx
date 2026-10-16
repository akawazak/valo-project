import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preset } from '../../lib/types';

const fixtures = vi.hoisted(() => ({
    stateIndex: 0,
    initialStates: new Map<number, unknown>(),
    cardPanel: vi.fn(), sprayPanel: vi.fn(), mobileSpray: vi.fn(),
    data: {
        loading: false, weapons: [], agents: [], sprays: [],
        ownedAgentIDs: [], ownedCardIDs: [], ownedTitleIDs: [], ownedSprayIDs: [],
        playerCards: [{ uuid: 'parent-card', displayName: 'Parent card', smallArt: '/parent-card.png', wideArt: '/parent-wide.png' }],
        playerTitles: [{ uuid: 'parent-title', displayName: 'Parent title', titleText: 'Big Guy' }],
    },
}));
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
vi.mock('@/context/DataContext', () => ({ useData: () => fixtures.data }));
vi.mock('@/lib/effectivePreset', () => import('../../lib/effectivePreset'));
vi.mock('@/lib/contentTiers', () => import('../../lib/contentTiers'));
vi.mock('@/lib/gameMeta', () => ({ weaponCategoryKey: () => '' }));
vi.mock('@/lib/spraySlots', () => import('../../lib/spraySlots'));
vi.mock('@/lib/presetShare', () => ({ exportPreset: vi.fn(), importPreset: vi.fn() }));
vi.mock('@/services/api', () => ({
    applyLoadout: vi.fn(), captureAccountRequest: vi.fn(), getPlayerLoadoutData: vi.fn(), getPresets: vi.fn(), savePresets: vi.fn(),
}));
vi.mock('@/features/gun-skins/WeaponCard', () => ({ default: () => null }));
vi.mock('@/features/gun-skins/UnifiedSkinSelectorModal', () => ({ default: () => null }));
vi.mock('@/features/presets/PresetAgentStrip', () => ({ default: () => null }));
vi.mock('@/features/agents/AgentSelectionModal', () => ({ default: () => null }));
vi.mock('@/features/presets/PlayerCardPanel', () => ({ default: (props: unknown) => { fixtures.cardPanel(props); return null; } }));
vi.mock('@/features/presets/SprayWheelPanel', () => ({ default: (props: unknown) => { fixtures.sprayPanel(props); return null; } }));
vi.mock('@/features/presets/PresetList', () => import('../presets/PresetList'));
vi.mock('../../mobile/MobileArsenalV2', () => ({ MobileWeaponEditor: () => null }));
vi.mock('../../mobile/MobileKit', () => ({
    MobileBackHeader: () => null, MobileDataLoading: () => null, MobileGameImage: () => null,
    MobileIcon: () => null, MobilePageHeader: () => null, MobileSectionHeader: () => null, MobileSheetLayer: () => null,
    MobileSprayWheel: (props: unknown) => { fixtures.mobileSpray(props); return null; },
    skinForLoadout: vi.fn(), skinRenderSources: vi.fn(),
}));
import ArsenalView from './ArsenalView';
import { PresetCard } from '../presets/PresetList';
import MobilePresetsV2 from '../../mobile/MobilePresetsV2';
import { buildPresetApplyRequest } from '../../lib/effectivePreset';
import { SPRAY_WHEEL_SLOTS } from '../../lib/spraySlots';

const parent: Preset = {
    uuid: 'parent', name: 'Parent', loadout: {}, agents: [],
    identity: { playerCardId: 'parent-card', playerTitleId: 'parent-title' },
    sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[0].id, sprayId: 'parent-spray' }],
    flexes: [{ typeId: 'flex-slot', assetId: 'parent-flex' }],
};
const child: Preset = { uuid: 'child', parentUuid: parent.uuid, name: 'Child', loadout: {}, agents: [] };
const presets = [parent, child];
const noop = () => {};
const props: ComponentProps<typeof ArsenalView> = {
    weapons: [], currentLoadout: {}, ownedLevelIDs: [], ownedChromaIDs: [], contentTiers: [],
    onSkinSelect: noop, onBuddySelect: noop, onSkinReset: noop, presets,
    selectedPreset: child, defaultPreset: { uuid: 'default-preset', name: 'Current', loadout: {}, agents: [] },
    onPresetSelect: noop, onPresetApply: noop, onPresetDelete: noop, onPresetRename: noop,
    onCreateVariant: noop, onTogglePreset: noop, onExportPreset: noop, onImportPresetClick: noop, onNewPreset: noop,
    agents: [], allAgents: [], ownedAgentIds: [], isEditing: false, editingPreset: null,
    onSave: noop, onCancel: noop, onSaveAsNew: noop, onApply: noop, onApplyWeapon: async () => true,
    onAgentAssignment: noop,
    gameIdentity: { playerCardId: 'unrelated-live-card', playerTitleId: 'unrelated-live-title' },
    gameSprays: [{ equipSlotId: 'live-slot', sprayId: 'unrelated-live-spray' }],
};

beforeEach(() => {
    fixtures.stateIndex = 0;
    fixtures.initialStates.clear();
    vi.clearAllMocks();
});

describe('variant metadata previews match Apply', () => {
    it.each([child, { ...child, sprays: [], flexes: [] }])('renders inherited card, title, sprays and flexes in the desktop saved editor', (preset) => {
        fixtures.initialStates.set(1, true); // Open the saved editor for this SSR render.
        renderToStaticMarkup(createElement(ArsenalView, { ...props, selectedPreset: preset }));
        const request = buildPresetApplyRequest(preset, presets);
        expect(fixtures.cardPanel).toHaveBeenCalledWith(expect.objectContaining({
            currentCardId: request.identity?.playerCardId, currentTitleId: request.identity?.playerTitleId,
        }));
        expect(fixtures.sprayPanel).toHaveBeenCalledWith(expect.objectContaining({
            currentSprays: request.sprays, currentFlexes: request.flexes,
        }));
        expect(request.identity).toEqual(parent.identity);
    });

    it('shows the inherited player card in a saved child card preview', () => {
        const html = renderToStaticMarkup(createElement(PresetCard, {
            preset: child, allPresets: presets, agents: [], isSelected: false,
            onSelect: noop, onApply: noop, onRename: noop, onDelete: noop, onToggle: noop,
        }));
        expect(html).toContain('alt="Parent card"');
        expect(html).toContain('src="/parent-card.png"');
    });

    it('keeps explicit child metadata instead of replacing it with parent or current data', () => {
        const override: Preset = {
            ...child, identity: { playerCardId: 'child-card', playerTitleId: '' },
            sprays: [{ equipSlotId: 'child-slot', sprayId: 'child-spray' }],
        };
        fixtures.initialStates.set(1, true);
        renderToStaticMarkup(createElement(ArsenalView, { ...props, selectedPreset: override }));
        expect(fixtures.cardPanel).toHaveBeenCalledWith(expect.objectContaining({ currentCardId: 'child-card', currentTitleId: '' }));
        expect(fixtures.sprayPanel).toHaveBeenCalledWith(expect.objectContaining({ currentSprays: override.sprays }));
    });

    it('renders inherited mobile identity and spray selection for a raw child draft', () => {
        fixtures.initialStates.set(0, presets);
        fixtures.initialStates.set(2, child.uuid);
        fixtures.initialStates.set(3, child);
        const html = renderToStaticMarkup(createElement(MobilePresetsV2));
        expect(html).toContain('Parent card');
        expect(html).toContain('Big Guy');
        expect(fixtures.mobileSpray).toHaveBeenCalledWith(expect.objectContaining({
            slots: expect.arrayContaining([expect.objectContaining({ equipped: parent.sprays![0] })]),
        }));
    });
});
