"use client";

import { useState, useMemo } from 'react';
import { useData } from '@/context/DataContext';
import { SprayAsset, SpraySlot } from '@/lib/types';

interface SpraySelectorProps {
    currentSprays: SpraySlot[];
    onUpdateSprays: (sprays: SpraySlot[]) => void;
}

const SPRAY_SLOTS = [
    { id: '0812b14c-4120-ed47-5cc2-c6b49b951408', name: 'Pre-Round' },
    { id: '04cbc83a-43cf-aa2a-ee40-a09869679f22', name: 'Mid-Round' },
    { id: 'ee063def-4a6b-8254-8e39-16a7eb108e42', name: 'Post-Round' },
    { id: 'd2b4e425-4a7b-3b3b-81d3-356c9a33bb58', name: 'Extra / Wheel' }
];

export default function SpraySelector({ currentSprays, onUpdateSprays }: SpraySelectorProps) {
    const { sprays, ownedSprayIDs } = useData();
    const [selectedSlotId, setSelectedSlotId] = useState<string>(SPRAY_SLOTS[0].id);
    const [searchQuery, setSearchQuery] = useState('');

    const displaySprays = useMemo(() => {
        const owned = sprays.filter(s => ownedSprayIDs.map(id => id.toLowerCase()).includes(s.uuid.toLowerCase()));
        const pool = owned.length > 0 ? owned : sprays;
        if (!searchQuery) return pool;
        return pool.filter(s => s.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [sprays, ownedSprayIDs, searchQuery]);

    const slotSprayMap = useMemo(() => {
        const map: Record<string, SprayAsset> = {};
        SPRAY_SLOTS.forEach(slot => {
            const match = currentSprays.find(s => s.equipSlotId.toLowerCase() === slot.id.toLowerCase());
            if (match) {
                const sprayAsset = sprays.find(a => a.uuid.toLowerCase() === match.sprayId.toLowerCase());
                if (sprayAsset) map[slot.id] = sprayAsset;
            }
        });
        return map;
    }, [currentSprays, sprays]);

    const handleSelectSpray = (sprayUuid: string) => {
        const updated = currentSprays.filter(s => s.equipSlotId.toLowerCase() !== selectedSlotId.toLowerCase());
        updated.push({ equipSlotId: selectedSlotId, sprayId: sprayUuid });
        onUpdateSprays(updated);
    };

    const handleClearSlot = (slotId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = currentSprays.filter(s => s.equipSlotId.toLowerCase() !== slotId.toLowerCase());
        onUpdateSprays(updated);
    };

    const activeSlotName = SPRAY_SLOTS.find(s => s.id === selectedSlotId)?.name || 'Spray';

    return (
        <div className="preset-panel mt-3">
            <div className="section-row mb-3" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.75rem' }}>
                <div>
                    <div className="tactical-kicker">// EXPRESSION</div>
                    <h3 className="tactical-title mb-0" style={{ fontSize: '1.2rem' }}>Custom Sprays</h3>
                </div>
            </div>

            <div className="spray-slot-grid mb-4">
                {SPRAY_SLOTS.map(slot => {
                    const activeSpray = slotSprayMap[slot.id];
                    const isSelected = slot.id === selectedSlotId;
                    return (
                        <div key={slot.id}>
                            <div
                                onClick={() => setSelectedSlotId(slot.id)}
                                className={`spray-slot-card${isSelected ? ' active' : ''}`}
                            >
                                <span className="spray-slot-label">{slot.name}</span>
                                <div className="spray-slot-preview">
                                    {activeSpray ? (
                                        <>
                                            <img src={activeSpray.displayIcon} alt={activeSpray.displayName} loading="lazy" />
                                            <span className="spray-slot-clear" onClick={(e) => handleClearSlot(slot.id, e)}>×</span>
                                        </>
                                    ) : (
                                        <div className="spray-slot-empty">+</div>
                                    )}
                                </div>
                                <span className="spray-slot-name">{activeSpray?.displayName || 'Empty'}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="spray-drawer">
                <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                    <h4 className="m-0 fs-6 font-monospace text-white uppercase">
                        Select Spray for <span style={{ color: 'var(--accent-red)' }}>{activeSlotName}</span>
                    </h4>
                    <div className="position-relative" style={{ maxWidth: '250px', width: '100%' }}>
                        <input
                            type="text"
                            placeholder="Search sprays..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="tactical-input ps-4"
                            style={{ fontSize: '0.8rem', height: '32px' }}
                        />
                        <svg className="position-absolute translate-middle-y top-50 start-0 ms-2" style={{ color: 'var(--text-dim)' }} xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor">
                            <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z"/>
                        </svg>
                    </div>
                </div>

                <div className="spray-grid" style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                    {displaySprays.map(spray => {
                        const isEquipped = currentSprays.some(
                            s => s.equipSlotId.toLowerCase() === selectedSlotId.toLowerCase() &&
                                 s.sprayId.toLowerCase() === spray.uuid.toLowerCase()
                        );
                        return (
                            <div key={spray.uuid}>
                                <div
                                    onClick={() => handleSelectSpray(spray.uuid)}
                                    className={`spray-item${isEquipped ? ' equipped' : ''}`}
                                >
                                    <img
                                        src={spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon}
                                        alt={spray.displayName}
                                        loading="lazy"
                                    />
                                    <span className="spray-item-name">{spray.displayName}</span>
                                </div>
                            </div>
                        );
                    })}
                    {displaySprays.length === 0 && (
                        <div className="col-12 py-4 text-center text-muted font-monospace">No Sprays Found</div>
                    )}
                </div>
            </div>
        </div>
    );
}
