"use client";

import { Preset, Agent } from "@/lib/types";
import React, { useState, useEffect, useRef } from "react";

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
        ? presets.filter((p) => p.uuid !== "default-preset")
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
                {allAssignedAgents.length > 0 ? (
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
                ) : (
                    <div className="card-assigned-agents-empty">No agents assigned</div>
                )}
            </div>

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
