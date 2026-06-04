"use client";

import { Agent, IdentityV1, Preset, SpraySlot } from '@/lib/types';
import PresetList from './PresetList';
import PlayerCardPanel from './PlayerCardPanel';
import SprayWheelPanel from './SprayWheelPanel';
import PresetAgentStrip from './PresetAgentStrip';

type PresetDetailsPanelProps = {
    presets: Preset[];
    selectedPreset: Preset | null;
    defaultPreset: Preset;
    activePreset: Preset | null;
    agents: Agent[];
    identity: IdentityV1;
    sprays: SpraySlot[];
    isRefreshing: boolean;
    showAgentStrip: boolean;
    onPresetSelect: (preset: Preset) => void;
    onPresetApply: (preset: Preset) => void;
    onPresetDelete: (presetId: string) => void;
    onPresetRename: (preset: Preset) => void;
    onCreateVariant: (preset: Preset) => void;
    onTogglePreset: (preset: Preset, checked: boolean) => void;
    onExportPreset: (preset: Preset) => void;
    onImportPresetClick: () => void;
    onRefresh: () => void;
    onNewPreset: () => void;
    onSelectCard: (cardId: string) => void;
    onSelectTitle: (titleId: string) => void;
    onUpdateSprays: (sprays: SpraySlot[]) => void;
    onAgentAssignment: (agentIds: string[], isAssigned: boolean) => void;
};

export default function PresetDetailsPanel({
    presets,
    selectedPreset,
    defaultPreset,
    activePreset,
    agents,
    identity,
    sprays,
    isRefreshing,
    showAgentStrip,
    onPresetSelect,
    onPresetApply,
    onPresetDelete,
    onPresetRename,
    onCreateVariant,
    onTogglePreset,
    onExportPreset,
    onImportPresetClick,
    onRefresh,
    onNewPreset,
    onSelectCard,
    onSelectTitle,
    onUpdateSprays,
    onAgentAssignment,
}: PresetDetailsPanelProps) {
    return (
        <aside className="preset-details-panel glass-panel" aria-label="Preset details">
            <header className="preset-details-header">
                <div>
                    <span className="preset-details-kicker">Preset details</span>
                    <h2 className="preset-details-title">Loadouts</h2>
                </div>
                <div className="preset-details-header-actions">
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-ghost"
                        onClick={onRefresh}
                        disabled={isRefreshing}
                        title="Refresh from Valorant"
                    >
                        {isRefreshing ? '…' : '↻'}
                    </button>
                    <button type="button" className="btn-tactical btn-tactical-accent" onClick={onNewPreset}>
                        + New
                    </button>
                </div>
            </header>

            <div className="preset-details-scroll">
                <PresetList
                    presets={presets}
                    onPresetSelect={onPresetSelect}
                    selectedPreset={selectedPreset}
                    defaultPreset={defaultPreset}
                    onPresetApply={onPresetApply}
                    onPresetDelete={onPresetDelete}
                    onPresetRename={onPresetRename}
                    onCreateVariant={onCreateVariant}
                    onTogglePreset={onTogglePreset}
                    agents={agents}
                    onExportPreset={onExportPreset}
                    onImportPresetClick={onImportPresetClick}
                />

                <div className="preset-details-divider" />

                {showAgentStrip && activePreset && (
                    <PresetAgentStrip
                        preset={activePreset}
                        agents={agents}
                        assignedAgentIds={activePreset.agents || []}
                        onAssignmentChange={onAgentAssignment}
                    />
                )}

                <div className="preset-details-divider" />

                <div className="preset-details-block preset-details-block--preview">
                    <PlayerCardPanel
                    currentCardId={identity.playerCardId}
                    currentTitleId={identity.playerTitleId}
                    onSelectCard={onSelectCard}
                    onSelectTitle={onSelectTitle}
                />
                </div>

                <div className="preset-details-block preset-details-block--sprays">
                    <SprayWheelPanel currentSprays={sprays} onUpdateSprays={onUpdateSprays} />
                </div>
            </div>
        </aside>
    );
}
