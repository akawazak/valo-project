"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { fetchCachedPublicJson, getLiveLoadouts, getLiveMatch, getLivePlayerStats, LiveLoadoutsResponse, LiveMatchResponse, LivePlayer, LivePlayerStats } from '@/services/api';
import { useData } from '@/context/DataContext';
import { Weapon } from '@/lib/types';
import { buildValorantLoadoutColumns } from '@/lib/weaponLayout';
import ProfilePanel from '@/features/profile/ProfilePanel';
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
type LivePublicMap = { uuid?: string; displayName: string; splash?: string; mapUrl?: string };
type LivePublicAgent = { uuid?: string; displayName: string; displayIcon?: string; fullPortrait?: string };
type LivePublicTierSet = { tiers?: Array<{ tier: number; tierName?: string; largeIcon?: string }> };

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

type ProfileTarget = { puuid: string; gameName: string; tagLine: string };

export default function LiveMatchOverlay() {
    const { activeAccount, weapons, playerCards } = useData();
    const [match, setMatch] = useState<LiveMatchResponse | null>(null);
    const [dismissedMatchKey, setDismissedMatchKey] = useState("");
    const [mapCache, setMapCache] = useState<Record<string, { name: string; splash: string }>>({});
    const [agentCache, setAgentCache] = useState<Record<string, { name: string; icon: string; full: string }>>({});
    const [tierCache, setTierCache] = useState<Record<number, { name: string; icon: string }>>({});
    const [selectedPlayer, setSelectedPlayer] = useState<LivePlayer | null>(null);
    const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);
    const playerCardIcons = useMemo(
        () => new Map(playerCards.map((card) => [card.uuid.toLowerCase(), card.displayIcon || card.smallArt || ""])),
        [playerCards],
    );
    const discordLocalAgentId = match?.allyTeam?.find((player) => player.isLocal)?.agentId || "";
    const discordAgentName = discordLocalAgentId ? agentCache[discordLocalAgentId.toLowerCase()]?.name || "" : "";
    const discordMapName = match?.mapId ? mapCache[match.mapId.toLowerCase()]?.name || "" : "";
    const discordPartySize = useMemo(() => {
        const allPlayers = [...(match?.allyTeam || []), ...(match?.enemyTeam || [])];
        const localPlayer = allPlayers.find((player) => player.isLocal);
        if (!localPlayer?.partyGroup) return 0;
        return partyGroupSizes(allPlayers).get(localPlayer.partyGroup) || 0;
    }, [match?.allyTeam, match?.enemyTeam]);

    useEffect(() => {
        setSelectedPlayer(null);
        setProfileTarget(null);
    }, [activeAccount?.puuid]);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent("vantavault:match-phase", {
            detail: {
                phase: match?.phase || "none",
                queueId: match?.queueId || "",
                mapName: discordMapName,
                agentName: discordAgentName,
                timeLeft: match?.timeLeft || 0,
                partySize: discordPartySize,
                allyCount: match?.allyTeam?.length || 0,
                enemyCount: match?.enemyTeam?.length || 0,
            },
        }));
        return () => {
            window.dispatchEvent(new CustomEvent("vantavault:match-phase", { detail: { phase: "none", queueId: "" } }));
        };
    }, [discordAgentName, discordMapName, discordPartySize, match?.allyTeam?.length, match?.enemyTeam?.length, match?.phase, match?.queueId, match?.timeLeft]);

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

        let timer = 0;
        const schedule = () => {
            if (!active) return;
            timer = window.setTimeout(async () => {
                await poll();
                if (active) schedule();
            }, document.hidden ? 20_000 : 5_000);
        };
        void poll().finally(schedule);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [activeAccount, dismissedMatchKey]);

    // Load Valorant-API metadata
    useEffect(() => {
        fetchCachedPublicJson<{ data?: LivePublicMap[] }>("https://valorant-api.com/v1/maps")
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

        fetchCachedPublicJson<{ data?: LivePublicAgent[] }>("https://valorant-api.com/v1/agents?isPlayableCharacter=true")
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

        fetchCachedPublicJson<{ data?: LivePublicTierSet[] }>("https://valorant-api.com/v1/competitivetiers")
            .then(d => {
                const latestEpisode = d.data?.[d.data.length - 1];
                const t: Record<number, { name: string; icon: string }> = {};
                for (const tier of latestEpisode?.tiers || []) {
                    t[tier.tier] = {
                        name: tier.tierName || "Unranked",
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
    const partySizes = partyGroupSizes([...sortedAllies, ...sortedEnemies]);
    const partyColors = partyGroupColors(partySizes);
    const yourPartySize = partySizes.get("your-party") || 0;
    const yourPartyColor = partyColors.get("your-party");
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
                    <div className="live-match-context">
                        <div className="live-badge">LIVE MATCH</div>
                        {yourPartySize > 1 && (
                            <div
                                className="live-match-party-summary"
                                style={{ "--party-color": yourPartyColor } as CSSProperties}
                            >
                                <i aria-hidden="true" />
                                {yourPartySize === 2 ? "Duo queued" : `${yourPartySize}-stack`}
                            </div>
                        )}
                    </div>
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
                                cardIcon={playerCardIcons.get(player.cardId?.toLowerCase())}
                                tier={tierCache[player.competitiveTier]}
                                peakTier={tierCache[player.peakTier || 0]}
                                partySize={player.partyGroup ? partySizes.get(player.partyGroup) : undefined}
                                partyColor={player.partyGroup ? partyColors.get(player.partyGroup) : undefined}
                                partyGroup={player.partyGroup}
                                onSelect={setSelectedPlayer}
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
                                cardIcon={playerCardIcons.get(player.cardId?.toLowerCase())}
                                tier={tierCache[player.competitiveTier]}
                                peakTier={tierCache[player.peakTier || 0]}
                                partySize={player.partyGroup ? partySizes.get(player.partyGroup) : undefined}
                                partyColor={player.partyGroup ? partyColors.get(player.partyGroup) : undefined}
                                partyGroup={player.partyGroup}
                                onSelect={setSelectedPlayer}
                            />
                        ))}
                    </div>
                </div>
            </div>
            {selectedPlayer && (
                <LivePlayerModal
                    player={selectedPlayer}
                    match={match}
                    agent={agentCache[selectedPlayer.agentId?.toLowerCase()]}
                    cardIcon={playerCardIcons.get(selectedPlayer.cardId?.toLowerCase())}
                    tier={tierCache[selectedPlayer.competitiveTier]}
                    peakTier={tierCache[selectedPlayer.peakTier || 0]}
                    weapons={weapons}
                    onClose={() => setSelectedPlayer(null)}
                    onViewProfile={(profile) => {
                        setSelectedPlayer(null);
                        setProfileTarget(profile);
                    }}
                />
            )}
            {profileTarget && (
                <LiveProfileModal
                    profile={profileTarget}
                    onProfileChange={setProfileTarget}
                    onClose={() => setProfileTarget(null)}
                />
            )}
        </div>
    );
}

function liveMatchKey(match: LiveMatchResponse | null) {
    if (!match || match.phase === "none") return "";
    return match.matchId || `${match.phase}:${match.mapId || "map"}:${match.queueId || "queue"}`;
}

function partyGroupSizes(players: LivePlayer[]) {
    const sizes = new Map<string, number>();
    for (const player of players) {
        if (player.partyGroup) sizes.set(player.partyGroup, (sizes.get(player.partyGroup) || 0) + 1);
    }
    return sizes;
}

function partyGroupColors(sizes: Map<string, number>) {
    const colors = ["#31d8b2", "#e9a84b", "#b47cff", "#55a9ff", "#ff6f91"];
    const groups = new Map<string, string>();
    let index = 0;
    for (const [group, size] of sizes) {
        if (size < 2) continue;
        groups.set(group, colors[index % colors.length]);
        index++;
    }
    return groups;
}

function PlayerCard({
    player,
    agent,
    cardIcon,
    tier,
    peakTier,
    partySize,
    partyColor,
    partyGroup,
    onSelect,
}: {
    player: LivePlayer;
    agent?: { name: string; icon: string; full: string };
    cardIcon?: string;
    tier?: { name: string; icon: string };
    peakTier?: { name: string; icon: string };
    partySize?: number;
    partyColor?: string;
    partyGroup?: string;
    onSelect: (player: LivePlayer) => void;
}) {
    const isLocked = player.selectionState === "locked";
    const isSelecting = player.selectionState === "selected";
    const rankName = tier?.name || (player.puuid ? "Rank unavailable" : "Hidden");
    const rankShort = tier?.name ? tier.name.replace("Radiant", "Rad").replace("Immortal", "Imm").replace("Ascendant", "Asc") : rankName;
    const peakName = player.peakRankName || peakTier?.name || "";
    const peakShort = peakName ? peakName.replace("Radiant", "Rad").replace("Immortal", "Imm").replace("Ascendant", "Asc") : "";
    const displayName = privatePlayerLabel(player, agent?.name);
    const partyPillText = partySize && partySize > 1
        ? partyPillLabel(partySize, partyGroup, player.isLocal)
        : null;

    return (
        <button
            type="button"
            className={`live-player-card ${player.isLocal ? 'local-user' : ''} ${isLocked ? 'state-locked' : ''} ${partyColor ? 'has-party-strip' : ''}`}
            style={partyColor ? { "--party-color": partyColor } as CSSProperties : undefined}
            onClick={() => onSelect(player)}
            aria-label={`Open details for ${displayName}`}
        >
            {agent?.full && (
                <div className="agent-card-full-art" style={{ backgroundImage: `url(${agent.full})` }}></div>
            )}

            <div className="card-left">
                <div className="agent-icon-container">
                    {agent?.icon || cardIcon ? (
                        <img src={agent?.icon || cardIcon} alt={agent?.icon ? agent.name : `${displayName} player card`} className="agent-icon-img" />
                    ) : (
                        <div className="agent-placeholder-icon">?</div>
                    )}
                    {player.accountLevel > 0 && (
                        <span className="player-lvl-badge">LVL {player.accountLevel}</span>
                    )}
                </div>

                <div className="player-details">
                    <div className="player-name-row">
                        <span className="player-display-name">{displayName}</span>
                        {player.isLocal && <span className="local-user-pill">YOU</span>}
                        {partyPillText ? <span className="player-party-pill">{partyPillText}</span> : null}
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
                                {player.peakTier && peakShort && (
                                    <span className="peak-rank-mini">
                                        {peakTier?.icon && <img src={peakTier.icon} alt="" aria-hidden="true" />}
                                        Peak {peakShort}
                                    </span>
                                )}
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
        </button>
    );
}

function LivePlayerModal({
    player,
    match,
    agent,
    cardIcon,
    tier,
    peakTier,
    weapons,
    onClose,
    onViewProfile,
}: {
    player: LivePlayer;
    match: LiveMatchResponse;
    agent?: { name: string; icon: string; full: string };
    cardIcon?: string;
    tier?: { name: string; icon: string };
    peakTier?: { name: string; icon: string };
    weapons: Weapon[];
    onClose: () => void;
    onViewProfile?: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const [stats, setStats] = useState<LivePlayerStats | null>(null);
    const [showLoadout, setShowLoadout] = useState(false);
    const [loadoutAttempt, setLoadoutAttempt] = useState(0);
    const [loadoutState, setLoadoutState] = useState<LoadoutState>({
        status: "idle",
        ids: [],
        message: "",
    });

    useEffect(() => {
        if (!player.puuid || !player.agentId) {
            setStats(null);
            return;
        }
        let cancelled = false;
        getLivePlayerStats(player.puuid, player.agentId).then((s) => {
            if (!cancelled) setStats(s);
        });
        return () => {
            cancelled = true;
        };
    }, [player.agentId, player.puuid]);

    useEffect(() => {
        if (!showLoadout) return;
        if (!player.puuid) {
            setLoadoutState({ status: "error", ids: [], message: "This player has no public Riot ID." });
            return;
        }
        let cancelled = false;
        setLoadoutState({ status: "loading", ids: [], message: "Reading this player's live loadout..." });
        const phase = match.phase === "none" ? undefined : match.phase;
        getLiveLoadouts(phase, match.matchId).then((response) => {
            if (!cancelled) setLoadoutState(resolveLiveLoadout(response, player.puuid));
        });
        return () => {
            cancelled = true;
        };
    }, [loadoutAttempt, match.matchId, match.phase, player.puuid, showLoadout]);

    const loadoutIds = loadoutState.ids;

    const equippedSkins = useMemo(() => {
        if (!loadoutIds?.length) return [];
        const byItemId = new Map<string, { uuid: string; weaponId: string; weapon: string; name: string; icon: string; fallbackIcon: string }>();
        for (const weapon of weapons) {
            for (const skin of weapon.skins) {
                const cosmetic = {
                    uuid: skin.uuid,
                    weaponId: weapon.uuid,
                    weapon: weapon.displayName,
                    name: skin.displayName,
                    icon: skin.displayIcon || skin.chromas[0]?.fullRender || weapon.displayIcon,
                    fallbackIcon: weapon.displayIcon,
                };
                byItemId.set(skin.uuid.toLowerCase(), cosmetic);
                for (const level of skin.levels) byItemId.set(level.uuid.toLowerCase(), cosmetic);
                for (const chroma of skin.chromas) byItemId.set(chroma.uuid.toLowerCase(), cosmetic);
            }
        }
        return Array.from(new Map(
            loadoutIds
                .map((id) => byItemId.get(id.toLowerCase()))
                .filter((skin): skin is { uuid: string; weaponId: string; weapon: string; name: string; icon: string; fallbackIcon: string } => Boolean(skin))
                .map((skin) => [skin.weaponId, skin]),
        ).values());
    }, [loadoutIds, weapons]);

    const loadoutColumns = useMemo(() => {
        const equippedByWeapon = new Map(equippedSkins.map((skin) => [skin.weaponId, skin]));
        return buildValorantLoadoutColumns(weapons).map((column) => ({
            sections: column.sections.map((section) => ({
                label: section.label,
                skins: section.weapons.map((weapon) => equippedByWeapon.get(weapon.uuid)).filter(Boolean),
            })).filter((section) => section.skins.length > 0),
        })).filter((column) => column.sections.length > 0);
    }, [equippedSkins, weapons]);

    const rankName = tier?.name || (player.competitiveTier > 0 ? `Tier ${player.competitiveTier}` : "Rank unavailable");
    const peakRankName = player.peakRankName || peakTier?.name || (player.peakTier ? `Tier ${player.peakTier}` : "");
    const selection = player.selectionState === "locked"
        ? "Locked"
        : player.selectionState === "selected"
            ? "Selecting"
            : "Not selected";
    const losses = stats?.loaded ? Math.max(0, stats.matches - stats.wins) : 0;
    const displayName = privatePlayerLabel(player, agent?.name);
    const [gameName, tagLine = ""] = player.name.split("#");
    const canViewProfile = Boolean(player.puuid && gameName && !["Agent", "Enemy"].includes(gameName));
    const waitingForWeaponMetadata = loadoutState.status === "ready" && loadoutIds.length > 0 && weapons.length === 0;
    const unmatchedCosmetics = loadoutState.status === "ready"
        && loadoutIds.length > 0
        && weapons.length > 0
        && equippedSkins.length === 0;
    const loadoutMessage = waitingForWeaponMetadata
        ? "Loading weapon artwork..."
        : unmatchedCosmetics
            ? "Weapon cosmetics could not be matched yet. Retry."
            : loadoutState.message;
    const canRetryLoadout = loadoutState.status === "error" || unmatchedCosmetics;

    return (
        <div className="live-player-modal-backdrop" role="presentation" onMouseDown={onClose}>
            <section
                className="live-player-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`${displayName} details`}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {agent?.full && (
                    <div className="live-player-modal-art" style={{ backgroundImage: `url(${agent.full})` }} aria-hidden="true" />
                )}
                <button type="button" className="live-player-modal-close" onClick={onClose} aria-label="Close player details">
                    <span aria-hidden="true">×</span>
                </button>
                <div className="live-player-modal-main">
                    <div className="live-player-modal-avatar">
                        {agent?.icon || cardIcon ? (
                            <img src={agent?.icon || cardIcon} alt={agent?.icon ? agent.name : `${displayName} player card`} />
                        ) : (
                            <span>?</span>
                        )}
                    </div>
                    <div className="live-player-modal-title">
                        <span className="live-player-modal-kicker">{player.isLocal ? "Your player" : "Live player"}</span>
                        <h2>{displayName}</h2>
                        <p>
                            {agent?.name || "Agent unavailable"} · {selection}
                            <span className="live-player-modal-rank">
                                {tier?.icon && <img src={tier.icon} alt="" aria-hidden="true" />}
                                {rankName}{player.rankedRating > 0 ? ` · ${player.rankedRating} RR` : ""}
                            </span>
                        </p>
                    </div>
                </div>

                <div className="live-player-modal-grid">
                    <button
                        type="button"
                        className="live-player-info-tile live-player-loadout-tile"
                        disabled={!canViewProfile}
                        onClick={() => {
                            if (!canViewProfile) return;
                            onViewProfile?.({ puuid: player.puuid, gameName, tagLine });
                        }}
                    >
                        <span>Player profile</span>
                        <strong>{canViewProfile ? "Check Profile" : "Profile Hidden"}</strong>
                        <small>{canViewProfile ? "Open full match and rank history" : "Riot hid this identity"}</small>
                    </button>
                    <button type="button" className="live-player-info-tile live-player-loadout-tile" onClick={() => setShowLoadout((open) => !open)}>
                        <span>Loadout</span>
                        <strong>{showLoadout ? "Close Loadout" : "Open Loadout"}</strong>
                        <small>{equippedSkins.length ? `${equippedSkins.length} equipped skins` : showLoadout && loadoutState.status === "loading" ? "Loading live cosmetics" : "View equipped weapons"}</small>
                    </button>
                    <InfoTile label="Level" value={player.accountLevel > 0 ? String(player.accountLevel) : "Hidden"} detail="Account level" />
                    <InfoTile label="Peak Rank" value={peakRankName || "Unavailable"} detail="Highest cached rank" icon={peakTier?.icon} />
                    <InfoTile label="Agent sample" value={stats?.loaded ? `${stats.wins}W-${losses}L` : "Unavailable"} detail={stats?.loaded ? `${Math.round(stats.winrate)}% WR · ${stats.kd.toFixed(2)} KD` : "No cached stat sample"} />
                </div>

                {showLoadout && <section className="live-player-loadout" aria-label={`${displayName} equipped skins`}>
                    <div className="live-player-loadout-heading">
                        <span>Live Loadout<small>{displayName}</small></span>
                        <span className={`live-player-loadout-status${loadoutState.status === "loading" || waitingForWeaponMetadata ? " is-loading" : ""}`}>
                            {loadoutState.status === "loading" || waitingForWeaponMetadata ? "Loading" : equippedSkins.length ? `${equippedSkins.length} visible` : "Unavailable"}
                        </span>
                        <button type="button" className="live-player-loadout-close" onClick={() => setShowLoadout(false)}>Close</button>
                    </div>
                    {loadoutColumns.length > 0 ? (
                        <div className="live-player-loadout-board">
                            {loadoutColumns.map((column, columnIndex) => (
                                <div className="live-player-loadout-column" key={columnIndex}>
                                    {column.sections.map((section) => (
                                        <section className="live-player-loadout-section" key={section.label}>
                                            <h3>{section.label}</h3>
                                            {section.skins.map((skin) => skin ? (
                                                <div className="live-player-loadout-item" key={skin.uuid}>
                                                    {skin.icon && (
                                                        <img
                                                            src={skin.icon}
                                                            data-fallback={skin.fallbackIcon}
                                                            alt=""
                                                            aria-hidden="true"
                                                            onError={(event) => {
                                                                const image = event.currentTarget;
                                                                const fallback = image.dataset.fallback;
                                                                if (fallback && image.src !== fallback) image.src = fallback;
                                                                else image.hidden = true;
                                                            }}
                                                        />
                                                    )}
                                                    <span><b>{skin.weapon}</b><small>{skin.name}</small></span>
                                                </div>
                                            ) : null)}
                                        </section>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="live-player-loadout-empty">
                            <span>{loadoutMessage}</span>
                            {canRetryLoadout && (
                                <button type="button" onClick={() => setLoadoutAttempt((attempt) => attempt + 1)}>
                                    Retry loadout
                                </button>
                            )}
                        </div>
                    )}
                </section>}

                <div className="live-player-modal-note">
                    Only live endpoint fields and cached agent stats are shown here. Missing Riot fields stay hidden instead of being guessed.
                </div>
            </section>
        </div>
    );
}

type LoadoutState = {
    status: "idle" | "loading" | "ready" | "empty" | "error";
    ids: string[];
    message: string;
};

function resolveLiveLoadout(response: LiveLoadoutsResponse, puuid: string): LoadoutState {
    if (response.phase === "error") {
        return { status: "error", ids: [], message: response.error || "Riot could not read live loadouts. Try again." };
    }
    if (response.phase === "none") {
        return { status: "error", ids: [], message: "No active match loadout is available. Try again after agent select." };
    }
    if (response.loadoutsValid === false) {
        return { status: "error", ids: [], message: "Riot is still preparing live loadouts. Try again in a moment." };
    }
    const loadout = response.players?.find((entry) => entry.puuid?.toLowerCase() === puuid.toLowerCase());
    if (!loadout) {
        return { status: "error", ids: [], message: "Riot has not exposed this player's loadout yet." };
    }
    const ids = loadout.skinIds || [];
    if (ids.length === 0 && loadout.gunCount > 0) {
        return { status: "error", ids: [], message: "Weapon data arrived without cosmetic details. Try again." };
    }
    if (ids.length === 0) {
        return { status: "empty", ids: [], message: "This player has no visible weapon cosmetics yet." };
    }
    return { status: "ready", ids, message: "" };
}

function LiveProfileModal({
    profile,
    onProfileChange,
    onClose,
}: {
    profile: ProfileTarget;
    onProfileChange: (profile: ProfileTarget | null) => void;
    onClose: () => void;
}) {
    return (
        <div className="live-profile-modal-backdrop" role="presentation" onMouseDown={onClose}>
            <section
                className="live-profile-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`${profile.gameName} profile`}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <button type="button" className="live-profile-modal-close" onClick={onClose} aria-label="Close player profile">
                    <span aria-hidden="true">×</span>
                </button>
                <div className="live-profile-modal-content">
                    <ProfilePanel
                        key={profile.puuid}
                        requestedProfile={profile}
                        onRequestedProfileChange={onProfileChange}
                        autoSyncMatches={true}
                    />
                </div>
            </section>
        </div>
    );
}

function privatePlayerLabel(player: LivePlayer, agentName?: string) {
    if (!player.name || player.name === "Agent" || player.name === "Enemy") {
        return agentName || (player.selectionState === "none" ? "Selecting..." : "Hidden player");
    }
    return player.name;
}

// Label vocabulary for a player's party pill. The local user's own
// party is anchored with "YOUR …" so it reads as self-referential on
// every row of their premade. Other premades use the match-history
// stack labels (DUO / TRIO / 4-STACK / 5-STACK) without the YOUR
// prefix, so an enemy Jett+Reyna duo reads "DUO", not "YOUR DUO".
const PARTY_STACK_LABELS = ["DUO", "TRIO", "4-STACK", "5-STACK"];

function partyPillLabel(partySize: number, partyGroup: string | undefined, isLocal: boolean) {
    if (isLocal || partyGroup === "your-party") {
        return partySize === 2 ? "YOUR DUO" : `YOUR PARTY · ${partySize}`;
    }
    const idx = Math.min(PARTY_STACK_LABELS.length - 1, Math.max(0, partySize - 2));
    return PARTY_STACK_LABELS[idx];
}

function InfoTile({
    label,
    value,
    detail,
    icon,
}: {
    label: string;
    value: string;
    detail: string;
    icon?: string;
}) {
    return (
        <div className="live-player-info-tile">
            {icon && <img src={icon} alt="" aria-hidden="true" />}
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
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
