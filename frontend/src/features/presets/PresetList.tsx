"use client";

import Image from 'next/image';
import { Preset, Agent } from '@/lib/types';
import React, { useState, useEffect, useRef } from 'react';

type PresetListProps = {
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
};

export default function PresetList({
    presets, selectedPreset, onPresetSelect, onPresetDelete, onPresetApply,
    onPresetRename, onCreateVariant, onTogglePreset, defaultPreset, agents,
    onExportPreset, onImportPresetClick
}: PresetListProps) {
    const savedPresets = Array.isArray(presets) ? presets.filter(p => p.uuid !== 'default-preset') : [];

    const getAgentIcons = (agentIds: string[] | undefined) => {
        if (!agentIds) return null;
        if (agentIds.length > 3) {
            const firstTwo = agentIds.slice(0, 2);
            const icons = firstTwo.map(id => {
                const agent = agents.find(a => a.uuid === id);
                return agent ? <Image key={agent.uuid} src={agent.displayIcon} alt={agent.displayName} width={18} height={18} className="preset-card-agent-icon" unoptimized /> : null;
            });
            icons.push(<span key="plus" className="preset-card-agent-icon" style={{ background: 'rgba(255,255,255,0.08)', fontSize: '0.6rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#8b95a5' }}>+{agentIds.length - 2}</span>);
            return icons;
        }
        return agentIds.map(id => {
            const agent = agents.find(a => a.uuid === id);
            return agent ? <Image key={agent.uuid} src={agent.displayIcon} alt={agent.displayName} width={18} height={18} className="preset-card-agent-icon" unoptimized /> : null;
        });
    };

    const topLevelPresets = savedPresets.filter(p => !p.parentUuid);
    const childrenByParent = savedPresets.reduce((acc, preset) => {
        if (preset.parentUuid) {
            (acc[preset.parentUuid] = acc[preset.parentUuid] || []).push(preset);
        }
        return acc;
    }, {} as Record<string, Preset[]>);

    return (
        <div>
            <button
                type="button"
                className={`preset-card${selectedPreset?.uuid === defaultPreset.uuid ? ' active' : ''}`}
                onClick={() => onPresetSelect(defaultPreset)}
            >
                <div className="preset-card-info">
                    <span className="preset-card-name">{defaultPreset.name}</span>
                </div>
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.75rem 0' }}>
                <span className="tactical-kicker">Saved Presets</span>
                <button type="button" className="btn-tactical" onClick={onImportPresetClick}>
                    Import Code
                </button>
            </div>

            {savedPresets.length === 0 ? (
                <p className="text-muted small">No presets saved yet.</p>
            ) : (
                <div className="preset-list">
                    {topLevelPresets.map((preset) => (
                        <React.Fragment key={preset.uuid}>
                            <PresetRow
                                preset={preset}
                                isSelected={selectedPreset?.uuid === preset.uuid}
                                onSelect={onPresetSelect}
                                onApply={onPresetApply}
                                onRename={onPresetRename}
                                onDelete={onPresetDelete}
                                onCreateVariant={onCreateVariant}
                                onToggle={onTogglePreset}
                                onExport={onExportPreset}
                                agentIcons={getAgentIcons(preset.agents)}
                            />
                            {childrenByParent[preset.uuid]?.map(child => (
                                <PresetRow
                                    key={child.uuid}
                                    preset={child}
                                    isSelected={selectedPreset?.uuid === child.uuid}
                                    onSelect={onPresetSelect}
                                    onApply={onPresetApply}
                                    onRename={onPresetRename}
                                    onDelete={onPresetDelete}
                                    onToggle={onTogglePreset}
                                    onExport={onExportPreset}
                                    agentIcons={getAgentIcons(child.agents)}
                                    isVariant
                                />
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            )}
        </div>
    );
}

function PresetRow({
    preset, isSelected, onSelect, onApply, onRename, onDelete, onCreateVariant, onToggle, onExport, agentIcons, isVariant
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
    agentIcons: React.ReactNode;
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

    return (
        <div className={`preset-card${isSelected ? ' active' : ''}${isVariant ? ' variant' : ''}`} style={isVariant ? { marginLeft: '1.25rem', position: 'relative' } : undefined}>
            <div className="preset-card-info" onClick={() => onSelect(preset)}>
                <span className="preset-card-name">{preset.name}</span>
                {agentIcons && <div className="preset-card-agents">{agentIcons}</div>}
            </div>
            <div className="preset-card-actions">
                <input
                    type="checkbox"
                    className="preset-toggle"
                    checked={!preset.disabled}
                    onChange={(e) => onToggle(preset, e.target.checked)}
                    title="Toggle preset"
                />
                <button className="btn-tactical btn-tactical-success btn-tactical-icon" onClick={() => onApply(preset)} title="Apply">
                    ✓
                </button>
                <div style={{ position: 'relative' }} ref={menuRef}>
                    <button className="btn-tactical btn-tactical-icon" onClick={() => setMenuOpen(v => !v)} title="More">
                        ⋮
                    </button>
                    {menuOpen && (
                        <div style={{
                            position: 'absolute',
                            right: 0,
                            top: 'calc(100% + 4px)',
                            minWidth: '140px',
                            background: 'rgba(13, 23, 30, 0.98)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '6px',
                            overflow: 'hidden',
                            zIndex: 100,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        }}>
                            <MenuItem onClick={() => { onRename(preset); setMenuOpen(false); }}>Rename</MenuItem>
                            {!isVariant && <MenuItem onClick={() => { onCreateVariant?.(preset); setMenuOpen(false); }}>Create Variant</MenuItem>}
                            <MenuItem onClick={() => { onExport?.(preset); setMenuOpen(false); }}>Export Code</MenuItem>
                            <MenuItem onClick={() => { onDelete(preset.uuid); setMenuOpen(false); }} style={{ color: '#ff4655' }}>Delete</MenuItem>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function MenuItem({ children, onClick, style }: { children: React.ReactNode; onClick: () => void; style?: React.CSSProperties }) {
    return (
        <button
            onClick={onClick}
            style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '0.5rem 0.75rem',
                textAlign: 'left',
                color: '#a8bac6',
                fontSize: '0.78rem',
                fontFamily: '"JetBrains Mono", monospace',
                cursor: 'pointer',
                transition: 'background 0.1s',
                ...style,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {children}
        </button>
    );
}
