"use client";

import { useState } from "react";
import { Weapon, LoadoutItemV1, Preset, Agent, SpraySlot, IdentityV1 } from "@/lib/types";
import WeaponCard from "@/features/gun-skins/WeaponCard";
import PlayerCardPanel from "@/features/presets/PlayerCardPanel";
import SprayWheelPanel from "@/features/presets/SprayWheelPanel";
import PresetAgentStrip from "@/features/presets/PresetAgentStrip";
import UnifiedSkinSelectorModal from "@/features/gun-skins/UnifiedSkinSelectorModal";
import { useData } from "@/context/DataContext";

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
    isEditing: boolean;
    editingPreset: Preset | null;
    onSave: () => void;
    onCancel: () => void;
    onSaveAsNew: () => void;
    onApply: () => void;
    onVariant: () => void;
    currentCardId?: string;
    currentTitleId?: string;
    onSelectCard?: (cardId: string) => void;
    onSelectTitle?: (titleId: string) => void;
    currentSprays?: SpraySlot[];
    onUpdateSprays?: (sprays: SpraySlot[]) => void;
    showPresetExtras?: boolean;
    onRefresh?: () => void;
    onBackToDashboard?: () => void;
    onAgentAssignment: (agentIds: string[], isAssigned: boolean) => void;
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
    editingPreset,
    currentCardId,
    currentTitleId,
    onSelectCard,
    onSelectTitle,
    currentSprays,
    onUpdateSprays,
    showPresetExtras,
    onBackToDashboard,
    onAgentAssignment,
}: ArsenalViewProps) {
    const { loading } = useData();

    // Unified weapon picker state
    const [activeWeapon, setActiveWeapon] = useState<Weapon | null>(null);

    const activePreset = editingPreset || selectedPreset;

    const identity: IdentityV1 = {
        playerCardId: activePreset?.identity?.playerCardId || currentCardId || "",
        playerTitleId: activePreset?.identity?.playerTitleId || currentTitleId || "",
    };

    const spraysList: SpraySlot[] = activePreset?.sprays || currentSprays || [];

    // Categorizing Weapons into columns matching the game loadout structure
    const sidearmsNames = ["classic", "shorty", "frenzy", "ghost", "sheriff"];
    const smgShotgunsNames = ["stinger", "spectre", "bucky", "judge"];
    const riflesMeleeNames = ["bulldog", "guardian", "phantom", "vandal", "melee", "tactical knife"];
    const snipersHeaviesNames = ["marshal", "outlaw", "operator", "ares", "odin"];

    const sortWeapons = (list: Weapon[], order: string[]) => {
        return [...list].sort((a, b) => {
            const indexA = order.indexOf(a.displayName.toLowerCase());
            const indexB = order.indexOf(b.displayName.toLowerCase());
            
            const isMeleeA = a.category === 'EEquippableCategory::Melee';
            const isMeleeB = b.category === 'EEquippableCategory::Melee';
            
            if (isMeleeA) return 1;
            if (isMeleeB) return -1;
            
            return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
        });
    };

    const sidearms = sortWeapons(weapons.filter(w => sidearmsNames.includes(w.displayName.toLowerCase())), sidearmsNames);
    const smgShotguns = sortWeapons(weapons.filter(w => smgShotgunsNames.includes(w.displayName.toLowerCase())), smgShotgunsNames);
    const riflesMelee = sortWeapons([
        ...weapons.filter(w => riflesMeleeNames.includes(w.displayName.toLowerCase()) && w.category !== 'EEquippableCategory::Melee'),
        ...weapons.filter(w => w.category === 'EEquippableCategory::Melee')
    ], riflesMeleeNames);
    const snipersHeavies = sortWeapons(weapons.filter(w => snipersHeaviesNames.includes(w.displayName.toLowerCase())), snipersHeaviesNames);

    // Handlers
    const handleWeaponCardClick = (weapon: Weapon) => {
        setActiveWeapon(weapon);
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

    const renderWeaponColumn = (title: string, wList: Weapon[]) => (
        <div className="workspace-column">
            <h3 className="workspace-column-title">{title}</h3>
            <div className="workspace-column-items">
                {wList.map(weapon => (
                    <WeaponCard
                        key={weapon.uuid}
                        weapon={weapon}
                        onClick={() => handleWeaponCardClick(weapon)}
                        onHandleResetSkinClick={() => onSkinReset(weapon.uuid)}
                        selectedItem={currentLoadout[weapon.uuid]}
                        parentItem={parent ? parent[weapon.uuid] : undefined}
                    />
                ))}
            </div>
        </div>
    );

    return (
        <div className="workspace-centered-wrapper">
            {/* Header */}
            <div className="workspace-header-row">
                <button type="button" className="btn-back-dashboard" onClick={onBackToDashboard}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '13px', height: '13px' }}>
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to Dashboard
                </button>
                <div className="workspace-title-area">
                    <span className="tactical-kicker">// EDITING LOADOUT</span>
                    <h2>{activePreset?.name || "Current Loadout"}</h2>
                </div>
            </div>

            {showPresetExtras && activePreset && onAgentAssignment && (
                <div className="workspace-agents-row mb-3">
                    <PresetAgentStrip
                        preset={activePreset}
                        agents={agents}
                        assignedAgentIds={activePreset.agents || []}
                        onAssignmentChange={onAgentAssignment}
                    />
                </div>
            )}

            {/* 5-Column Centered Grid */}
            <div className="workspace-grid-5">
                {renderWeaponColumn("SIDEARMS", sidearms)}
                {renderWeaponColumn("SMGS & SHOTGUNS", smgShotguns)}
                {renderWeaponColumn("RIFLES & MELEE", riflesMelee)}
                {renderWeaponColumn("SNIPERS & HEAVIES", snipersHeavies)}
                
                {/* Column 5: Cosmetics (Player Card + Circular Spray Wheel) */}
                <div className="workspace-column">
                    <h3 className="workspace-column-title">COSMETICS</h3>
                    <div className="workspace-column-items">
                        <PlayerCardPanel
                            currentCardId={identity.playerCardId}
                            currentTitleId={identity.playerTitleId}
                            onSelectCard={onSelectCard || (() => {})}
                            onSelectTitle={onSelectTitle || (() => {})}
                        />
                        <SprayWheelPanel currentSprays={spraysList} onUpdateSprays={onUpdateSprays || (() => {})} />
                    </div>
                </div>
            </div>

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
                    show={activeWeapon !== null}
                    onClose={() => setActiveWeapon(null)}
                />
            )}
        </div>
    );
}