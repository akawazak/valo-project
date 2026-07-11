"use client";

import { useState, useEffect, type CSSProperties } from "react";
import { Weapon, LoadoutItemV1, Preset, Agent, SpraySlot, IdentityV1, ExpressionSlot } from "@/lib/types";
import WeaponCard from "@/features/gun-skins/WeaponCard";
import PlayerCardPanel from "@/features/presets/PlayerCardPanel";
import SprayWheelPanel from "@/features/presets/SprayWheelPanel";
import PresetAgentStrip from "@/features/presets/PresetAgentStrip";
import { PresetCard } from "@/features/presets/PresetList";
import UnifiedSkinSelectorModal from "@/features/gun-skins/UnifiedSkinSelectorModal";
import { useData } from "@/context/DataContext";
import { DEFAULT_PRESET_ID } from "@/lib/effectivePreset";

const SIDEARMS_NAMES = ["classic", "shorty", "frenzy", "ghost", "bandit", "sheriff"];
const SMGS_NAMES = ["stinger", "spectre"];
const SHOTGUNS_NAMES = ["bucky", "judge"];
const RIFLES_NAMES = ["bulldog", "guardian", "phantom", "vandal"];
const MELEE_NAMES = ["melee", "tactical knife"];
const SNIPERS_NAMES = ["marshal", "outlaw", "operator"];
const HEAVIES_NAMES = ["ares", "odin"];

function sortWeapons(list: Weapon[], order: string[]) {
    return [...list].sort((a, b) => {
        const indexA = order.indexOf(a.displayName.toLowerCase());
        const indexB = order.indexOf(b.displayName.toLowerCase());

        const isMeleeA = a.category === 'EEquippableCategory::Melee';
        const isMeleeB = b.category === 'EEquippableCategory::Melee';

        if (isMeleeA) return 1;
        if (isMeleeB) return -1;

        return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
    });
}

interface ArsenalViewProps {
    weapons: Weapon[];
    currentLoadout: Record<string, LoadoutItemV1>;
    parent?: Record<string, LoadoutItemV1>;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    contentTiers: { uuid: string; displayName: string; rank: number }[];
    onSkinSelect: (weaponId: string, skinId: string, levelId: string, chromaId: string) => void;
    onBuddySelect: (weaponId: string, charmID: string, charmLevelID: string) => void;
    onSkinReset: (weaponId: string) => void;
    presets: Preset[];
    selectedPreset: Preset | null;
    defaultPreset: Preset;
    onPresetSelect: (p: Preset) => void;
    onPresetApply: (p: Preset) => void;
    onPresetDelete: (id: string) => void;
    onPresetRename: (p: Preset) => void;
    onCreateVariant: (p: Preset) => void;
    onTogglePreset: (p: Preset, checked: boolean) => void;
    onExportPreset: (p: Preset) => void;
    onImportPresetClick: () => void;
    onNewPreset: () => void;
    agents: Agent[];
    allAgents: Agent[];
    ownedAgentIds: string[];
    isEditing: boolean;
    editingPreset: Preset | null;
    onSave: () => void;
    onCancel: () => void;
    onSaveAsNew: () => void;
    onApply: () => void;
    onApplyWeapon: (weaponId: string) => Promise<boolean>;
    currentCardId?: string;
    currentTitleId?: string;
    onSelectCard?: (cardId: string) => void;
    onSelectTitle?: (titleId: string) => void;
    currentSprays?: SpraySlot[];
    onUpdateSprays?: (sprays: SpraySlot[]) => void;
    currentFlexes?: ExpressionSlot[];
    onUpdateFlexes?: (flexes: ExpressionSlot[]) => void;
    onRefresh?: () => void;
    onAgentAssignment: (agentIds: string[], isAssigned: boolean) => void;
    gameIdentity?: IdentityV1;
    gameSprays?: SpraySlot[];
    gameFlexes?: ExpressionSlot[];
    accountName?: string;
    accountLevel?: number;
    accountRank?: string;
    accountRankTier?: number;
    showUnownedCosmetics?: boolean;
}

