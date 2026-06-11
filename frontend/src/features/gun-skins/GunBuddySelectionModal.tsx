import Image from 'next/image';
import { useState } from 'react';
import { LoadoutItemV1 } from '@/lib/types';
import { useData } from '@/context/DataContext';

type GunBuddySelectionModalProps = {
    onSelect: (charmID: string, charmLevelID: string) => void;
    onClose: () => void;
    weaponName: string;
    currentLoadout: Record<string, LoadoutItemV1>;
};

export default function GunBuddySelectionModal({ onSelect, onClose, weaponName, currentLoadout }: GunBuddySelectionModalProps) {
    const { ownedBuddies } = useData();
    const [searchTerm, setSearchTerm] = useState('');

    const filteredBuddies = ownedBuddies.filter(b =>
        b.displayName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getBuddyUsage = (loadout: Record<string, LoadoutItemV1>, buddyLevelId: string): number => {
        return Object.values(loadout).filter(item => item.charmLevelID === buddyLevelId).length;
    };

    return (
        <div className="lc-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="lc-dialog">
                <div className="lc-header">
                    <div>
                        <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>GUN BUDDY</div>
                        <div className="lc-title">{weaponName}</div>
                    </div>
                    <button className="lc-close" onClick={onClose}>✕</button>
                </div>

                <div className="lc-body">
                    {ownedBuddies.length === 0 ? (
                        <div className="skin-list-empty">You don't own any gun buddies.</div>
                    ) : (
                        <>
                            <div className="lc-section-title" style={{ marginBottom: '0.6rem' }}>Select Buddy</div>
                            <div style={{ marginBottom: '0.75rem' }}>
                                <input
                                    type="text"
                                    placeholder="Search gun buddies…"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{
                                        width: '100%',
                                        background: 'var(--bg-surface)',
                                        border: '1px solid var(--border)',
                                        borderRadius: '6px',
                                        padding: '0.5rem 0.85rem',
                                        fontSize: '0.8rem',
                                        fontFamily: 'var(--font-mono)',
                                        color: 'var(--text-primary)',
                                        outline: 'none',
                                    }}
                                />
                            </div>
                            <div className="skin-list-grid">
                                {/* None option */}
                                <button
                                    className="skin-list-card"
                                    onClick={() => onSelect('', '')}
                                >
                                    <div className="skin-list-card-img" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' }}>
                                        <span style={{ color: 'var(--text-dim)' }}>🚫</span>
                                    </div>
                                    <div className="skin-list-card-info">
                                        <div className="skin-list-card-name">None</div>
                                    </div>
                                </button>

                                {filteredBuddies.map((buddy) => {
                                    const level = buddy.levels?.[0];
                                    if (!level) return null;
                                    const usage = getBuddyUsage(currentLoadout, level.uuid);
                                    const isDisabled = usage >= buddy.amount;

                                    return (
                                        <button
                                            key={buddy.uuid}
                                            className={`skin-list-card ${isDisabled ? 'disabled' : ''}`}
                                            onClick={() => !isDisabled && onSelect(buddy.uuid, level.uuid)}
                                            style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                                        >
                                            <div className="skin-list-card-img">
                                                <Image src={level.displayIcon} alt={buddy.displayName} fill style={{ objectFit: 'contain' }} unoptimized />
                                            </div>
                                            <div className="skin-list-card-info">
                                                <div className="skin-list-card-name">{buddy.displayName}</div>
                                                {isDisabled && (
                                                    <div style={{ fontSize: '0.55rem', color: 'var(--accent)', textAlign: 'center', marginTop: '0.15rem' }}>In use</div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}