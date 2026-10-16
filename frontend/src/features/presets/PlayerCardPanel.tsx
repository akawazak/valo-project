"use client";

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useData } from '@/context/DataContext';
import IdentitySelector from '@/features/identity/IdentitySelector';
import { getPlayerCardPortraitUrl, getPlayerLevelBorder, type PlayerLevelBorder } from '@/lib/playerCardArt';
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
    preferredLevelBorderId?: string;
    hideAccountLevel?: boolean;
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
    preferredLevelBorderId,
    hideAccountLevel = false,
    accountRank,
    accountRankTier = 0,
    showUnownedCosmetics = false,
}: PlayerCardPanelProps) {
    const { playerCards, playerTitles } = useData();
    const [pickerOpen, setPickerOpen] = useState(false);
    const [portraitFailed, setPortraitFailed] = useState(false);
    const [rankArt, setRankArt] = useState({ tier: 0, url: "" });
    const [levelBorders, setLevelBorders] = useState<PlayerLevelBorder[]>([]);
    const [failedLevelFrame, setFailedLevelFrame] = useState("");

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
    const showLevel = !hideAccountLevel && Number.isFinite(accountLevel) && Number(accountLevel) > 0;
    const levelText = showLevel ? String(accountLevel) : "";
    const levelBorder = getPlayerLevelBorder(levelBorders, Number(accountLevel), preferredLevelBorderId);
    const levelFrame = levelBorder?.levelNumberAppearance && levelBorder.levelNumberAppearance !== failedLevelFrame ? levelBorder.levelNumberAppearance : "";
    const accountLabel = accountName?.trim() || "Current Account";
    const displayName = accountLabel.split('#')[0].trim() || accountLabel;
    const rankLabel = accountRank?.trim() || "Unranked";
    const rankIcon = rankArt.tier === accountRankTier ? rankArt.url : "";

    useEffect(() => {
        setPortraitFailed(false);
    }, [portraitUrl]);

    useEffect(() => {
        if (!showLevel) return;
        let alive = true;
        fetchCachedPublicJson<{ data?: PlayerLevelBorder[] }>("https://valorant-api.com/v1/levelborders")
            .then(data => { if (alive) setLevelBorders(data.data || []); })
            .catch(() => { if (alive) setLevelBorders([]); });
        return () => { alive = false; };
    }, [showLevel]);

    useEffect(() => {
        let alive = true;
        if (!accountRankTier || accountRankTier <= 0) {
            setRankArt({ tier: 0, url: "" });
            return;
        }
        fetchCachedPublicJson<{ data?: CompetitiveTierSet[] }>("https://valorant-api.com/v1/competitivetiers")
            .then((data) => {
                if (!alive) return;
                const latest = data.data?.[data.data.length - 1];
                const tier = latest?.tiers?.find((item) => item.tier === accountRankTier);
                setRankArt({ tier: accountRankTier, url: tier?.largeIcon || tier?.smallIcon || "" });
            })
            .catch(() => {
                if (alive) setRankArt({ tier: accountRankTier, url: "" });
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
                aria-label={`Change player card and title for ${accountLabel}`}
                title={`${accountLabel} · Change player card and title`}
            >
                {showLevel && (
                    <span className={`player-card-rank-badge${levelFrame ? ' player-card-level-badge--art' : ''}`} aria-label={`Account level ${levelText}`}>
                        {levelFrame && <img src={levelFrame} alt="" aria-hidden="true" draggable={false} onError={() => setFailedLevelFrame(levelFrame)} />}
                        <span>{levelText}</span>
                    </span>
                )}
                <div className="player-card-portrait">
                    {portraitUrl && !portraitFailed ? (
                        <img
                            className="player-card-portrait-art"
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
                        <svg className="player-card-portrait-frame" viewBox="0 57 100 43" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                            <path d="M7.7 62V78.3L49.4 95.8L91.4 78.3V62" fill="none" stroke="currentColor" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
                        </svg>
                        <div className="player-card-portrait-identity">
                            <span className="player-card-portrait-name">
                                {displayName}
                            </span>
                            <span className="player-card-portrait-title">
                                {titleText}
                            </span>
                        </div>
                        {rankIcon && (
                            <span className="player-card-portrait-rank" aria-label={rankLabel} title={rankLabel}>
                                <img src={rankIcon} alt="" aria-hidden="true" onError={() => setRankArt(current => current.tier === accountRankTier && current.url === rankIcon ? { tier: accountRankTier, url: "" } : current)} />
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
                                <h3 className="unified-modal-title">Player Card &amp; Title</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={() => setPickerOpen(false)} aria-label="Close">×</button>
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
