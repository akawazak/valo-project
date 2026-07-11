"use client";

import { useState } from 'react';
import Image from 'next/image';
import { Agent, Preset } from '@/lib/types';
import AgentSelectionModal from '@/features/agents/AgentSelectionModal';

type PresetAgentStripProps = {
    preset: Preset;
    agents: Agent[];
    ownedAgentIds?: string[];
    assignedAgentIds: string[];
    onAssignmentChange: (agentIds: string[], isAssigned: boolean) => void;
    compact?: boolean;
};

export default function PresetAgentStrip({
    preset,
    agents,
    ownedAgentIds,
    assignedAgentIds,
    onAssignmentChange,
    compact = false,
}: PresetAgentStripProps) {
    const [showModal, setShowModal] = useState(false);
    const assigned = assignedAgentIds
        .map((id) => agents.find((agent) => agent.uuid === id))
        .filter((agent): agent is Agent => Boolean(agent));

    const picker = (
        <AgentSelectionModal
            show={showModal}
            onClose={() => setShowModal(false)}
            agents={agents}
            ownedAgentIds={ownedAgentIds || agents.map((agent) => agent.uuid)}
            selectedAgentIds={assignedAgentIds}
            onAgentSelect={(ids) => onAssignmentChange(ids, true)}
        />
    );

    if (compact) {
        return (
            <div className="preset-agent-toolbar">
                <button type="button" onClick={() => setShowModal(true)} title="Choose agents for this preset">
                    <span className="preset-agent-toolbar-icons" aria-hidden="true">
                        {assigned.slice(0, 3).map((agent) => <Image key={agent.uuid} src={agent.displayIcon} alt="" width={20} height={20} unoptimized />)}
                    </span>
                    <span>{assigned.length === 0 ? 'Assign Agents' : assigned.length === 1 ? assigned[0].displayName : `${assigned.length} Agents`}</span>
                </button>
                {picker}
            </div>
        );
    }

    return (
        <div className="preset-details-block preset-details-block--agents">
            <div className="preset-details-block-head">
                <span className="preset-details-kicker">Agents</span>
                <span className="preset-details-hint">Auto-switch targets</span>
            </div>
            <div className="preset-agent-strip">
                {assigned.map((agent) => (
                    <button
                        key={agent.uuid}
                        type="button"
                        className="preset-agent-chip"
                        onClick={() => onAssignmentChange([agent.uuid], false)}
                        title={`Remove ${agent.displayName}`}
                    >
                        <Image src={agent.displayIcon} alt="" width={28} height={28} unoptimized />
                        <span>{agent.displayName}</span>
                        <span className="preset-agent-chip-x" aria-hidden>×</span>
                    </button>
                ))}
                <button
                    type="button"
                    className="preset-agent-add"
                    onClick={() => setShowModal(true)}
                    title="Choose agents"
                >
                    +
                </button>
            </div>
            {assigned.length === 0 && (
                <p className="preset-details-empty">Assign owned agents to &quot;{preset.name}&quot; for auto-select.</p>
            )}
            {picker}
        </div>
    );
}
