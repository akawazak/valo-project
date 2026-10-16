import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ current: true, apply: vi.fn(), sound: vi.fn(), capture: vi.fn(), get: vi.fn() }));
vi.mock('@/services/api', () => ({ applyLoadout: mocks.apply, captureAccountRequest: mocks.capture, getPlayerLoadoutData: mocks.get }));
vi.mock('@/lib/errors', () => import('../lib/errors'));
vi.mock('@/lib/uiSounds', () => ({ playUiSound: mocks.sound }));
import { useLoadout } from './useLoadout';
import { readLoadoutRestore, writeLoadoutRestore, captureLoadoutRestore } from '../lib/loadoutRestore';

const owner = { puuid: 'synthetic-owner', region: 'eu' };
const item = { skinId: 'old', skinLevelId: 'level', chromaId: 'silver' };
const before = { loadout: { vandal: item }, sprays: [], flexes: [], expressions: [] };
const request = { loadout: { vandal: { ...item, skinId: 'new' } } };
function captureHook() {
    let hook!: ReturnType<typeof useLoadout>;
    function Capture() { hook = useLoadout(); return null; }
    renderToStaticMarkup(React.createElement(Capture));
    return hook;
}
beforeEach(() => {
    vi.clearAllMocks();
    mocks.current = true;
    mocks.capture.mockReturnValue({ owner, isCurrent: () => mocks.current });
    mocks.get.mockResolvedValue(before);
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});

it.each(['resolve', 'reject'])('ignores a stale Apply %s after the selected account changes', async outcome => {
    let resolve!: () => void, reject!: (error: Error) => void;
    mocks.apply.mockReturnValueOnce(new Promise<void>((ok, fail) => { resolve = ok; reject = fail; }));
    const applying = captureHook().handleApplyLoadout(request, 'Synthetic preset');
    await vi.waitFor(() => expect(mocks.apply).toHaveBeenCalledWith(request, owner));
    mocks.current = false;
    if (outcome === 'resolve') resolve(); else reject(new Error('old account failure'));
    await expect(applying).resolves.toBe(false);
    expect(mocks.sound).not.toHaveBeenCalled();
    expect(Boolean(readLoadoutRestore(owner))).toBe(outcome === 'resolve');
});

it('reports a completed Apply for the same account', async () => {
    mocks.apply.mockResolvedValueOnce(undefined);
    await expect(captureHook().handleApplyLoadout(request, 'Synthetic preset')).resolves.toBe(true);
    expect(mocks.sound).toHaveBeenCalledWith('success');
});

it('keeps the previous restore on failed apply, and keeps a failed restore retryable', async () => {
    const point = captureLoadoutRestore(before, request, 'Earlier');
    writeLoadoutRestore(owner, point);
    mocks.apply.mockRejectedValueOnce(new Error('offline'));
    await expect(captureHook().handleApplyLoadout(request, 'New')).resolves.toBe(false);
    expect(readLoadoutRestore(owner)).toEqual(point);
    mocks.apply.mockRejectedValueOnce(new Error('offline'));
    await expect(captureHook().handleRestoreLoadout()).resolves.toBe(false);
    expect(readLoadoutRestore(owner)).toEqual(point);
    mocks.apply.mockResolvedValueOnce(undefined);
    await expect(captureHook().handleRestoreLoadout()).resolves.toBe(true);
    expect(mocks.apply).toHaveBeenLastCalledWith(point.request, owner);
    expect(readLoadoutRestore(owner)).toBeNull();
});

it('blocks duplicate dispatches and cancels before sending if the account changes during capture', async () => {
    let resolve!: (value: typeof before) => void;
    mocks.get.mockReturnValueOnce(new Promise(ok => { resolve = ok; }));
    const hook = captureHook();
    const first = hook.handleApplyLoadout(request, 'One');
    await expect(hook.handleApplyLoadout(request, 'Two')).resolves.toBe(false);
    mocks.current = false;
    resolve(before);
    await expect(first).resolves.toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(readLoadoutRestore(owner)).toBeNull();
});

it('does not change equipment when the recovery snapshot cannot be persisted', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
    await expect(captureHook().handleApplyLoadout(request, 'New')).resolves.toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
});
