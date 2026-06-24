"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { getLiveMatch, getLivePlayerStats, LiveMatchResponse, LivePlayer, LivePlayerStats } from '@/services/api';
import { useData } from '@/context/DataContext';
import './LiveMatchOverlay.css';

// Sort players for stable rendering. The 5-second poll can reorder
// the array between updates; sorting on a deterministic key keeps
// each row glued to its slot. Order of precedence:
//   1. Local user first
//   2. Locked > Selecting > None (so confirmed picks surface up)
//   3. PUUID ascending (stable, content-free tiebreaker)
//   4. Display name ascending (used when PUUID is hidden, e.g. enemy
//      pregame placeholders)
const SELECTION_RANK: Record<string, number> = { locked: 0, selected: 1, none: 2 };

function stablePlayerSort(players: LivePlayer[] | undefined): LivePlayer[] {
    if (!players || players.length === 0) return [];
    return [...players].sort((a, b) => {
        if (!!a.isLocal !== !!b.isLocal) return a.isLocal ? -1 : 1;
        const ar = SELECTION_RANK[a.selectionState] ?? 99;
        const br = SELECTION_RANK[b.selectionState] ?? 99;
        if (ar !== br) return ar - br;
        if (a.puuid && b.puuid) return a.puuid < b.puuid ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
    });
}

