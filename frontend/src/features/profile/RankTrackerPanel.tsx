"use client";

// RankTrackerPanel — driven by the persistent local-cache endpoints
// (GET /v1/profile/overview, /v1/profile/rr-history, /v1/profile/sync).
// All field names below mirror backend/tracking/types.go exactly.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useData } from "@/context/DataContext";
import {
    getProfileOverview,
    getRRHistory,
    postProfileSync,
    getProfileSyncStatus,
    ProfileOverview,
    ProfileRRHistory,
    ProfileSyncStatus,
} from "@/services/api";
import RRHistoryChart from "./RRHistoryChart";

interface Props {
    onConnectAccount?: () => void;
}

// Valorant-API.com `/v1/competitivetiers` returns tiers numbered 0..27.
// Tiers 0..2 are unused, tier 27 is Radiant. Division label = tier%3 (3/2/1).
const RANK_GROUPS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
function tierLabel(tier: number, fallback: string): string {
    if (!tier || tier <= 0) return "Unranked";
    if (tier >= 27) return "Radiant";
    const groupIdx = Math.floor((tier - 3) / 3);
    const sub = tier % 3; // 0,1,2 → 3,2,1
    const name = RANK_GROUPS[Math.min(groupIdx, RANK_GROUPS.length - 1)] ?? fallback;
    const num = sub === 0 ? 3 : sub === 1 ? 2 : 1;
    return `${name} ${num}`;
}

// Hardcoded fallback icons for ranks (Riot CDN); matches the panel we replaced.
// Keyed by group starting tier (3 = Iron 1, 11 = Diamond 1, 24 = Radiant).
const FALLBACK_RANK_ICON: Record<number, string> = {
    3: "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/smallicon.png",
    4: "https://media.valorant-api.com/competitivetiers/0d993a76-3eca-14b3-73c4-66e92c0ec4e3/smallicon.png",
    5: "https://media.valorant-api.com/competitivetiers/411e4a55-ae87-3e4c-b4b3-4c54f0b1a6d1/smallicon.png",
    6: "https://media.valorant-api.com/competitivetiers/5d9bf112-df2f-4ad2-ace8-13a87a09b4d2/smallicon.png",
    7: "https://media.valorant-api.com/competitivetiers/ae5e3aac-4d6d-2b58-7e96-29c00e9d7a2c/smallicon.png",
    8: "https://media.valorant-api.com/competitivetiers/4f1e1a3b-7c5b-3b0d-9b3e-2c5a6f3f4c1e/smallicon.png",
    9: "https://media.valorant-api.com/competitivetiers/30f0e2a1-2c7c-4d3d-9e4d-5f3b3b1a2b3c/smallicon.png",
    10: "https://media.valorant-api.com/competitivetiers/2f50e2a1-1b7c-4d3d-9e4d-5f3b3b1a2b3c/smallicon.png",
    11: "https://media.valorant-api.com/competitivetiers/eb3b2a7f-4b7c-5d4d-9f4d-5f3b3b1a2b3c/smallicon.png",
    24: "https://media.valorant-api.com/competitivetiers/eb3b2a7f-4b7c-5d4d-9f4d-5f3b3b1a2b3c/smallicon.png",
};
function rankIconUrl(tier: number, tierAssets: Map<number, { smallIcon: string }>): string | null {
    if (!tier || tier <= 0) return null;
    // 1) Prefer the cached valorant-api.com competitive-tiers entry.
    const asset = tierAssets.get(tier);
    if (asset?.smallIcon) return asset.smallIcon;
    // 2) Fall back to hard-coded group icon.
    if (tier >= 27) return FALLBACK_RANK_ICON[24] ?? null;
    const group = Math.max(3, Math.min(11, Math.floor(tier / 3) + 3));
    return FALLBACK_RANK_ICON[group] ?? FALLBACK_RANK_ICON[24] ?? null;
}

function fmtDate(ms: number): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Per-session cache for competitive-tiers metadata; fetched lazily.
let tierAssetCache: Map<number, { smallIcon: string }> | null = null;
let tierAssetInFlight: Promise<Map<number, { smallIcon: string }>> | null = null;
async function loadTierAssets(): Promise<Map<number, { smallIcon: string }>> {
    if (tierAssetCache) return tierAssetCache;
    if (tierAssetInFlight) return tierAssetInFlight;
    tierAssetInFlight = (async () => {
        try {
            const res = await fetch("https://valorant-api.com/v1/competitivetiers");
            if (!res.ok) throw new Error(`competitivetiers ${res.status}`);
            const d = await res.json();
            const m = new Map<number, { smallIcon: string }>();
            for (const t of d?.data ?? []) {
                if (t && typeof t.tier === "number" && t.smallIcon) {
                    m.set(t.tier, { smallIcon: t.smallIcon });
                }
            }
            tierAssetCache = m;
            return m;
        } catch (e) {
            console.warn("Failed to load competitive tiers metadata", e);
            tierAssetCache = new Map();
            return tierAssetCache;
        } finally {
            tierAssetInFlight = null;
        }
    })();
    return tierAssetInFlight;
}

