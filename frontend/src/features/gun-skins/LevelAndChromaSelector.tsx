import Image from 'next/image';
import { Skin } from '@/lib/types';
import { useEffect } from 'react';
import { TIER_COLORS } from "@/lib/contentTiers";

type LevelAndChromaSelectorProps = {
    skin: Skin;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    onSelect: (skinId: string, levelId: string, chromaId: string) => void;
    show: boolean;
    onClose: () => void;
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
