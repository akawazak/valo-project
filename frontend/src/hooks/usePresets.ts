import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Preset, LoadoutItemV1, SpraySlot, ExpressionSlot } from '@/lib/types';
import { AccountRequestScope, getPlayerLoadoutData, savePresets } from '@/services/api';
import { importPreset } from '@/lib/presetShare';
import { buildPresetApplyRequest, DEFAULT_PRESET_ID, effectiveExpressions, effectiveFlexes, effectiveIdentity, effectiveSprays, GameLoadoutMeta, mergePresetLoadout } from '@/lib/effectivePreset';
import { expressionMetadata } from '../lib/spraySlots';

export enum NamingMode {
    New,
    SaveAsNew,
    Rename,
    Variant
}

export const defaultPreset: Preset = {
    uuid: DEFAULT_PRESET_ID,
    name: 'Current Loadout',
    loadout: {},
    agents: [],
};

export function usePresets(
    initialPresets: Preset[],
    initialPlayerLoadout: Record<string, LoadoutItemV1>,
    onPresetSelectError: (error: unknown) => void,
    initialGameMeta: GameLoadoutMeta = { sprays: [] },
    dataRevision = 0,
    owner: AccountRequestScope | null = null,
) {
    const [presets, setPresets] = useState<Preset[]>(initialPresets);
    const [selectedPreset, setSelectedPreset] = useState<Preset | null>(defaultPreset);
    const [isEditing, setIsEditing] = useState(false);
    const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
    const [originalPreset, setOriginalPreset] = useState<Preset | null>(null);
    const [showPresetNameModal, setShowPresetNameModal] = useState(false);
    const [dropdownPreset, setDropdownPreset] = useState<Preset | null>(null);
    const [namingMode, setNamingMode] = useState(NamingMode.New);
    const [showConfirmationModal, setShowConfirmationModal] = useState(false);
    const [presetToDelete, setPresetToDelete] = useState<Preset | null>(null);
    const [currentLoadout, setCurrentLoadout] = useState<Record<string, LoadoutItemV1>>(initialPlayerLoadout);
    const [gameLoadout, setGameLoadout] = useState<Record<string, LoadoutItemV1>>(initialPlayerLoadout);
    const [gameMeta, setGameMeta] = useState<GameLoadoutMeta>(initialGameMeta);

    const lastRevisionRef = useRef(-1);
    const isEditingRef = useRef(false);
    isEditingRef.current = isEditing;
    const ownerKey = owner ? `${owner.puuid.trim().toLowerCase()}:${owner.region}` : '';
    const ownerRef = useRef({ key: ownerKey, revision: 0 });
    if (ownerRef.current.key !== ownerKey) {
        ownerRef.current = { key: ownerKey, revision: ownerRef.current.revision + 1 };
    }
    const ownerRevision = ownerRef.current.revision;
    const isCurrentOwner = useCallback(() => Boolean(ownerKey)
        && ownerRef.current.key === ownerKey
        && ownerRef.current.revision === ownerRevision, [ownerKey, ownerRevision]);
    const displayedOwnerRef = useRef(ownerKey);

    useEffect(() => {
        if (displayedOwnerRef.current === ownerKey) return;
        displayedOwnerRef.current = ownerKey;
        // The next owner is loading. Never let the previous owner's initial
        // data or draft become the new owner's working snapshot.
        lastRevisionRef.current = dataRevision;
        isEditingRef.current = false;
        setPresets([]);
        setSelectedPreset(defaultPreset);
        setCurrentLoadout({});
        setGameLoadout({});
        setGameMeta({ sprays: [] });
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
        setShowPresetNameModal(false);
        setDropdownPreset(null);
        setNamingMode(NamingMode.New);
        setShowConfirmationModal(false);
        setPresetToDelete(null);
    }, [ownerKey, dataRevision]);

    const persistPresets = async (updatedPresets: Preset[]) => {
        if (!owner || !isCurrentOwner()) return false;
        try {
            await savePresets(updatedPresets, owner);
            if (!isCurrentOwner()) return false;
            setPresets(updatedPresets);
            return true;
        } catch (error) {
            if (isCurrentOwner()) onPresetSelectError(error);
            return false;
        }
    };

    const livePreset = useMemo<Preset>(() => ({
        ...defaultPreset,
        loadout: gameLoadout,
    }), [gameLoadout]);

    const makeEditableSnapshot = useCallback((preset: Preset): Preset => {
        const inherited = { ...preset, ...buildPresetApplyRequest(preset, presets) };
        const sprays = effectiveSprays(inherited, gameMeta);
        const flexes = effectiveFlexes(inherited, gameMeta);
        const expressions = effectiveExpressions(inherited, gameMeta);
        const identity = effectiveIdentity(inherited, gameMeta);
        return {
            ...preset,
            loadout: { ...preset.loadout },
            agents: preset.agents ? [...preset.agents] : [],
            sprays: sprays.length ? [...sprays] : undefined,
            flexes: flexes.length ? [...flexes] : undefined,
            expressions: expressions.length ? [...expressions] : undefined,
            identity: { ...identity },
        };
    }, [gameMeta, presets]);

    // Sync server data when parent reloads (account switch / refresh) without clobbering in-progress edits
    useEffect(() => {
        if (lastRevisionRef.current === dataRevision) {
            return;
        }
        lastRevisionRef.current = dataRevision;

        // Only sync when this is a NEW data revision (i.e., real reload, not first mount with empty data)
        if (dataRevision === 0) {
            return;
        }

        setPresets(initialPresets);
        setGameMeta(initialGameMeta);
        setGameLoadout(initialPlayerLoadout);

        if (isEditingRef.current) {
            return;
        }

        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);

        setSelectedPreset(prev => {
            const next =
                prev?.uuid === DEFAULT_PRESET_ID || initialPresets.some(p => p.uuid === prev?.uuid)
                    ? (prev ?? livePreset)
                    : livePreset;

            if (next.uuid === DEFAULT_PRESET_ID) {
                setCurrentLoadout(initialPlayerLoadout);
                return livePreset;
            } else {
                const fresh = initialPresets.find(p => p.uuid === next.uuid);
                setCurrentLoadout(
                    fresh
                        ? mergePresetLoadout(fresh, initialPresets, fresh.loadout)
                        : initialPlayerLoadout,
                );
            }
            return initialPresets.find(p => p.uuid === next.uuid) ?? next;
        });
    }, [dataRevision, initialPresets, initialPlayerLoadout, initialGameMeta, livePreset]);

    const refreshFromGame = useCallback(async () => {
        if (!owner || !isCurrentOwner()) return null;
        try {
            const playerData = await getPlayerLoadoutData(owner);
            if (!isCurrentOwner()) return null;
            setGameLoadout(playerData.loadout);
            setGameMeta({
                sprays: playerData.sprays,
                flexes: playerData.flexes,
                expressions: playerData.expressions,
                identity: playerData.identity,
            });

            if (!isEditingRef.current) {
                setSelectedPreset(prev => {
                    if (!prev || prev.uuid === DEFAULT_PRESET_ID) {
                        setCurrentLoadout(playerData.loadout);
                        return { ...defaultPreset, loadout: playerData.loadout };
                    }
                    return prev;
                });
            }
            return playerData;
        } catch (error) {
            if (!isCurrentOwner()) return null;
            if (!isEditingRef.current) {
                onPresetSelectError(error);
            } else {
                console.warn('refreshFromGame failed while editing; keeping current edit snapshot', error);
            }
            return null;
        }
    }, [onPresetSelectError, owner, isCurrentOwner]);

    const handleSave = async () => {
        if (!isCurrentOwner() || !editingPreset || editingPreset.uuid === DEFAULT_PRESET_ID) return;

        const updatedPresets = presets.map(p =>
            p.uuid === editingPreset.uuid ? editingPreset : p
        );
        if (!await persistPresets(updatedPresets)) return;
        setSelectedPreset(editingPreset);
        setCurrentLoadout(mergePresetLoadout(editingPreset, updatedPresets, editingPreset.loadout));
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleSavePresetName = async (name: string) => {
        if (!name || !owner || !isCurrentOwner()) return;

        const newPreset: Preset = {
            uuid: crypto.randomUUID(),
            name,
            loadout: {},
            agents: [],
        };

        switch (namingMode) {
            case NamingMode.Rename: {
                const updatedPresets = presets.map(p =>
                    p.uuid === dropdownPreset!.uuid ? { ...p, name } : p
                );
                if (!await persistPresets(updatedPresets)) return;
                setShowPresetNameModal(false);
                setDropdownPreset(null);
                return;
            }
            case NamingMode.New: {
                let fresh;
                try {
                    fresh = await getPlayerLoadoutData(owner);
                } catch (error) {
                    if (isCurrentOwner()) onPresetSelectError(error);
                    return;
                }
                if (!isCurrentOwner()) return;
                newPreset.loadout = { ...fresh.loadout };
                newPreset.agents = [];
                newPreset.identity = fresh.identity;
                newPreset.sprays = [...(fresh.sprays || [])];
                newPreset.flexes = [...(fresh.flexes || [])];
                newPreset.expressions = [...(fresh.expressions || [])];
                setGameLoadout(fresh.loadout);
                setGameMeta({
                    sprays: fresh.sprays || [],
                    flexes: fresh.flexes || [],
                    expressions: fresh.expressions || [],
                    identity: fresh.identity,
                });
                break;
            }
            case NamingMode.SaveAsNew: {
                const source = makeEditableSnapshot(editingPreset || selectedPreset || originalPreset || livePreset);
                newPreset.loadout = { ...currentLoadout };
                newPreset.agents = source.agents;
                newPreset.identity = source.identity;
                newPreset.sprays = source.sprays;
                newPreset.flexes = source.flexes;
                newPreset.expressions = source.expressions;
                break;
            }
            case NamingMode.Variant: {
                newPreset.parentUuid = editingPreset?.uuid || originalPreset?.uuid || dropdownPreset?.uuid;
                const edited: Record<string, LoadoutItemV1> = {};
                const source = editingPreset?.loadout || dropdownPreset!.loadout;
                const base = originalPreset?.loadout || dropdownPreset!.loadout;
                for (const [gun, item] of Object.entries(source)) {
                    const originalGun = base[gun];
                    if (
                        !originalGun ||
                        originalGun.skinId !== item.skinId ||
                        originalGun.chromaId !== item.chromaId ||
                        originalGun.skinLevelId !== item.skinLevelId ||
                        originalGun.charmID !== item.charmID ||
                        originalGun.charmLevelID !== item.charmLevelID
                    ) {
                        edited[gun] = item;
                    }
                }
                newPreset.loadout = edited;
                newPreset.identity = editingPreset?.identity;
                newPreset.sprays = editingPreset?.sprays;
                newPreset.flexes = editingPreset?.flexes;
                newPreset.expressions = editingPreset?.expressions;
                break;
            }
        }

        const updatedPresets = [...presets.filter(p => p.uuid !== DEFAULT_PRESET_ID), newPreset];
        if (!await persistPresets(updatedPresets)) return;
        setSelectedPreset(newPreset);
        setCurrentLoadout(mergePresetLoadout(newPreset, updatedPresets, newPreset.loadout));

        // A newly created preset is already persisted. Keep the editor clean
        // until the user actually changes a slot, identity, or agent assignment.
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);

        setShowPresetNameModal(false);
        setDropdownPreset(null);
    };

    const handlePresetSelect = async (preset: Preset) => {
        if (!owner || !isCurrentOwner()) return;
        if (isEditing) {
            setIsEditing(false);
            setEditingPreset(null);
            setOriginalPreset(null);
        }

        if (preset.uuid === DEFAULT_PRESET_ID) {
            try {
                const playerData = await getPlayerLoadoutData(owner);
                if (!isCurrentOwner()) return;
                setGameLoadout(playerData.loadout);
                setGameMeta({
                    sprays: playerData.sprays,
                    flexes: playerData.flexes,
                    expressions: playerData.expressions,
                    identity: playerData.identity,
                });
                setCurrentLoadout(playerData.loadout);
                setSelectedPreset({ ...defaultPreset, loadout: playerData.loadout });
                return;
            } catch (error) {
                if (isCurrentOwner()) onPresetSelectError(error);
                return;
            }
        } else {
            setCurrentLoadout(mergePresetLoadout(preset, presets, preset.loadout));
        }

        setSelectedPreset(preset);
    };

    const handlePresetDelete = (presetId: string) => {
        if (!isCurrentOwner()) return;
        const presetToDelete = presets.find(p => p.uuid === presetId);
        if (!presetToDelete) return;
        setPresetToDelete(presetToDelete);
        setShowConfirmationModal(true);
    };

    const handleConfirmDelete = async () => {
        if (!isCurrentOwner()) return;
        if (presetToDelete) {
            const updatedPresets = presets.filter(
                p => p.uuid !== presetToDelete.uuid && p.parentUuid !== presetToDelete.uuid
            );

            const deletingActive =
                presetToDelete.uuid === selectedPreset?.uuid ||
                presetToDelete.uuid === editingPreset?.uuid ||
                presetToDelete.uuid === originalPreset?.uuid;

            if (!await persistPresets(updatedPresets)) return;
            if (deletingActive) {
                setSelectedPreset(livePreset);
                setCurrentLoadout(gameLoadout);
                setIsEditing(false);
                setEditingPreset(null);
                setOriginalPreset(null);
            }

            setPresetToDelete(null);
        }
        setShowConfirmationModal(false);
    };

    const handleCloseConfirmationModal = () => {
        if (!isCurrentOwner()) return;
        setShowConfirmationModal(false);
        setPresetToDelete(null);
    };

    const handleCancel = () => {
        if (!isCurrentOwner()) return;
        if (originalPreset && originalPreset.uuid !== DEFAULT_PRESET_ID) {
            setSelectedPreset(originalPreset);
            setCurrentLoadout(mergePresetLoadout(originalPreset, presets, originalPreset.loadout));
        } else {
            // Default preset: revert local changes back to the live game state
            setCurrentLoadout(gameLoadout);
            setSelectedPreset({ ...defaultPreset, loadout: gameLoadout });
        }
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleApplyComplete = (appliedPreset: Preset) => {
        if (!isCurrentOwner()) return;
        const appliedLoadout = mergePresetLoadout(appliedPreset, presets, appliedPreset.loadout);
        setGameLoadout(appliedLoadout);
        setGameMeta({
            identity: appliedPreset.identity || gameMeta.identity,
            sprays: appliedPreset.sprays || gameMeta.sprays,
            flexes: appliedPreset.flexes || gameMeta.flexes,
            expressions: appliedPreset.expressions || gameMeta.expressions,
        });
        setCurrentLoadout(appliedLoadout);
        // Applying makes this the game loadout, so return to the live view
        // instead of leaving the user on the source preset.
        setSelectedPreset({
            ...defaultPreset,
            loadout: appliedLoadout,
            identity: appliedPreset.identity || gameMeta.identity,
            sprays: appliedPreset.sprays || gameMeta.sprays,
            flexes: appliedPreset.flexes || gameMeta.flexes,
            expressions: appliedPreset.expressions || gameMeta.expressions,
        });
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleApplyDraftComplete = (appliedPreset: Preset) => {
        if (!isCurrentOwner()) return;
        const appliedLoadout = mergePresetLoadout(appliedPreset, presets, appliedPreset.loadout);
        setGameLoadout(appliedLoadout);
        setGameMeta({
            identity: appliedPreset.identity || gameMeta.identity,
            sprays: appliedPreset.sprays || gameMeta.sprays,
            flexes: appliedPreset.flexes || gameMeta.flexes,
            expressions: appliedPreset.expressions || gameMeta.expressions,
        });
        // Applying a draft changes VALORANT only. The preset editor remains
        // open and unsaved until the user explicitly chooses Save.
    };

    const handleApplySingleComplete = (weaponId: string) => {
        if (!isCurrentOwner()) return;
        const item = currentLoadout[weaponId];
        if (!item) return;
        const nextLoadout = { ...gameLoadout, [weaponId]: item };
        setGameLoadout(nextLoadout);

        // A quick live apply is useful while comparing a saved preset too.
        // Keep that unsaved editor snapshot intact instead of silently
        // switching the user away from it.
        if (isEditing && editingPreset?.uuid !== DEFAULT_PRESET_ID) {
            return;
        }
        setCurrentLoadout(nextLoadout);
        setSelectedPreset({ ...defaultPreset, loadout: nextLoadout });
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleOpenPresetNameModal = (mode: NamingMode) => {
        if (!isCurrentOwner()) return;
        setNamingMode(mode);
        setShowPresetNameModal(true);
    };

    const handleOpenRenameModal = (preset: Preset) => {
        if (!isCurrentOwner()) return;
        setNamingMode(NamingMode.Rename);
        setDropdownPreset(preset);
        setShowPresetNameModal(true);
    };

    const handleDropdownVariant = (preset: Preset) => {
        if (!isCurrentOwner()) return;
        setNamingMode(NamingMode.Variant);
        setDropdownPreset(preset);
        setShowPresetNameModal(true);
    };

    const handleVariant = () => {
        if (!isCurrentOwner()) return;
        setNamingMode(NamingMode.Variant);
        setShowPresetNameModal(true);
    };

    const handleClosePresetNameModal = () => {
        if (!isCurrentOwner()) return;
        setShowPresetNameModal(false);
        setDropdownPreset(null);
    };

    const handleAgentAssignment = (agentIds: string[], isAssigned: boolean) => {
        if (!isCurrentOwner()) return;
        const base = editingPreset || selectedPreset;
        if (!base || base.uuid === DEFAULT_PRESET_ID) return;

        const applyAgentChange = (preset: Preset): Preset => {
            const updatedAgents = isAssigned
                ? [...new Set(agentIds)]
                : (preset.agents || []).filter(id => !agentIds.includes(id));
            return { ...preset, agents: updatedAgents };
        };

        if (!isEditing) {
            const snapshot = applyAgentChange(makeEditableSnapshot(base));
            setIsEditing(true);
            setOriginalPreset(base);
            setEditingPreset(snapshot);
            setSelectedPreset(null);
            setCurrentLoadout(mergePresetLoadout(snapshot, presets, snapshot.loadout));
            return;
        }

        setEditingPreset(prev => prev ? applyAgentChange(prev) : null);
    };

    const applyLoadoutChange = (
        preset: Preset,
        weaponId: string,
        changedItem: Partial<LoadoutItemV1> | null,
    ): Preset => {
        const parentPreset = preset.parentUuid
            ? presets.find(p => p.uuid === preset.parentUuid)
            : undefined;
        const baseItem =
            preset.loadout[weaponId] ??
            parentPreset?.loadout[weaponId];

        const newLoadout = { ...preset.loadout };
        if (!changedItem) {
            delete newLoadout[weaponId];
        } else if (baseItem) {
            newLoadout[weaponId] = { ...baseItem, ...changedItem };
        } else {
            newLoadout[weaponId] = changedItem as LoadoutItemV1;
        }
        return { ...preset, loadout: newLoadout };
    };

    const handleItemChange = (weaponId: string, changedItem: Partial<LoadoutItemV1> | null) => {
        if (!isCurrentOwner()) return;
        if (editingPreset) {
            const next = applyLoadoutChange(editingPreset, weaponId, changedItem);
            setEditingPreset(next);
            setCurrentLoadout(mergePresetLoadout(next, presets, next.loadout));
            return;
        }

        const preset = selectedPreset;
        if (!preset || preset.uuid === DEFAULT_PRESET_ID) {
            const newLoadout = { ...currentLoadout };
            if (!changedItem) delete newLoadout[weaponId];
            else {
                const base = currentLoadout[weaponId];
                newLoadout[weaponId] = base ? { ...base, ...changedItem } : (changedItem as LoadoutItemV1);
            }
            setCurrentLoadout(newLoadout);
            // Keep this as a temporary picker draft. The weapon modal owns
            // the only live apply action; closing it restores gameLoadout.
            setIsEditing(true);
            setOriginalPreset({ ...defaultPreset, loadout: gameLoadout });
            setEditingPreset({ ...defaultPreset, loadout: newLoadout });
            return;
        }

        let snapshot = makeEditableSnapshot(preset);
        snapshot = applyLoadoutChange(snapshot, weaponId, changedItem);
        const displayLoadout = mergePresetLoadout(snapshot, presets, snapshot.loadout);
        setIsEditing(true);
        setOriginalPreset(preset);
        setEditingPreset(snapshot);
        setSelectedPreset(null);
        setCurrentLoadout(displayLoadout);
    };

    const handleTogglePreset = async (preset: Preset, checked: boolean) => {
        if (!isCurrentOwner()) return;
        const updatedPresets = presets.map(p =>
            p.uuid === preset.uuid ? { ...p, disabled: !checked } : p
        );
        await persistPresets(updatedPresets);
    };

    const getParentPreset = (preset: Preset | null | undefined) => {
        if (!preset?.parentUuid) return undefined;
        return presets.find(p => p.uuid === preset.parentUuid);
    };

    const handleIdentityChange = (cardId: string, titleId: string) => {
        if (!isCurrentOwner()) return;
        const base = editingPreset || selectedPreset;
        if (!base) return;

        const nextIdentity = { playerCardId: cardId, playerTitleId: titleId };

        if (!isEditing) {
            const snapshot = { ...makeEditableSnapshot(base), identity: nextIdentity };
            setIsEditing(true);
            setOriginalPreset(base);
            setEditingPreset(snapshot);
            setSelectedPreset(null);
            setCurrentLoadout(mergePresetLoadout(snapshot, presets, snapshot.loadout));
            return;
        }

        setEditingPreset(prev => prev ? { ...prev, identity: nextIdentity } : null);
    };

    const handleSpraysChange = (sprays: SpraySlot[]) => {
        if (!isCurrentOwner()) return;
        const base = editingPreset || selectedPreset;
        if (!base) return;

        if (!isEditing) {
            const snapshot = { ...makeEditableSnapshot(base), sprays };
            setIsEditing(true);
            setOriginalPreset(base);
            setEditingPreset(snapshot);
            setSelectedPreset(null);
            setCurrentLoadout(mergePresetLoadout(snapshot, presets, snapshot.loadout));
            return;
        }

        setEditingPreset(prev => (prev ? { ...prev, sprays } : null));
    };

    const handleFlexesChange = (flexes: ExpressionSlot[]) => {
        if (!isCurrentOwner()) return;
        const base = editingPreset || selectedPreset;
        if (!base) return;

        if (!isEditing) {
            const snapshot = { ...makeEditableSnapshot(base), flexes };
            setIsEditing(true);
            setOriginalPreset(base);
            setEditingPreset(snapshot);
            setSelectedPreset(null);
            setCurrentLoadout(mergePresetLoadout(snapshot, presets, snapshot.loadout));
            return;
        }

        setEditingPreset(prev => (prev ? { ...prev, flexes } : null));
    };

    const handleExpressionsChange = (expressions: ExpressionSlot[]) => {
        if (!isCurrentOwner()) return;
        const base = editingPreset || selectedPreset;
        if (!base) return;
        const metadata = expressionMetadata(expressions);
        if (!isEditing) {
            const snapshot = { ...makeEditableSnapshot(base), ...metadata };
            setIsEditing(true);
            setOriginalPreset(base);
            setEditingPreset(snapshot);
            setSelectedPreset(null);
            setCurrentLoadout(mergePresetLoadout(snapshot, presets, snapshot.loadout));
            return;
        }
        setEditingPreset(prev => prev ? { ...prev, ...metadata } : null);
    };

    const handleImportPresetAction = async (presetCode: string) => {
        if (!isCurrentOwner()) return false;
        const imported = importPreset(presetCode);
        const newPreset: Preset = {
            ...imported,
            uuid: crypto.randomUUID(),
        };
        const updatedPresets = [...presets.filter(p => p.uuid !== DEFAULT_PRESET_ID), newPreset];
        if (!await persistPresets(updatedPresets)) return false;
        setSelectedPreset(newPreset);
        setCurrentLoadout(newPreset.loadout);
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
        return true;
    };

    return {
        presets,
        selectedPreset,
        isEditing,
        editingPreset,
        originalPreset,
        showPresetNameModal,
        dropdownPreset,
        namingMode,
        showConfirmationModal,
        currentLoadout,
        handleSave,
        handleSavePresetName,
        handlePresetSelect,
        handlePresetDelete,
        handleConfirmDelete,
        handleCloseConfirmationModal,
        handleCancel,
        handleApplyComplete,
        handleApplyDraftComplete,
        handleApplySingleComplete,
        handleOpenPresetNameModal,
        handleOpenRenameModal,
        handleDropdownVariant,
        handleVariant,
        handleClosePresetNameModal,
        handleTogglePreset,
        handleAgentAssignment,
        handleItemChange,
        handleIdentityChange,
        handleSpraysChange,
        handleFlexesChange,
        handleExpressionsChange,
        handleImportPresetAction,
        refreshFromGame,
        getParentPreset,
        defaultPreset: livePreset,
        gameMeta,
        NamingMode,
    };
}
