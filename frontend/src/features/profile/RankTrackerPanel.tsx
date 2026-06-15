"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import { AccountXPResponse, getAccountXP, getCompetitiveUpdates, getPlayerMMR, PlayerMMRResponse } from "@/services/api";

// Rank names match valorant-api.com /v1/competitivetiers — tier index offset
// by 3 (the first 3 entries are "Unused" placeholders). Tier ID = 0 = Unranked.
const RANK_NAMES = [
    "Unused", "Unused", "Unused", "Unused",
    "Iron", "Bronze", "Silver", "Gold", "Platinum",
    "Diamond", "Ascendant", "Immortal", "Radiant",
];
const RANK_ICONS: Record<number, string> = {
    3: "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/smallicon.png", // Iron 1
    4: "https://media.valorant-api.com/competitivetiers/0d993a76-3eca-14b3-73c4-66e92c0ec4e3/smallicon.png", // Bronze 1
    5: "https://media.valorant-api.com/competitivetiers/411e4a55-ae87-3e4c-b4b3-4c54f0b1a6d1/smallicon.png", // Silver 1
    6: "https://media.valorant-api.com/competitivetiers/5d9bf112-df2f-4ad2-ace8-13a87a09b4d2/smallicon.png", // Gold 1
    7: "https://media.valorant-api.com/competitivetiers/ae5e3aac-4d6d-2b58-7e96-29c00e9d7a2c/smallicon.png", // Platinum 1
    8: "https://media.valorant-api.com/competitivetiers/4f1e1a3b-7c5b-3b0d-9b3e-2c5a6f3f4c1e/smallicon.png", // Diamond 1
    9: "https://media.valorant-api.com/competitivetiers/30f0e2a1-2c7c-4d3d-9e4d-5f3b3b1a2b3c/smallicon.png", // Ascendant 1
    10: "https://media.valorant-api.com/competitivetiers/2f50e2a1-1b7c-4d3d-9e4d-5f3b3b1a2b3c/smallicon.png", // Immortal 1
    11: "https://media.valorant-api.com/competitivetiers/eb3b2a7f-4b7c-5d4d-9f4d-5f3b3b1a2b3c/smallicon.png", // Radiant
};

function rankLabel(tier: number): string {
    if (tier <= 0) return "Unranked";
    if (tier >= 27) return "Radiant";
    const baseTier = Math.min(RANK_NAMES.length - 1, Math.max(3, Math.floor(tier / 3) + 3));
    const sub = tier % 3; // 0,1,2 -> 3,2,1
    return `${RANK_NAMES[baseTier]} ${sub === 0 ? 3 : sub === 1 ? 2 : 1}`;
}

function rankIconUrl(tier: number): string | null {
    if (tier <= 0) return null;
    if (tier >= 27) return RANK_ICONS[11];
    const group = Math.min(11, Math.max(3, Math.floor(tier / 3) + 3));
    return RANK_ICONS[group] || null;
}

function rrForQueue(mmr: PlayerMMRResponse | null, queue: string = "competitive"): { current: number; games: number } {
    if (!mmr?.QueueSkills) return { current: 0, games: 0 };
    const q = mmr.QueueSkills[queue] || mmr.QueueSkills.competitive;
    if (!q) return { current: 0, games: 0 };
    return { current: q.RankedRating ?? 0, games: q.CurrentSeasonGamesPlayed ?? 0 };
}

function peakForQueue(mmr: PlayerMMRResponse | null, queue: string = "competitive"): { peakTier: number; peakRR: number } {
    if (!mmr?.QueueSkills) return { peakTier: 0, peakRR: 0 };
    const q = mmr.QueueSkills[queue] || mmr.QueueSkills.competitive;
    if (!q?.SeasonalInfoBySeasonID) return { peakTier: 0, peakRR: 0 };
    let bestTier = 0;
    let bestRR = 0;
    for (const seasonId of Object.keys(q.SeasonalInfoBySeasonID)) {
        const s = q.SeasonalInfoBySeasonID[seasonId];
        if ((s.PeakRank ?? 0) > bestTier) bestTier = s.PeakRank;
        if ((s.RankedRatingPeak ?? 0) > bestRR) bestRR = s.RankedRatingPeak;
    }
    return { peakTier: bestTier, peakRR: bestRR };
}

function currentTierForQueue(mmr: PlayerMMRResponse | null, queue: string = "competitive"): number {
    if (!mmr?.QueueSkills) return 0;
    const q = mmr.QueueSkills[queue] || mmr.QueueSkills.competitive;
    if (!q?.SeasonalInfoBySeasonID) return 0;
    // Latest season is the last (or first) entry; use highest FinalRank found
    let best = 0;
    for (const seasonId of Object.keys(q.SeasonalInfoBySeasonID)) {
        const s = q.SeasonalInfoBySeasonID[seasonId];
        const fr = s.FinalRank ?? 0;
        if (fr > best) best = fr;
    }
    return best;
}

