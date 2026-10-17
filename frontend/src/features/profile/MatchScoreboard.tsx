"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { type ProfileMatchDetails, type ProfileMatchSummary } from "@/services/api";
import { sideStats, type MatchSide, type RoundOutcome, type SideStats } from "./matchBreakdown";
import s from "./ProfilePanel.module.css";
import { type AgentMeta, tierLabel, rankIconUrl, fmtPct } from "./profileShared";

export const ROUND_END_LABELS: Record<RoundOutcome["end"], string> = {
    elim: "Elimination",
    boom: "Spike detonated",
    defuse: "Spike defused",
    time: "Time ran out",
    other: "Other",
};

export function RoundEndIcon({ end }: { end: RoundOutcome["end"] }) {
    const common = { width: 14, height: 14, viewBox: "0 0 24 24", "aria-hidden": true } as const;
    if (end === "boom") {
        return <svg {...common} fill="currentColor"><path d="M12 2l2.2 5.6L20 6l-3 5.2L22 14l-5.8 1.2L17 21l-5-3.4L7 21l.8-5.8L2 14l5-2.8L4 6l5.8 1.6z" /></svg>;
    }
    if (end === "defuse") {
        return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>;
    }
    if (end === "time") {
        return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M9 2h6" /></svg>;
    }
    if (end === "other") {
        return <svg {...common} fill="currentColor"><circle cx="12" cy="12" r="4" /></svg>;
    }
    return <svg {...common} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>;
}

// VLR-style round history: one row per team, the winner's cell carries how the round ended.
export function RoundHistory({ rounds, ownRounds, enemyRounds }: { rounds: RoundOutcome[]; ownRounds: number; enemyRounds: number }) {
    const endsSeen = Array.from(new Set(rounds.map((round) => round.end)));
    return (
        <div className={s.roundHistory} role="group" aria-label="Round history">
            <div className={s.roundHistoryTeams} aria-hidden="true">
                <span data-team="ally"><i />Your team <b>{ownRounds}</b></span>
                <small>Round</small>
                <span data-team="enemy"><i />Enemy <b>{enemyRounds}</b></span>
            </div>
            <ol className={s.roundHistoryTrack}>
                {rounds.map((round) => (
                    <li key={round.roundNum} data-swap={round.afterSwap || undefined} title={round.label} aria-label={round.label}>
                        <span data-team="ally" data-won={round.won || undefined}>{round.won ? <RoundEndIcon end={round.end} /> : null}</span>
                        <small>{round.roundNum + 1}</small>
                        <span data-team="enemy" data-won={!round.won || undefined}>{round.won ? null : <RoundEndIcon end={round.end} />}</span>
                    </li>
                ))}
            </ol>
            <ul className={s.roundHistoryKey} aria-label="Round end key">
                {endsSeen.map((end) => (
                    <li key={end}><RoundEndIcon end={end} />{ROUND_END_LABELS[end]}</li>
                ))}
            </ul>
        </div>
    );
}

