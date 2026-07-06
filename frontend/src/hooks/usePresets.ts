import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Preset, LoadoutItemV1, SpraySlot } from '@/lib/types';
import { getPlayerLoadoutData, savePresets } from '@/services/api';
import { importPreset } from '@/lib/presetShare';
import { DEFAULT_PRESET_ID, effectiveIdentity, effectiveSprays, GameLoadoutMeta, mergePresetLoadout } from '@/lib/effectivePreset';

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

    const livePreset = useMemo<Preset>(() => ({
        ...defaultPreset,
        loadout: gameLoadout,
    }), [gameLoadout]);

    const makeEditableSnapshot = useCallback((preset: Preset): Preset => {
        const sprays = effectiveSprays(preset, gameMeta);
        const identity = effectiveIdentity(preset, gameMeta);
        return {
            ...preset,
            loadout: { ...preset.loadout },
            agents: preset.agents ? [...preset.agents] : [],
            sprays: sprays.length ? [...sprays] : undefined,
            identity: { ...identity },
        };
    }, [gameMeta]);

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
            return next;
        });
    }, [dataRevision, initialPresets, initialPlayerLoadout, initialGameMeta, livePreset]);

    const refreshFromGame = useCallback(async () => {
        try {
            const playerData = await getPlayerLoadoutData();
            setGameLoadout(playerData.loadout);
            setGameMeta({ sprays: playerData.sprays, identity: playerData.identity });

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
            if (!isEditingRef.current) {
                onPresetSelectError(error);
            } else {
                console.warn('refreshFromGame failed while editing; keeping current edit snapshot', error);
            }
            return null;
        }
    }, [onPresetSelectError]);

    const handleSave = async () => {
        if (!editingPreset || editingPreset.uuid === DEFAULT_PRESET_ID) return;

        const updatedPresets = presets.map(p =>
            p.uuid === editingPreset.uuid ? editingPreset : p
        );
        setPresets(updatedPresets);
        await savePresets(updatedPresets);
        setSelectedPreset(editingPreset);
        setCurrentLoadout(mergePresetLoadout(editingPreset, updatedPresets, editingPreset.loadout));
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleSavePresetName = async (name: string) => {
        if (!name) return;

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
                setPresets(updatedPresets);
                await savePresets(updatedPresets);
                setShowPresetNameModal(false);
                setDropdownPreset(null);
                return;
            }
            case NamingMode.New: {
                const fresh = await getPlayerLoadoutData();
                newPreset.loadout = { ...fresh.loadout };
                newPreset.agents = [];
                newPreset.identity = fresh.identity;
                newPreset.sprays = [...(fresh.sprays || [])];
                setGameLoadout(fresh.loadout);
                setGameMeta({ sprays: fresh.sprays || [], identity: fresh.identity });
                break;
            }
            case NamingMode.SaveAsNew:
                newPreset.loadout = { ...currentLoadout };
                newPreset.agents = editingPreset?.agents || originalPreset?.agents || [];
                newPreset.identity = editingPreset?.identity || originalPreset?.identity;
                newPreset.sprays = editingPreset?.sprays || originalPreset?.sprays || [...gameMeta.sprays];
                break;
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
                break;
            }
        }

        const updatedPresets = [...presets.filter(p => p.uuid !== DEFAULT_PRESET_ID), newPreset];
        setPresets(updatedPresets);
        await savePresets(updatedPresets);
        setSelectedPreset(newPreset);
        setCurrentLoadout(newPreset.loadout);

        if (namingMode === NamingMode.New || namingMode === NamingMode.SaveAsNew) {
            setIsEditing(true);
            setEditingPreset({ ...newPreset });
            setOriginalPreset({ ...newPreset });
        } else {
            setIsEditing(false);
            setEditingPreset(null);
            setOriginalPreset(null);
        }

        setShowPresetNameModal(false);
        setDropdownPreset(null);
    };

    const handlePresetSelect = async (preset: Preset) => {
        if (isEditing) {
            setIsEditing(false);
            setEditingPreset(null);
            setOriginalPreset(null);
        }

        if (preset.uuid === DEFAULT_PRESET_ID) {
            try {
                const playerData = await getPlayerLoadoutData();
                setGameLoadout(playerData.loadout);
                setGameMeta({ sprays: playerData.sprays, identity: playerData.identity });
                setCurrentLoadout(playerData.loadout);
                setSelectedPreset({ ...defaultPreset, loadout: playerData.loadout });
                return;
            } catch (error) {
                onPresetSelectError(error);
                return;
            }
        } else {
            setCurrentLoadout(mergePresetLoadout(preset, presets, preset.loadout));
        }

        setSelectedPreset(preset);
    };

    const handlePresetDelete = (presetId: string) => {
        const presetToDelete = presets.find(p => p.uuid === presetId);
        if (!presetToDelete) return;
        setPresetToDelete(presetToDelete);
        setShowConfirmationModal(true);
    };

    const handleConfirmDelete = async () => {
        if (presetToDelete) {
            const updatedPresets = presets.filter(
                p => p.uuid !== presetToDelete.uuid && p.parentUuid !== presetToDelete.uuid
            );

            const deletingActive =
                presetToDelete.uuid === selectedPreset?.uuid ||
                presetToDelete.uuid === editingPreset?.uuid ||
                presetToDelete.uuid === originalPreset?.uuid;

            if (deletingActive) {
                setSelectedPreset(livePreset);
                setCurrentLoadout(gameLoadout);
                setIsEditing(false);
                setEditingPreset(null);
                setOriginalPreset(null);
            }

            setPresets(updatedPresets);
            await savePresets(updatedPresets);
            setPresetToDelete(null);
        }
        setShowConfirmationModal(false);
    };

    const handleCloseConfirmationModal = () => {
        setShowConfirmationModal(false);
        setPresetToDelete(null);
    };

    const handleCancel = () => {
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
        const appliedLoadout = mergePresetLoadout(appliedPreset, presets, appliedPreset.loadout);
        setGameLoadout(appliedLoadout);
        setGameMeta({
            identity: appliedPreset.identity || gameMeta.identity,
            sprays: appliedPreset.sprays || gameMeta.sprays,
        });
        setCurrentLoadout(appliedLoadout);
        setSelectedPreset(
            appliedPreset.uuid === DEFAULT_PRESET_ID
                ? { ...defaultPreset, loadout: appliedLoadout, identity: appliedPreset.identity, sprays: appliedPreset.sprays }
                : appliedPreset,
        );
        setIsEditing(false);
        setEditingPreset(null);
        setOriginalPreset(null);
    };

    const handleOpenPresetNameModal = (mode: NamingMode) => {
        setNamingMode(mode);
        setShowPresetNameModal(true);
    };

    const handleOpenRenameModal = (preset: Preset) => {
        setNamingMode(NamingMode.Rename);
        setDropdownPreset(preset);
        setShowPresetNameModal(true);
    };

    const handleDropdownVariant = (preset: Preset) => {
        setNamingMode(NamingMode.Variant);
        setDropdownPreset(preset);
        setShowPresetNameModal(true);
    };

    const handleVariant = () => {
        setNamingMode(NamingMode.Variant);
        setShowPresetNameModal(true);
    };

    const handleClosePresetNameModal = () => {
        setShowPresetNameModal(false);
        setDropdownPreset(null);
    };

    const handleAgentAssignment = (agentIds: string[], isAssigned: boolean) => {
        const base = editingPreset || selectedPreset;
        if (!base || base.uuid === DEFAULT_PRESET_ID) return;

        const applyAgentChange = (preset: Preset): Preset => {
            const updatedAgents = isAssigned
                ? [...new Set([...(preset.agents || []), ...agentIds])]
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
        if (editingPreset) {
            const next = applyLoadoutChange(editingPreset, weaponId, changedItem);
            setEditingPreset(next);
            setCurrentLoadout(next.loadout);
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
            setGameLoadout(newLoadout);
            // Surface the action bar so the user can Apply the change
            setIsEditing(true);
            setOriginalPreset({ ...defaultPreset, loadout: newLoadout });
            setEditingPreset({ ...defaultPreset, loadout: newLoadout });
            return;
        }

        const sprays = effectiveSprays(preset, gameMeta);
        const identity = effectiveIdentity(preset, gameMeta);
        let snapshot: Preset = {
            ...makeEditableSnapshot(preset),
            sprays: sprays.length ? [...sprays] : undefined,
            identity: { ...identity },
        };
        snapshot = applyLoadoutChange(snapshot, weaponId, changedItem);
        const displayLoadout = mergePresetLoadout(snapshot, presets, snapshot.loadout);
        setIsEditing(true);
        setOriginalPreset(preset);
        setEditingPreset(snapshot);
        setSelectedPreset(null);
        setCurrentLoadout(displayLoadout);
    };

    const handleTogglePreset = async (preset: Preset, checked: boolean) => {
        const updatedPresets = presets.map(p =>
            p.uuid === preset.uuid ? { ...p, disabled: !checked } : p
        );
        setPresets(updatedPresets);
        await savePresets(updatedPresets);
    };

    const getParentPreset = (preset: Preset | null | undefined) => {
        if (!preset?.parentUuid) return undefined;
        return presets.find(p => p.uuid === preset.parentUuid);
    };

    const handleIdentityChange = (cardId: string, titleId: string) => {
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

    const handleImportPresetAction = async (presetCode: string) => {
        const imported = importPreset(presetCode);
        const newPreset: Preset = {
            ...imported,
            uuid: crypto.randomUUID(),
        };
        const updatedPresets = [...presets.filter(p => p.uuid !== DEFAULT_PRESET_ID), newPreset];
        setPresets(updatedPresets);
        await savePresets(updatedPresets);
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
        handleImportPresetAction,
        refreshFromGame,
        getParentPreset,
        defaultPreset: livePreset,
        gameMeta,
        NamingMode,
    };
}
