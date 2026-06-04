"use client";

import { useState } from 'react';
import Image from 'next/image';
import { Agent, Preset } from '@/lib/types';
import AgentSelectionModal from '@/features/agents/AgentSelectionModal';

type PresetAgentStripProps = {
    preset: Preset;
    agents: Agent[];
    assignedAgentIds: string[];
    onAssignmentChange: (agentIds: string[], isAssigned: boolean) => void;
};

export default function PresetAgentStrip({
    preset,
    agents,
    assignedAgentIds,
    onAssignmentChange,
}: PresetAgentStripProps) {
    const [showModal, setShowModal] = useState(false);
    const assigned = agents.filter(a => assignedAgentIds.includes(a.uuid));
    const available = agents.filter(a => !assignedAgentIds.includes(a.uuid));

    return (
        <div className="preset-details-block preset-details-block--agents">
            <div className="preset-details-block-head">
                <span className="preset-details-kicker">Agents</span>
                <span className="preset-details-hint">Auto-switch targets</span>
            </div>
            <div className="preset-agent-strip">
                {assigned.map(agent => (
                    <button
                        key={agent.uuid}
                        type="button"
                        className="preset-agent-chip"
                        onClick={() => onAssignmentChange([agent.uuid], false)}
                        title={`Remove ${agent.displayName}`}
                    >
                        <Image src={agent.displayIcon} alt="" width={28} height={28} unoptimized />
                        <span className="preset-agent-chip-x" aria-hidden>×</span>
                    </button>
                ))}
                <button
                    type="button"
                    className="preset-agent-add"
                    onClick={() => setShowModal(true)}
                    title="Add agents to preset"
                >
                    +
                </button>
            </div>
            {assigned.length === 0 && (
                <p className="preset-details-empty">Link agents to &quot;{preset.name}&quot; for auto-select.</p>
            )}
            <AgentSelectionModal
                show={showModal}
                onClose={() => setShowModal(false)}
                agents={available}
                onAgentSelect={(ids) => onAssignmentChange(ids, true)}
            />
        </div>
    );
}
