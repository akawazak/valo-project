"use client";

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useData } from '@/context/DataContext';
import IdentitySelector from '@/features/identity/IdentitySelector';
import { getPlayerCardPortraitUrl } from '@/lib/playerCardArt';
import { fetchCachedPublicJson } from '@/services/api';

type CompetitiveTierSet = {
    tiers?: Array<{ tier: number; tierName?: string; smallIcon?: string; largeIcon?: string }>;
};

type PlayerCardPanelProps = {
    currentCardId: string;
    currentTitleId: string;
    onSelectCard: (cardId: string) => void;
    onSelectTitle: (titleId: string) => void;
    accountName?: string;
    accountLevel?: number;
    accountRank?: string;
    accountRankTier?: number;
    showUnownedCosmetics?: boolean;
};

export default function PlayerCardPanel({
    currentCardId,
    currentTitleId,
    onSelectCard,
    onSelectTitle,
    accountName,
    accountLevel,
    accountRank,
    accountRankTier = 0,
    showUnownedCosmetics = false,
}: PlayerCardPanelProps) {
    const { playerCards, playerTitles } = useData();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [portraitFailed, setPortraitFailed] = useState(false);
    const [rankIcon, setRankIcon] = useState("");

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
    const levelText = Number.isFinite(accountLevel) && accountLevel && accountLevel > 0 ? String(accountLevel) : "1";
    const accountLabel = accountName?.trim() || "Current Account";
    const rankLabel = accountRank?.trim() || "Unranked";

    useEffect(() => {
        setPortraitFailed(false);
    }, [portraitUrl]);

    useEffect(() => {
        let alive = true;
        if (!accountRankTier || accountRankTier <= 0) {
            setRankIcon("");
            return;
        }
        fetchCachedPublicJson<{ data?: CompetitiveTierSet[] }>("https://valorant-api.com/v1/competitivetiers")
            .then((data) => {
                if (!alive) return;
                const latest = data.data?.[data.data.length - 1];
                const tier = latest?.tiers?.find((item) => item.tier === accountRankTier);
                setRankIcon(tier?.smallIcon || tier?.largeIcon || "");
            })
            .catch(() => {
                if (alive) setRankIcon("");
            });
        return () => {
            alive = false;
        };
    }, [accountRankTier]);

    return (
        <div className="player-card-panel-premium">
            <div className="cosmetics-sub-header">Identity</div>

            <button
                type="button"
                className="player-card-slot-premium"
                onClick={() => setPickerOpen(true)}
                aria-label="Change player card and title"
                title="Change player card and title"
            >
                <span className="player-card-rank-badge" aria-label={`Account level ${levelText}`}>{levelText}</span>
                <div className="player-card-portrait">
                    {portraitUrl && !portraitFailed ? (
                        <img
                            src={portraitUrl}
                            alt={selectedCard?.displayName || ''}
                            loading="lazy"
                            draggable={false}
                            onError={() => setPortraitFailed(true)}
                        />
                    ) : selectedCard?.displayIcon ? (
                        <Image
                            src={selectedCard.displayIcon}
                            alt=""
                            fill
                            unoptimized
                            style={{ objectFit: 'cover' }}
                        />
                    ) : (
                        <div className="player-card-empty-art" aria-hidden="true">
                            <span className="player-card-empty-mark">V</span>
                        </div>
                    )}

                    <div className="player-card-portrait-scrim">
                        <span className="player-card-portrait-name">
                            {accountLabel}
                        </span>
                        <span className="player-card-portrait-title">
                            {titleText}
                        </span>
                        {rankIcon && (
                            <span className="player-card-portrait-rank" aria-label={rankLabel} title={rankLabel}>
                                <img src={rankIcon} alt="" aria-hidden="true" />
                            </span>
                        )}
                    </div>
                </div>
            </button>

            {pickerOpen && createPortal(
                <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && setPickerOpen(false)}>
                    <div className="unified-modal-container" style={{ maxWidth: '720px', height: 'min(85vh, 700px)' }}>
                        <div className="unified-modal-header" style={{ padding: '0.85rem 1.5rem' }}>
                            <div className="unified-modal-title-wrap">
                                <span className="kicker">// Select Identity</span>
                                <h3 className="unified-modal-title">Player Card &amp; Title</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={() => setPickerOpen(false)}>x</button>
                        </div>

                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0.75rem 1.25rem 1rem' }}>
                            <IdentitySelector
                                compact
                                currentCardId={currentCardId}
                                currentTitleId={currentTitleId}
                                onSelectCard={onSelectCard}
                                onSelectTitle={onSelectTitle}
                                showUnownedCosmetics={showUnownedCosmetics}
                            />
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