export default function RankTrackerPanel({ onConnectAccount }: { onConnectAccount?: () => void }) {
    const { activeAccount } = useData();
    const [mmr, setMmr] = useState<PlayerMMRResponse | null>(null);
    const [xp, setXp] = useState<AccountXPResponse | null>(null);
    const [lastGames, setLastGames] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        if (!activeAccount) return;
        setLoading(true);
        setError("");
        try {
            const [mmrRes, xpRes, compRes] = await Promise.all([
                getPlayerMMR(),
                getAccountXP(),
                getCompetitiveUpdates(0, 5).catch(() => null),
            ]);
            setMmr(mmrRes);
            setXp(xpRes);
            setLastGames(Array.isArray(compRes?.Matches) ? compRes.Matches.slice(0, 5) : []);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load rank data.";
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [activeAccount]);

    useEffect(() => {
        if (!activeAccount) {
            setMmr(null);
            setXp(null);
            setLastGames([]);
            return;
        }
        refresh();
    }, [activeAccount, refresh]);

    if (!activeAccount) {
        return (
            <div className="storefront-page scrollable-col">
                <section className="store-empty-hero clip-tactical">
                    <div>
                        <div className="tactical-kicker">// ACCOUNT REQUIRED</div>
                        <h1>Connect Riot to view your rank.</h1>
                        <p>Your current rank, RR, peak rank, and match history will appear here once you connect a Riot account.</p>
                    </div>
                    {onConnectAccount && (
                        <button type="button" className="connect-mega-btn clip-tactical-sm" onClick={onConnectAccount}>
                            Connect Riot Account
                        </button>
                    )}
                </section>
            </div>
        );
    }

    const queue = "competitive";
    const current = currentTierForQueue(mmr, queue);
    const rr = rrForQueue(mmr, queue);
    const peak = peakForQueue(mmr, queue);
    const rankIcon = rankIconUrl(current);
    const progress = Math.min(100, Math.max(0, (rr.current / 100) * 100));
    const totalXp = xp?.TotalXP ?? 0;
    // Account level from XP: 1 level per 1000 XP up to lvl 20, then linear
    const levelFromXp = (xpAmount: number) => {
        if (xpAmount < 0) return 0;
        if (xpAmount < 20000) return Math.floor(xpAmount / 1000) + 1;
        return Math.floor((xpAmount - 20000) / 5000) + 20;
    };
    const level = xp?.History?.length ? levelFromXp(xp.History[0].EndXP ?? 0) : 0;

    return (
        <div className="storefront-page scrollable-col">
            <div className="storefront-title-container d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
                <div>
                    <div className="tactical-kicker">// RANK TRACKER</div>
                    <h2 className="mb-1 tactical-title">Competitive Profile</h2>
                    <p className="text-muted small mb-0">Your current rank, RR, peak rank, and account level</p>
                </div>
                <button type="button" className="btn-tactical" onClick={refresh} disabled={loading}>
                    {loading ? "⟳ Loading…" : "⟳ Refresh"}
                </button>
            </div>

            {error && <div className="alert alert-warning mb-4">{error}</div>}

            <div className="rank-tracker-grid mb-5">
                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <div className="tactical-kicker">// CURRENT RANK</div>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {rankIcon && (
                            <Image src={rankIcon} alt={rankLabel(current)} width={96} height={96} unoptimized className="rank-icon" />
                        )}
                        <div>
                            <div className="rank-name">{rankLabel(current)}</div>
                            <div className="rank-rr">{rr.current} RR</div>
                            <div className="rank-meta">{rr.games} games this act</div>
                        </div>
                    </div>
                    {current > 0 && current < 27 && (
                        <div className="rank-progress-wrap">
                            <div className="rank-progress">
                                <div className="rank-progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="rank-progress-label">{rr.current} / 100 RR</div>
                        </div>
                    )}
                </div>

                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <div className="tactical-kicker">// PEAK RANK</div>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {rankIconUrl(peak.peakTier) && (
                            <Image src={rankIconUrl(peak.peakTier)!} alt="Peak" width={64} height={64} unoptimized className="rank-icon rank-icon-small" />
                        )}
                        <div>
                            <div className="rank-name">{peak.peakTier > 0 ? rankLabel(peak.peakTier) : "—"}</div>
                            <div className="rank-rr">{peak.peakRR} RR peak</div>
                            <div className="rank-meta">Across all acts played</div>
                        </div>
                    </div>
                </div>

                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <div className="tactical-kicker">// ACCOUNT LEVEL</div>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        <div className="account-level-circle">
                            <span className="account-level-number">{level || "—"}</span>
                        </div>
                        <div>
                            <div className="rank-name">{totalXp.toLocaleString()} XP</div>
                            <div className="rank-rr">Lifetime</div>
                            <div className="rank-meta">{xp?.History?.length ?? 0} XP events recorded</div>
                        </div>
                    </div>
                </div>
            </div>

            {lastGames.length > 0 && (
                <div className="mb-5">
                    <div className="section-row">
                        <div>
                            <div className="tactical-kicker">// RECENT RANKED</div>
                            <h3 className="mb-0 section-title">Last 5 Ranked Games</h3>
                        </div>
                    </div>
                    <div className="rank-games-list">
                        {lastGames.map((g: any) => {
                            const won = g.RankedRatingEarned > 0;
                            return (
                                <div key={g.MatchID} className={`rank-game-row clip-tactical-sm ${won ? "win" : "loss"}`}>
                                    <span className="rank-game-result">{won ? "WIN" : "LOSS"}</span>
                                    <span className="rank-game-rr">{g.RankedRatingEarned > 0 ? "+" : ""}{g.RankedRatingEarned} RR</span>
                                    <span className="rank-game-meta">
                                        {g.SeasonID} · Tier {g.TierAfterUpdate}
                                    </span>
                                    <span className="rank-game-time">
                                        {new Date(g.MatchStartTime).toLocaleDateString()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