export default function RankTrackerPanel({ onConnectAccount }: Props) {
    const { activeAccount } = useData();
    const [overview, setOverview] = useState<ProfileOverview | null>(null);
    const [rrHistory, setRRHistory] = useState<ProfileRRHistory | null>(null);
    const [syncStatus, setSyncStatus] = useState<ProfileSyncStatus | null>(null);
    const [tierAssets, setTierAssets] = useState<Map<number, { smallIcon: string }>>(new Map());
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [showRaw, setShowRaw] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const puuid = activeAccount?.puuid ?? "";
    const region = activeAccount?.region ?? "na";

    // Load competitive tier metadata once on mount (module-level cache; cheap to re-call).
    useEffect(() => {
        let cancelled = false;
        loadTierAssets().then((m) => {
            if (!cancelled) setTierAssets(m);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 3500);
    }, []);

    const refresh = useCallback(async () => {
        if (!puuid) return;
        setLoading(true);
        try {
            const [ov, rr, st] = await Promise.all([
                getProfileOverview({ puuid, region }),
                getRRHistory(undefined, { puuid, region }),
                getProfileSyncStatus({ puuid, region }).catch(() => null),
            ]);
            setOverview(ov);
            setRRHistory(rr);
            setSyncStatus(st);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Failed to load rank data.";
            showToast(msg);
        } finally {
            setLoading(false);
        }
    }, [puuid, region, showToast]);

    useEffect(() => {
        if (!puuid) {
            setOverview(null);
            setRRHistory(null);
            setSyncStatus(null);
            return;
        }
        void refresh();
    }, [puuid, refresh]);

    const onSync = useCallback(async () => {
        if (!puuid || syncing) return;
        setSyncing(true);
        try {
            const res = await postProfileSync({ puuid, region });
            if (res.started) {
                showToast("Sync started — refreshing when ready…");
                // Poll until the in-flight flag clears, then refresh.
                for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    try {
                        const st = await getProfileSyncStatus({ puuid, region });
                        setSyncStatus(st);
                        if (!st.inFlight) break;
                    } catch {
                        /* ignore */
                    }
                }
                await refresh();
                showToast("Sync complete.");
            } else if (res.inFlight) {
                showToast("Sync already in flight — hang tight.");
            }
        } catch (e) {
            showToast(e instanceof Error ? e.message : "Sync failed.");
        } finally {
            setSyncing(false);
        }
    }, [puuid, region, syncing, refresh, showToast]);

    const current = overview?.currentRank?.competitiveTier ?? 0;
    const rr = overview?.currentRank?.rankedRating ?? 0;
    const tierName = overview?.currentRank?.tierName ?? "";
    const wins = overview?.currentRank?.numberOfWins ?? 0;
    const games = overview?.currentRank?.numberOfGames ?? 0;
    const peakTier = overview?.peakRank?.competitiveTier ?? 0;
    const level = overview?.account?.level ?? 0;
    const totalXp = overview?.account?.totalXp ?? 0;
    const deltas = overview?.lastDeltas ?? [];
    const isRadiantOrAbove = current >= 27;
    const progress = isRadiantOrAbove ? 100 : Math.min(100, Math.max(0, rr));

    const currentRankLabel = useMemo(() => {
        if (!overview) return "Unranked";
        if (tierName && tierName.toLowerCase() !== "unranked") return tierName;
        return tierLabel(current, tierName);
    }, [overview, current, tierName]);

    const peakRankLabel = useMemo(() => {
        if (!overview?.peakRank) return "—";
        if (overview.peakRank.tierName && overview.peakRank.tierName.toLowerCase() !== "unranked") {
            return overview.peakRank.tierName;
        }
        return tierLabel(peakTier, overview.peakRank.tierName);
    }, [overview, peakTier]);

    if (!activeAccount) {
        return (
            <div className="storefront-page scrollable-col">
                <section className="store-empty-hero clip-tactical">
                    <div>
                        <div className="tactical-kicker">// ACCOUNT REQUIRED</div>
                        <h1>Connect Riot to view your rank.</h1>
                        <p>Your current rank, RR, peak rank, RR history, and account level will appear here once you connect a Riot account.</p>
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

    return (
        <div className="storefront-page scrollable-col">
            <div className="storefront-title-container d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
                <div>
                    <div className="tactical-kicker">// RANK TRACKER</div>
                    <h2 className="mb-1 tactical-title">Competitive Profile</h2>
                    <p className="text-muted small mb-0">Current rank, RR history, peak rank, and account level</p>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    {syncStatus && (
                        <span className="sync-indicator" data-inflight={syncStatus.inFlight ? "true" : "false"}>
                            <span className="sync-dot" />
                            {syncStatus.totalMatches > 0
                                ? `${syncStatus.totalMatches} cached`
                                : "0 cached"}
                            {syncStatus.lastSyncedAt > 0 && (
                                <> · last synced {fmtDate(syncStatus.lastSyncedAt)}</>
                            )}
                        </span>
                    )}
                    <button
                        type="button"
                        className="btn-tactical"
                        onClick={onSync}
                        disabled={syncing || syncStatus?.inFlight}
                    >
                        {syncing ? (
                            <>
                                <span className="status-spinner" /> Syncing…
                            </>
                        ) : (
                            <>⟳ Sync</>
                        )}
                    </button>
                    <button type="button" className="btn-tactical-ghost" onClick={refresh} disabled={loading}>
                        {loading ? "⟳ Loading…" : "⟳ Refresh"}
                    </button>
                    <button
                        type="button"
                        className="btn-tactical-icon"
                        onClick={() => setShowRaw((v) => !v)}
                        title="Toggle raw JSON"
                    >
                        {showRaw ? "↦" : "{ }"}
                    </button>
                </div>
            </div>

            {toast && (
                <div className="profile-toast" role="status">
                    {toast}
                </div>
            )}

            {overview?.currentSeasonId && (
                <p className="text-muted small mb-3">Season: <code>{overview.currentSeasonId}</code></p>
            )}

            <div className="rank-tracker-grid mb-5">
                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <div className="tactical-kicker">// CURRENT RANK</div>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {rankIconUrl(current, tierAssets) && (
                            <Image
                                src={rankIconUrl(current, tierAssets)!}
                                alt={currentRankLabel}
                                width={96}
                                height={96}
                                unoptimized
                                className="rank-icon"
                            />
                        )}
                        <div>
                            <div className="rank-name">{currentRankLabel}</div>
                            <div className="rank-rr">{isRadiantOrAbove ? "MAX" : `${rr} RR`}</div>
                            <div className="rank-meta">{wins} wins · {games} games this act</div>
                        </div>
                    </div>
                    {!isRadiantOrAbove && current > 0 && (
                        <div className="rank-progress-wrap">
                            <div className="rank-progress">
                                <div className="rank-progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="rank-progress-label">{rr} / 100 RR</div>
                        </div>
                    )}
                </div>

                <div className="rank-card clip-tactical">
                    <div className="rank-card-header">
                        <div className="tactical-kicker">// PEAK RANK</div>
                    </div>
                    <div className="rank-card-body d-flex align-items-center gap-3">
                        {rankIconUrl(peakTier, tierAssets) && (
                            <Image
                                src={rankIconUrl(peakTier, tierAssets)!}
                                alt="Peak"
                                width={64}
                                height={64}
                                unoptimized
                                className="rank-icon rank-icon-small"
                            />
                        )}
                        <div>
                            <div className="rank-name">{peakRankLabel}</div>
                            <div className="rank-rr">{overview?.peakRank?.seasonId ? `Season ${overview.peakRank.seasonId}` : "Across all acts"}</div>
                            <div className="rank-meta">Highest tier ever recorded</div>
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
                            <div className="rank-meta">{overview?.seasonSummary ? `${overview.seasonSummary.matches} matches this act` : "No matches yet"}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-5">
                <div className="section-row">
                    <div>
                        <div className="tactical-kicker">// RR HISTORY</div>
                        <h3 className="mb-0 section-title">Ranked Rating over Time</h3>
                    </div>
                </div>
                <div className="rr-chart-wrap clip-tactical-sm">
                    <RRHistoryChart snapshots={rrHistory?.snapshots ?? []} />
                </div>
            </div>

            {deltas.length > 0 && (
                <div className="mb-5">
                    <div className="section-row">
                        <div>
                            <div className="tactical-kicker">// RECENT RANKED</div>
                            <h3 className="mb-0 section-title">Last {deltas.length} Ranked Games</h3>
                        </div>
                    </div>
                    <div className="rank-games-list">
                        {deltas.map((d) => {
                            const won = d.rrEarned >= 0;
                            return (
                                <div key={d.matchId} className={`rank-game-row clip-tactical-sm ${won ? "win" : "loss"}`}>
                                    <span className="rank-game-result">{won ? "WIN" : "LOSS"}</span>
                                    <span className="rank-game-rr">
                                        {d.rrEarned > 0 ? "+" : ""}{d.rrEarned} RR
                                    </span>
                                    <span className="rank-game-meta">
                                        {d.seasonId} · Tier {d.tierAfter}
                                    </span>
                                    <span className="rank-game-time">{fmtDate(d.matchStartTime)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {showRaw && overview && (
                <div className="raw-json-block clip-tactical-sm">
                    <div className="tactical-kicker">// RAW JSON · OVERVIEW</div>
                    <pre>{JSON.stringify(overview, null, 2)}</pre>
                    {rrHistory && (
                        <>
                            <div className="tactical-kicker mt-3">// RAW JSON · RR HISTORY (last 50)</div>
                            <pre>{JSON.stringify((rrHistory.snapshots ?? []).slice(-50), null, 2)}</pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}