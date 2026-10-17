"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { Weapon } from "@/lib/types";
import { getProfileMatchDetails, type ProfileMatchDetails, type ProfileMatchSummary } from "@/services/api";
import { matchModeLabel, useGameModes, useQueues } from "@/lib/gameMeta";
import { hasRoundBreakdown, roundOutcomes, type MatchSide } from "./matchBreakdown";
import s from "./ProfilePanel.module.css";
import { type AgentMeta, type MapMeta, tierLabel, rankIconUrl, fmtDate, fmtLength, fmtPct, fmtRatio, placeLabel, fmtClock, agentRoleTone, acsColor, type MatchKillEvent } from "./profileShared";
import { RoundReview } from "./RoundReview";
import { MatchMapAnalytics } from "./MatchMap";
import { RoundHistory, Scoreboard } from "./MatchScoreboard";
import ShareButton from "@/components/ShareButton";
import { drawMatchShare } from "./shareCards";

export function MatchRow({
    match,
    detail,
    expanded,
    loading,
    agents,
    maps,
    weapons,
    tierAssets,
    profilePuuid,
    region,
    onToggle,
    onViewProfile,
}: {
    match: ProfileMatchSummary;
    detail?: ProfileMatchDetails;
    expanded: boolean;
    loading: boolean;
    agents: Record<string, AgentMeta>;
    maps: Record<string, MapMeta>;
    weapons: Weapon[];
    tierAssets: Map<number, { smallIcon: string }>;
    profilePuuid: string;
    region: string;
    onToggle: () => void;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
}) {
    const [activeMatchTab, setActiveMatchTab] = useState<"scoreboard" | "rounds" | "map">("scoreboard");
    const [reviewFight, setReviewFight] = useState<MatchKillEvent | null>(null);
    const [loadedAnalytics, setLoadedAnalytics] = useState<ProfileMatchDetails | null>(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsError, setAnalyticsError] = useState("");
    const [rankDetails, setRankDetails] = useState<ProfileMatchDetails | null>(null);
    const [ranksLoading, setRanksLoading] = useState(false);
    const [ranksError, setRanksError] = useState("");
    const dialogRef = useRef<HTMLElement>(null);

    useEffect(() => {
        if (!expanded) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.focus();
        return () => {
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [expanded]);
    useEffect(() => {
        if (expanded) dialogRef.current?.querySelector<HTMLButtonElement>('nav[aria-label="Match detail views"] button[aria-current="page"]')?.focus();
    }, [activeMatchTab, expanded]);
    const loadRanks = async () => {
        if (ranksLoading) return;
        if (rankDetails?.rankRetryAt && Date.now() < rankDetails.rankRetryAt) {
            setRanksError(`Try again after ${new Date(rankDetails.rankRetryAt).toLocaleTimeString()}.`);
            return;
        }
        setRanksLoading(true);
        setRanksError("");
        try {
            const result = await getProfileMatchDetails(match.matchId, { puuid: profilePuuid, region, ranks: true });
            setRankDetails(result);
            setRanksError(result.rankError || "");
        } catch {
            setRanksError("Could not load ranks. Try again.");
        } finally {
            setRanksLoading(false);
        }
    };
    const gameModes = useGameModes();
    const queueNames = useQueues();
    const agentMeta = agents[match.localPlayer.characterId?.toLowerCase?.() || ""];
    const mapMeta = maps[match.mapID?.toLowerCase?.() || ""];
    // Ability-draft modes (Gauntlet) give every player a placeholder agent ID.
    const draftMode = /abilitydraft/i.test(match.queueID || "") || /abilitydraft/i.test(match.gameMode || "");
    const agentName = agentMeta?.name || (draftMode ? "Drafted kit" : "Unknown agent");
    const mapName = mapMeta?.name || match.mapID?.slice(0, 8) || "Map";
    // Modes without rounds (e.g. Deathmatch) have no team result or per-round
    // stats, so the row shows neither instead of a fake loss and inflated ACS.
    const roundBased = match.blueRoundsWon + match.redRoundsWon > 0 && match.localPlayer.roundsPlayed > 0;
    // Deathmatch is ranked by kills across every player instead of a team score.
    const placement = !roundBased ? match.placement ?? 0 : 0;
    // Gauntlet duos have no team score, but Riot reports each duo's final standing.
    const duoPlace = !roundBased && !placement ? match.teamPlacement ?? 0 : 0;
    const standing = placement || duoPlace;
    const standingOf = placement ? match.playerCount : match.teamCount;
    const ffaWin = standing === 1;
    const decided = roundBased || (!standing && (match.teamCount ?? 0) > 0);
    const resultClass = standing ? (ffaWin ? s.winText : s.neutralText) : !decided ? s.neutralText : match.win ? s.winText : s.lossText;
    const rowResultClass = ffaWin ? s.matchRowWin : !decided ? "" : match.win ? s.matchRowWin : s.matchRowLoss;
    // Some team-less modes still play real rounds (Gauntlet), so per-round stats hold.
    const perRoundStats = roundBased || (match.localPlayer.roundsPlayed > 1 && match.localPlayer.damageDealt > 0);
    const resultLabel = standing ? (ffaWin ? "WON" : "PLACED") : !decided ? "PLAYED" : match.win ? "WIN" : "LOSS";
    const killsPerMinute = match.gameLengthMillis > 0 ? match.localPlayer.kills / (match.gameLengthMillis / 60_000) : 0;
    const killGap = placement && match.bestOtherKills !== undefined ? match.localPlayer.kills - match.bestOtherKills : null;
    const queueName = matchModeLabel(gameModes, match.queueID, match.gameMode, queueNames);

    const matchTier = match.tierAfter ?? 0;
    const matchRRIcon = rankIconUrl(matchTier, tierAssets);
    const matchRRLabel = tierLabel(matchTier);
    const rrEarned = match.rrEarned ?? 0;
    const rrSign = rrEarned > 0 ? "+" : "";
    const blueSide = match.localPlayer.teamId.toLowerCase() === "blue";
    const ownRounds = blueSide ? match.blueRoundsWon : match.redRoundsWon;
    const enemyRounds = blueSide ? match.redRoundsWon : match.blueRoundsWon;
    const completionState = detail?.matchInfo.completionState || "Completed";
    const unusualCompletion = !/^completed$/i.test(completionState);

    const openAnalyticsTab = useCallback(async (tab: "rounds" | "map") => {
        if (tab === "map") setReviewFight(null);
        setActiveMatchTab(tab);
        if ((detail?.rounds?.length || 0) > 0 || loadedAnalytics !== null || analyticsLoading) return;
        setAnalyticsLoading(true);
        setAnalyticsError("");
        try {
            const refreshed = await getProfileMatchDetails(match.matchId, { puuid: profilePuuid, region, analytics: true });
            setLoadedAnalytics(refreshed);
        } catch (error) {
            setAnalyticsError(error instanceof Error ? error.message : "Could not load map events for this match.");
        } finally {
            setAnalyticsLoading(false);
        }
    }, [analyticsLoading, detail?.rounds?.length, loadedAnalytics, match.matchId, profilePuuid, region]);

    const [scoreSide, setScoreSide] = useState<MatchSide>("all");
    const breakdownDetail = loadedAnalytics ?? detail;
    const roundOutcomeList = useMemo(
        () => (breakdownDetail && roundBased ? roundOutcomes(breakdownDetail, match.localPlayer.teamId, match.queueID) : []),
        [breakdownDetail, match.localPlayer.teamId, match.queueID, roundBased],
    );
    const canSplitSides = Boolean(breakdownDetail && roundBased && hasRoundBreakdown(breakdownDetail));
    const kda = match.localPlayer.kda;
    const hsPct = match.localPlayer.hsPct;
    // Some modes (e.g. Deathmatch) report no hit locations at all.
    const hasShotData = match.localPlayer.headshots + match.localPlayer.bodyshots + match.localPlayer.legshots > 0;
    const adr = Math.round(match.localPlayer.adr || 0);
    const acs = Math.round(match.localPlayer.acs || 0);
    const kdaText = `${match.localPlayer.kills}/${match.localPlayer.deaths}/${match.localPlayer.assists}`;
    const detailedLocalPlayer = detail?.players.find((player) => player.isLocal);
    const detailedPartyMembers = detailedLocalPlayer?.partyId
        ? (detail?.players || [])
            .filter((player) => !player.isLocal && player.partyId === detailedLocalPlayer.partyId)
            .map((player) => ({
                subject: player.subject,
                gameName: player.gameName,
                tagLine: player.tagLine,
                characterId: player.characterId,
                playerCardId: player.playerCardId,
                playerTitleId: player.playerTitleId,
            }))
        : [];
    const partyMembers = ((match.partyMembers || []).length > 0 ? match.partyMembers || [] : detailedPartyMembers)
        .filter((member) => member.subject !== match.localPlayer.subject);
    const partyPreview = partyMembers.slice(0, 3);
    const partyLabel = ["SOLO", "DUO", "TRIO", "4-STACK", "5-STACK"][Math.min(4, partyMembers.length)];
    const partyNames = partyMembers
        .map((member) => member.gameName ? `${member.gameName}${member.tagLine ? `#${member.tagLine}` : ""}` : "Hidden player")
        .join(", ");
    const partyPreviewNames = partyPreview
        .map((member) => member.gameName || agents[member.characterId?.toLowerCase?.() || ""]?.name || "Hidden")
        .join(", ");
    const partyOverflow = partyMembers.length - partyPreview.length;

    return (
        <div
            className={`${s.matchWrap} ${rowResultClass} ${expanded ? s.matchWrapExpanded : ""}`}
            data-result={ffaWin ? "win" : !decided ? "neutral" : match.win ? "win" : "loss"}
            data-loading={loading ? "true" : undefined}
        >
            <button type="button" className={s.matchRow} onClick={() => {
                if (!expanded) setActiveMatchTab("scoreboard");
                onToggle();
            }} aria-expanded={expanded}>
                <span className={s.matchRowSheen} aria-hidden="true" />
                <div className={s.matchResultBlock}>
                    <span className={s.matchResultChip}>
                        {decided ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                {match.win ? <path d="M5 12l5 5 9-10" /> : <><path d="M7 7l10 10" /><path d="M17 7L7 17" /></>}
                            </svg>
                        ) : null}
                        <span className={resultClass}>{resultLabel}</span>
                    </span>
                    {roundBased ? (
                        <span className={s.matchScore} aria-label={`${ownRounds} to ${enemyRounds}`}>
                            <b className={match.win ? s.winText : s.lossText}>{ownRounds}</b>
                            <i>:</i>
                            <b>{enemyRounds}</b>
                        </span>
                    ) : standing ? (
                        <span className={s.matchScore} aria-label={`Placed ${placeLabel(standing).toLowerCase()} of ${standingOf}`} title={`${placeLabel(standing)} of ${standingOf} ${placement ? "players" : "teams"}`}>
                            <b className={ffaWin ? s.winText : undefined}>{standing}</b>
                            <i>/</i>
                            <b>{standingOf}</b>
                        </span>
                    ) : (
                        <span className={s.matchScoreStandin}>{match.localPlayer.roundsPlayed > 1 ? `${match.localPlayer.roundsPlayed} rounds` : "No score"}</span>
                    )}
                    <span className={s.matchResultMeta}>
                        {queueName} · {fmtLength(match.gameLengthMillis)}
                    </span>
                </div>

                <div className={s.matchMain}>
                    <div className={s.matchAgent}>
                        <span className={`${s.matchAgentPortrait} ${agentRoleTone(agentMeta?.role)}`}>
                            {agentMeta?.icon ? (
                                <Image src={agentMeta.icon} alt={agentName} width={56} height={56} unoptimized className={s.matchAgentIcon} />
                            ) : (
                                <span className={`${s.matchAgentIcon} ${s.matchAgentPlaceholder}`} aria-hidden="true">
                                    <svg viewBox="0 0 24 24"><path d="M12 3l8 4.5-8 4.5-8-4.5z" /><path d="M4 12l8 4.5 8-4.5" /><path d="M4 16.5L12 21l8-4.5" /></svg>
                                </span>
                            )}
                            {agentMeta?.roleIcon ? (
                                <Image src={agentMeta.roleIcon} alt="" width={18} height={18} unoptimized className={s.matchAgentRole} />
                            ) : null}
                        </span>
                        <div className={s.matchAgentMeta}>
                            <div className={s.matchAgentName}>{agentName}</div>
                            {agentMeta?.role || draftMode ? (
                                <span className={s.matchAgentKicker}>
                                    {agentMeta?.role || "Ability draft"}
                                </span>
                            ) : null}
                            <div className={s.matchPartyInline} title={partyNames || "No queued teammates detected"}>
                                <span className={s.matchPartyBadge}>{partyLabel}</span>
                                {partyPreview.length > 0 && (
                                    <span className={s.matchPartyAvatars} aria-label={`Queued with ${partyNames}`}>
                                        {partyPreview.map((member) => {
                                            const memberMeta = agents[member.characterId?.toLowerCase?.() || ""];
                                            return memberMeta?.icon ? (
                                                <Image
                                                    key={member.subject}
                                                    src={memberMeta.icon}
                                                    alt=""
                                                    width={20}
                                                    height={20}
                                                    unoptimized
                                                    className={s.matchPartyIcon}
                                                />
                                            ) : <span key={member.subject} className={s.matchPartyDot} aria-hidden="true" />;
                                        })}
                                        <small>
                                            {partyPreviewNames}
                                            {partyOverflow > 0 ? ` +${partyOverflow}` : ""}
                                        </small>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={s.matchStats}>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>KDA</span>
                            <strong className={s.matchStatValue}>{kdaText}</strong>
                            <span className={s.matchStatSub}>{fmtRatio(kda)} K/D</span>
                        </div>
                        {placement ? <>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>KILLS/MIN</span>
                            <strong className={s.matchStatValue}>{killsPerMinute ? killsPerMinute.toFixed(1) : "—"}</strong>
                            <span className={s.matchStatSub}>per minute</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>{ffaWin ? "LEAD" : "TO 1ST"}</span>
                            <strong className={`${s.matchStatValue} ${ffaWin ? s.winText : ""}`}>{killGap === null ? "—" : `${killGap > 0 ? "+" : killGap < 0 ? "−" : ""}${Math.abs(killGap)}`}</strong>
                            <span className={s.matchStatSub}>{ffaWin ? "kills over 2nd" : "kills behind"}</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>SCORE</span>
                            <strong className={s.matchStatValue}>{match.localPlayer.score.toLocaleString()}</strong>
                            <span className={s.matchStatSub}>Riot DM score</span>
                        </div>
                        </> : <>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>HS%</span>
                            <strong className={s.matchStatValue}>{hasShotData ? fmtPct(hsPct) : "—"}</strong>
                            <span className={s.matchStatSub}>accuracy</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ADR</span>
                            <strong className={s.matchStatValue}>{perRoundStats ? adr : "—"}</strong>
                            <span className={s.matchStatSub}>dmg/rd</span>
                        </div>
                        <div className={s.matchStat}>
                            <span className={s.matchStatKicker}>ACS</span>
                            <strong className={`${s.matchStatValue} ${perRoundStats && acsColor(acs) === s.statElite ? s.statElite : ""}`}>{perRoundStats ? acs : "—"}</strong>
                            <span className={s.matchStatSub}>score/rd</span>
                        </div>
                        </>}
                    </div>
                </div>

                {/* Map tile also carries the time, rank and RR so the row has no empty end column. */}
                <div
                    className={s.matchMapTile}
                    style={mapMeta?.splash ? { backgroundImage: `url(${mapMeta.splash})` } : undefined}
                >
                    <strong className={s.matchTileMap}>{mapName}</strong>
                    <span className={s.matchTileSide}>
                        <span className={s.matchTileTime}>{fmtClock(match.gameStartMillis)}</span>
                        {matchTier > 0 ? (
                            <>
                                <span className={s.matchTileRank} title={matchRRLabel}>
                                    {matchRRIcon && (
                                        <Image src={matchRRIcon} alt="" width={22} height={22} unoptimized className={s.matchRankIcon} />
                                    )}
                                    <span className={s.matchTileRankName}>{matchRRLabel}</span>
                                </span>
                                <span className={s.matchTileRrRow}>
                                    {match.performanceBonus ? <span className={s.matchTileBonus} data-tone="good">+{match.performanceBonus} perf</span> : null}
                                    {match.afkPenalty ? <span className={s.matchTileBonus} data-tone="danger">{match.afkPenalty > 0 ? "-" : ""}{Math.abs(match.afkPenalty)} AFK</span> : null}
                                    <span className={`${s.matchTileRr} ${rrEarned > 0 ? s.rrGain : rrEarned < 0 ? s.rrLoss : s.rrNeutral}`}>
                                        {rrSign}
                                        {rrEarned}
                                        <em>RR</em>
                                    </span>
                                </span>
                            </>
                        ) : match.isRanked ? (
                            <span className={s.matchTileRankName}>No RR cached</span>
                        ) : null}
                    </span>
                    <span className={s.matchChevron} aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 6l6 6-6 6" />
                        </svg>
                    </span>
                </div>
            </button>

            {expanded && createPortal(
                <div className={s.matchModalBackdrop} role="presentation" onMouseDown={onToggle}>
                    <section
                        ref={dialogRef}
                        className={`${s.matchModal} ${match.win ? s.matchModalWin : s.matchModalLoss}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${mapName} match details`}
                        tabIndex={-1}
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggle();
                            }
                            if (event.key !== "Tab") return;
                            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                                'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
                            )).filter((element) => element.getClientRects().length > 0);
                            const first = controls[0];
                            const last = controls[controls.length - 1];
                            if (!first || !last) { event.preventDefault(); return; }
                            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
                                event.preventDefault();
                                last.focus();
                            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
                                event.preventDefault();
                                first.focus();
                            }
                        }}
                    >
                        {/* Round review gets a slim banner, so its content starts higher. */}
                        <header
                            className={s.matchModalHeader}
                            data-compact={activeMatchTab === "rounds" || undefined}
                            style={mapMeta?.splash ? { backgroundImage: `url(${mapMeta.splash})` } : undefined}
                        >
                            <div className={s.matchModalHeaderShade} />
                            <div className={s.matchModalHeading}>
                                <div className={s.matchModalTitle}>
                                    <h2>{mapName}</h2>
                                    <span className={s.matchResultTag} data-result={!roundBased ? "neutral" : match.win ? "win" : "loss"}>
                                        {roundBased ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                {match.win ? <path d="M5 12l5 5 9-10" /> : <><path d="M7 7l10 10" /><path d="M17 7L7 17" /></>}
                                            </svg>
                                        ) : null}
                                        {!roundBased ? "Completed" : match.win ? "Victory" : "Defeat"}
                                    </span>
                                </div>
                                <div className={s.matchMetaTags}>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 3L4 14h7l-1 7 9-11h-7z" /></svg>
                                        {queueName}
                                    </span>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                                        {fmtLength(match.gameLengthMillis)}
                                    </span>
                                    <span>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                                        {fmtDate(match.gameStartMillis)}
                                    </span>
                                    {unusualCompletion ? <span className={s.matchMetaWarn}>{completionState}</span> : null}
                                    {!unusualCompletion && detail?.matchInfo.earlyCompletion ? <span className={s.matchMetaWarn} title="Riot marked this match as ended early">Ended early</span> : null}
                                    {detailedLocalPlayer?.partyRRPenalty ? <span className={s.matchMetaWarn} title="Riot applied a party-size RR penalty to your party in this match">Party RR penalty {detailedLocalPlayer.partyRRPenalty}</span> : null}
                                    <span className={s.matchMetaShare}>
                                        <ShareButton filename={`vantavault-${mapName.toLowerCase()}-${ownRounds}-${enemyRounds}.png`} build={() => drawMatchShare({
                                            mapName, mapArt: mapMeta?.splash, result: !decided ? "neutral" : (standing ? ffaWin : match.win) ? "win" : "loss",
                                            resultLabel: standing ? (standing === 1 ? "1st place" : `${standing} of ${standingOf}`) : !roundBased ? "Completed" : match.win ? "Victory" : "Defeat",
                                            ownRounds: roundBased ? ownRounds : undefined, enemyRounds: roundBased ? enemyRounds : undefined,
                                            queue: queueName, date: fmtDate(match.gameStartMillis), length: fmtLength(match.gameLengthMillis),
                                            agentName, agentIcon: agentMeta?.icon, rankIcon: match.isRanked && matchTier ? matchRRIcon || undefined : undefined,
                                            rankLabel: match.isRanked && matchTier ? matchRRLabel : undefined, rr: match.isRanked ? rrEarned : undefined, mvp: match.localPlayer.teamMvp,
                                            player: match.localPlayer.gameName ? `${match.localPlayer.gameName}#${match.localPlayer.tagLine}` : "You",
                                            stats: [
                                                { label: "K / D / A", value: `${match.localPlayer.kills} / ${match.localPlayer.deaths} / ${match.localPlayer.assists}` },
                                                ...(perRoundStats ? [{ label: "ACS", value: String(Math.round(match.localPlayer.acs)) }, { label: "ADR", value: String(Math.round(match.localPlayer.adr)) }] : []),
                                                { label: "HS %", value: `${Math.round(match.localPlayer.hsPct)}%` },
                                                { label: "K/D", value: match.localPlayer.kd.toFixed(2) },
                                            ],
                                        })} />
                                    </span>
                                </div>
                            </div>
                            {roundBased ? (
                                <div className={s.matchScorePlates} aria-label={`Score ${ownRounds} to ${enemyRounds}`}>
                                    <span data-team="ally"><strong>{ownRounds}</strong><small>Your team</small></span>
                                    <i aria-hidden="true">:</i>
                                    <span data-team="enemy"><strong>{enemyRounds}</strong><small>Enemy</small></span>
                                </div>
                            ) : null}
                            <button type="button" className={s.matchModalClose} onClick={onToggle} aria-label="Close match details">×</button>
                        </header>
                        <nav className={s.matchDetailTabs} aria-label="Match detail views">
                            <button
                                type="button"
                                className={activeMatchTab === "scoreboard" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "scoreboard" ? "page" : undefined}
                                onClick={() => setActiveMatchTab("scoreboard")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
                                Scoreboard
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "rounds" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "rounds" ? "page" : undefined}
                                onClick={() => void openAnalyticsTab("rounds")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>
                                Round review
                            </button>
                            <button
                                type="button"
                                className={activeMatchTab === "map" ? s.matchDetailTabActive : ""}
                                aria-current={activeMatchTab === "map" ? "page" : undefined}
                                onClick={() => void openAnalyticsTab("map")}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
                                Map
                            </button>
                            {activeMatchTab === "scoreboard" && canSplitSides ? (
                                <div className={s.matchSideFilter} role="group" aria-label="Scoreboard side">
                                    {(["all", "attack", "defense"] as const).map((option) => (
                                        <button
                                            type="button"
                                            key={option}
                                            aria-pressed={scoreSide === option}
                                            onClick={() => setScoreSide(option)}
                                        >
                                            {option === "all" ? "All" : option === "attack" ? "Attack" : "Defense"}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                            {activeMatchTab === "scoreboard" && detail?.players.some(player => player.competitiveTier <= 0) && (
                                <button
                                    type="button"
                                    className={s.loadRanksButton}
                                    data-loaded={!!rankDetails && !rankDetails.rankError}
                                    onClick={() => void loadRanks()}
                                    disabled={ranksLoading || (!!rankDetails && !rankDetails.rankError)}
                                    title={rankDetails && !rankDetails.rankError ? "Missing match ranks supplemented with current ranks. A dash means no rank was returned." : "Look up current competitive ranks for players whose match rank is missing"}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                                        <path d="m12 3 7 3v6c0 4-7 9-7 9s-7-5-7-9V6l7-3Z" />
                                        <path d="m8.5 11.5 2.5 2.5 4.5-5" />
                                    </svg>
                                    <span aria-live="polite">{ranksLoading ? "Loading ranks…" : rankDetails && !rankDetails.rankError ? "Ranks loaded" : "Load ranks"}</span>
                                </button>
                            )}
                        </nav>
                        {activeMatchTab === "scoreboard" && ranksError && (
                            <p className={s.rankLookupStatus} role="status">
                                {ranksError}
                            </p>
                        )}
                        <div className={s.matchModalBody}>
                            {activeMatchTab === "scoreboard" && roundOutcomeList.length ? (
                                <RoundHistory rounds={roundOutcomeList} ownRounds={ownRounds} enemyRounds={enemyRounds} />
                            ) : null}
                            {loading ? (
                                <div className={s.placeholder}>Loading scoreboard…</div>
                            ) : detail ? (
                                activeMatchTab === "scoreboard" ? (
                                    <Scoreboard
                                        detail={rankDetails ?? detail}
                                        breakdown={loadedAnalytics ?? detail}
                                        side={canSplitSides ? scoreSide : "all"}
                                        queueId={match.queueID}
                                        partyMembers={partyMembers}
                                        agents={agents}
                                        tierAssets={tierAssets}
                                        onViewProfile={onViewProfile}
                                    />
                                ) : activeMatchTab === "rounds" ? (
                                    <RoundReview
                                        detail={loadedAnalytics ?? detail}
                                        map={mapMeta}
                                        agents={agents}
                                        weapons={weapons}
                                        initialRoundNum={reviewFight?.roundNum}
                                        onInspectFight={(event) => { setReviewFight(event); setActiveMatchTab("map"); }}
                                    />
                                ) : (
                                    <MatchMapAnalytics
                                        detail={loadedAnalytics ?? detail}
                                        kills={loadedAnalytics?.kills ?? detail.kills ?? []}
                                        map={mapMeta}
                                        agents={agents}
                                        weapons={weapons}
                                        loading={analyticsLoading}
                                        error={analyticsError}
                                        initialFight={reviewFight}
                                        onBackToRound={reviewFight ? () => setActiveMatchTab("rounds") : undefined}
                                    />
                                )
                            ) : (
                                <div className={s.placeholder}>No details cached for this match.</div>
                            )}
                        </div>
                    </section>
                </div>,
                document.body,
            )}
        </div>
    );
}
