"use client";

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '@/context/DataContext';
import { SpraySlot } from '@/lib/types';

const SPRAY_SLOTS = [
    { id: '0812b14c-4120-ed47-5cc2-c6b49b951408', name: 'Pre-Round', position: 'top' as const },
    { id: '04cbc83a-43cf-aa2a-ee40-a09869679f22', name: 'Mid-Round', position: 'right' as const },
    { id: 'ee063def-4a6b-8254-8e39-16a7eb108e42', name: 'Post-Round', position: 'bottom' as const },
    { id: 'd2b4e425-4a7b-3b3b-81d3-356c9a33bb58', name: 'Extra / Wheel', position: 'left' as const },
];

type SprayWheelPanelProps = {
    currentSprays: SpraySlot[];
    onUpdateSprays: (sprays: SpraySlot[]) => void;
};

export default function SprayWheelPanel({ currentSprays, onUpdateSprays }: SprayWheelPanelProps) {
    const { sprays, ownedSprayIDs } = useData();
    
    // Active slot state for opening search modal
    const [modalSlotId, setModalSlotId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const slotSprayMap = useMemo(() => {
        const map: Record<string, { icon: string; name: string; uuid: string }> = {};
        for (const slot of SPRAY_SLOTS) {
            const match = currentSprays.find(s => s.equipSlotId.toLowerCase() === slot.id.toLowerCase());
            if (!match) continue;
            const asset = sprays.find(a => a.uuid.toLowerCase() === match.sprayId.toLowerCase());
            if (asset) {
                map[slot.id] = {
                    uuid: asset.uuid,
                    icon: asset.displayIcon || asset.fullIcon || asset.fullTransparentIcon || '',
                    name: asset.displayName,
                };
            }
        }
        return map;
    }, [currentSprays, sprays]);

    const displaySprays = useMemo(() => {
        const owned = sprays.filter(s =>
            ownedSprayIDs.map(id => id.toLowerCase()).includes(s.uuid.toLowerCase())
        );
        const pool = owned.length > 0 ? owned : sprays;
        
        // Sort alphabetically
        const sorted = [...pool].sort((a, b) => a.displayName.localeCompare(b.displayName));
        
        if (!searchQuery) return sorted;
        return sorted.filter(s => s.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [sprays, ownedSprayIDs, searchQuery]);

    const activeSlot = SPRAY_SLOTS.find(s => s.id === modalSlotId);

    const handleSelectSpray = (sprayUuid: string) => {
        if (!modalSlotId) return;
        const updated = currentSprays.filter(s => s.equipSlotId.toLowerCase() !== modalSlotId.toLowerCase());
        updated.push({ equipSlotId: modalSlotId, sprayId: sprayUuid });
        onUpdateSprays(updated);
        setModalSlotId(null);
        setSearchQuery('');
    };

    const handleClearSlot = (slotId: string) => {
        onUpdateSprays(currentSprays.filter(s => s.equipSlotId.toLowerCase() !== slotId.toLowerCase()));
        setModalSlotId(null);
        setSearchQuery('');
    };

    const handleCloseModal = () => {
        setModalSlotId(null);
        setSearchQuery('');
    };

    return (
        <div className="cosmetics-panel-container">
            {/* Spray Wheel Section */}
            <div className="premium-spray-wheel-wrapper">
                <div className="cosmetics-sub-header">Sprays</div>
                
                <div className="circular-spray-wheel">
                    <div className="circular-spray-wheel-ring" />
                    <div className="circular-spray-wheel-center">Sprays</div>
                    
                    {SPRAY_SLOTS.map(slot => {
                        const equipped = slotSprayMap[slot.id];
                        const className = `circular-spray-slot circular-spray-slot--${slot.position}${equipped ? ' is-equipped' : ''}`;
                        return (
                            <button
                                key={slot.id}
                                type="button"
                                className={className}
                                onClick={() => setModalSlotId(slot.id)}
                                title={`${slot.name}${equipped ? `: ${equipped.name}` : ' (Empty)'}`}
                            >
                                <div className="circular-spray-slot-inner">
                                    {equipped ? (
                                        <img src={equipped.icon} alt={equipped.name} loading="lazy" draggable={false} />
                                    ) : (
                                        <span className="circular-spray-slot-empty">+</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="circular-spray-label-hint">Click a slot to configure</div>
            </div>

            {activeSlot && createPortal(
                <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCloseModal()}>
                    <div className="unified-modal-container spray-picker-modal">
                        {/* Header */}
                        <div className="unified-modal-header">
                            <div className="unified-modal-title-wrap">
                                <span className="kicker">// Customize Spray Slot</span>
                                <h3 className="unified-modal-title">{activeSlot.name}</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={handleCloseModal} aria-label="Close">
                                ✕
                            </button>
                        </div>

                        {/* Split Content */}
                        <div className="unified-modal-content spray-picker-modal-content">
                            {/* Left Pane: Preview and Clear Actions */}
                            <div className="unified-modal-left spray-picker-modal-left">
                                <div className="unified-modal-preview-box spray-picker-modal-preview">
                                    <div className="unified-modal-card-tier-line" style={{ backgroundColor: 'var(--accent)' }} />
                                    {slotSprayMap[activeSlot.id] ? (
                                        <img
                                            src={slotSprayMap[activeSlot.id].icon}
                                            alt={slotSprayMap[activeSlot.id].name}
                                            className="unified-modal-preview-img"
                                            style={{ maxHeight: '70%', maxWidth: '70%', objectFit: 'contain' }}
                                        />
                                    ) : (
                                        <div className="spray-picker-empty" aria-label="Empty spray slot">—</div>
                                    )}
                                </div>

                                <div className="unified-modal-skin-meta">
                                    <h4>{slotSprayMap[activeSlot.id]?.name || "Empty Slot"}</h4>
                                    <span>{slotSprayMap[activeSlot.id] ? "Equipped in preset" : "No spray selected"}</span>
                                </div>

                                {slotSprayMap[activeSlot.id] && (
                                    <div className="spray-picker-clear-action">
                                        <button
                                            type="button"
                                            className="btn-tactical btn-tactical-ghost"
                                            style={{ width: '100%', border: '1px solid var(--accent)', color: 'var(--accent)', padding: '0.6rem', fontWeight: 700, fontSize: '0.75rem' }}
                                            onClick={() => handleClearSlot(activeSlot.id)}
                                        >
                                            Clear Spray Slot
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Right Pane: Search and Grid */}
                            <div className="unified-modal-right">
                                <div className="unified-modal-tabs-row">
                                    <button type="button" className="unified-modal-tab-btn active">
                                        Owned Sprays ({displaySprays.length})
                                    </button>
                                </div>

                                {/* Search Bar */}
                                <div className="unified-modal-search-box">
                                    <input
                                        type="text"
                                        placeholder="Search sprays…"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        autoFocus
                                    />
                                    <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor">
                                        <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z"/>
                                    </svg>
                                </div>

                                {/* Scrollable List Grid */}
                                <div className="unified-modal-grid-scroll">
                                    {displaySprays.length === 0 ? (
                                        <div className="skin-list-empty">No sprays match your search.</div>
                                    ) : (
                                        <div className="unified-modal-cards-grid">
                                            {displaySprays.map(spray => {
                                                const isEquipped = slotSprayMap[activeSlot.id]?.uuid === spray.uuid;
                                                const sprayIcon = spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon;
                                                return (
                                                    <button
                                                        key={spray.uuid}
                                                        type="button"
                                                        className={`unified-modal-card-item${isEquipped ? ' active' : ''}`}
                                                        onClick={() => handleSelectSpray(spray.uuid)}
                                                        title={spray.displayName}
                                                    >
                                                        <div className="unified-modal-card-img-wrap" style={{ aspectRatio: '1', padding: '0.45rem' }}>
                                                            <img src={sprayIcon} alt="" style={{ objectFit: 'contain' }} />
                                                        </div>
                                                        <div className="unified-modal-card-info">
                                                            <span className="unified-modal-card-name">{spray.displayName}</span>
                                                            {isEquipped && <span className="unified-modal-card-status">Equipped</span>}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
