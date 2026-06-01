"use client";

import { useState, useMemo } from 'react';
import { useData } from '@/context/DataContext';
import Image from 'next/image';

interface IdentitySelectorProps {
    currentCardId: string;
    currentTitleId: string;
    onSelectCard: (uuid: string) => void;
    onSelectTitle: (uuid: string) => void;
}

export default function IdentitySelector({ currentCardId, currentTitleId, onSelectCard, onSelectTitle }: IdentitySelectorProps) {
    const { playerCards, playerTitles, ownedCardIDs, ownedTitleIDs } = useData();
    const [cardSearch, setCardSearch] = useState('');
    const [titleSearch, setTitleSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'cards' | 'titles'>('cards');

    const displayCards = useMemo(() => {
        const owned = playerCards.filter(c => ownedCardIDs.map(id => id.toLowerCase()).includes(c.uuid.toLowerCase()));
        const pool = owned.length > 0 ? owned : playerCards;
        if (!cardSearch) return pool;
        return pool.filter(c => c.displayName.toLowerCase().includes(cardSearch.toLowerCase()));
    }, [playerCards, ownedCardIDs, cardSearch]);

    const displayTitles = useMemo(() => {
        const owned = playerTitles.filter(t => ownedTitleIDs.map(id => id.toLowerCase()).includes(t.uuid.toLowerCase()));
        const pool = owned.length > 0 ? owned : playerTitles;
        if (!titleSearch) return pool;
        return pool.filter(t =>
            t.displayName.toLowerCase().includes(titleSearch.toLowerCase()) ||
            (t.titleText && t.titleText.toLowerCase().includes(titleSearch.toLowerCase()))
        );
    }, [playerTitles, ownedTitleIDs, titleSearch]);

    const selectedCard = useMemo(() => {
        return playerCards.find(c => c.uuid.toLowerCase() === currentCardId.toLowerCase());
    }, [playerCards, currentCardId]);

    const selectedTitle = useMemo(() => {
        return playerTitles.find(t => t.uuid.toLowerCase() === currentTitleId.toLowerCase());
    }, [playerTitles, currentTitleId]);

    return (
        <div className="preset-panel mt-3">
            <div className="section-row mb-3" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.75rem' }}>
                <div>
                    <div className="tactical-kicker">// IDENTITY</div>
                    <h3 className="tactical-title mb-0" style={{ fontSize: '1.2rem' }}>Identity Customize</h3>
                </div>
            </div>

            <div className="identity-preview-banner mb-4"
                style={{
                    backgroundImage: selectedCard?.wideArt
                        ? `linear-gradient(to right, rgba(15, 23, 42, 0.95) 30%, rgba(15, 23, 42, 0.6)), url(${selectedCard.wideArt})`
                        : 'none'
                }}
            >
                {selectedCard?.displayIcon && (
                    <Image src={selectedCard.displayIcon} alt="Card" width={60} height={60} className="rounded-2" style={{ border: '1px solid rgba(255,255,255,0.1)' }} unoptimized />
                )}
                <div>
                    <div style={{ color: 'var(--text-dim)', fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Active Identity</div>
                    <div className="fw-bold fs-5 text-white">{selectedCard?.displayName || 'No Player Card'}</div>
                    <div style={{
                        display: 'inline-block',
                        marginTop: '0.25rem',
                        padding: '0.15rem 0.5rem',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                    }}>
                        {selectedTitle?.titleText || selectedTitle?.displayName || 'No Title'}
                    </div>
                </div>
            </div>

            <div className="d-flex border-bottom mb-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <button onClick={() => setActiveTab('cards')} className={`identity-tab-btn${activeTab === 'cards' ? ' active' : ''}`}>
                    Player Cards ({displayCards.length})
                </button>
                <button onClick={() => setActiveTab('titles')} className={`identity-tab-btn${activeTab === 'titles' ? ' active' : ''}`}>
                    Player Titles ({displayTitles.length})
                </button>
            </div>

            {activeTab === 'cards' ? (
                <div>
                    <div className="position-relative mb-3">
                        <input
                            type="text"
                            placeholder="Search player cards..."
                            value={cardSearch}
                            onChange={(e) => setCardSearch(e.target.value)}
                            className="tactical-input ps-4"
                            style={{ fontSize: '0.85rem', height: '36px' }}
                        />
                        <svg className="position-absolute translate-middle-y top-50 start-0 ms-2" style={{ color: 'var(--text-dim)' }} xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor">
                            <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z"/>
                        </svg>
                    </div>

                    <div className="row g-2" style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                        {displayCards.map(card => {
                            const isSelected = card.uuid.toLowerCase() === currentCardId.toLowerCase();
                            return (
                                <div key={card.uuid} className="col-6 col-sm-4 col-md-3">
                                    <div
                                        onClick={() => onSelectCard(card.uuid)}
                                        className={`identity-card${isSelected ? ' active' : ''}`}
                                    >
                                        <div className="identity-card-img-wrap">
                                            {card.wideArt ? (
                                                <Image src={card.wideArt} alt={card.displayName} fill unoptimized style={{ objectFit: 'cover' }} />
                                            ) : (
                                                <div className="d-flex align-items-center justify-content-center text-muted small h-100">No Image</div>
                                            )}
                                        </div>
                                        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {card.displayName}
                                        </div>
                                        {isSelected && (
                                            <div style={{
                                                position: 'absolute', top: '4px', right: '4px',
                                                background: 'var(--accent-red)', color: '#fff',
                                                padding: '0.05rem 0.3rem', borderRadius: '3px',
                                                fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem', fontWeight: 800
                                            }}>ACTIVE</div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {displayCards.length === 0 && (
                            <div className="col-12 py-4 text-center text-muted font-monospace">No Player Cards Found</div>
                        )}
                    </div>
                </div>
            ) : (
                <div>
                    <div className="position-relative mb-3">
                        <input
                            type="text"
                            placeholder="Search player titles..."
                            value={titleSearch}
                            onChange={(e) => setTitleSearch(e.target.value)}
                            className="tactical-input ps-4"
                            style={{ fontSize: '0.85rem', height: '36px' }}
                        />
                        <svg className="position-absolute translate-middle-y top-50 start-0 ms-2" style={{ color: 'var(--text-dim)' }} xmlns="http://www.w3.org/2000/svg" height="18" viewBox="0 -960 960 960" width="18" fill="currentColor">
                            <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z"/>
                        </svg>
                    </div>

                    <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {displayTitles.map(title => {
                            const isSelected = title.uuid.toLowerCase() === currentTitleId.toLowerCase();
                            const titleDisplayText = title.titleText || title.displayName;
                            if (!titleDisplayText.trim()) return null;
                            return (
                                <button
                                    key={title.uuid}
                                    type="button"
                                    onClick={() => onSelectTitle(title.uuid)}
                                    className={`identity-title-row${isSelected ? ' active' : ''}`}
                                >
                                    <div className="d-flex flex-column">
                                        <span className="small">{titleDisplayText}</span>
                                        <span className="text-muted" style={{ fontSize: '0.68rem' }}>{title.displayName}</span>
                                    </div>
                                    {isSelected && (
                                        <span style={{
                                            background: 'var(--accent-red)', color: '#fff',
                                            padding: '0.1rem 0.4rem', borderRadius: '3px',
                                            fontFamily: '"JetBrains Mono", monospace', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase'
                                        }}>Active</span>
                                    )}
                                </button>
                            );
                        })}
                        {displayTitles.length === 0 && (
                            <div className="py-4 text-center text-muted font-monospace">No Player Titles Found</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