export default function LiveMatchOverlay() {
    const { activeAccount } = useData();
    const [match, setMatch] = useState<LiveMatchResponse | null>(null);
    const [dismissedMatchKey, setDismissedMatchKey] = useState("");
    const [mapCache, setMapCache] = useState<Record<string, { name: string; splash: string }>>({});
    const [agentCache, setAgentCache] = useState<Record<string, { name: string; icon: string; full: string }>>({});
    const [tierCache, setTierCache] = useState<Record<number, { name: string; icon: string }>>({});

    // ---- Local countdown timer ----
    // The backend only emits timeLeft at each 5s poll. We capture the
    // server's snapshot + the wall-clock at which we received it, then
    // tick down locally every second so the user sees a smooth
    // countdown. When a new poll arrives with a HIGHER timeLeft (Riot
    // resets the clock on phase changes / dodges) we re-anchor.
    const [timerSnapshot, setTimerSnapshot] = useState<{ seconds: number; receivedAt: number } | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const lastPollPhaseRef = useRef<string>("");

    useEffect(() => {
        if (!timerSnapshot) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [timerSnapshot]);

    const displayedTimeLeft = useMemo(() => {
        if (!timerSnapshot) return 0;
        const elapsed = Math.floor((now - timerSnapshot.receivedAt) / 1000);
        return Math.max(0, timerSnapshot.seconds - elapsed);
    }, [timerSnapshot, now]);

    // Poll live match status
    useEffect(() => {
        if (!activeAccount) {
            setMatch(null);
            setTimerSnapshot(null);
            lastPollPhaseRef.current = "";
            return;
        }

        let active = true;
        const poll = async () => {
            const data = await getLiveMatch();
            if (!active) return;

            if (data.phase === "none" && data.error) {
                console.debug("No live match detected:", data.error);
            }
            if (active) {
                const liveKey = liveMatchKey(data);
                setMatch(data);

                // ---- Anchor the local countdown timer ----
                // 1. Phase changed -> reset the timer.
                // 2. Polled value rose (server reset / dodge re-anchor).
                // 3. First pregame poll -> start counting.
                if (data.phase !== lastPollPhaseRef.current) {
                    lastPollPhaseRef.current = data.phase;
                    if (data.phase === "pregame" && data.timeLeft > 0) {
                        setTimerSnapshot({ seconds: data.timeLeft, receivedAt: Date.now() });
                    } else {
                        setTimerSnapshot(null);
                    }
                } else if (data.phase === "pregame") {
                    setTimerSnapshot((prev) => {
                        const received = data.timeLeft;
                        if (!prev || received > prev.seconds) {
                            return { seconds: received, receivedAt: Date.now() };
                        }
                        return prev;
                    });
                }

                if (liveKey && liveKey !== dismissedMatchKey) {
                    setDismissedMatchKey("");
                }
            }
        };

        poll();
        const interval = setInterval(poll, 5000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [activeAccount, dismissedMatchKey]);

    // Load Valorant-API metadata
    useEffect(() => {
        fetch("https://valorant-api.com/v1/maps")
            .then(res => res.json())
            .then(d => {
                const m: Record<string, { name: string; splash: string }> = {};
                for (const item of d.data || []) {
                    if (item.uuid) {
                        const meta = { name: item.displayName, splash: item.splash || "" };
                        m[item.uuid.toLowerCase()] = meta;
                        if (item.mapUrl) m[item.mapUrl.toLowerCase()] = meta;
                    }
                }
                setMapCache(m);
            }).catch(err => console.error("Error loading maps API", err));

        fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true")
            .then(res => res.json())
            .then(d => {
                const a: Record<string, { name: string; icon: string; full: string }> = {};
                for (const item of d.data || []) {
                    if (item.uuid) {
                        a[item.uuid.toLowerCase()] = {
                            name: item.displayName,
                            icon: item.displayIcon || "",
                            full: item.fullPortrait || ""
                        };
                    }
                }
                setAgentCache(a);
            }).catch(err => console.error("Error loading agents API", err));

        fetch("https://valorant-api.com/v1/competitivetiers")
            .then(res => res.json())
            .then(d => {
                const latestEpisode = d.data?.[d.data.length - 1];
                const t: Record<number, { name: string; icon: string }> = {};
                for (const tier of latestEpisode?.tiers || []) {
                    t[tier.tier] = {
                        name: tier.tierName,
                        icon: tier.largeIcon || ""
                    };
                }
                setTierCache(t);
            }).catch(err => console.error("Error loading competitive tiers API", err));
    }, []);

    if (!activeAccount) return null;

    const matchKey = liveMatchKey(match);
    if (!match || match.phase === "none") return null;

    const isDismissed = !!(matchKey && matchKey === dismissedMatchKey);

    // Format queue name
    const getQueueName = (id: string) => {
        const key = id?.toLowerCase?.() || "";
        if (!key) return "Live Match";
        const labels: Record<string, string> = {
            competitive: "Competitive",
            unrated: "Unrated",
            spikerush: "Spike Rush",
            swiftplay: "Swiftplay",
            deathmatch: "Deathmatch",
            teamdeathmatch: "Team Deathmatch",
            hurm: "Team Deathmatch",
            escalation: "Escalation",
            ggteam: "Escalation",
            onefa: "Replication",
            snowball: "Snowball Fight",
            premier: "Premier",
            custom: "Custom Game",
        };
        return labels[key] || id.charAt(0).toUpperCase() + id.slice(1);
    };

    if (isDismissed) {
        const reopen = () => setDismissedMatchKey("");
        const isPregame = match.phase === "pregame";
        const pillPhaseLabel = isPregame ? "Agent select" : "Live match";
        const queueName = getQueueName(match.queueId);
        const mapName = mapCache[match.mapId?.toLowerCase()]?.name;
        const tier = "is-" + (isPregame ? "pregame" : "live");
        return (
            <button
                type="button"
                className={`live-match-status-pill is-clickable ${tier}`}
                onClick={reopen}
                aria-label="Reopen live match overlay"
                title="Reopen live match"
            >
                <span className="live-match-pill-icon" aria-hidden="true">
                    <span className="live-match-pill-dot" />
                </span>
                <span className="live-match-pill-body">
                    <span className="live-match-pill-kicker">
                        {queueName} · {pillPhaseLabel}
                    </span>
                    <span className="live-match-pill-title">
                        {mapName || "Match in progress"}
                    </span>
                    <span className="live-match-pill-cta">Click to view</span>
                </span>
                <span className="live-match-pill-arrow" aria-hidden="true">›</span>
            </button>
        );
    }

    const currentMap = mapCache[match.mapId?.toLowerCase()] || { name: "Unknown Map", splash: "" };
    const sortedAllies = stablePlayerSort(match.allyTeam);
    const sortedEnemies = stablePlayerSort(match.enemyTeam);

    return (
        <div className="live-match-overlay" style={{ backgroundImage: currentMap.splash ? `url(${currentMap.splash})` : 'none' }}>
            <div className="overlay-scrim"></div>
            <button
                type="button"
                className="live-match-close"
                onClick={() => setDismissedMatchKey(matchKey || "dismissed")}
                aria-label="Close live match overlay"
            >
                <span aria-hidden="true">×</span>
            </button>

            <header className="live-match-header">
                <div className="live-match-header-row">
                    <div className="game-mode-tag">{getQueueName(match.queueId)}</div>
                    {match.source && <div className="game-source-tag">{match.source}</div>}
                </div>
                <h1 className="map-display-name">{currentMap.name}</h1>
                {match.phase === "pregame" && displayedTimeLeft > 0 && (
                    <div className="timer-display">
                        <span className="timer-label">AGENT SELECT</span>
                        <span className="timer-val">{displayedTimeLeft}s</span>
                    </div>
                )}
                {match.phase === "coregame" && (
                    <div className="live-badge">LIVE MATCH</div>
                )}
            </header>

            <div className="teams-container">
                <div className="team-column ally-team">
                    <h2 className="team-title"><span>YOUR TEAM</span><small>{match.allyTeam?.length || 0} players</small></h2>
                    <div className="players-list">
                        {sortedAllies.map((player, idx) => (
                            <PlayerCard
                                key={player.puuid || `ally-${idx}`}
                                player={player}
                                agent={agentCache[player.agentId?.toLowerCase()]}
                                tier={tierCache[player.competitiveTier]}
                            />
                        ))}
                    </div>
                </div>

                <div className="vs-divider">
                    <div className="vs-circle">VS</div>
                </div>

                <div className="team-column enemy-team">
                    <h2 className="team-title"><span>ENEMY TEAM</span><small>{match.enemyTeam?.length || 0} players</small></h2>
                    <div className="players-list">
                        {sortedEnemies.map((player, idx) => (
                            <PlayerCard
                                key={player.puuid || `enemy-${idx}`}
                                player={player}
                                agent={agentCache[player.agentId?.toLowerCase()]}
                                tier={tierCache[player.competitiveTier]}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function liveMatchKey(match: LiveMatchResponse | null) {
    if (!match || match.phase === "none") return "";
    return match.matchId || `${match.phase}:${match.mapId || "map"}:${match.queueId || "queue"}`;
}

function PlayerCard({
    player,
    agent,
    tier,
}: {
    player: LivePlayer;
    agent?: { name: string; icon: string; full: string };
    tier?: { name: string; icon: string };
}) {
    const isLocked = player.selectionState === "locked";
    const isSelecting = player.selectionState === "selected";
    const rankName = tier?.name || (player.puuid ? "Rank unavailable" : "Hidden");
    const rankShort = tier?.name ? tier.name.replace("Radiant", "Rad").replace("Immortal", "Imm").replace("Ascendant", "Asc") : rankName;

    return (
        <div className={`live-player-card ${player.isLocal ? 'local-user' : ''} ${isLocked ? 'state-locked' : ''}`}>
            {agent?.full && (
                <div className="agent-card-full-art" style={{ backgroundImage: `url(${agent.full})` }}></div>
            )}

            <div className="card-left">
                <div className="agent-icon-container">
                    {agent?.icon ? (
                        <img src={agent.icon} alt={agent.name} className="agent-icon-img" />
                    ) : (
                        <div className="agent-placeholder-icon">?</div>
                    )}
                    {player.accountLevel > 0 && (
                        <span className="player-lvl-badge">LVL {player.accountLevel}</span>
                    )}
                </div>

                <div className="player-details">
                    <div className="player-name-row">
                        <span className="player-display-name">{player.name || "Selecting..."}</span>
                        {player.isLocal && <span className="local-user-pill">YOU</span>}
                    </div>
                    <span className="agent-name-display">
                        {agent ? agent.name : (isLocked || isSelecting ? "Agent Selection" : "Selecting...")}
                    </span>
                    <PlayerStatsLine player={player} agentId={player.agentId} />
                </div>
            </div>

            <div className="card-right">
                {tier ? (
                    <div className="player-rank-container">
                        <img src={tier.icon} alt={tier.name} className="player-rank-icon" title={tier.name} />
                        {player.competitiveTier > 0 && (
                            <div className="rank-rating-text">
                                <span className="tier-name">{rankShort}</span>
                                <span className="rr-val">{player.rankedRating} RR</span>
                            </div>
                        )}
                    </div>
                ) : player.puuid ? (
                    <div className="player-rank-container unranked">
                        <div className="unranked-placeholder">{rankName}</div>
                    </div>
                ) : null}

                <div className="selection-status">
                    {isLocked && <span className="badge-locked">LOCKED</span>}
                    {isSelecting && <span className="badge-selecting">SELECTING</span>}
                </div>
            </div>
        </div>
    );
}

// Lightweight inline stat line: "12W-8L · 60% · 1.4 KD" rendered
// under the agent name. Fetches lazily (once per puuid+agent pair)
// and silently stays empty for placeholder / private profiles.
function PlayerStatsLine({ player, agentId }: { player: LivePlayer; agentId?: string }) {
    const [stats, setStats] = useState<LivePlayerStats | null>(null);
    const cacheKey = player.puuid && agentId ? `${player.puuid}:${agentId.toLowerCase()}` : "";

    useEffect(() => {
        if (!cacheKey) {
            setStats(null);
            return;
        }
        let cancelled = false;
        getLivePlayerStats(player.puuid, agentId!).then((s) => {
            if (!cancelled) setStats(s);
        });
        return () => { cancelled = true; };
        // Re-fetch only when the (puuid, agent) key changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cacheKey]);

    if (!stats || !stats.loaded || stats.matches <= 0) return null;

    const losses = stats.matches - stats.wins;
    const pct = Math.round(stats.winrate);
    const wrColor = pct >= 55 ? "wr-good" : pct <= 45 ? "wr-bad" : "wr-mid";

    return (
        <span className={`player-stats-line ${wrColor}`}>
            <span className="player-stats-record">{stats.wins}W-{losses}L</span>
            <span className="player-stats-sep">·</span>
            <span className="player-stats-wr">{pct}%</span>
            <span className="player-stats-sep">·</span>
            <span className="player-stats-kd">{stats.kd.toFixed(2)} KD</span>
            <span className="player-stats-sample">({stats.matches})</span>
        </span>
    );
}
