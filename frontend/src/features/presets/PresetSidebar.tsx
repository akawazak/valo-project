"use client";

import { useState, useEffect, useRef } from 'react';
import { Preset, Agent } from '@/lib/types';
import { DEFAULT_PRESET_ID } from '@/lib/effectivePreset';

interface PresetSidebarProps {
    presets: Preset[];
    selectedPreset: Preset | null;
    onPresetSelect: (preset: Preset) => void;
    onPresetApply: (preset: Preset) => void;
    onPresetRename: (preset: Preset) => void;
    onPresetDelete: (presetId: string) => void;
    onTogglePreset: (preset: Preset, checked: boolean) => void;
    onCreateVariant: (preset: Preset) => void;
    onExportPreset: (preset: Preset) => void;
    onImportPresetClick: () => void;
    onNewPreset: () => void;
    agents: Agent[];
}

export default function PresetSidebar({
    presets,
    selectedPreset,
    onPresetSelect,
    onPresetApply,
    onPresetRename,
    onPresetDelete,
    onTogglePreset,
    onCreateVariant,
    onExportPreset,
    onImportPresetClick,
    onNewPreset,
    agents,
    }: PresetSidebarProps) {
    const [collapsed, setCollapsed] = useState(false);

    const savedPresets = Array.isArray(presets)
        ? presets.filter((p) => p.uuid !== DEFAULT_PRESET_ID)
        : [];

    const topLevelPresets = savedPresets.filter((p) => !p.parentUuid);
    const childrenByParent = savedPresets.reduce<Record<string, Preset[]>>((acc, preset) => {
        if (preset.parentUuid) {
            (acc[preset.parentUuid] = acc[preset.parentUuid] || []).push(preset);
        }
        return acc;
    }, {});

    return (
        <div className={`arsenal-v2-preset-sidebar ${collapsed ? 'collapsed' : ''}`}>
            {/* Sidebar toggle header */}
            <div className="preset-sidebar-header">
                <div className="preset-sidebar-header-left">
                    <span className="preset-sidebar-title">Presets</span>
                    <span className="preset-sidebar-count">{savedPresets.length}</span>
                </div>
                <div className="preset-sidebar-header-right">
                    <button
                        type="button"
                        className="preset-sidebar-new-btn"
                        onClick={onNewPreset}
                        title="Create new preset"
                    >
                        +
                    </button>
                    <button
                        type="button"
                        className="preset-sidebar-collapse-btn"
                        onClick={() => setCollapsed(c => !c)}
                        title={collapsed ? 'Expand presets' : 'Collapse presets'}
                    >
                        {collapsed ? '‹' : '›'}
                    </button>
                </div>
            </div>

            {/* Sidebar content */}
            {!collapsed && (
                <div className="preset-sidebar-body">
                    {/* Import button */}
                    <button
                        type="button"
                        className="arsenal-v2-import-btn"
                        onClick={onImportPresetClick}
                    >
                        Import Code
                    </button>

                    {/* Saved presets list */}
                    <div className="arsenal-v2-preset-list">
                        {savedPresets.length === 0 ? (
                            <div className="preset-sidebar-empty">
                                <span>No saved presets yet.</span>
                            </div>
                        ) : (
                            topLevelPresets.map((preset) => {
                                const variants = childrenByParent[preset.uuid] || [];
                                return (
                                    <div key={preset.uuid}>
                                        <PresetSidebarRow
                                            preset={preset}
                                            isSelected={selectedPreset?.uuid === preset.uuid}
                                            onSelect={onPresetSelect}
                                            onApply={onPresetApply}
                                            onRename={onPresetRename}
                                            onDelete={onPresetDelete}
                                            onToggle={onTogglePreset}
                                            onCreateVariant={onCreateVariant}
                                            onExport={onExportPreset}
                                            agents={agents}
                                        />
                                        {variants.map((child) => (
                                            <PresetSidebarRow
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
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Sidebar row component ── */
export function PresetSidebarRow({
    preset,
    isSelected,
    onSelect,
    onApply,
    onRename,
    onDelete,
    onToggle,
    onCreateVariant,
    onExport,
    agents,
    isVariant = false,
}: {
    preset: Preset;
    isSelected: boolean;
    onSelect: (p: Preset) => void;
    onApply: (p: Preset) => void;
    onRename: (p: Preset) => void;
    onDelete: (id: string) => void;
    onToggle: (p: Preset, checked: boolean) => void;
    onCreateVariant?: (p: Preset) => void;
    onExport?: (p: Preset) => void;
    agents: Agent[];
    isVariant?: boolean;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const allAssignedAgents = (preset.agents || [])
        .map((id) => agents.find((a) => a.uuid === id))
        .filter((a): a is Agent => !!a);

    return (
        <div
            className={`arsenal-v2-preset-row ${isSelected ? 'active' : ''} ${isVariant ? 'variant' : ''} ${preset.disabled ? 'disabled' : ''}`}
        >
            {/* Main clickable area */}
            <button
                type="button"
                className="arsenal-v2-preset-row-main"
                onClick={() => onSelect(preset)}
                title={preset.name}
            >
                <div className="arsenal-v2-preset-row-name">{preset.name}</div>
                {allAssignedAgents.length > 0 && (
                    <div className="arsenal-v2-preset-row-agents">
                        {allAssignedAgents.slice(0, 3).map((agent) => (
                            <img
                                key={agent.uuid}
                                src={agent.displayIcon}
                                alt={agent.displayName}
                                title={agent.displayName}
                                className="preset-row-agent-icon"
                            />
                        ))}
                    </div>
                )}
            </button>

            {/* Actions */}
            <div className="arsenal-v2-preset-row-actions">
                <label
                    className="preset-row-toggle"
                    title="Enable/disable preset"
                    onClick={(e) => e.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        checked={!preset.disabled}
                        onChange={(e) => onToggle(preset, e.target.checked)}
                    />
                    <span className="preset-row-toggle-slider" />
                </label>

                <button
                    type="button"
                    className="arsenal-v2-preset-row-btn apply"
                    onClick={(e) => {
                        e.stopPropagation();
                        onApply(preset);
                    }}
                    title="Apply preset"
                >
                    ✓
                </button>

                <div className="preset-row-menu-container" ref={menuRef}>
                    <button
                        type="button"
                        className="arsenal-v2-preset-row-btn"
                        onClick={() => setMenuOpen(!menuOpen)}
                        title="More options"
                    >
                        ⋮
                    </button>
                    {menuOpen && (
                        <div className="arsenal-v2-preset-row-menu">
                            <button onClick={() => { onRename(preset); setMenuOpen(false); }}>
                                Rename
                            </button>
                            {!isVariant && onCreateVariant && (
                                <button onClick={() => { onCreateVariant(preset); setMenuOpen(false); }}>
                                    Create Variant
                                </button>
                            )}
                            {onExport && (
                                <button onClick={() => { onExport(preset); setMenuOpen(false); }}>
                                    Export Code
                                </button>
                            )}
                            <hr />
                            <button
                                className="delete"
                                onClick={() => { onDelete(preset.uuid); setMenuOpen(false); }}
                            >
                                Delete
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}