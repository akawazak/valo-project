"use client";

import { Preset, Agent } from "@/lib/types";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { useData } from "@/context/DataContext";
import { DEFAULT_PRESET_ID } from "@/lib/effectivePreset";

interface PresetListProps {
    presets: Preset[];
    selectedPreset: Preset | null;
    onPresetSelect: (preset: Preset) => void;
    onPresetDelete: (presetId: string) => void;
    onPresetApply: (preset: Preset) => void;
    onPresetRename: (preset: Preset) => void;
    onCreateVariant: (preset: Preset) => void;
    onTogglePreset: (preset: Preset, checked: boolean) => void;
    defaultPreset: Preset;
    agents: Agent[];
    onExportPreset?: (preset: Preset) => void;
    onImportPresetClick?: () => void;
    onNewPreset: () => void;
}

export default function PresetList({
    presets,
    selectedPreset,
    onPresetSelect,
    onPresetDelete,
    onPresetApply,
    onPresetRename,
    onCreateVariant,
    onTogglePreset,
    defaultPreset,
    agents,
    onExportPreset,
    onImportPresetClick,
    onNewPreset,
}: PresetListProps) {
    const savedPresets = Array.isArray(presets)
        ? presets.filter((p) => p.uuid !== DEFAULT_PRESET_ID)
        : [];

    const topLevelPresets = savedPresets.filter((p) => !p.parentUuid);
    const childrenByParent = savedPresets.reduce((acc, preset) => {
        if (preset.parentUuid) {
            (acc[preset.parentUuid] = acc[preset.parentUuid] || []).push(preset);
        }
        return acc;
    }, {} as Record<string, Preset[]>);

    return (
        <div className="preset-dashboard">
            {/* Header / Actions Row */}
            <div className="dashboard-header-row">
                <div>
                    <span className="tactical-kicker">// LOADOUT PROFILES</span>
                    <h1 className="dashboard-title">Preset Dashboard</h1>
                </div>
                <div className="dashboard-buttons">
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-secondary"
                        onClick={onImportPresetClick}
                    >
                        Import Code
                    </button>
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-danger"
                        onClick={onNewPreset}
                    >
                        + Create Preset
                    </button>
                </div>
            </div>

            <div className="preset-dashboard-grid">
                {/* Current Loadout Prominent Card */}
                <div
                    className={`preset-dashboard-card current-loadout-card ${
                        selectedPreset?.uuid === defaultPreset.uuid ? "active" : ""
                    }`}
                    onClick={() => onPresetSelect(defaultPreset)}
                >
                    <div className="card-top">
                        <div className="card-badge">LIVE</div>
                        <h3 className="card-name">{defaultPreset.name}</h3>
                        <p className="card-desc">Your current in-game weapon skins and cosmetics.</p>
                    </div>
                    <div className="card-footer">
                        <button
                            type="button"
                            className="btn-card-action"
                            onClick={(e) => {
                                e.stopPropagation();
                                onPresetSelect(defaultPreset);
                            }}
                        >
                            View Live Loadout
                        </button>
                    </div>
                </div>

                {/* Saved Presets */}
                {topLevelPresets.map((preset) => {
                    const variants = childrenByParent[preset.uuid] || [];
                    return (
                        <div key={preset.uuid} className="preset-card-group">
                            <PresetCard
                                preset={preset}
                                isSelected={selectedPreset?.uuid === preset.uuid}
                                onSelect={onPresetSelect}
                                onApply={onPresetApply}
                                onRename={onPresetRename}
                                onDelete={onPresetDelete}
                                onCreateVariant={onCreateVariant}
                                onToggle={onTogglePreset}
                                onExport={onExportPreset}
                                agents={agents}
                                variantCount={variants.length}
                            />

                            {variants.map((child) => (
                                <PresetCard
                                    key={child.uuid}
                                    preset={child}
                                    isSelected={selectedPreset?.uuid === child.uuid}
                                    onSelect={onPresetSelect}
                                    onApply={onPresetApply}
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

                {savedPresets.length === 0 && (
                    <div className="presets-empty-state">
                        <div className="empty-icon">📂</div>
                        <h3>No Presets Configured</h3>
                        <p>Create a preset to save custom agent loadouts or import a configuration code.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Individual Preset Card Component ── */

export function PresetCard({
    preset,
    isSelected,
    onSelect,
    onApply,
    onRename,
    onDelete,
    onCreateVariant,
    onToggle,
    onExport,
    agents,
    isVariant = false,
    variantCount = 0,
}: {
    preset: Preset;
    isSelected: boolean;
    onSelect: (p: Preset) => void;
    onApply: (p: Preset) => void;
    onRename: (p: Preset) => void;
    onDelete: (id: string) => void;
    onCreateVariant?: (p: Preset) => void;
    onToggle: (p: Preset, checked: boolean) => void;
    onExport?: (p: Preset) => void;
    agents: Agent[];
    isVariant?: boolean;
    variantCount?: number;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const { weapons, playerCards } = useData();

    const equippedCard = useMemo(() => {
        const cardId = preset.identity?.playerCardId;
        if (!cardId) return null;
        return playerCards.find(c => c.uuid.toLowerCase() === cardId.toLowerCase());
    }, [preset.identity?.playerCardId, playerCards]);

    const skinPreviews = useMemo(() => {
        if (!preset.loadout) return [];
        const items: Array<{ name: string; image: string }> = [];
        
        const weaponPriority = [
            "2f59173c-433b-8590-a734-77e485057b24", // Melee
            "edf530be-4047-020c-7d49-7c2420a9d7dc", // Vandal
            "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", // Phantom
            "1baa85b4-4c70-1284-6d97-f7e170876c64", // Sheriff
            "a03b24d3-472b-9974-bc7e-3141fae62483", // Operator
        ];

        for (const wUuid of weaponPriority) {
            const equipped = preset.loadout[wUuid];
            if (!equipped) continue;
            
            const weapon = weapons.find(w => w.uuid === wUuid);
            if (!weapon) continue;

            const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
            if (!skin) continue;

            const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
            const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
            
            if (image) {
                items.push({
                    name: skin.displayName,
                    image,
                });
            }
        }

        if (items.length < 3) {
            for (const [wUuid, equipped] of Object.entries(preset.loadout)) {
                if (weaponPriority.includes(wUuid)) continue;
                const weapon = weapons.find(w => w.uuid === wUuid);
                if (!weapon) continue;
                const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
                if (!skin) continue;
                const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
                const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
                if (image) {
                    items.push({
                        name: skin.displayName,
                        image,
                    });
                }
                if (items.length >= 4) break;
            }
        }
        
        return items.slice(0, 4);
    }, [preset.loadout, weapons]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Find the first assigned agent for background portrait
    const assignedAgentId = preset.agents?.[0];
    const assignedAgent = assignedAgentId
        ? agents.find((a) => a.uuid === assignedAgentId)
        : null;

    const allAssignedAgents = (preset.agents || [])
        .map((id) => agents.find((a) => a.uuid === id))
        .filter((a): a is Agent => !!a);

    return (
        <div
            className={`preset-dashboard-card ${isSelected ? "active" : ""} ${
                isVariant ? "variant-card" : ""
            } ${preset.disabled ? "disabled-preset" : ""}`}
            onClick={() => onSelect(preset)}
        >
            {/* Faded Agent Portrait Background */}
            {assignedAgent && (
                <div className="card-bg-portrait">
                    <img
                        src={assignedAgent.displayIcon}
                        alt={assignedAgent.displayName}
                        draggable={false}
                    />
                </div>
            )}

            <div className="card-top">
                <div className="card-header-actions">
                    <div className="card-badge">{isVariant ? "VARIANT" : "PRESET"}</div>

                    {/* Auto-apply toggle */}
                    <label
                        className="card-switch"
                        title="Auto-apply when matches assigned agent"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            checked={!preset.disabled}
                            onChange={(e) => onToggle(preset, e.target.checked)}
                        />
                        <span className="card-switch-slider" />
                    </label>
                </div>

                <h3 className="card-name">{preset.name}</h3>

                {/* Assigned Agents list */}
                {allAssignedAgents.length > 0 && (
                    <div className="card-assigned-agents">
                        {allAssignedAgents.slice(0, 3).map((agent) => (
                            <div key={agent.uuid} className="mini-agent-bubble" title={agent.displayName}>
                                <img src={agent.displayIcon} alt={agent.displayName} />
                            </div>
                        ))}
                        {allAssignedAgents.length > 3 && (
                            <div className="mini-agent-bubble count">
                                +{allAssignedAgents.length - 3}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Visual Preview Strip */}
            {(skinPreviews.length > 0 || equippedCard) && (
                <div className="preset-skins-preview">
                    {equippedCard && (
                        <div className="preset-skin-preview-item identity-preview" title={`Card: ${equippedCard.displayName}`}>
                            <img src={equippedCard.smallArt || equippedCard.displayIcon} alt={equippedCard.displayName} style={{ objectFit: 'cover', borderRadius: '2px' }} />
                        </div>
                    )}
                    {skinPreviews.map((preview, i) => (
                        <div key={i} className="preset-skin-preview-item" title={preview.name}>
                            <img src={preview.image} alt={preview.name} />
                        </div>
                    ))}
                </div>
            )}

            <div className="card-footer" onClick={(e) => e.stopPropagation()}>
                <div className="card-left-info">
                    {variantCount > 0 && (
                        <span className="variant-count-indicator">
                            {variantCount} variant{variantCount > 1 ? "s" : ""}
                        </span>
                    )}
                </div>

                <div className="card-actions-group">
                    {/* Apply Button */}
                    <button
                        type="button"
                        className="btn-card-action apply"
                        onClick={() => onApply(preset)}
                        title="Apply Loadout"
                    >
                        ✓ Apply
                    </button>

                    {/* Edit Button */}
                    <button
                        type="button"
                        className="btn-card-action edit"
                        onClick={() => onSelect(preset)}
                        title="Edit Loadout"
                    >
                        Edit
                    </button>

                    {/* More actions menu */}
                    <div className="card-more-menu-container" ref={menuRef}>
                        <button
                            type="button"
                            className="btn-card-action-more"
                            onClick={() => setMenuOpen(!menuOpen)}
                            title="More options"
                        >
                            ⋮
                        </button>
                        {menuOpen && (
                            <div className="card-dropdown-menu">
                                <button
                                    type="button"
                                    onClick={() => {
                                        onRename(preset);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Rename
                                </button>
                                {!isVariant && onCreateVariant && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onCreateVariant(preset);
                                            setMenuOpen(false);
                                        }}
                                    >
                                        Create Variant
                                    </button>
                                )}
                                {onExport && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onExport(preset);
                                            setMenuOpen(false);
                                        }}
                                    >
                                        Export Code
                                    </button>
                                )}
                                <hr />
                                <button
                                    type="button"
                                    className="delete"
                                    onClick={() => {
                                        onDelete(preset.uuid);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Compact Preset Bar Card (for bottom strip in ArsenalView) ── */
export function PresetBarCard({
    preset,
    isSelected,
    onSelect,
    onApply,
    agents,
    isVariant = false,
}: {
    preset: Preset;
    isSelected: boolean;
    onSelect: (p: Preset) => void;
    onApply: (p: Preset) => void;
    agents: Agent[];
    isVariant?: boolean;
}) {
    const { weapons } = useData();

    const skinPreviews = useMemo(() => {
        if (!preset.loadout) return [];
        const items: Array<{ image: string }> = [];

        const weaponPriority = [
            "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", // Phantom
            "edf530be-4047-020c-7d49-7c2420a9d7dc", // Vandal
            "a03b24d3-472b-9974-bc7e-3141fae62483", // Operator
            "2f59173c-433b-8590-a734-77e485057b24", // Melee
            "1baa85b4-4c70-1284-6d97-f7e170876c64", // Sheriff
        ];

        for (const wUuid of weaponPriority) {
            const equipped = preset.loadout[wUuid];
            if (!equipped) continue;
            const weapon = weapons.find(w => w.uuid === wUuid);
            if (!weapon) continue;
            const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
            if (!skin) continue;
            const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
            const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
            if (image) {
                items.push({ image });
            }
        }

        if (items.length < 3) {
            for (const [wUuid, equipped] of Object.entries(preset.loadout)) {
                if (weaponPriority.includes(wUuid)) continue;
                const weapon = weapons.find(w => w.uuid === wUuid);
                if (!weapon) continue;
                const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
                if (!skin) continue;
                const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
                const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
                if (image) {
                    items.push({ image });
                }
                if (items.length >= 4) break;
            }
        }

        return items.slice(0, 4);
    }, [preset.loadout, weapons]);

    const assignedAgent = (preset.agents?.[0])
        ? agents.find((a) => a.uuid === preset.agents[0])
        : null;

    return (
        <div
            className={`preset-bar-card ${isSelected ? "active" : ""} ${isVariant ? "variant" : ""} ${preset.disabled ? "disabled" : ""}`}
            onClick={() => onSelect(preset)}
            title={preset.name}
        >
            {/* Skin preview strip */}
            <div className="preset-bar-card-media">
                {skinPreviews.length > 0 ? (
                    <div className="preset-bar-skins">
                        {skinPreviews.map((preview, i) => (
                            <div key={i} className="preset-bar-skin-item">
                                <img src={preview.image} alt="" draggable={false} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="preset-bar-empty">No skins</div>
                )}
            </div>

            <div className="preset-bar-card-footer">
                <div className="preset-bar-card-name-row">
                    <span className="preset-bar-card-name">{preset.name}</span>
                    {assignedAgent && (
                        <img
                            className="preset-bar-agent-icon"
                            src={assignedAgent.displayIcon}
                            alt={assignedAgent.displayName}
                            title={assignedAgent.displayName}
                        />
                    )}
                </div>
                <div className="preset-bar-card-actions">
                    <button
                        type="button"
                        className="preset-bar-apply-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onApply(preset);
                        }}
                        title="Apply preset"
                    >
                        ✓
                    </button>
                </div>
            </div>
        </div>
    );
}
