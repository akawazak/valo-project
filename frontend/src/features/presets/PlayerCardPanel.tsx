"use client";

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useData } from '@/context/DataContext';
import IdentitySelector from '@/features/identity/IdentitySelector';
import { getPlayerCardPortraitUrl } from '@/lib/playerCardArt';

type PlayerCardPanelProps = {
    currentCardId: string;
    currentTitleId: string;
    onSelectCard: (cardId: string) => void;
    onSelectTitle: (titleId: string) => void;
};

export default function PlayerCardPanel({
    currentCardId,
    currentTitleId,
    onSelectCard,
    onSelectTitle,
}: PlayerCardPanelProps) {
    const { playerCards, playerTitles } = useData();
    const [pickerOpen, setPickerOpen] = useState(false);

    const selectedCard = useMemo(
        () => playerCards.find(c => c.uuid.toLowerCase() === currentCardId.toLowerCase()),
        [playerCards, currentCardId]
    );

    const selectedTitle = useMemo(
        () => playerTitles.find(t => t.uuid.toLowerCase() === currentTitleId.toLowerCase()),
        [playerTitles, currentTitleId]
    );

    const titleText = selectedTitle?.titleText || selectedTitle?.displayName || 'No Title';
    const portraitUrl = getPlayerCardPortraitUrl(selectedCard);

    return (
        <div className="cosmetics-panel-container" style={{ flex: '0 0 auto', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '1rem' }}>
            <div className="workspace-column-title" style={{ borderBottom: 'none', marginBottom: '0.5rem' }}>
                Identity
            </div>
            
            <button
                type="button"
                className="player-card-slot"
                onClick={() => setPickerOpen(true)}
                title="Change player card & title"
                style={{
                    width: '100%',
                    height: 'auto',
                    flex: 'none',
                    flexDirection: 'row',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.65rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textAlign: 'left',
                    transition: 'all var(--transition)',
                    aspectRatio: 'unset'
                }}
            >
                <div 
                    className="player-card-slot-media" 
                    style={{ 
                        width: '56px', 
                        height: '38px', 
                        position: 'relative', 
                        borderRadius: '4px', 
                        overflow: 'hidden', 
                        background: 'var(--bg-elevated)',
                        flexShrink: 0,
                        flex: 'none'
                    }}
                >
                    {portraitUrl ? (
                        <img
                            src={portraitUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }}
                            loading="lazy"
                            draggable={false}
                        />
                    ) : selectedCard?.displayIcon ? (
                        <Image
                            src={selectedCard.displayIcon}
                            alt=""
                            width={56}
                            height={56}
                            unoptimized
                            style={{ objectFit: 'contain' }}
                        />
                    ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', justifySelf: 'center', height: '100%' }}>Card</span>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '0.52rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Equipped Card</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedCard?.displayName || 'No Player Card'}
                    </span>
                    <span style={{ fontSize: '0.64rem', color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.05rem', fontWeight: 500 }}>
                        {titleText}
                    </span>
                </div>
            </button>

            {pickerOpen && (
                <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
                    <div className="unified-modal-container" style={{ maxWidth: '720px', height: 'min(80vh, 580px)' }}>
                        <div className="unified-modal-header">
                            <div className="unified-modal-title-wrap">
                                <span className="kicker">// Select Identity</span>
                                <h3 className="unified-modal-title">Player Card & Title</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={() => setPickerOpen(false)}>✕</button>
                        </div>
                        
                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                            <IdentitySelector
                                compact
                                currentCardId={currentCardId}
                                currentTitleId={currentTitleId}
                                onSelectCard={onSelectCard}
                                onSelectTitle={onSelectTitle}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
