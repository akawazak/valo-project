"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Weapon, LoadoutItemV1, Preset, Agent, SpraySlot, IdentityV1, ExpressionSlot } from "@/lib/types";
import WeaponCard from "@/features/gun-skins/WeaponCard";
import PlayerCardPanel from "@/features/presets/PlayerCardPanel";
import SprayWheelPanel from "@/features/presets/SprayWheelPanel";
import AgentSelectionModal from "@/features/agents/AgentSelectionModal";
import { CONTENT_TIERS } from "@/lib/contentTiers";
import { PresetCard } from "@/features/presets/PresetList";
import UnifiedSkinSelectorModal from "@/features/gun-skins/UnifiedSkinSelectorModal";
import { useData } from "@/context/DataContext";
import { buildPresetApplyRequest, DEFAULT_PRESET_ID } from "@/lib/effectivePreset";
import { weaponCategoryKey } from "@/lib/gameMeta";

// Board columns keyed by valorant-api's EEquippableCategory, so new weapons
// (e.g. Warden) land in the right column without code changes.
const COLUMN_CATEGORY: Record<string, string> = {
    sidearms: "sidearm",
    smgs: "smg",
    shotguns: "shotgun",
    rifles: "rifle",
    melee: "melee",
    snipers: "sniper",
    heavies: "heavy",
};

