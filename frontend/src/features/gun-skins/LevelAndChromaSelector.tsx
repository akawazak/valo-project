import Image from 'next/image';
import { Skin } from '@/lib/types';
import { useEffect } from 'react';

type LevelAndChromaSelectorProps = {
    skin: Skin;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    onSelect: (skinId: string, levelId: string, chromaId: string) => void;
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

export default function LevelAndChromaSelector({ skin, ownedLevelIDs, ownedChromaIDs, onSelect, show, onClose }: LevelAndChromaSelectorProps) {
    const ownedLevels = skin.levels.filter(level => ownedLevelIDs.includes(level.uuid));
    const ownsSkin = ownedLevels.length > 0;
    const ownedChromas = skin.chromas.filter((chroma, index) => (index === 0 && ownsSkin) || ownedChromaIDs.includes(chroma.uuid));

    const allLevelsOwned = ownedLevels.length === skin.levels.length;
    const displayLevels = allLevelsOwned ? ownedLevels.slice(0, -1) : ownedLevels;
    const lastLevel = skin.levels[skin.levels.length - 1];

    useEffect(() => {
        if (show && ownedLevels.length === 1 && ownedChromas.length === 0) {
            onSelect(skin.uuid, ownedLevels[0].uuid, skin.chromas[0].uuid);
            onClose();
        }
    }, [show, ownedLevels, ownedChromas, onSelect, onClose, skin.uuid, skin.chromas]);

    if (!show || (ownedLevels.length === 1 && ownedChromas.length === 0)) {
        return null;
    }

    const tierColor = TIER_COLORS[skin.contentTierUuid] || "#6b7280";

    return (
        <div className="lc-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="lc-dialog">
                <div className="lc-header">
                    <div>
                        <div style={{ fontSize: '0.58rem', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>SELECT LEVEL & VARIANT</div>
                        <div className="lc-title">{skin.displayName}</div>
                    </div>
                    <button className="lc-close" onClick={onClose}>✕</button>
                </div>

                <div className="lc-body">
                    {/* Variants section (chromas + final level) */}
                    {(ownedChromas.length > 0 || allLevelsOwned) && (
                        <>
                            <div className="lc-section-title">Variants</div>
                            <div className="lc-grid">
                                {allLevelsOwned && !ownedChromas.some((chroma) => chroma.uuid === skin.chromas[0]?.uuid) && (
                                    <button
                                        className="lc-card"
                                        onClick={() => onSelect(skin.uuid, lastLevel.uuid, skin.chromas[0].uuid)}
                                    >
                                        <div className="lc-card-img" style={{ position: 'relative' }}>
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: tierColor }} />
                                            <Image src={skin.chromas[0].fullRender} alt={lastLevel.displayName} fill style={{ objectFit: 'contain' }} unoptimized />
                                        </div>
                                        <div className="lc-card-name">{lastLevel.displayName}</div>
                                    </button>
                                )}
                                {ownedChromas.map((chroma) => (
                                    <button
                                        key={chroma.uuid}
                                        className="lc-card"
                                        onClick={() => onSelect(skin.uuid, lastLevel.uuid, chroma.uuid)}
                                    >
                                        <div className="lc-card-img">
                                            <Image src={chroma.fullRender} alt={chroma.displayName} fill style={{ objectFit: 'contain' }} unoptimized />
                                        </div>
                                        <div className="lc-card-name">{chroma.displayName}</div>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {/* Levels section */}
                    {displayLevels.length > 0 && (
                        <>
                            <hr className="lc-divider" />
                            <div className="lc-section-title">Levels</div>
                            <div className="lc-grid">
                                {displayLevels.map((level) => (
                                    <button
                                        key={level.uuid}
                                        className="lc-card"
                                        onClick={() => onSelect(skin.uuid, level.uuid, skin.chromas[0].uuid)}
                                    >
                                        <div className="lc-card-img" style={{ position: 'relative' }}>
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: tierColor }} />
                                            <Image src={skin.chromas[0].fullRender} alt={level.displayName} fill style={{ objectFit: 'contain' }} unoptimized />
                                        </div>
                                        <div className="lc-card-name">{level.displayName}</div>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
