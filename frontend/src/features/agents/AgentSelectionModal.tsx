import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Agent } from '@/lib/types';

type AgentSelectionModalProps = {
    show: boolean;
    onClose: () => void;
    agents: Agent[];
    onAgentSelect: (agentIds: string[]) => void;
    ownedAgentIds?: string[];
    selectedAgentId?: string;
    selectedAgentIds?: string[];
    selectionMode?: 'single' | 'multiple';
};

export default function AgentSelectionModal({
    show,
    onClose,
    agents,
    onAgentSelect,
    ownedAgentIds,
    selectedAgentId,
    selectedAgentIds,
    selectionMode = 'multiple',
}: AgentSelectionModalProps) {
    const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
    const ownedSet = new Set((ownedAgentIds || agents.map((agent) => agent.uuid)).map((id) => id.toLowerCase()));

    useEffect(() => {
        if (!show) return;
        setSelectedAgents(
            selectionMode === 'single'
                ? (selectedAgentId ? [selectedAgentId] : [])
                : [...new Set(selectedAgentIds || [])],
        );
    }, [selectedAgentId, selectedAgentIds, selectionMode, show]);

    if (!show || typeof document === 'undefined') {
        return null;
    }

    const handleAgentClick = (agentId: string) => {
        if (selectionMode === 'single') {
            setSelectedAgents((current) => current[0] === agentId ? [] : [agentId]);
            return;
        }
        setSelectedAgents(prev =>
            prev.includes(agentId)
                ? prev.filter(id => id !== agentId)
                : [...prev, agentId]
        );
    };

    const handleConfirm = () => {
        onAgentSelect(selectionMode === 'single' ? selectedAgents.slice(0, 1) : selectedAgents);
        handleClose();
    };

    const handleClose = () => {
        setSelectedAgents([]);
        onClose();
    }

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    };

    return createPortal(
        <div className="modal modal-backdrop-valovault agent-selection-modal" onClick={handleBackdropClick}>
            <div className="modal-dialog modal-dialog-centered modal-lg">
                <div className="modal-content">
                    <div className="modal-header">
                        <div>
                            <span className="tactical-kicker">// PRESET ASSIGNMENT</span>
                            <h5 className="modal-title">{selectionMode === 'single' ? 'Choose an agent' : 'Select agents'}</h5>
                        </div>
                        <button type="button" className="btn-close" onClick={handleClose}></button>
                    </div>
                    <div className="modal-body">
                        <div className="agent-picker-grid" role="listbox" aria-label="Available agents">
                            {agents.map((agent) => {
                                const owned = agent.isBaseContent || ownedSet.has(agent.uuid.toLowerCase());
                                const selected = selectedAgents.includes(agent.uuid);
                                return (
                                    <button
                                        key={agent.uuid}
                                        type="button"
                                        className={`agent-pick-card${selected ? ' is-selected' : ''}${owned ? '' : ' is-locked'}`}
                                        onClick={() => handleAgentClick(agent.uuid)}
                                        aria-pressed={selected}
                                        disabled={!owned}
                                        title={owned ? `Assign ${agent.displayName}` : `${agent.displayName} is not unlocked on this account`}
                                    >
                                        <span className="agent-pick-card-art">
                                            <Image src={agent.displayIcon} alt="" width={72} height={72} unoptimized />
                                            {selected && <span className="agent-pick-card-check" aria-hidden="true" />}
                                        </span>
                                        <span className="agent-pick-card-name">{agent.displayName}</span>
                                        {!owned && <span className="agent-pick-card-lock">Locked</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="modal-footer">
                        <span className="agent-picker-selection-count">
                            {selectedAgents.length
                                ? `${selectedAgents.length} selected`
                                : selectionMode === 'single' ? 'Choose one unlocked agent' : 'Choose one or more unlocked agents'}
                        </span>
                        <button type="button" className="btn btn-primary" onClick={handleConfirm} disabled={selectedAgents.length === 0}>
                            {selectionMode === 'single' ? 'Assign agent' : `Add (${selectedAgents.length})`}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