export function Scoreboard({
    detail,
    breakdown,
    side,
    queueId,
    partyMembers,
    agents,
    tierAssets,
    onViewProfile,
}: {
    detail: ProfileMatchDetails;
    /** Source of rounds and kill events, which may arrive with a later analytics load. */
    breakdown: ProfileMatchDetails;
    side: MatchSide;
    queueId?: string;
    partyMembers: NonNullable<ProfileMatchSummary["partyMembers"]>;
    agents: Record<string, AgentMeta>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const localPlayer = detail.players.find((p) => p.isLocal);
    const [hoveredParty, setHoveredParty] = useState<string | null>(null);
    const [focusedParty, setFocusedParty] = useState<string | null>(null);
    const [pinnedParty, setPinnedParty] = useState<string | null>(null);
    const activeParty = hoveredParty ?? focusedParty ?? pinnedParty;
    const localTeamId = localPlayer?.teamId || "Blue";
    const localIsBlue = localTeamId.toLowerCase() === "blue";
    const yourTeam = detail.players.filter((p) => p.teamId.toLowerCase() === localTeamId.toLowerCase());
    const enemyTeam = detail.players.filter((p) => p.teamId.toLowerCase() !== localTeamId.toLowerCase());
    const partyMemberSubjects = new Set(partyMembers.map((member) => member.subject.toLowerCase()));
    const partyGroups = buildScorePartyGroups(detail.players, partyMemberSubjects);
    // Free-for-all modes (e.g. Deathmatch) end 0:0 with every player on their
    // own team, so show one standings list ranked by kills instead.
    const teamRounds = detail.matchInfo.blueRoundsWon + detail.matchInfo.redRoundsWon > 0;
    const stats = useMemo(
        () => sideStats({ ...detail, rounds: breakdown.rounds, kills: breakdown.kills }, side, queueId),
        [breakdown.kills, breakdown.rounds, detail, queueId, side],
    );
    const showFirsts = (breakdown.kills?.length ?? 0) > 0;
    const acsOf = (p: ProfileMatchDetails["players"][number]) => stats.get(p.subject.toLowerCase())?.acs || 0;
    const sortPlayers = (rows: typeof detail.players) => teamRounds
        ? [...rows].sort((a, b) => acsOf(b) - acsOf(a) || b.score - a.score || b.kills - a.kills)
        : [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.assists - a.assists);
    const maxAcs = Math.max(1, ...detail.players.map(acsOf));
    // Only the lobby best in each column gets emphasis; everything else stays neutral.
    const statValues = detail.players.map((p) => stats.get(p.subject.toLowerCase())).filter((stat): stat is SideStats => Boolean(stat));
    const leaders: ScoreLeaders = {
        acs: maxAcs,
        adr: Math.max(0, ...statValues.map((stat) => Math.round(stat.adr))),
        hs: Math.max(0, ...statValues.filter((stat) => stat.hasShots).map((stat) => stat.hsPct)),
        firstKills: Math.max(0, ...statValues.map((stat) => stat.firstKills)),
    };

    // MVPs always reflect the whole match, whichever side filter is active.
    const mvpPlayer = useMemo(() => {
        if (!detail.players.length) return null;
        // Riot names one MVP per team; the stronger of them is the match MVP.
        const riotMvps = detail.players.filter((p) => p.teamMvp);
        if (riotMvps.length) {
            return riotMvps.reduce((best, p) => ((teamRounds ? (p.acs || 0) > (best.acs || 0) : p.kills > best.kills) ? p : best), riotMvps[0]);
        }
        if (!teamRounds) {
            return [...detail.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
        }
        return [...detail.players].reduce(
            (max, p) => ((p.acs || 0) > (max.acs || 0) ? p : max),
            detail.players[0],
        );
    }, [detail.players, teamRounds]);

    const shared = {
        agents, mvpPlayer, partyGroups, tierAssets, onViewProfile, stats, maxAcs, showFirsts, leaders, activeParty, pinnedParty,
        onPartyHover: setHoveredParty,
        onPartyFocus: setFocusedParty,
        onPartyPin: (party: string) => setPinnedParty((current) => current === party ? null : party),
    };

    if (!teamRounds) {
        return (
            <div className={s.scoreboardStage} data-party-active={Boolean(activeParty) || undefined}>
                <div className={`${s.sbGrid} ${s.sbGridSingle}`}>
                    <ScoreTeam title="Standings" side="blue" players={sortPlayers(detail.players)} roundStats={false} {...shared} />
                </div>
            </div>
        );
    }

    return (
        <div className={s.scoreboardStage} data-party-active={Boolean(activeParty) || undefined}>
            <div className={s.sbGrid}>
                <ScoreTeam
                    title="Your team"
                    side="blue"
                    won={localIsBlue ? detail.matchInfo.blueWins : !detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.blueRoundsWon : detail.matchInfo.redRoundsWon}
                    players={sortPlayers(yourTeam)}
                    {...shared}
                />
                <ScoreTeam
                    title="Enemy team"
                    side="red"
                    won={localIsBlue ? !detail.matchInfo.blueWins : detail.matchInfo.blueWins}
                    score={localIsBlue ? detail.matchInfo.redRoundsWon : detail.matchInfo.blueRoundsWon}
                    players={sortPlayers(enemyTeam)}
                    {...shared}
                />
            </div>
        </div>
    );
}

export function ScoreTeam({
    title,
    side,
    won,
    score,
    roundStats = true,
    players,
    agents,
    mvpPlayer,
    partyGroups,
    tierAssets,
    onViewProfile,
    stats,
    maxAcs,
    showFirsts,
    leaders,
    activeParty,
    pinnedParty,
    onPartyHover,
    onPartyFocus,
    onPartyPin,
}: {
    title: string;
    side: "blue" | "red";
    won?: boolean;
    score?: number;
    /** False for free-for-all modes: hides round result, ACS, ADR and first kills, and numbers the standings. */
    roundStats?: boolean;
    players: ProfileMatchDetails["players"];
    agents: Record<string, AgentMeta>;
    mvpPlayer: ProfileMatchDetails["players"][number] | null;
    partyGroups: Map<string, ScorePartyGroup>;
    tierAssets: Map<number, { smallIcon: string }>;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    stats: Map<string, SideStats>;
    maxAcs: number;
    showFirsts: boolean;
    leaders: ScoreLeaders;
    activeParty: string | null;
    pinnedParty: string | null;
    onPartyHover: (party: string | null) => void;
    onPartyFocus: (party: string | null) => void;
    onPartyPin: (party: string) => void;
}) {
    const statOf = (p: ProfileMatchDetails["players"][number]) => stats.get(p.subject.toLowerCase());
    // Team MVP: Riot's pick for this team when cached, otherwise the top
    // full-match ACS on the team without the match MVP.
    const riotTeamMvp = players.find((p) => p.teamMvp);
    const teamMvp = players.some((p) => p.subject === mvpPlayer?.subject)
        ? null
        : riotTeamMvp ?? (roundStats && players.length
            ? players.reduce((best, p) => ((p.acs || 0) > (best.acs || 0) ? p : best), players[0])
            : null);
    const teamKills = players.reduce((sum, p) => sum + (statOf(p)?.kills ?? p.kills), 0);
    const avgAcs = players.length ? Math.round(players.reduce((sum, p) => sum + (statOf(p)?.acs ?? 0), 0) / players.length) : 0;

    return (
        <div className={s.sbTeam} data-side={side}>
            <div className={s.sbHead}>
                <div className={s.sbBanner}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" />
                    </svg>
                    <span>{title}</span>
                    <small>{roundStats ? (won ? "Victory" : "Defeat") : `${players.length} players`}</small>
                </div>
                {roundStats ? <span className={s.sbTotals}>{teamKills} kills · {avgAcs} avg ACS</span> : null}
                {roundStats ? <strong className={s.sbScore}>{score}</strong> : null}
            </div>
            <div className={s.sbScroll}>
                <table className={s.sbTable} data-round-stats={roundStats}>
                    <thead>
                        <tr className={s.sbRow}>
                            <th scope="col">Player</th>
                            <th scope="col">Rank</th>
                            {roundStats ? <th scope="col">ACS</th> : null}
                            <th scope="col">K / D / A</th>
                            <th scope="col" title="Kills minus deaths">+/−</th>
                            {roundStats ? <th scope="col">ADR</th> : null}
                            <th scope="col">HS%</th>
                            {roundStats ? <th scope="col" title="First kills: opened the round with a kill">FK</th> : null}
                            {roundStats ? <th scope="col" title="First deaths: died first in the round">FD</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {players.map((p, idx) => {
                            const meta = agents[p.characterId?.toLowerCase?.() || ""];
                            const stat = statOf(p);
                            const kills = stat?.kills ?? p.kills;
                            const deaths = stat?.deaths ?? p.deaths;
                            const assists = stat?.assists ?? p.assists;
                            const diff = kills - deaths;
                            const acs = Math.round(stat?.acs ?? p.acs ?? 0);
                            const hasShots = stat?.hasShots ?? p.headshots + p.bodyshots + p.legshots > 0;
                            const hsPct = stat?.hsPct ?? p.hsPct;
                            const adr = Math.round(stat?.adr ?? p.adr ?? 0);
                            const firstKills = stat?.firstKills ?? 0;
                            const firstDeaths = stat?.firstDeaths ?? 0;
                            const name = p.gameName
                                ? `${p.gameName}${p.tagLine ? `#${p.tagLine}` : ""}`
                                : p.isLocal
                                    ? "You"
                                    : "Player";
                            const isMvp = Boolean(mvpPlayer && mvpPlayer.subject === p.subject);
                            const isTeamMvp = Boolean(teamMvp && teamMvp.subject === p.subject);
                            const party = partyGroups.get(p.subject.toLowerCase());
                            const displayedTier = p.competitiveTier || p.currentCompetitiveTier || 0;
                            const rankIcon = displayedTier > 0 ? rankIconUrl(displayedTier, tierAssets) : null;
                            const rowStyle = (party ? { "--party-color": party.color } : {}) as CSSProperties;
                            return (
                                <tr
                                    data-slot="score-player-row"
                                    key={p.subject || `${p.characterId}-${idx}`}
                                    className={`${s.sbRow} ${p.isLocal ? s.sbRowLocal : ""}`}
                                    style={rowStyle}
                                    data-party-highlighted={Boolean(party && activeParty === party.key) || undefined}
                                    onMouseEnter={() => onPartyHover(party?.key ?? null)}
                                    onMouseLeave={() => onPartyHover(null)}
                                    onFocus={() => onPartyFocus(party?.key ?? null)}
                                    onBlur={(event) => {
                                        if (!event.currentTarget.contains(event.relatedTarget)) onPartyFocus(null);
                                    }}
                                >
                                    <td className={s.sbPlayerCell}>
                                        {party ? (
                                            <button
                                                type="button"
                                                className={s.sbPartyRail}
                                                aria-label={party.title}
                                                aria-pressed={pinnedParty === party.key}
                                                title={`${party.title}. Click to keep this party highlighted.`}
                                                onClick={() => onPartyPin(party.key)}
                                            ><i aria-hidden="true" /></button>
                                        ) : null}
                                        {roundStats ? null : <span className={s.sbPlace} aria-label={`Place ${idx + 1}`}>{idx + 1}</span>}
                                        {meta?.icon ? (
                                            <Image src={meta.icon} alt="" width={38} height={38} unoptimized className={s.sbAgent} />
                                        ) : (
                                            <span className={s.sbAgent} />
                                        )}
                                        <span className={s.sbIdentity}>
                                            <span className={s.sbName}>
                                                {p.subject && p.gameName && !p.isLocal ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => onViewProfile({ puuid: p.subject, gameName: p.gameName, tagLine: p.tagLine || "" })}
                                                        title={`View ${name}'s profile`}
                                                    >
                                                        {name}
                                                    </button>
                                                ) : name}
                                            </span>
                                            <span className={s.sbTags}>
                                                <small>{meta?.name || "Agent"}</small>
                                                {party ? (
                                                    <span
                                                        className={s.sbParty}
                                                        title={party.title}
                                                        aria-label={party.title}
                                                    >
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
                                                            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                                                        </svg>
                                                        {party.label}
                                                        <span className={s.sbPartyDots} aria-hidden="true">
                                                            {Array.from({ length: Math.min(party.size, 5) }, (_, dot) => <i key={dot} />)}
                                                        </span>
                                                    </span>
                                                ) : null}
                                                {isMvp ? (
                                                    <span className={`${s.sbTag} ${s.sbTagMvp}`}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" /></svg>
                                                        MVP
                                                    </span>
                                                ) : null}
                                                {isTeamMvp ? (
                                                    <span className={`${s.sbTag} ${s.sbTagTeamMvp}`}>
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l3 6.5 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21l1.5-7L2 9.3l7-.8z" /></svg>
                                                        Team MVP
                                                    </span>
                                                ) : null}
                                                {p.isLocal ? <span className={`${s.sbTag} ${s.sbTagYou}`}>You</span> : null}
                                            </span>
                                        </span>
                                    </td>
                                    <td title={rankIcon ? `${tierLabel(displayedTier)} · ${p.competitiveTier > 0 ? "recorded in this match" : "current rank"}` : "Rank not provided"}>
                                        {rankIcon ? <Image src={rankIcon} alt={`${tierLabel(displayedTier)}${p.competitiveTier > 0 ? "" : " (current)"}`} width={32} height={32} unoptimized /> : <span className={s.sbMuted} aria-label="Rank not provided">—</span>}
                                    </td>
                                    {roundStats ? (
                                        <td className={`${s.sbAcs} ${acs === Math.round(leaders.acs) ? s.sbLead : ""}`}>
                                            <b>{acs}</b>
                                            <i aria-hidden="true"><span style={{ width: `${Math.min(100, (acs / maxAcs) * 100)}%` }} /></i>
                                        </td>
                                    ) : null}
                                    <td className={s.sbKda}>{kills}<i>/</i>{deaths}<i>/</i>{assists}</td>
                                    <td className={diff > 0 ? s.sbPositive : diff < 0 ? s.sbNegative : s.sbMuted}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{Math.abs(diff)}</td>
                                    {roundStats ? <td className={adr === leaders.adr ? s.sbLead : ""}>{adr}</td> : null}
                                    <td className={!hasShots ? s.sbMuted : hsPct === leaders.hs ? s.sbLead : ""}>{hasShots ? fmtPct(hsPct) : "—"}</td>
                                    {roundStats ? <td className={!showFirsts || !firstKills ? s.sbMuted : firstKills === leaders.firstKills ? s.sbLead : ""}>{showFirsts ? firstKills : "—"}</td> : null}
                                    {roundStats ? <td className={!showFirsts || !firstDeaths ? s.sbMuted : ""}>{showFirsts ? firstDeaths : "—"}</td> : null}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export interface ScoreLeaders {
    acs: number;
    adr: number;
    hs: number;
    firstKills: number;
}

export interface ScorePartyGroup {
    key: string;
    label: string;
    size: number;
    color: string;
    title: string;
}

export function buildScorePartyGroups(
    players: ProfileMatchDetails["players"],
    knownLocalPartySubjects: Set<string>,
): Map<string, ScorePartyGroup> {
    const localSubject = players.find((player) => player.isLocal)?.subject.toLowerCase() || "";
    const localPartySubjects = new Set(knownLocalPartySubjects);
    if (localPartySubjects.size > 0 && localSubject) localPartySubjects.add(localSubject);

    const membersByParty = new Map<string, ProfileMatchDetails["players"]>();
    for (const player of players) {
        const subject = player.subject.toLowerCase();
        const partyId = localPartySubjects.has(subject)
            ? "__viewing_party__"
            : (player.partyId || "").trim();
        if (!partyId) continue;
        const members = membersByParty.get(partyId) || [];
        members.push(player);
        membersByParty.set(partyId, members);
    }

    const groups = [...membersByParty.entries()]
        .filter(([, members]) => members.length >= 2)
        .sort(([, a], [, b]) => {
            const aLocal = a.some((player) => player.isLocal);
            const bLocal = b.some((player) => player.isLocal);
            return Number(bLocal) - Number(aLocal) || b.length - a.length;
        });
    // Party identity is deliberately independent from the selected app accent and
    // from the ally/enemy team colours. The viewing party is sorted first, so it
    // always receives the same warm gold marker across themes and matches.
    const palette = ["#e8b84a", "#9b7cff", "#4fa8ff", "#ff7699", "#a7b0ba"];
    const bySubject = new Map<string, ScorePartyGroup>();

    groups.forEach(([key, members], index) => {
        const size = members.length;
        const label = size === 2 ? "Duo" : size === 3 ? "Trio" : `${Math.min(size, 5)}-stack`;
        const names = members
            .map((player) => player.gameName || "Hidden player")
            .join(", ");
        const group: ScorePartyGroup = {
            key,
            label,
            size,
            color: palette[index % palette.length],
            title: `${label} queued together: ${names}`,
        };
        for (const player of members) bySubject.set(player.subject.toLowerCase(), group);
    });

    return bySubject;
}
