import { describe, expect, it, vi } from 'vitest';
import type { Preset } from './types';
import { exportPreset, importPreset } from './presetShare';

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const gun = id('1');
const parent: Preset = {
    uuid: id('2'), name: 'Parent', loadout: { [gun]: { skinId: id('3'), skinLevelId: id('4'), chromaId: id('5') } },
    identity: { playerCardId: id('6'), playerTitleId: id('7') },
    sprays: [{ equipSlotId: id('8'), sprayId: id('9') }],
};
const encode = (value: unknown) => btoa(JSON.stringify(value));

describe('portable presets', () => {
    it('exports a child as a standalone effective snapshot including parent identity and sprays', () => {
        const child: Preset = { uuid: id('a'), parentUuid: parent.uuid, name: 'Child', loadout: {} };
        expect(importPreset(exportPreset(child, [parent, child]))).toMatchObject({
            name: 'Child', loadout: parent.loadout, identity: parent.identity, sprays: parent.sprays,
        });
        expect(importPreset(exportPreset(child, [parent, child]))).not.toHaveProperty('parentUuid');
    });

    it('resolves all ancestors and preserves child overrides', () => {
        const child: Preset = { uuid: id('a'), parentUuid: parent.uuid, name: 'Child', loadout: {} };
        const leaf: Preset = { uuid: id('b'), parentUuid: child.uuid, name: 'Leaf', loadout: { [gun]: { ...parent.loadout[gun], chromaId: id('c') } } };
        expect(importPreset(exportPreset(leaf, [parent, child, leaf]))).toMatchObject({
            loadout: { [gun]: { chromaId: id('c') } }, identity: parent.identity, sprays: parent.sprays,
        });
    });

    it('round-trips Unicode names', () => {
        expect(importPreset(exportPreset({ ...parent, name: '夜 🐈 العربية' })).name).toBe('夜 🐈 العربية');
    });

    it('rejects a missing or circular parent instead of silently exporting an incomplete loadout', () => {
        expect(() => exportPreset({ ...parent, parentUuid: 'missing' }, [])).toThrow('parent preset is unavailable');
        expect(() => exportPreset({ ...parent, parentUuid: parent.uuid }, [parent])).toThrow('circular');
    });
});

describe('import validation', () => {
    it.each([
        null, [], 3,
        { name: 'Bad', loadout: null },
        { name: 3, loadout: {} },
        { loadout: { [gun]: null } },
        { loadout: { [gun]: { skinId: 3, skinLevelId: id('4'), chromaId: id('5') } } },
        { loadout: {}, agents: ['not-an-id'] },
        { loadout: {}, identity: { playerCardId: id('6'), playerTitleId: 3 } },
        { loadout: {}, sprays: [{ equipSlotId: id('8'), sprayId: null }] },
        { loadout: {}, expressions: 'bad' },
    ])('rejects malformed nested preset contents: %j', value => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => importPreset(encode(value))).toThrow('Invalid preset code format.');
        warning.mockRestore();
    });

    it('accepts intentional empty identity and empty arrays', () => {
        expect(importPreset(encode({ name: 'Empty', loadout: {}, identity: { playerCardId: '', playerTitleId: '' }, agents: [], sprays: [] })))
            .toMatchObject({ identity: { playerCardId: '', playerTitleId: '' }, loadout: {}, agents: [], sprays: [] });
    });
});
