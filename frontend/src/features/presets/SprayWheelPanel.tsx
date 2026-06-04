"use client";

import { useMemo, useState } from 'react';
import { useData } from '@/context/DataContext';
import { SpraySlot } from '@/lib/types';

const SPRAY_SLOTS = [
    { id: '0812b14c-4120-ed47-5cc2-c6b49b951408', name: 'Pre-Round', position: 'top' as const },
    { id: '04cbc83a-43cf-aa2a-ee40-a09869679f22', name: 'Mid-Round', position: 'right' as const },
    { id: 'ee063def-4a6b-8254-8e39-16a7eb108e42', name: 'Post-Round', position: 'bottom' as const },
    { id: 'd2b4e425-4a7b-3b3b-81d3-356c9a33bb58', name: 'Extra', position: 'left' as const },
];

type SprayWheelPanelProps = {
    currentSprays: SpraySlot[];
    onUpdateSprays: (sprays: SpraySlot[]) => void;
};

export default function SprayWheelPanel({ currentSprays, onUpdateSprays }: SprayWheelPanelProps) {
    const { sprays, ownedSprayIDs } = useData();
    const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const slotSprayMap = useMemo(() => {
        const map: Record<string, { icon: string; name: string }> = {};
        for (const slot of SPRAY_SLOTS) {
            const match = currentSprays.find(s => s.equipSlotId.toLowerCase() === slot.id.toLowerCase());
            if (!match) continue;
            const asset = sprays.find(a => a.uuid.toLowerCase() === match.sprayId.toLowerCase());
            if (asset) {
                map[slot.id] = {
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
        if (!searchQuery) return pool;
        return pool.filter(s => s.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [sprays, ownedSprayIDs, searchQuery]);

    const activeSlot = SPRAY_SLOTS.find(s => s.id === activeSlotId);

    const handleSelectSpray = (sprayUuid: string) => {
        if (!activeSlotId) return;
        const updated = currentSprays.filter(s => s.equipSlotId.toLowerCase() !== activeSlotId.toLowerCase());
        updated.push({ equipSlotId: activeSlotId, sprayId: sprayUuid });
        onUpdateSprays(updated);
    };

    const handleClearSlot = (slotId: string) => {
        onUpdateSprays(currentSprays.filter(s => s.equipSlotId.toLowerCase() !== slotId.toLowerCase()));
    };

    return (
        <div className="loadout-cosmetic-block loadout-cosmetic-block--sprays">
            <div className="loadout-section-label">SPRAYS</div>

            <div className="spray-wheel">
                <div className="spray-wheel-ring" aria-hidden="true" />
                <div className="spray-wheel-hub">Sprays</div>
                {SPRAY_SLOTS.map(slot => {
                    const equipped = slotSprayMap[slot.id];
                    const isActive = activeSlotId === slot.id;
                    return (
                        <button
                            key={slot.id}
                            type="button"
                            className={`spray-wheel-slot spray-wheel-slot--${slot.position}${isActive ? ' is-active' : ''}${equipped ? ' is-equipped' : ''}`}
                            onClick={() => setActiveSlotId(isActive ? null : slot.id)}
                            title={slot.name}
                        >
                            <span className="spray-wheel-slot-inner">
                                {equipped ? (
                                    <img src={equipped.icon} alt={equipped.name} loading="lazy" draggable={false} />
                                ) : (
                                    <span className="spray-wheel-slot-empty">+</span>
                                )}
                            </span>
                        </button>
                    );
                })}
            </div>

            {activeSlot && (
                <div className="spray-wheel-picker">
                    <div className="spray-wheel-picker-header">
                        <span>{activeSlot.name}</span>
                        {slotSprayMap[activeSlot.id] && (
                            <button type="button" className="btn-tactical btn-tactical-sm" onClick={() => handleClearSlot(activeSlot.id)}>
                                Clear
                            </button>
                        )}
                    </div>
                    <input
                        type="text"
                        className="tactical-input spray-wheel-search"
                        placeholder="Search sprays…"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                    <div className="spray-wheel-grid">
                        {displaySprays.map(spray => {
                            const isEquipped = currentSprays.some(
                                s =>
                                    s.equipSlotId.toLowerCase() === activeSlot.id.toLowerCase() &&
                                    s.sprayId.toLowerCase() === spray.uuid.toLowerCase()
                            );
                            return (
                                <button
                                    key={spray.uuid}
                                    type="button"
                                    className={`spray-wheel-item${isEquipped ? ' is-equipped' : ''}`}
                                    onClick={() => handleSelectSpray(spray.uuid)}
                                    title={spray.displayName}
                                >
                                    <img
                                        src={spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon}
                                        alt=""
                                        loading="lazy"
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
