import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadoutItemV1, Preset } from '../lib/types';
import type { GameLoadoutMeta } from '../lib/effectivePreset';
import type { AccountRequestScope } from '../services/api';

// Run the actual hook with deterministic state/effect scheduling. Deferred API
// promises can finish between renders without requiring a browser dependency.
const harness = vi.hoisted(() => {
    type Slot = { value: unknown; deps?: readonly unknown[] };
    const slots = new Map<number, Slot>();
    let cursor = 0;
    let changed = false;
    let effects: Array<() => unknown> = [];
    const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) =>
        Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
    const slot = (initial: () => unknown) => {
        const index = cursor++;
        if (!slots.has(index)) slots.set(index, { value: initial() });
        return slots.get(index)!;
    };
    const memo = <T,>(factory: () => T, deps: readonly unknown[]): T => {
        const current = slot(() => undefined);
        if (!sameDeps(current.deps, deps)) {
            current.value = factory();
            current.deps = deps;
        }
        return current.value as T;
    };
    return {
        reset: () => { slots.clear(); cursor = 0; effects = []; changed = false; },
        begin: () => { cursor = 0; changed = false; },
        flush: () => { const pending = effects; effects = []; pending.forEach(effect => effect()); return changed; },
        useState: <T,>(initial: T | (() => T)) => {
            const current = slot(() => typeof initial === 'function' ? (initial as () => T)() : initial);
            return [current.value as T, (next: T | ((previous: T) => T)) => {
                const value = typeof next === 'function' ? (next as (previous: T) => T)(current.value as T) : next;
                if (!Object.is(value, current.value)) changed = true;
                current.value = value;
            }] as const;
        },
        useRef: <T,>(initial: T) => slot(() => ({ current: initial })).value as { current: T },
        useEffect: (effect: () => unknown, deps: readonly unknown[]) => {
            const current = slot(() => undefined);
            if (!sameDeps(current.deps, deps)) { current.deps = deps; effects.push(effect); }
        },
        useMemo: memo,
        useCallback: <T,>(callback: T, deps: readonly unknown[]) => memo(() => callback, deps),
    };
});
const api = vi.hoisted(() => ({ loadout: vi.fn(), save: vi.fn() }));
vi.mock('react', () => harness);
vi.mock('@/services/api', () => ({ getPlayerLoadoutData: api.loadout, savePresets: api.save }));
vi.mock('@/lib/effectivePreset', () => import('../lib/effectivePreset'));
vi.mock('@/lib/presetShare', () => import('../lib/presetShare'));
import { defaultPreset, NamingMode, usePresets } from './usePresets';
import { FLEX_TYPE_ID, SPRAY_TYPE_ID, SPRAY_WHEEL_SLOTS } from '../lib/spraySlots';

const item = (skinId: string): LoadoutItemV1 => ({ skinId, skinLevelId: 'level', chromaId: 'chroma' });
const ownerA = { puuid: 'owner-a', region: 'eu' };
const ownerB = { puuid: 'owner-b', region: 'na' };
const presetA: Preset = { uuid: 'preset-a', name: 'A', loadout: { gun: item('a') }, agents: ['agent-a'] };
const metaA = { sprays: [], identity: { playerCardId: 'card-a', playerTitleId: 'title-a' } };
const onError = vi.fn();
type Props = { presets: Preset[]; loadout: Record<string, LoadoutItemV1>; meta: GameLoadoutMeta; revision: number; owner: AccountRequestScope | null };
let props: Props;
function render() {
    for (let renderCount = 0; renderCount < 20; renderCount++) {
        harness.begin();
        // eslint-disable-next-line react-hooks/rules-of-hooks -- One actual hook invocation per controlled test render.
        const hook = usePresets(props.presets, props.loadout, onError, props.meta, props.revision, props.owner);
        if (!harness.flush()) return hook;
    }
    throw new Error('Hook did not settle.');
}
function switchOwner(owner: AccountRequestScope) {
    props = { owner, presets: [], loadout: {}, meta: { sprays: [] }, revision: props.revision + 1 };
    return render();
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    return { promise, resolve, reject };
}
async function editSavedPreset() {
    let hook = render();
    await hook.handlePresetSelect(presetA);
    hook = render();
    hook.handleItemChange('gun', { skinId: 'edited-a' });
    return render();
}
beforeEach(() => {
    harness.reset();
    vi.clearAllMocks();
    api.save.mockResolvedValue(undefined);
    api.loadout.mockResolvedValue({ loadout: { gun: item('a') }, ...metaA, flexes: [], expressions: [] });
    props = { owner: ownerA, presets: [presetA], loadout: { gun: item('a') }, meta: metaA, revision: 1 };
});

