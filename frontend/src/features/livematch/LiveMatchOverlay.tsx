"use client";

import { useEffect, useState } from 'react';
import { getLiveMatch, LiveMatchResponse, LivePlayer } from '@/services/api';
import './LiveMatchOverlay.css';

export default function LiveMatchOverlay() {
    const [match, setMatch] = useState<LiveMatchResponse | null>(null);
    const [mapCache, setMapCache] = useState<Record<string, { name: string; splash: string }>>({});
    const [agentCache, setAgentCache] = useState<Record<string, { name: string; icon: string; full: string }>>({});
    const [tierCache, setTierCache] = useState<Record<number, { name: string; icon: string }>>({});

    // Poll live match status
    useEffect(() => {
        let active = true;
        const poll = async () => {
            const data = await getLiveMatch();
            if (active) {
                setMatch(data);
            }
        };

        poll();
        const interval = setInterval(poll, 2000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, []);

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

    if (!match || match.phase === "none") {
        return null;
    }

    const currentMap = mapCache[match.mapId?.toLowerCase()] || { name: "Unknown Map", splash: "" };
    
    // Format queue name
    const getQueueName = (id: string) => {
        if (!id) return "Custom Game";
        if (id.toLowerCase() === "competitive") return "Competitive";
        if (id.toLowerCase() === "unrated") return "Unrated";
        if (id.toLowerCase() === "spikerush") return "Spike Rush";
        if (id.toLowerCase() === "swiftplay") return "Swiftplay";
        if (id.toLowerCase() === "deathmatch") return "Deathmatch";
        return id.charAt(0).toUpperCase() + id.slice(1);
    };

    return (
        <div className="live-match-overlay" style={{ backgroundImage: currentMap.splash ? `url(${currentMap.splash})` : 'none' }}>
            <div className="overlay-scrim"></div>
            
            {/* Header info */}
            <header className="live-match-header">
                <div className="game-mode-tag">{getQueueName(match.queueId)}</div>
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
                    <h2 className="team-title">YOUR TEAM</h2>
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
                    <h2 className="team-title">ENEMY TEAM</h2>
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

function PlayerCard({ player, agent, tier }: { 
    player: LivePlayer; 
    agent?: { name: string; icon: string; full: string }; 
    tier?: { name: string; icon: string } 
}) {
    const isLocked = player.selectionState === "locked";
    const isSelecting = player.selectionState === "selected";
    
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
                                <span className="tier-name">{tier.name.split(' ')[0]}</span>
                                <span className="rr-val">{player.rankedRating} RR</span>
                            </div>
                        )}
                    </div>
                ) : player.puuid ? (
                    <div className="player-rank-container unranked">
                        <div className="unranked-placeholder">Unranked</div>
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
