import Image from 'next/image';
import { useState, useMemo } from 'react';
import { Weapon, Skin } from '@/lib/types';
import { useData } from '@/context/DataContext';

type SkinListProps = {
    weapon: Weapon;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    onSkinSelect: (skin: Skin) => void;
    show: boolean;
    onClose: () => void;
};

const TIER_COLORS: Record<string, string> = {
    "12683d2c-44af-d54e-12a6-cf4fb56b09d7": "#5e9296",
    "0c052332-f437-42f8-a2e6-8f4a7bf2a75a": "#4a9f6e",
    "7c5ac5b0-49f4-9766-e57e-de0e08ee30b8": "#8e5bc8",
    "4b0f4478-7fb6-7c1b-e23a-6371d8aaf2d4": "#d652a0",
    "3ee4d8e2-4d71-b8b5-f97f-915f0f47d1ee": "#e09c32",
    "dd7f1161-3c94-a4be-9df7-b9e56b073f43": "#f04e50",
    "e1c8a98f-4e32-4964-b1ec-51c66a25216e": "#b44d4d",
    "c564c281-c776-4467-9157-0a94cba04e6b": "#6b7280",
};

export default function SkinList({ weapon, ownedLevelIDs, ownedChromaIDs, onSkinSelect, show, onClose }: SkinListProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const { contentTiers } = useData();

    const tierRankMap = useMemo(() => {
        return contentTiers.reduce((acc, tier) => {
            acc[tier.uuid] = tier.rank;
            return acc;
        }, {} as Record<string, number>);
    }, [contentTiers]);

    const ownedSkins = useMemo(() => {
        const skins = weapon.skins.filter(skin => {
            const hasOwnedLevel = skin.levels.some(level => ownedLevelIDs.includes(level.uuid));
            const hasOwnedChroma = skin.chromas.some(chroma => ownedChromaIDs.includes(chroma.uuid));
            return (hasOwnedLevel || hasOwnedChroma);
        });

        skins.sort((a, b) => {
            const rankA = tierRankMap[a.contentTierUuid || ''] || 0;
            const rankB = tierRankMap[b.contentTierUuid || ''] || 0;
            if (rankB !== rankA) return rankB - rankA;
            return a.displayName.localeCompare(b.displayName);
        });

        return skins;
    }, [weapon.skins, ownedLevelIDs, ownedChromaIDs, tierRankMap]);

    const filteredSkins = useMemo(() => {
        return ownedSkins.filter(skin =>
            skin.displayName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [ownedSkins, searchTerm]);

    if (!show) return null;

    return (
        <div className="skin-list-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="skin-list-dialog">
                <div className="skin-list-header">
                    <div>
                        <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>SELECT SKIN</div>
                        <div className="skin-list-title">{weapon.displayName}</div>
                    </div>
                    <button className="skin-list-close" onClick={onClose}>✕</button>
                </div>

                <div className="skin-list-search">
                    <input
                        type="text"
                        placeholder="Search skins…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="skin-list-body">
                    {ownedSkins.length === 0 ? (
                        <div className="skin-list-empty">You don't own any skins for this weapon.</div>
                    ) : filteredSkins.length === 0 ? (
                        <div className="skin-list-empty">No skins match your search.</div>
                    ) : (
                        <div className="skin-list-grid">
                            {/* Default skin card */}
                            <button
                                className="skin-list-card skin-list-card--default"
                                onClick={() => {
                                    const def = weapon.skins.find(s => s.uuid === weapon.defaultSkinUuid);
                                    if (def) onSkinSelect(def);
                                }}
                            >
                                <div className="skin-list-card-img">
                                    <div className="skin-list-card-tier" />
                                    <Image src={weapon.displayIcon} alt="Default" fill style={{ objectFit: 'contain' }} unoptimized />
                                </div>
                                <div className="skin-list-card-info">
                                    <div className="skin-list-card-name">Default</div>
                                </div>
                            </button>

                            {filteredSkins.map((skin) => {
                                const tierColor = TIER_COLORS[skin.contentTierUuid] || "#6b7280";
                                const firstChroma = skin.chromas.find(c => ownedChromaIDs.includes(c.uuid)) || skin.chromas[0];
                                return (
                                    <button
                                        key={skin.uuid}
                                        className="skin-list-card"
                                        onClick={() => onSkinSelect(skin)}
                                    >
                                        <div className="skin-list-card-img" style={{ position: 'relative' }}>
                                            <div className="skin-list-card-tier" style={{ background: tierColor }} />
                                            <Image src={firstChroma?.fullRender || skin.displayIcon} alt={skin.displayName} fill style={{ objectFit: 'contain' }} unoptimized />
                                        </div>
                                        <div className="skin-list-card-info">
                                            <div className="skin-list-card-name">{skin.displayName}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}