export default function ArsenalView({
    weapons,
    currentLoadout,
    parent,
    ownedLevelIDs,
    ownedChromaIDs,
    onSkinSelect,
    onBuddySelect,
    onSkinReset,
    selectedPreset,
    agents,
    allAgents,
    ownedAgentIds,
    isEditing,
    editingPreset,
    currentCardId,
    currentTitleId,
    onSelectCard,
    onSelectTitle,
    currentSprays,
    onUpdateSprays,
    currentFlexes,
    onUpdateFlexes,
    onAgentAssignment,
    presets,
    defaultPreset,
    onPresetDelete,
    onPresetRename,
    onCreateVariant,
    onTogglePreset,
    onExportPreset,
    onImportPresetClick,
    onNewPreset,
    onSave,
    onCancel,
    onSaveAsNew,
    onApply,
    onApplyWeapon,
    onPresetSelect,
    onPresetApply,
    gameIdentity,
    gameSprays,
    gameFlexes,
    accountName,
    accountLevel,
    accountRank,
    accountRankTier,
    showUnownedCosmetics = false,
}: ArsenalViewProps) {
    const { loading } = useData();

    // Unified weapon picker state
    const [activeWeapon, setActiveWeapon] = useState<Weapon | null>(null);
    const [showPresetEditor, setShowPresetEditor] = useState(false);

    // Custom weapon ordering states
    const [weaponOrder, setWeaponOrder] = useState<Record<string, string[]>>({});
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [draggedCol, setDraggedCol] = useState<string | null>(null);

    const activePreset = editingPreset || selectedPreset;
    const isViewingDefault = !activePreset || activePreset.uuid === DEFAULT_PRESET_ID;
    const isEditingDefault = Boolean(isEditing && editingPreset?.uuid === DEFAULT_PRESET_ID);

    useEffect(() => {
        if (selectedPreset && selectedPreset.uuid !== DEFAULT_PRESET_ID) {
            setShowPresetEditor(true);
        }
    }, [selectedPreset?.uuid]);

    // For current loadout, fall back to whatever the game has equipped right now
    const identity: IdentityV1 = isViewingDefault
        ? (editingPreset?.identity || gameIdentity || { playerCardId: currentCardId || "", playerTitleId: currentTitleId || "" })
        : {
            playerCardId: activePreset?.identity?.playerCardId || currentCardId || "",
            playerTitleId: activePreset?.identity?.playerTitleId || currentTitleId || "",
        };

    const spraysList: SpraySlot[] = isViewingDefault
        ? (editingPreset?.sprays || gameSprays || currentSprays || [])
        : (activePreset?.sprays || currentSprays || []);

    const flexesList: ExpressionSlot[] = isViewingDefault
        ? (editingPreset?.flexes || gameFlexes || currentFlexes || [])
        : (activePreset?.flexes || currentFlexes || []);

    // Initialize or load weapon sorting configuration
    useEffect(() => {
        if (!weapons.length) return;
        const stored = localStorage.getItem("valovault_weapon_order_v1");
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setWeaponOrder(parsed);
                return;
            } catch (e) {
                console.error("Failed to load weapon order:", e);
            }
        }

        const defaults: Record<string, string[]> = {
            sidearms: sortWeapons(weapons.filter(w => SIDEARMS_NAMES.includes(w.displayName.toLowerCase())), SIDEARMS_NAMES).map(w => w.uuid),
            smgs: sortWeapons(weapons.filter(w => SMGS_NAMES.includes(w.displayName.toLowerCase())), SMGS_NAMES).map(w => w.uuid),
            shotguns: sortWeapons(weapons.filter(w => SHOTGUNS_NAMES.includes(w.displayName.toLowerCase())), SHOTGUNS_NAMES).map(w => w.uuid),
            rifles: sortWeapons(weapons.filter(w => RIFLES_NAMES.includes(w.displayName.toLowerCase())), RIFLES_NAMES).map(w => w.uuid),
            melee: sortWeapons(weapons.filter(w => w.category === 'EEquippableCategory::Melee' || MELEE_NAMES.includes(w.displayName.toLowerCase())), MELEE_NAMES).map(w => w.uuid),
            snipers: sortWeapons(weapons.filter(w => SNIPERS_NAMES.includes(w.displayName.toLowerCase())), SNIPERS_NAMES).map(w => w.uuid),
            heavies: sortWeapons(weapons.filter(w => HEAVIES_NAMES.includes(w.displayName.toLowerCase())), HEAVIES_NAMES).map(w => w.uuid),
        };
        setWeaponOrder(defaults);
    }, [weapons]);

    const getColumnWeapons = (colKey: string, fallbackList: Weapon[]) => {
        const uuids = weaponOrder[colKey] || [];
        if (uuids.length === 0) return fallbackList;
        const mapped = uuids
            .map(id => weapons.find(w => w.uuid === id))
            .filter((w): w is Weapon => !!w);
        const missing = fallbackList.filter(w => !uuids.includes(w.uuid));
        return [...mapped, ...missing];
    };

    const sidearms = getColumnWeapons("sidearms", sortWeapons(weapons.filter(w => SIDEARMS_NAMES.includes(w.displayName.toLowerCase())), SIDEARMS_NAMES));
    const smgs = getColumnWeapons("smgs", sortWeapons(weapons.filter(w => SMGS_NAMES.includes(w.displayName.toLowerCase())), SMGS_NAMES));
    const shotguns = getColumnWeapons("shotguns", sortWeapons(weapons.filter(w => SHOTGUNS_NAMES.includes(w.displayName.toLowerCase())), SHOTGUNS_NAMES));
    const rifles = getColumnWeapons("rifles", sortWeapons(weapons.filter(w => RIFLES_NAMES.includes(w.displayName.toLowerCase())), RIFLES_NAMES));
    const melee = getColumnWeapons("melee", sortWeapons(weapons.filter(w => w.category === 'EEquippableCategory::Melee' || MELEE_NAMES.includes(w.displayName.toLowerCase())), MELEE_NAMES));
    const snipers = getColumnWeapons("snipers", sortWeapons(weapons.filter(w => SNIPERS_NAMES.includes(w.displayName.toLowerCase())), SNIPERS_NAMES));
    const heavies = getColumnWeapons("heavies", sortWeapons(weapons.filter(w => HEAVIES_NAMES.includes(w.displayName.toLowerCase())), HEAVIES_NAMES));
    const commandState = isEditing ? (isEditingDefault ? "LIVE DRAFT" : "UNSAVED") : (isViewingDefault ? "LIVE" : "PRESET");
    const commandHint = isEditing
        ? (isEditingDefault ? "Apply this weapon from its picker, or close it to keep the current game loadout." : "Save, apply, or fork this preset.")
        : (isViewingDefault ? "Click any slot to edit the live loadout." : "Click any slot to edit this preset.");

    // Drag handlers
    const handleDragStart = (e: React.DragEvent, id: string, colKey: string) => {
        setDraggedId(id);
        setDraggedCol(colKey);
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent, targetId: string, colKey: string) => {
        e.preventDefault();
        if (!draggedId || draggedId === targetId || draggedCol !== colKey) return;
        
        const colList = [...(weaponOrder[colKey] || [])];
        const dragIndex = colList.indexOf(draggedId);
        const targetIndex = colList.indexOf(targetId);
        
        if (dragIndex !== -1 && targetIndex !== -1) {
            colList.splice(dragIndex, 1);
            colList.splice(targetIndex, 0, draggedId);
            
            const updated = { ...weaponOrder, [colKey]: colList };
            setWeaponOrder(updated);
            localStorage.setItem("valovault_weapon_order_v1", JSON.stringify(updated));
        }
    };

    const handleDragEnd = () => {
        setDraggedId(null);
        setDraggedCol(null);
    };

    // Handlers
    const handleWeaponCardClick = (weapon: Weapon) => {
        setActiveWeapon(weapon);
    };

    const openPresetEditor = (preset: Preset) => {
        onPresetSelect(preset);
        setShowPresetEditor(true);
    };

    const closePresetEditor = async () => {
        if (isEditing) onCancel();
        setActiveWeapon(null);
        // The background is the live Current Loadout. Keep this dialog above
        // it until its async refresh has finished, preventing the preset draft
        // from flashing as the dialog closes.
        await Promise.resolve(onPresetSelect(defaultPreset));
        setShowPresetEditor(false);
    };

    const handleSkinSelectComplete = (skinId: string, levelId: string, chromaId: string) => {
        if (activeWeapon) {
            onSkinSelect(activeWeapon.uuid, skinId, levelId, chromaId);
        }
    };

    const handleBuddySelectComplete = (charmID: string, charmLevelID: string) => {
        if (activeWeapon) {
            onBuddySelect(activeWeapon.uuid, charmID, charmLevelID);
        }
    };

    if (loading) {
        return <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'center', padding: '2rem' }}>Loading game data…</div>;
    }

    const renderWeaponCategory = (title: string, wList: Weapon[], colKey: string) => {
        const categoryStyle = {
            "--slot-count": Math.max(wList.length, 1),
            "--category-weight": Math.max(wList.length, 1),
        } as CSSProperties;

        return (
        <section
            className={`workspace-category workspace-category--weapon workspace-category--${colKey}`}
            aria-label={title}
            style={categoryStyle}
        >
            <h3 className="workspace-column-title workspace-column-title--weapon">{title}</h3>
            <div className="workspace-column-items">
                {wList.map(weapon => (
                    <div
                        key={weapon.uuid}
                        draggable
                        onDragStart={(e) => handleDragStart(e, weapon.uuid, colKey)}
                        onDragOver={(e) => handleDragOver(e, weapon.uuid, colKey)}
                        onDragEnd={handleDragEnd}
                        className={`draggable-weapon-wrapper ${draggedId === weapon.uuid ? "dragging" : ""}`}
                    >
                        <WeaponCard
                            weapon={weapon}
                            onClick={() => handleWeaponCardClick(weapon)}
                            onHandleResetSkinClick={() => onSkinReset(weapon.uuid)}
                            selectedItem={currentLoadout[weapon.uuid]}
                            parentItem={parent ? parent[weapon.uuid] : undefined}
                        />
                    </div>
                ))}
            </div>
        </section>
        );
    };

    return (
        <div className="workspace-centered-wrapper">
            {/* Header */}
            <div className="workspace-header-row workspace-builder-header">
                <div className="workspace-title-area">
                    <div className="workspace-title-line">
                        <h2>{activePreset?.name || "Current Loadout"}</h2>
                    </div>
                </div>
                <div className="workspace-actions workspace-builder-actions">
                    {/* Show "Switch to Current Loadout" only when viewing a saved preset */}
                    {!isViewingDefault && (
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-secondary"
                            onClick={() => onPresetSelect(defaultPreset)}
                        >
                            ← Current Loadout
                        </button>
                    )}
                    <button type="button" className="btn-tactical btn-tactical-ghost" onClick={onImportPresetClick}>
                        Import
                    </button>
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-accent"
                        onClick={onNewPreset}
                    >
                        + New Preset
                    </button>
                </div>
            </div>

            {/* Current Loadout Reference Card — only show on the current loadout */}
            <div className={`workspace-command-strip workspace-command-strip--compact${isEditing ? " is-editing" : ""}`}>
                <div className="workspace-command-copy">
                    <span className="clr-reference-badge">{commandState}</span>
                    <span className="clr-reference-hint">{commandHint}</span>
                </div>
                {isEditing && !isEditingDefault && (
                    <div className="workspace-edit-actions">
                        {!isEditingDefault && (
                            <button type="button" className="btn-tactical btn-tactical-secondary" onClick={onSave}>
                                Save
                            </button>
                        )}
                        <button type="button" className="btn-tactical btn-tactical-ghost" onClick={onSaveAsNew}>
                            Save As New
                        </button>
                        <button type="button" className="btn-tactical btn-tactical-accent" onClick={onApply}>
                            Apply to Game
                        </button>
                        <button type="button" className="btn-tactical btn-tactical-secondary" onClick={onCancel}>
                            Cancel
                        </button>
                    </div>
                )}
            </div>

            <div className="workspace-grid-5 workspace-builder-board">
                <div className="workspace-board-column workspace-board-column--sidearms">
                    {renderWeaponCategory("SIDEARMS", sidearms, "sidearms")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("SMGS", smgs, "smgs")}
                    {renderWeaponCategory("SHOTGUNS", shotguns, "shotguns")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("RIFLES", rifles, "rifles")}
                    {renderWeaponCategory("MELEE", melee, "melee")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("SNIPER RIFLES", snipers, "snipers")}
                    {renderWeaponCategory("MACHINE GUNS", heavies, "heavies")}
                </div>

                <aside className="workspace-column workspace-column--cosmetics workspace-builder-rail">
                    <section className="workspace-rail-section">
                        <h3 className="workspace-column-title">PLAYER CARDS</h3>
                        <PlayerCardPanel
                            currentCardId={identity.playerCardId}
                            currentTitleId={identity.playerTitleId}
                            onSelectCard={onSelectCard || (() => {})}
                            onSelectTitle={onSelectTitle || (() => {})}
                            accountName={accountName}
                            accountLevel={accountLevel || identity.accountLevel}
                            accountRank={accountRank}
                            accountRankTier={accountRankTier}
                            showUnownedCosmetics={showUnownedCosmetics}
                        />
                    </section>
                    <section className="workspace-rail-section">
                        <h3 className="workspace-column-title">EXPRESSIONS</h3>
                        <SprayWheelPanel
                            currentSprays={spraysList}
                            onUpdateSprays={onUpdateSprays || (() => {})}
                            currentFlexes={flexesList}
                            onUpdateFlexes={onUpdateFlexes || (() => {})}
                            showUnownedCosmetics={showUnownedCosmetics}
                        />
                    </section>
                </aside>
            </div>

            {/* Preset List at the bottom */}
            {presets && presets.length > 0 && (
                <div className="workspace-presets-row">
                    <div className="workspace-presets-header">
                        <span className="workspace-presets-label">// SAVED PRESETS</span>
                        <span className="workspace-presets-hint">
                            Saved configurations · Live loadout stays unchanged until applied
                        </span>
                    </div>
                    <div className="workspace-presets-scroll">
                        {presets.filter(p => p.uuid !== defaultPreset.uuid).map(preset => {
                            const variants = presets.filter(c => c.parentUuid === preset.uuid);
                            return (
                                <div key={preset.uuid} className="workspace-preset-group">
                                    <PresetCard
                                        preset={preset}
                                        isSelected={selectedPreset?.uuid === preset.uuid}
                                        onSelect={openPresetEditor}
                                        onApply={() => onPresetApply(preset)}
                                        onRename={onPresetRename}
                                        onDelete={onPresetDelete}
                                        onCreateVariant={onCreateVariant}
                                        onToggle={onTogglePreset}
                                        onExport={onExportPreset}
                                        agents={agents}
                                        variantCount={variants.length}
                                    />
                                    {variants.map(child => (
                                        <PresetCard
                                            key={child.uuid}
                                            preset={child}
                                            isSelected={selectedPreset?.uuid === child.uuid}
                                            onSelect={openPresetEditor}
                                            onApply={() => onPresetApply(child)}
                                            onRename={onPresetRename}
                                            onDelete={onPresetDelete}
                                            onToggle={onTogglePreset}
                                            onExport={onExportPreset}
                                            agents={agents}
                                            isVariant
                                        />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {showPresetEditor && !isViewingDefault && (
                <div
                    className="preset-loadout-editor-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget && !isEditing) void closePresetEditor();
                    }}
                >
                    <section className="preset-loadout-editor" role="dialog" aria-modal="true" aria-label={`Edit ${activePreset?.name || "preset"}`}>
                        <header className="preset-loadout-editor-header">
                            <div className="preset-loadout-editor-heading">
                                <div className="preset-loadout-editor-context">
                                    <span>Saved Preset</span>
                                    <span className="preset-loadout-editor-not-live">Not Live</span>
                                </div>
                                <div className="preset-loadout-editor-title-row">
                                    <span className="preset-loadout-editor-mark" aria-hidden="true">
                                        <svg viewBox="0 0 24 24"><path d="M5 4h14v16l-7-4-7 4V4Z" /></svg>
                                    </span>
                                    <div>
                                        <h2>{activePreset?.name || "Preset"}</h2>
                                        <p>{isEditing ? "Unsaved changes" : "All changes saved"}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="preset-loadout-editor-actions">
                                {activePreset && onAgentAssignment && (
                                    <PresetAgentStrip
                                        compact
                                        preset={activePreset}
                                        agents={allAgents}
                                        ownedAgentIds={ownedAgentIds}
                                        assignedAgentIds={activePreset.agents || []}
                                        onAssignmentChange={onAgentAssignment}
                                    />
                                )}
                                <button type="button" className="btn-tactical btn-tactical-secondary" onClick={onSave} disabled={!isEditing} title={isEditing ? "Save changes to this preset" : "No unsaved changes"}>
                                    Save Preset
                                </button>
                                <button type="button" className="btn-tactical btn-tactical-ghost" onClick={onSaveAsNew}>
                                    Save As New
                                </button>
                                <button type="button" className="btn-tactical btn-tactical-accent" onClick={onApply}>
                                    Apply to VALORANT
                                </button>
                                <button type="button" className="preset-loadout-editor-close" onClick={() => void closePresetEditor()} aria-label={isEditing ? "Discard changes and close" : "Close preset editor"} title={isEditing ? "Discard changes and close" : "Close"}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                                </button>
                            </div>
                        </header>

                        <div className="preset-loadout-editor-body">
                            <div className="workspace-grid-5 workspace-builder-board preset-loadout-editor-grid">
                                <div className="workspace-board-column workspace-board-column--sidearms">
                                    {renderWeaponCategory("SIDEARMS", sidearms, "sidearms")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("SMGS", smgs, "smgs")}
                                    {renderWeaponCategory("SHOTGUNS", shotguns, "shotguns")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("RIFLES", rifles, "rifles")}
                                    {renderWeaponCategory("MELEE", melee, "melee")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("SNIPER RIFLES", snipers, "snipers")}
                                    {renderWeaponCategory("MACHINE GUNS", heavies, "heavies")}
                                </div>
                                <aside className="workspace-column workspace-column--cosmetics workspace-builder-rail">
                                    <section className="workspace-rail-section">
                                        <h3 className="workspace-column-title">PLAYER CARDS</h3>
                                        <PlayerCardPanel
                                            currentCardId={identity.playerCardId}
                                            currentTitleId={identity.playerTitleId}
                                            onSelectCard={onSelectCard || (() => {})}
                                            onSelectTitle={onSelectTitle || (() => {})}
                                            accountName={accountName}
                                            accountLevel={accountLevel || identity.accountLevel}
                                            accountRank={accountRank}
                                            accountRankTier={accountRankTier}
                                            showUnownedCosmetics={showUnownedCosmetics}
                                        />
                                    </section>
                                    <section className="workspace-rail-section">
                                        <h3 className="workspace-column-title">EXPRESSIONS</h3>
                                        <SprayWheelPanel
                                            currentSprays={spraysList}
                                            onUpdateSprays={onUpdateSprays || (() => {})}
                                            currentFlexes={flexesList}
                                            onUpdateFlexes={onUpdateFlexes || (() => {})}
                                            showUnownedCosmetics={showUnownedCosmetics}
                                        />
                                    </section>
                                </aside>
                            </div>
                        </div>

                        <footer className="preset-loadout-editor-footer">
                            <span>{isEditing ? "Save updates this preset. Apply changes VALORANT without saving." : "This preset is saved. Apply sends it to VALORANT."}</span>
                            {isEditing ? (
                                <button type="button" className="btn-tactical btn-tactical-ghost" onClick={onCancel}>Discard Changes</button>
                            ) : null}
                        </footer>
                    </section>
                </div>
            )}

            {/* Unified Selector Modal */}
            {activeWeapon && (
                <UnifiedSkinSelectorModal
                    weapon={activeWeapon}
                    ownedLevelIDs={ownedLevelIDs}
                    ownedChromaIDs={ownedChromaIDs}
                    currentLoadout={currentLoadout}
                    selectedItem={currentLoadout[activeWeapon.uuid]}
                    parentItem={parent ? parent[activeWeapon.uuid] : undefined}
                    onSkinSelect={handleSkinSelectComplete}
                    onBuddySelect={handleBuddySelectComplete}
                    onApplyWeapon={async () => {
                        if (await onApplyWeapon(activeWeapon.uuid)) {
                            setActiveWeapon(null);
                        }
                    }}
                    editingContext={isViewingDefault ? "Current Loadout" : `preset: ${activePreset?.name || "Preset"}`}
                    saveAction={isViewingDefault
                        ? {
                            label: "Save as Preset",
                            detail: "Create a reusable preset from this loadout",
                            onSave: () => {
                                setActiveWeapon(null);
                                onSaveAsNew();
                            },
                        }
                        : {
                            label: "Save Preset",
                            detail: `Save changes to ${activePreset?.name || "this preset"}`,
                            onSave: () => {
                                setActiveWeapon(null);
                                onSave();
                            },
                        }}
                    show={activeWeapon !== null}
                    onClose={() => {
                        // Current Loadout changes are a modal-local draft
                        // until its Apply weapon action succeeds.
                        if (isEditingDefault) onCancel();
                        setActiveWeapon(null);
                    }}
                />
            )}
        </div>
    );
}