// Default order within a column follows the in-game buy menu price.
function weaponsInColumn(weapons: Weapon[], colKey: string) {
    const category = COLUMN_CATEGORY[colKey];
    return weapons
        .filter((weapon) => weaponCategoryKey(weapon.category) === category)
        .sort((a, b) => (a.shopData?.cost ?? 0) - (b.shopData?.cost ?? 0) || a.displayName.localeCompare(b.displayName));
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
    currentExpressions?: ExpressionSlot[];
    onUpdateExpressions?: (expressions: ExpressionSlot[]) => void;
    onRefresh?: () => void;
    loadoutAvailable?: boolean;
    loadoutError?: string;
    onAgentAssignment: (agentIds: string[], isAssigned: boolean) => void;
    gameIdentity?: IdentityV1;
    gameSprays?: SpraySlot[];
    gameFlexes?: ExpressionSlot[];
    gameExpressions?: ExpressionSlot[];
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
    currentExpressions,
    onUpdateExpressions,
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
    gameExpressions,
    accountName,
    accountLevel,
    accountRank,
    accountRankTier,
    showUnownedCosmetics = false,
    onRefresh,
    loadoutAvailable = true,
    loadoutError = "",
}: ArsenalViewProps) {
    const { loading } = useData();

    // Unified weapon picker state
    const [activeWeapon, setActiveWeapon] = useState<Weapon | null>(null);
    const [showPresetEditor, setShowPresetEditor] = useState(false);
    const presetEditorRef = useRef<HTMLElement>(null);

    // Custom weapon ordering states
    const [weaponOrder, setWeaponOrder] = useState<Record<string, string[]>>({});
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [draggedCol, setDraggedCol] = useState<string | null>(null);

    const activePreset = editingPreset || selectedPreset;
    const isViewingDefault = !activePreset || activePreset.uuid === DEFAULT_PRESET_ID;
    const isEditingDefault = Boolean(isEditing && editingPreset?.uuid === DEFAULT_PRESET_ID);
    const presetEditorVisible = showPresetEditor && !isViewingDefault;

    useEffect(() => {
        if (!presetEditorVisible) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        presetEditorRef.current?.focus({ preventScroll: true });
        return () => {
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
        };
    }, [presetEditorVisible]);

    const selectedPresetUuid = selectedPreset?.uuid;
    useEffect(() => {
        if (selectedPresetUuid && selectedPresetUuid !== DEFAULT_PRESET_ID) {
            setShowPresetEditor(true);
        }
    }, [selectedPresetUuid]);

    const presetRequest = activePreset ? buildPresetApplyRequest(activePreset, presets) : null;

    // Saved previews show the same inherited cosmetics that Apply sends.
    const identity: IdentityV1 = isViewingDefault
        ? (editingPreset?.identity || gameIdentity || { playerCardId: currentCardId || "", playerTitleId: currentTitleId || "" })
        : (presetRequest?.identity || { playerCardId: "", playerTitleId: "" });

    const spraysList: SpraySlot[] = isViewingDefault
        ? (editingPreset?.sprays || gameSprays || currentSprays || [])
        : (presetRequest?.sprays || []);

    const flexesList: ExpressionSlot[] = isViewingDefault
        ? (editingPreset?.flexes || gameFlexes || currentFlexes || [])
        : (presetRequest?.flexes || []);

    const expressionsList: ExpressionSlot[] = isViewingDefault
        ? (editingPreset?.expressions || gameExpressions || currentExpressions || [])
        : (presetRequest?.expressions || []);

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
                console.warn("Failed to load weapon order:", e instanceof Error ? e.message : String(e));
            }
        }

        const defaults: Record<string, string[]> = Object.fromEntries(
            Object.keys(COLUMN_CATEGORY).map((colKey) => [colKey, weaponsInColumn(weapons, colKey).map(w => w.uuid)]),
        );
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

    const sidearms = getColumnWeapons("sidearms", weaponsInColumn(weapons, "sidearms"));
    const smgs = getColumnWeapons("smgs", weaponsInColumn(weapons, "smgs"));
    const shotguns = getColumnWeapons("shotguns", weaponsInColumn(weapons, "shotguns"));
    const rifles = getColumnWeapons("rifles", weaponsInColumn(weapons, "rifles"));
    const melee = getColumnWeapons("melee", weaponsInColumn(weapons, "melee"));
    const snipers = getColumnWeapons("snipers", weaponsInColumn(weapons, "snipers"));
    const heavies = getColumnWeapons("heavies", weaponsInColumn(weapons, "heavies"));
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

    // The editor header shows who the preset is for: the first linked agent's
    // colours and portrait, or the preset's own player card.
    const editorAgents = (activePreset?.agents || [])
        .map((id) => allAgents.find((agent) => agent.uuid === id))
        .filter((agent): agent is Agent => Boolean(agent));
    const [agentPickerOpen, setAgentPickerOpen] = useState(false);
    const hexColor = (value?: string) => value && /^[0-9a-f]{6}/i.test(value) ? `#${value.slice(0, 6)}` : undefined;
    const agentPanelStyle = (agent: Agent) => ({
        "--agent-a": hexColor(agent.backgroundGradientColors?.[0]) || "#1a2430",
        "--agent-b": hexColor(agent.backgroundGradientColors?.[2]) || hexColor(agent.backgroundGradientColors?.[1]) || "#0f1923",
    } as CSSProperties);
    const editorCard = identity.playerCardId ? {
        tall: `https://media.valorant-api.com/playercards/${identity.playerCardId}/largeart.png`,
        wide: `https://media.valorant-api.com/playercards/${identity.playerCardId}/wideart.png`,
    } : null;
    // How many skins of each edition the preset holds, rarest first.
    const editorRarity = (() => {
        const counts = new Map<string, { tier: (typeof CONTENT_TIERS)[string]; count: number }>();
        for (const [weaponId, item] of Object.entries(currentLoadout)) {
            const skin = weapons.find((weapon) => weapon.uuid === weaponId)?.skins.find((entry) => entry.uuid === item.skinId);
            const tier = skin && CONTENT_TIERS[skin.contentTierUuid];
            if (!tier) continue;
            const entry = counts.get(tier.name) || { tier, count: 0 };
            entry.count += 1;
            counts.set(tier.name, entry);
        }
        const order = ["Ultra", "Exclusive", "Premium", "Deluxe", "Select"];
        return [...counts.values()].sort((a, b) => order.indexOf(a.tier.name) - order.indexOf(b.tier.name));
    })();

    // Preset edits save themselves shortly after each change; closing saves too.
    const latestSave = useRef(onSave);
    latestSave.current = onSave;
    const [autoSaving, setAutoSaving] = useState(false);
    // Restart the wait on every edit, but not on unrelated re-renders.
    const draftKey = JSON.stringify([currentLoadout, identity, spraysList, flexesList, expressionsList]);
    useEffect(() => {
        if (!presetEditorVisible || !isEditing) return;
        const timer = window.setTimeout(() => {
            setAutoSaving(true);
            void Promise.resolve(latestSave.current()).finally(() => setAutoSaving(false));
        }, 500);
        return () => window.clearTimeout(timer);
    }, [presetEditorVisible, isEditing, draftKey]);

    const closePresetEditor = async () => {
        if (isEditing) await Promise.resolve(onSave());
        setActiveWeapon(null);
        // The background is the live Current Loadout. Keep this dialog above
        // it until its async refresh has finished, preventing the preset draft
        // from flashing as the dialog closes.
        await Promise.resolve(onPresetSelect(defaultPreset));
        setShowPresetEditor(false);
    };

    const handlePresetEditorKeys = (event: React.KeyboardEvent<HTMLElement>) => {
        const dialog = presetEditorRef.current;
        // Portalled child pickers and the weapon dialog own their keyboard input.
        if (activeWeapon || event.defaultPrevented || !dialog?.contains(event.target as Node)) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            void closePresetEditor();
            return;
        }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex], [contenteditable="true"]',
        )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) {
            event.preventDefault();
            dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
            event.preventDefault();
            first.focus();
        }
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
                            isOverride={Boolean(activePreset?.parentUuid && Object.hasOwn(activePreset.loadout, weapon.uuid))}
                            selectionLabel={isViewingDefault && !isEditing ? "Equipped" : "Selected in preset"}
                        />
                    </div>
                ))}
            </div>
        </section>
        );
    };

    return (
        <div className="workspace-centered-wrapper">
            {isViewingDefault && (
                <header className="workspace-header-row workspace-builder-header">
                    <div className="workspace-title-area">
                        <h2>Current loadout</h2>
                        <p className="workspace-loadout-status" role="status">
                            {loading ? "Loading your account…" : loadoutAvailable ? (isEditing ? "Unsaved changes · Apply sends them to VALORANT" : "Equipped in VALORANT") : "Live loadout unavailable"}
                        </p>
                    </div>
                    <div className="workspace-actions workspace-builder-actions">
                        <button type="button" className="btn-tactical btn-tactical-secondary" onClick={onRefresh} disabled={loading || !onRefresh}>Refresh</button>
                        <button type="button" className="btn-tactical btn-tactical-accent" onClick={onNewPreset} disabled={loading || !loadoutAvailable}>Save as preset</button>
                    </div>
                </header>
            )}
            {!isViewingDefault && (
                <div className="workspace-header-row workspace-builder-header">
                    <div className="workspace-title-area">
                        <div className="workspace-title-line">
                            <h2>{activePreset?.name || "Preset"}</h2>
                        </div>
                    </div>
                    <div className="workspace-actions workspace-builder-actions">
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-secondary"
                            onClick={() => onPresetSelect(defaultPreset)}
                        >
                            ← Back to loadout
                        </button>
                    </div>
                </div>
            )}

            {isEditing && !isEditingDefault && (
                <div className="workspace-command-strip workspace-command-strip--compact is-editing">
                    <span className="clr-reference-hint">Unsaved preset changes</span>
                    <div className="workspace-edit-actions">
                        <button type="button" className="btn-tactical btn-tactical-secondary" onClick={onSave}>
                            Save
                        </button>
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
                </div>
            )}

            {isViewingDefault && (!loadoutAvailable || loading) ? (
                <div className="workspace-loadout-unavailable" role="status">
                    <strong>{loading ? "Loading your account" : "Your equipped loadout could not be loaded"}</strong>
                    <p>{loading ? "Your saved presets are still available below." : "Refresh after renewing your Riot session in Account Manager. Your saved presets are still available below."}</p>
                    {!loading && loadoutError && <p className="workspace-loadout-error">{loadoutError}</p>}
                </div>
            ) : isViewingDefault && <div className="workspace-grid-5 workspace-builder-board">
                <div className="workspace-board-column workspace-board-column--sidearms">
                    {renderWeaponCategory("SIDEARMS", sidearms, "sidearms")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("SMGS", smgs, "smgs")}
                    {renderWeaponCategory("SHOTGUNS", shotguns, "shotguns")}
                    {renderWeaponCategory("MELEE", melee, "melee")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("RIFLES", rifles, "rifles")}
                </div>

                <div className="workspace-board-column">
                    {renderWeaponCategory("SNIPER RIFLES", snipers, "snipers")}
                    {renderWeaponCategory("MACHINE GUNS", heavies, "heavies")}
                </div>

                <aside className="workspace-column workspace-column--cosmetics workspace-builder-rail">
                    <section className="workspace-rail-section">
                        <h3 className="workspace-column-title">Player card</h3>
                        <PlayerCardPanel
                            currentCardId={identity.playerCardId}
                            currentTitleId={identity.playerTitleId}
                            onSelectCard={onSelectCard || (() => {})}
                            onSelectTitle={onSelectTitle || (() => {})}
                            accountName={accountName}
                            accountLevel={gameIdentity?.accountLevel || accountLevel || identity.accountLevel}
                            preferredLevelBorderId={gameIdentity?.preferredLevelBorderId}
                            hideAccountLevel={gameIdentity?.hideAccountLevel}
                            accountRank={accountRank}
                            accountRankTier={accountRankTier}
                            showUnownedCosmetics={showUnownedCosmetics}
                        />
                    </section>
                    <section className="workspace-rail-section">
                        <h3 className="workspace-column-title">Expressions</h3>
                        <SprayWheelPanel
                            currentSprays={spraysList}
                            onUpdateSprays={onUpdateSprays || (() => {})}
                            currentFlexes={flexesList}
                            onUpdateFlexes={onUpdateFlexes || (() => {})}
                            currentExpressions={expressionsList}
                            onUpdateExpressions={onUpdateExpressions}
                            showUnownedCosmetics={showUnownedCosmetics}
                        />
                    </section>
                </aside>
            </div>}

            {/* Preset List at the bottom */}
            {(
                <div className="workspace-presets-row">
                    <div className="workspace-presets-header">
                        <span className="workspace-presets-label">Saved presets</span>
                        <span className="workspace-presets-hint">
                            Saved configurations stay unchanged until applied
                        </span>
                        <div className="workspace-presets-actions">
                            <button type="button" className="btn-tactical btn-tactical-ghost" onClick={onImportPresetClick}>
                                Import
                            </button>
                            <button type="button" className="btn-tactical btn-tactical-accent" onClick={onNewPreset} disabled={isViewingDefault && (loading || !loadoutAvailable)}>
                                + New preset
                            </button>
                        </div>
                    </div>
                    <div className="workspace-presets-scroll">
                        {presets.filter(p => p.uuid !== defaultPreset.uuid).length === 0 && <p className="workspace-presets-empty">No saved presets yet. Save your current loadout or import a shared preset to get started.</p>}
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
                                        allPresets={presets}
                                        variantCount={variants.length}
                                        isVariant={Boolean(preset.parentUuid)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {presetEditorVisible && (
                <div
                    className="preset-loadout-editor-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) void closePresetEditor();
                    }}
                >
                    <section ref={presetEditorRef} tabIndex={-1} onKeyDown={handlePresetEditorKeys} className="preset-loadout-editor" role="dialog" aria-modal="true" aria-label={`Edit ${activePreset?.name || "preset"}`}>
                        <header className="preset-loadout-editor-header preset-locker">
                            {editorCard && <div className="preset-locker-wash" style={{ backgroundImage: `url(${editorCard.wide})` }} aria-hidden="true" />}
                            {editorCard && <img className="preset-locker-card" src={editorCard.tall} alt="" aria-hidden="true" />}
                            <div className="preset-loadout-editor-heading">
                                <span className="preset-editor-kicker">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
                                    Editing preset
                                </span>
                                <h2>{activePreset?.name || "Preset"}</h2>
                                <p className={`preset-loadout-editor-status${isEditing || autoSaving ? " is-saving" : ""}`} role="status">
                                    <i aria-hidden="true" />
                                    {isEditing || autoSaving ? "Saving…" : "Saved"}
                                    <span>Changes save automatically</span>
                                </p>
                                {editorRarity.length > 0 && (
                                    <div className="preset-locker-rarity">
                                        {editorRarity.map(({ tier, count }) => (
                                            <span key={tier.name} title={`${tier.name} Edition`}><img src={tier.icon} alt="" />{count} {tier.name}</span>
                                        ))}
                                        <em>{Object.keys(currentLoadout).length} weapons</em>
                                    </div>
                                )}
                            </div>
                            {activePreset && onAgentAssignment && (
                                <div className="preset-lineup">
                                    <span className="preset-lineup-label">{editorAgents.length ? "Auto-applies when you lock" : "Auto-apply for an agent"}</span>
                                    {editorAgents.slice(0, 3).map((agent) => (
                                        <button
                                            type="button"
                                            key={agent.uuid}
                                            className="preset-lineup-agent"
                                            style={agentPanelStyle(agent)}
                                            onClick={() => setAgentPickerOpen(true)}
                                            title={`Change agents (${agent.displayName})`}
                                        >
                                            {agent.background && <img className="preset-lineup-bg" src={agent.background} alt="" />}
                                            <img className="preset-lineup-portrait" src={agent.fullPortrait || agent.displayIcon} alt="" />
                                            <span className="preset-lineup-name">{agent.displayName}</span>
                                        </button>
                                    ))}
                                    <button type="button" className="preset-lineup-add" onClick={() => setAgentPickerOpen(true)} title="Choose agents for this preset">
                                        <span aria-hidden="true">+</span>
                                        <small>{editorAgents.length > 3 ? `+${editorAgents.length - 3} more` : editorAgents.length ? "Add agent" : "Pick agents"}</small>
                                    </button>
                                    <AgentSelectionModal
                                        show={agentPickerOpen}
                                        onClose={() => setAgentPickerOpen(false)}
                                        agents={allAgents}
                                        ownedAgentIds={ownedAgentIds || allAgents.map((agent) => agent.uuid)}
                                        selectedAgentIds={activePreset.agents || []}
                                        onAgentSelect={(ids) => onAgentAssignment(ids, true)}
                                    />
                                </div>
                            )}
                            <div className="preset-loadout-editor-actions preset-locker-actions">
                                <button type="button" className="preset-editor-btn" onClick={onApply} title="Equip this preset in VALORANT now">
                                    Apply to VALORANT
                                </button>
                                <button type="button" className="preset-editor-btn" onClick={onSaveAsNew}>
                                    Save as new
                                </button>
                            </div>
                            <button type="button" className="preset-loadout-editor-close preset-locker-close" onClick={() => void closePresetEditor()} aria-label="Close preset editor" title="Close">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                            </button>
                        </header>

                        <div className="preset-loadout-editor-body">
                            <div className="workspace-grid-5 workspace-builder-board preset-loadout-editor-grid">
                                <div className="workspace-board-column workspace-board-column--sidearms">
                                    {renderWeaponCategory("SIDEARMS", sidearms, "sidearms")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("SMGS", smgs, "smgs")}
                                    {renderWeaponCategory("SHOTGUNS", shotguns, "shotguns")}
                                    {renderWeaponCategory("MELEE", melee, "melee")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("RIFLES", rifles, "rifles")}
                                </div>
                                <div className="workspace-board-column">
                                    {renderWeaponCategory("SNIPER RIFLES", snipers, "snipers")}
                                    {renderWeaponCategory("MACHINE GUNS", heavies, "heavies")}
                                </div>
                                <aside className="workspace-column workspace-column--cosmetics workspace-builder-rail">
                                    <section className="workspace-rail-section">
                                        <h3 className="workspace-column-title">Player card</h3>
                                        <PlayerCardPanel
                                            currentCardId={identity.playerCardId}
                                            currentTitleId={identity.playerTitleId}
                                            onSelectCard={onSelectCard || (() => {})}
                                            onSelectTitle={onSelectTitle || (() => {})}
                                            accountName={accountName}
                                            accountLevel={gameIdentity?.accountLevel || accountLevel || identity.accountLevel}
                                            preferredLevelBorderId={gameIdentity?.preferredLevelBorderId}
                                            hideAccountLevel={gameIdentity?.hideAccountLevel}
                                            accountRank={accountRank}
                                            accountRankTier={accountRankTier}
                                            showUnownedCosmetics={showUnownedCosmetics}
                                        />
                                    </section>
                                    <section className="workspace-rail-section">
                                        <h3 className="workspace-column-title">Expressions</h3>
                                        <SprayWheelPanel
                                            currentSprays={spraysList}
                                            onUpdateSprays={onUpdateSprays || (() => {})}
                                            currentFlexes={flexesList}
                                            onUpdateFlexes={onUpdateFlexes || (() => {})}
                                            currentExpressions={expressionsList}
                                            onUpdateExpressions={onUpdateExpressions}
                                            showUnownedCosmetics={showUnownedCosmetics}
                                        />
                                    </section>
                                </aside>
                            </div>
                        </div>

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
                            label: "Done",
                            detail: `Changes to ${activePreset?.name || "this preset"} save automatically`,
                            onSave: () => setActiveWeapon(null),
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
