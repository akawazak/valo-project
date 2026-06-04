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

    const titleText = selectedTitle?.titleText || selectedTitle?.displayName || 'No title';
    const portraitUrl = getPlayerCardPortraitUrl(selectedCard);

    return (
        <div className="loadout-cosmetic-block loadout-cosmetic-block--card">
            <div className="loadout-section-label">Preview</div>
            <button
                type="button"
                className="player-card-slot"
                onClick={() => setPickerOpen(true)}
                title="Change player card"
            >
                <div className="player-card-slot-media">
                    {portraitUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={portraitUrl}
                            alt={selectedCard?.displayName ?? 'Player card'}
                            className="player-card-slot-art"
                            loading="lazy"
                            draggable={false}
                        />
                    ) : selectedCard?.displayIcon ? (
                        <Image
                            src={selectedCard.displayIcon}
                            alt={selectedCard.displayName}
                            width={72}
                            height={72}
                            unoptimized
                            className="player-card-slot-fallback-icon"
                        />
                    ) : (
                        <span className="player-card-slot-empty">Select card</span>
                    )}
                </div>
                <div className="player-card-slot-footer">
                    <span className="player-card-slot-name">{selectedCard?.displayName || 'No card'}</span>
                    <span className="player-card-slot-title">{titleText}</span>
                </div>
            </button>

            {pickerOpen && (
                <div className="loadout-picker-modal" role="dialog" aria-modal="true" aria-label="Player card picker">
                    <div className="loadout-picker-backdrop" onClick={() => setPickerOpen(false)} />
                    <div className="loadout-picker-dialog">
                        <div className="loadout-picker-header">
                            <h3>Player card & title</h3>
                            <button type="button" className="loadout-picker-close" onClick={() => setPickerOpen(false)} aria-label="Close">
                                ×
                            </button>
                        </div>
                        <IdentitySelector
                            compact
                            currentCardId={currentCardId}
                            currentTitleId={currentTitleId}
                            onSelectCard={onSelectCard}
                            onSelectTitle={onSelectTitle}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
