"use client";

import { useEffect, useState } from 'react';
import { getLiveMatch, LiveMatchResponse, LivePlayer } from '@/services/api';
import { useData } from '@/context/DataContext';
import './LiveMatchOverlay.css';

export default function LiveMatchOverlay() {
    const { activeAccount } = useData();
    const [match, setMatch] = useState<LiveMatchResponse | null>(null);
    const [dismissedMatchKey, setDismissedMatchKey] = useState("");
    const [mapCache, setMapCache] = useState<Record<string, { name: string; splash: string }>>({});
    const [agentCache, setAgentCache] = useState<Record<string, { name: string; icon: string; full: string }>>({});
    const [tierCache, setTierCache] = useState<Record<number, { name: string; icon: string }>>({});

    // Poll live match status
    useEffect(() => {
        if (!activeAccount) {
            setMatch(null);
            return;
        }

        let active = true;
        const poll = async () => {
            const data = await getLiveMatch();
            if (data.phase === "none" && data.error) {
                console.debug("No live match detected:", data.error);
            }
            if (active) {
                const liveKey = liveMatchKey(data);
                setMatch(data);
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
        // Maps
        fetch("https://valorant-api.com/v1/maps")
            .then(res => res.json())
            .then(d => {
                const m: Record<string, { name: string; splash: string }> = {};
                for (const item of d.data || []) {
                    if (item.uuid) {
                        const meta = { name: item.displayName, splash: item.splash || "" };
                        m[item.uuid.toLowerCase()] = meta;
                        if (item.mapUrl) {
                            m[item.mapUrl.toLowerCase()] = meta;
                        }
                    }
                }
                setMapCache(m);
            }).catch(err => console.error("Error loading maps API", err));

        // Agents
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

        // Competitive Tiers
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

    if (!activeAccount) {
        return null;
    }

    const matchKey = liveMatchKey(match);

    if (!match || match.phase === "none" || (matchKey && matchKey === dismissedMatchKey)) {
        return null;
    }

    const currentMap = mapCache[match.mapId?.toLowerCase()] || { name: "Unknown Map", splash: "" };
    
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
            
            {/* Header info */}
            <header className="live-match-header">
                <div className="live-match-header-row">
                    <div className="game-mode-tag">{getQueueName(match.queueId)}</div>
                    {match.source && <div className="game-source-tag">{match.source}</div>}
                </div>
                <h1 className="map-display-name">{currentMap.name}</h1>
                {match.phase === "pregame" && match.timeLeft > 0 && (
                    <div className="timer-display">
                        <span className="timer-label">AGENT SELECT</span>
                        <span className="timer-val">{match.timeLeft}s</span>
                    </div>
                )}
                {match.phase === "coregame" && (
                    <div className="live-badge">LIVE MATCH</div>
                )}
            </header>

            {/* Teams comparison container */}
            <div className="teams-container">
                {/* Ally Team */}
                <div className="team-column ally-team">
                    <h2 className="team-title"><span>YOUR TEAM</span><small>{match.allyTeam?.length || 0} players</small></h2>
                    <div className="players-list">
                        {match.allyTeam?.map((player, idx) => (
                            <PlayerCard 
                                key={player.puuid || idx} 
                                player={player} 
                                agent={agentCache[player.agentId?.toLowerCase()]} 
                                tier={tierCache[player.competitiveTier]}
                            />
                        ))}
                    </div>
                </div>

                {/* VS Indicator */}
                <div className="vs-divider">
                    <div className="vs-circle">VS</div>
                </div>

                {/* Enemy Team */}
                <div className="team-column enemy-team">
                    <h2 className="team-title"><span>ENEMY TEAM</span><small>{match.enemyTeam?.length || 0} players</small></h2>
                    <div className="players-list">
                        {match.enemyTeam?.map((player, idx) => (
                            <PlayerCard 
                                key={player.puuid || idx} 
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

function PlayerCard({ player, agent, tier }: { 
    player: LivePlayer; 
    agent?: { name: string; icon: string; full: string }; 
    tier?: { name: string; icon: string } 
}) {
    const isLocked = player.selectionState === "locked";
    const isSelecting = player.selectionState === "selected";
    const rankName = tier?.name || (player.puuid ? "Rank unavailable" : "Hidden");
    const rankShort = tier?.name ? tier.name.replace("Radiant", "Rad").replace("Immortal", "Imm").replace("Ascendant", "Asc") : rankName;
    
    return (
        <div className={`live-player-card ${player.isLocal ? 'local-user' : ''} ${isLocked ? 'state-locked' : ''}`}>
            {/* Agent background silhouette/fullart */}
            {agent?.full && (
                <div className="agent-card-full-art" style={{ backgroundImage: `url(${agent.full})` }}></div>
            )}
            
            <div className="card-left">
                {/* Agent Icon or Placeholder */}
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

                {/* Player Identity Details */}
                <div className="player-details">
                    <div className="player-name-row">
                        <span className="player-display-name">{player.name || "Selecting..."}</span>
                        {player.isLocal && <span className="local-user-pill">YOU</span>}
                    </div>
                    <span className="agent-name-display">
                        {agent ? agent.name : (isLocked || isSelecting ? "Agent Selection" : "Selecting...")}
                    </span>
                </div>
            </div>

            {/* Rank / MMR rating */}
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

                {/* State indicator (Selecting / Locked) */}
                <div className="selection-status">
                    {isLocked && <span className="badge-locked">LOCKED</span>}
                    {isSelecting && <span className="badge-selecting">SELECTING</span>}
                </div>
            </div>
        </div>
    );
}