it('keeps unified expression changes and both legacy projections together through save', async () => {
    let hook = render();
    await hook.handlePresetSelect(presetA);
    hook = render();
    const expressions = [
        { typeId: FLEX_TYPE_ID, assetId: 'new-flex', slotIndex: 0 },
        { typeId: SPRAY_TYPE_ID, assetId: 'remaining-spray', slotIndex: 1 },
        { typeId: 'future-category', assetId: 'untouched-expression', slotIndex: 3 },
    ];
    hook.handleExpressionsChange(expressions);
    hook = render();
    expect(hook.editingPreset?.expressions).toEqual(expressions);
    expect(hook.editingPreset?.flexes).toEqual([expressions[0]]);
    expect(hook.editingPreset?.sprays).toEqual([{ equipSlotId: SPRAY_WHEEL_SLOTS[1].id, sprayId: 'remaining-spray' }]);
    await hook.handleSave();
    const saved = render().selectedPreset!;
    expect(saved.expressions).toEqual(expressions);
    expect(api.save).toHaveBeenCalledWith([saved], ownerA);
});

it('preserves saved legacy sprays when a weapon edit starts beside a different live expression wheel', async () => {
    const legacy: Preset = { ...presetA, sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[2].id, sprayId: 'saved-spray' }] };
    props.presets = [legacy];
    props.meta = { sprays: [{ equipSlotId: SPRAY_WHEEL_SLOTS[2].id, sprayId: 'live-spray' }], expressions: [{ typeId: SPRAY_TYPE_ID, assetId: 'live-spray', slotIndex: 2 }] };
    let hook = render();
    await hook.handlePresetSelect(legacy);
    hook = render();
    hook.handleItemChange('gun', { skinId: 'weapon-edit' });
    hook = render();
    expect(hook.editingPreset?.expressions).toEqual([{ typeId: SPRAY_TYPE_ID, assetId: 'saved-spray', slotIndex: 2 }]);
    await hook.handleSave();
    expect(render().selectedPreset?.expressions?.[0].assetId).toBe('saved-spray');
});

