import { useState } from 'react';
import { Agent, Preset } from '@/lib/types';
import AgentCard from './AgentCard';
import AgentSelectionModal from './AgentSelectionModal';

type AgentAssignerProps = {
    agents: Agent[];
    selectedPreset: Preset;
    assignedAgents: string[];
    onAssignmentChange: (agentIds: string[], isAssigned: boolean) => void;
};

export default function AgentAssigner({ agents, selectedPreset, assignedAgents, onAssignmentChange }: AgentAssignerProps) {
    const [showModal, setShowModal] = useState(false);

    const assignedAgentDetails = agents.filter(agent => assignedAgents.includes(agent.uuid));
    const availableAgents = agents.filter(agent => !assignedAgents.includes(agent.uuid));

    const handleAddAgents = (agentIds: string[]) => {
        onAssignmentChange(agentIds, true);
    };

    const handleRemoveAgent = (agentId: string) => {
        onAssignmentChange([agentId], false);
    };

    return (
        <div className="preset-panel agent-assigner-panel">
            <div className="section-header" style={{ marginBottom: '0.75rem' }}>
                <div>
                    <div className="tactical-kicker">// AGENTS</div>
                    <h3 className="section-title" style={{ fontSize: '1rem' }}>Assign agents for &quot;{selectedPreset.name}&quot;</h3>
                </div>
            </div>
            <p className="text-muted small mb-2">Open the picker and select multiple agents before confirming.</p>
            <div className="row row-cols-2 row-cols-md-4 row-cols-lg-6 g-3">
                {assignedAgentDetails.map((agent) => (
                    <div key={agent.uuid} className="col">
                        <AgentCard agent={agent} onRemove={handleRemoveAgent} />
                    </div>
                ))}
                <div className="col">
                    <button type="button" className="agent-assigner-add w-100 h-100 d-flex flex-column" onClick={() => setShowModal(true)}>
                        <div className="flex-grow-1 d-flex align-items-center justify-content-center p-2">
                            <span className="agent-assigner-add-icon" aria-hidden="true">+</span>
                        </div>
                        <small className="text-muted text-center pb-2">Add agents</small>
                    </button>
                </div>
            </div>
            <AgentSelectionModal
                show={showModal}
                onClose={() => setShowModal(false)}
                agents={availableAgents}
                onAgentSelect={handleAddAgents}
            />
        </div>
    );
}