describe('account-owned preset operations', () => {
    it('resets the previous owner draft, selection and dialogs and ignores its old apply callback', async () => {
        let hook = await editSavedPreset();
        hook.handleOpenPresetNameModal(NamingMode.SaveAsNew);
        hook.handlePresetDelete(presetA.uuid);
        hook = render();
        expect(hook.isEditing).toBe(true);
        expect(hook.showConfirmationModal).toBe(true);
        const oldApplyComplete = hook.handleApplyComplete;
        hook = switchOwner(ownerB);
        oldApplyComplete(presetA);
        hook = render();
        expect(hook.presets).toEqual([]);
        expect(hook.currentLoadout).toEqual({});
        expect(hook.selectedPreset?.uuid).toBe(defaultPreset.uuid);
        expect(hook.isEditing).toBe(false);
        expect(hook.editingPreset).toBeNull();
        expect(hook.originalPreset).toBeNull();
        expect(hook.showPresetNameModal).toBe(false);
        expect(hook.showConfirmationModal).toBe(false);
        expect(hook.gameMeta).toEqual({ sprays: [] });
    });

    it('binds a pending save to A and discards its completion after switching to B', async () => {
        const pending = deferred<void>();
        api.save.mockReturnValueOnce(pending.promise);
        const hookA = await editSavedPreset();
        const saving = hookA.handleSave();
        expect(api.save).toHaveBeenCalledWith(expect.any(Array), ownerA);
        switchOwner(ownerB);
        pending.resolve();
        await saving;
        const hookB = render();
        expect(hookB.presets).toEqual([]);
        expect(hookB.currentLoadout).toEqual({});
        expect(hookB.selectedPreset?.uuid).toBe(defaultPreset.uuid);
        expect(onError).not.toHaveBeenCalled();
    });

    it('does not save an old creation after its loadout read completes, even after A → B → A', async () => {
        const pending = deferred<{ loadout: Record<string, LoadoutItemV1>; sprays: [] }>();
        api.loadout.mockReturnValueOnce(pending.promise);
        const creating = render().handleSavePresetName('Old A creation');
        expect(api.loadout).toHaveBeenCalledWith(ownerA);
        switchOwner(ownerB);
        switchOwner(ownerA);
        pending.resolve({ loadout: { gun: item('old-a') }, sprays: [] });
        await creating;
        expect(api.save).not.toHaveBeenCalled();
        expect(render().currentLoadout).toEqual({});
    });

    it('ignores an old read failure after the account changes', async () => {
        const pending = deferred<never>();
        api.loadout.mockReturnValueOnce(pending.promise);
        const refresh = render().refreshFromGame();
        switchOwner(ownerB);
        pending.reject(new Error('old owner expired'));
        await expect(refresh).resolves.toBeNull();
        expect(onError).not.toHaveBeenCalled();
        expect(render().gameMeta).toEqual({ sprays: [] });
    });

    it('keeps a failed save draft editable and leaves the saved list unchanged', async () => {
        api.save.mockRejectedValueOnce(new Error('disk unavailable'));
        const hook = await editSavedPreset();
        await hook.handleSave();
        const failed = render();
        expect(failed.presets).toEqual([presetA]);
        expect(failed.editingPreset?.loadout.gun.skinId).toBe('edited-a');
        expect(failed.isEditing).toBe(true);
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk unavailable' }));
    });
});

describe('preset snapshots', () => {
    it('preserves inherited guns during a second variant edit and after clearing an override', async () => {
        const parent = { ...presetA, loadout: { first: item('first-parent'), second: item('second-parent') } };
        const child: Preset = { uuid: 'child', name: 'Child', parentUuid: parent.uuid, loadout: {} };
        props.presets = [parent, child];
        let hook = render();
        await hook.handlePresetSelect(child);
        hook = render();
        hook.handleItemChange('first', { skinId: 'override' });
        hook = render();
        hook.handleItemChange('first', { chromaId: 'changed-chroma' });
        hook = render();
        expect(hook.currentLoadout.second.skinId).toBe('second-parent');
        hook.handleItemChange('first', null);
        hook = render();
        expect(hook.currentLoadout.first.skinId).toBe('first-parent');
        expect(hook.editingPreset?.loadout).toEqual({});
    });

    it('copies current game identity when Save as Preset starts from Current Loadout', async () => {
        let hook = render();
        hook.handleOpenPresetNameModal(NamingMode.SaveAsNew);
        hook = render();
        await hook.handleSavePresetName('Current copy');
        const saved = render().selectedPreset!;
        expect(saved.identity).toEqual(metaA.identity);
        expect(saved.loadout).toEqual(props.loadout);
        expect(render().isEditing).toBe(false);
    });

    it('copies a clean selected preset agents and inherited identity instead of game metadata', async () => {
        const parent = { ...presetA, identity: { playerCardId: 'parent-card', playerTitleId: 'parent-title' } };
        const child: Preset = { uuid: 'child', name: 'Child', parentUuid: parent.uuid, loadout: {}, agents: ['child-agent'] };
        props.presets = [parent, child];
        let hook = render();
        await hook.handlePresetSelect(child);
        hook = render();
        hook.handleOpenPresetNameModal(NamingMode.SaveAsNew);
        await render().handleSavePresetName('Child copy');
        const copy = render().selectedPreset!;
        expect(copy.parentUuid).toBeUndefined();
        expect(copy.agents).toEqual(['child-agent']);
        expect(copy.identity).toEqual(parent.identity);
        expect(copy.loadout).toEqual(parent.loadout);
    });
});
