"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import RRHistoryChart from "@/features/profile/RRHistoryChart";
import {
  getAgentStats,
  getMapStats,
  getProfileMatchDetails,
  getProfileMatchHistory,
  getProfileOverview,
  getProfileSyncStatus,
  getRRHistory,
  postProfileSync,
  type ProfileAgentStat,
  type ProfileMapStat,
  type ProfileMatchDetails,
  type ProfileMatchSummary,
  type ProfileOverview,
  type ProfilePlayerStats,
  type ProfileRRHistory,
  type ProfileRRSnapshot,
  type ProfileSyncStatus,
} from "@/services/api";
import {
  MobileBackHeader,
  MobileDataLoading,
  MobileGameImage,
  MobileIcon,
  MobilePageHeader,
  MobileSectionHeader,
  MobileSheetLayer,
  formatQueue,
  formatRelative,
  loadMobileMaps,
  loadMobileTiers,
} from "./MobileKit";

export type MobileProfileTarget = {
  puuid: string;
  gameName: string;
  tagLine: string;
  cardId?: string;
  autoSyncMatches?: boolean;
};

type MapMeta = { name: string; splash: string; icon: string };
type TierMeta = { name: string; icon: string };

function percent(value: number | undefined) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "—";
}

function ratio(value: number | undefined) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
}

function playerHeadshotPercent(player?: ProfilePlayerStats) {
  if (!player) return undefined;
  const hits = (player.headshots || 0) + (player.bodyshots || 0) + (player.legshots || 0);
  return hits > 0 ? (player.headshots / hits) * 100 : player.hsPct;
}

function tierName(value?: string) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const QUEUE_LABELS: Record<string, string> = {
  competitive: "Competitive",
  unrated: "Unrated",
  swiftplay: "Swiftplay",
  spikerush: "Spike Rush",
  deathmatch: "Deathmatch",
  teamdeathmatch: "Team Deathmatch",
  premier: "Premier",
  custom: "Custom",
};

function RankProgress({
  snapshots,
  tiers,
  source,
  loading,
}: {
  snapshots: ProfileRRSnapshot[];
  tiers: Map<number, TierMeta>;
  source?: "rr" | "tier";
  loading: boolean;
}) {
  const sorted = [...snapshots]
    .filter((item) => Number.isFinite(item.matchStartTime))
    .sort((leftItem, rightItem) => leftItem.matchStartTime - rightItem.matchStartTime);
  if (!sorted.length && !loading) return null;
  if (!sorted.length) {
    return (
      <section className="mv2-rank-progress">
        <header><div><span>Ranked progression</span><strong>Updating…</strong></div></header>
        <div className="mv2-modern-rank-chart"><RRHistoryChart snapshots={[]} height={190} source={source} loading /></div>
      </section>
    );
  }
  const last = sorted[sorted.length - 1];
  const currentName = tierName(tiers.get(last.tierAfter)?.name) || `Tier ${last.tierAfter}`;
  const latest = [...sorted].reverse().slice(0, 4);

  return (
    <section className="mv2-rank-progress">
      <header>
        <div><span>Ranked progression</span><strong>{currentName} · {last.rrAfter} RR</strong></div>
        <small>{sorted.length} game{sorted.length === 1 ? "" : "s"} tracked</small>
      </header>
      <div className="mv2-modern-rank-chart"><RRHistoryChart snapshots={sorted} height={190} source={source} loading={loading} /></div>
      <div className="mv2-rank-deltas">
        {latest.map((item) => (
          <div key={`${item.matchId}:${item.matchStartTime}`}>
            <span>{new Date(item.matchStartTime).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
            <strong className={item.rrEarned >= 0 ? "positive" : "negative"}>{item.rrEarned > 0 ? "+" : ""}{item.rrEarned} RR</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchRow({
  match,
  agents,
  maps,
  onOpen,
}: {
  match: ProfileMatchSummary;
  agents: ReturnType<typeof useData>["agents"];
  maps: Map<string, MapMeta>;
  onOpen: (match: ProfileMatchSummary) => void;
}) {
  const player = match.localPlayer;
  const agent = agents.find((item) => item.uuid.toLowerCase() === player?.characterId?.toLowerCase());
  const map = maps.get(match.mapID?.toLowerCase());
  const isDeathmatch = match.queueID.toLowerCase() === "deathmatch";
  const score = player?.teamId?.toLowerCase() === "red"
    ? `${match.redRoundsWon}–${match.blueRoundsWon}`
    : `${match.blueRoundsWon}–${match.redRoundsWon}`;
  const playedAt = new Date(match.gameStartMillis).toLocaleDateString([], { month: "short", day: "numeric" });
  const duration = Math.max(1, Math.round(match.gameLengthMillis / 60_000));
  return (
    <article className={`mv2-match-row ${isDeathmatch ? "is-ffa" : match.win ? "is-win" : "is-loss"}`}>
      <button type="button" onClick={() => onOpen(match)} aria-label={`Open ${map?.name || "match"} scoreboard`}>
        <span className="mv2-match-map" style={map?.splash ? { backgroundImage: `url(${map.splash})` } : undefined}>
          <small>{map?.name || "Map"}</small>
        </span>
        <span className="mv2-match-agent">
          {player?.characterId ? (
            <MobileGameImage
              sources={[
                agent?.displayIcon,
                `https://media.valorant-api.com/agents/${player.characterId.toLowerCase()}/displayicon.png`,
                `https://media.valorant-api.com/agents/${player.characterId.toLowerCase()}/bustportrait.png`,
              ]}
              alt={agent?.displayName || "Agent"}
            />
          ) : (player?.gameName || "?").slice(0, 1)}
        </span>
        <span className="mv2-match-result">
          <strong>{isDeathmatch ? `${player?.kills ?? 0} kills` : score}</strong>
          <small>{isDeathmatch ? "Free for all · Deathmatch" : `${match.win ? "Victory" : "Defeat"} · ${formatQueue(match.queueID)}`}</small>
          <em>{playedAt} · {duration}m</em>
        </span>
        <span className="mv2-match-kda">
          <strong>{player?.kills ?? 0}/{player?.deaths ?? 0}/{player?.assists ?? 0}</strong>
          <small>{isDeathmatch ? `${Math.round(player?.score || 0)} score` : `${Math.round(player?.acs || 0)} ACS · ${Math.round(player?.adr || 0)} ADR`}</small>
        </span>
        <span className={`mv2-match-rr ${(match.rrEarned || 0) >= 0 ? "positive" : "negative"}`}>
          {match.rrEarned ? `${match.rrEarned > 0 ? "+" : ""}${match.rrEarned} RR` : <MobileIcon name="chevron" size={18} />}
        </span>
      </button>
    </article>
  );
}

function scoreForTeam(match: ProfileMatchSummary, teamId: string) {
  return teamId.toLowerCase() === "red" ? match.redRoundsWon : match.blueRoundsWon;
}

function MatchDetailsSheet({
  match,
  details,
  loading,
  error,
  agents,
  maps,
  tiers,
  onClose,
  onOpenProfile,
}: {
  match: ProfileMatchSummary;
  details: ProfileMatchDetails | null;
  loading: boolean;
  error: string;
  agents: ReturnType<typeof useData>["agents"];
  maps: Map<string, MapMeta>;
  tiers: Map<number, TierMeta>;
  onClose: () => void;
  onOpenProfile?: (target: MobileProfileTarget) => void;
}) {
  const localTeam = match.localPlayer?.teamId || "Blue";
  const partySubjects = new Set((match.partyMembers || []).map((item) => item.subject.toLowerCase()));
  const teamIds = Array.from(new Set((details?.players || []).map((player) => player.teamId).filter(Boolean)))
    .sort((left, right) => Number(right.toLowerCase() === localTeam.toLowerCase()) - Number(left.toLowerCase() === localTeam.toLowerCase()));
  const map = maps.get(match.mapID?.toLowerCase());
  const opposingTeam = localTeam.toLowerCase() === "red" ? "Blue" : "Red";
  const score = `${scoreForTeam(match, localTeam)}–${scoreForTeam(match, opposingTeam)}`;
  const isDeathmatch = match.queueID.toLowerCase() === "deathmatch";

  const renderPlayer = (player: ProfilePlayerStats) => {
    const agent = agents.find((item) => item.uuid.toLowerCase() === player.characterId?.toLowerCase());
    const tier = tiers.get(player.competitiveTier);
    const canOpen = Boolean(onOpenProfile && player.subject && !player.isLocal);
    const content = (
      <>
        <span className="mv2-score-agent">
          {player.characterId ? (
            <MobileGameImage
              sources={[
                agent?.displayIcon,
                `https://media.valorant-api.com/agents/${player.characterId.toLowerCase()}/displayicon.png`,
                `https://media.valorant-api.com/agents/${player.characterId.toLowerCase()}/bustportrait.png`,
              ]}
              alt={agent?.displayName || "Agent"}
            />
          ) : "?"}
        </span>
        <span className="mv2-score-player">
          <strong>{player.gameName || (player.isLocal ? "You" : "Riot player")}{player.tagLine ? <small>#{player.tagLine}</small> : null}</strong>
          <small>{agent?.displayName || "Agent"}{player.isLocal ? " · You" : partySubjects.has(player.subject.toLowerCase()) ? " · Party" : ""}</small>
        </span>
        <span className="mv2-score-rank">{!isDeathmatch && tier?.icon ? <img src={tier.icon} alt={tier.name} /> : null}</span>
        <span className="mv2-score-kda"><strong>{player.kills}/{player.deaths}/{player.assists}</strong><small>K / D / A</small></span>
        <span className="mv2-score-stat"><strong>{Math.round(isDeathmatch ? player.score : player.acs || 0)}</strong><small>{isDeathmatch ? "Score" : "ACS"}</small></span>
        <span className="mv2-score-stat"><strong>{Math.round(isDeathmatch ? player.damageDealt : player.adr || 0)}</strong><small>{isDeathmatch ? "Damage" : "ADR"}</small></span>
        <span className="mv2-score-stat"><strong>{percent(playerHeadshotPercent(player))}</strong><small>HS</small></span>
        {canOpen ? <MobileIcon name="chevron" size={16} /> : <span className="mv2-score-row-end" />}
      </>
    );
    return canOpen ? (
      <button
        type="button"
        key={player.subject}
        className={player.isLocal ? "is-local" : ""}
        onClick={() => onOpenProfile?.({
          puuid: player.subject,
          gameName: player.gameName || "Riot player",
          tagLine: player.tagLine || "",
          cardId: player.playerCardId,
        })}
      >
        {content}
      </button>
    ) : (
      <div key={player.subject || `${player.characterId}:${player.gameName}`} className={player.isLocal ? "is-local" : ""}>{content}</div>
    );
  };

  return (
    <MobileSheetLayer onClose={onClose}>
      <section className="mv2-sheet mv2-match-sheet" onClick={(event) => event.stopPropagation()}>
        <i />
        <header
          className="mv2-match-sheet-header"
          style={map?.splash ? { backgroundImage: `linear-gradient(90deg,rgba(7,12,16,.18),rgba(7,12,16,.94)),url(${map.splash})` } : undefined}
        >
          <div>
            <small>{formatQueue(match.queueID)} · {new Date(match.gameStartMillis).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
            <h2>{map?.name || "Match details"}</h2>
            <span className={isDeathmatch ? "neutral" : match.win ? "positive" : "negative"}>
              {isDeathmatch
                ? `${match.localPlayer?.kills ?? 0} eliminations · ${match.localPlayer?.deaths ?? 0} deaths`
                : `${match.win ? "Victory" : "Defeat"} · ${score}`}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close match details"><MobileIcon name="close" /></button>
        </header>

        <div className="mv2-match-facts">
          <div><span>Duration</span><strong>{Math.round(match.gameLengthMillis / 60_000)}m</strong></div>
          <div><span>{isDeathmatch ? "Combat score" : "Your ACS"}</span><strong>{Math.round(isDeathmatch ? match.localPlayer?.score || 0 : match.localPlayer?.acs || 0)}</strong></div>
          <div><span>{isDeathmatch ? "Damage" : "ADR"}</span><strong>{Math.round(isDeathmatch ? match.localPlayer?.damageDealt || 0 : match.localPlayer?.adr || 0)}</strong></div>
          <div><span>HS%</span><strong>{percent(playerHeadshotPercent(match.localPlayer))}</strong></div>
        </div>

        {isDeathmatch ? <p className="mv2-match-party">Free-for-all standings</p> : match.partyMembers?.length ? (
          <p className="mv2-match-party"><MobileIcon name="party" size={15} />Queued with {match.partyMembers.map((item) => item.gameName || "teammate").join(", ")}</p>
        ) : <p className="mv2-match-party">Solo queue</p>}

        {loading ? <div className="mv2-sheet-loading"><i />Loading the cached scoreboard…</div> : null}
        {error ? <div className="mv2-inline-error">{error}</div> : null}
        {!loading && details?.players?.length ? (
          <div className="mv2-scoreboards">
            {isDeathmatch ? (
              <section className="ffa">
                <header><strong>Standings</strong><span>{details.players.length} players</span></header>
                <div>{[...details.players].sort((left, right) => right.score - left.score).map(renderPlayer)}</div>
              </section>
            ) : teamIds.map((teamId) => {
              const isLocalTeam = teamId.toLowerCase() === localTeam.toLowerCase();
              const players = details.players
                .filter((player) => player.teamId === teamId)
                .sort((left, right) => right.score - left.score);
              return (
                <section key={teamId} className={isLocalTeam ? "ally" : "enemy"}>
                  <header><strong>{isLocalTeam ? "Your team" : "Opponents"}</strong><span>{scoreForTeam(match, teamId)} rounds</span></header>
                  <div>{players.map(renderPlayer)}</div>
                </section>
              );
            })}
          </div>
        ) : null}
        {!loading && !error && !details?.players?.length ? <p className="mv2-muted-row">No player scoreboard is cached for this match.</p> : null}
        {details?.servedFrom ? <small className="mv2-match-source">Loaded from {details.servedFrom === "cache" ? "local cache" : details.servedFrom}</small> : null}
      </section>
    </MobileSheetLayer>
  );
}

export default function MobileProfileV2({
  target,
  onBack,
  onMessage,
  onOpenProfile,
  isActive = true,
}: {
  target?: MobileProfileTarget | null;
  onBack?: () => void;
  onMessage?: (target: MobileProfileTarget) => void;
  onOpenProfile?: (target: MobileProfileTarget) => void;
  isActive?: boolean;
}) {
  const { activeAccount, agents, playerCards, playerTitles } = useData();
  const isOwn = !target || target.puuid === activeAccount?.puuid;
  const autoSyncMatches = target?.autoSyncMatches !== false;
  const puuid = target?.puuid || activeAccount?.puuid || "";
  const region = activeAccount?.region || "na";
  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [sync, setSync] = useState<ProfileSyncStatus | null>(null);
  const [matches, setMatches] = useState<ProfileMatchSummary[]>([]);
  const [agentStats, setAgentStats] = useState<ProfileAgentStat[]>([]);
  const [mapStats, setMapStats] = useState<ProfileMapStat[]>([]);
  const [rrHistory, setRRHistory] = useState<ProfileRRHistory | null>(null);
  const [maps, setMaps] = useState<Map<string, MapMeta>>(new Map());
  const [tiers, setTiers] = useState<Map<number, TierMeta>>(new Map());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [queueFilter, setQueueFilter] = useState("");
  const [thisActOnly, setThisActOnly] = useState(false);
  const [totalMatches, setTotalMatches] = useState(0);
  const [detailMatch, setDetailMatch] = useState<ProfileMatchSummary | null>(null);
  const [matchDetails, setMatchDetails] = useState<ProfileMatchDetails | null>(null);
  const [matchDetailsLoading, setMatchDetailsLoading] = useState(false);
  const [matchDetailsError, setMatchDetailsError] = useState("");
  const [error, setError] = useState("");
  const detailRequest = useRef(0);
  const profileRequest = useRef(0);
  const autoSyncAttempt = useRef("");
  const currentPuuidRef = useRef(puuid);
  currentPuuidRef.current = puuid;

  const opts = useMemo(() => ({ puuid, region }), [puuid, region]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [puuid]);

  const refresh = useCallback(async () => {
    if (!puuid) return;
    const request = ++profileRequest.current;
    const targetPuuid = puuid;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      getProfileOverview(opts),
      getProfileMatchHistory(0, 30, undefined, opts),
      getAgentStats(undefined, opts),
      getMapStats(undefined, opts),
      getProfileSyncStatus(opts),
      getRRHistory(undefined, opts),
      loadMobileMaps(),
      loadMobileTiers(),
    ]);
    if (request !== profileRequest.current || currentPuuidRef.current !== targetPuuid) return;
    if (results[0].status === "fulfilled") setOverview(results[0].value);
    if (results[1].status === "fulfilled") {
      setMatches(results[1].value.matches || []);
      setTotalMatches(results[1].value.total || results[1].value.matches?.length || 0);
    }
    if (results[2].status === "fulfilled") setAgentStats(results[2].value.agents || []);
    if (results[3].status === "fulfilled") setMapStats(results[3].value.maps || []);
    if (results[4].status === "fulfilled") setSync(results[4].value);
    if (results[5].status === "fulfilled") setRRHistory(results[5].value);
    if (results[6].status === "fulfilled") setMaps(results[6].value);
    if (results[7].status === "fulfilled") setTiers(results[7].value);
    const rejected = results.find((result, index) => index < 4 && result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Profile data could not be loaded.");
    }
    setLoading(false);
  }, [opts, puuid]);

  useEffect(() => {
    setOverview(null);
    setMatches([]);
    setAgentStats([]);
    setMapStats([]);
    setRRHistory(null);
    setShowAll(false);
    setQueueFilter("");
    setThisActOnly(false);
    setDetailMatch(null);
    setMatchDetails(null);
    void refresh();
  }, [puuid, refresh]);

  const runSync = useCallback(async () => {
    if (!puuid || syncing) return;
    setSyncing(true);
    setError("");
    try {
      await postProfileSync(opts);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 900 : 1800));
        const next = await getProfileSyncStatus(opts);
        setSync(next);
        if (!next.inFlight) break;
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Match sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [opts, puuid, refresh, syncing]);

  useEffect(() => {
    if (!isActive || !autoSyncMatches || loading || !sync || syncing || sync.inFlight) return;
    if (sync.errorKind === "rate_limited" && (sync.retryAt || 0) > Date.now()) return;
    // The visible profile owns its refresh lifecycle. Other players should be
    // useful on first open too; this button is only a manual recovery path.
    const staleAfter = (isOwn ? 20 : 60) * 60 * 1000;
    const attemptSync = () => {
      const attemptKey = `${puuid}:${sync.lastSyncedAt || 0}`;
      if (autoSyncAttempt.current === attemptKey) return;
      autoSyncAttempt.current = attemptKey;
      void runSync();
    };
    const remainingFreshTime = sync.lastSyncedAt
      ? staleAfter - (Date.now() - sync.lastSyncedAt)
      : 0;
    if (remainingFreshTime > 0) {
      const timer = window.setTimeout(attemptSync, remainingFreshTime + 250);
      return () => window.clearTimeout(timer);
    }
    attemptSync();
  }, [autoSyncMatches, isActive, isOwn, loading, puuid, runSync, sync, syncing]);

  const matchIdentity = matches.find((match) => match.localPlayer?.playerCardId)?.localPlayer;
  const identityCardId = overview?.playerCardId || target?.cardId || matchIdentity?.playerCardId;
  const card = playerCards.find((item) => item.uuid.toLowerCase() === identityCardId?.toLowerCase());
  const title = playerTitles.find((item) => item.uuid.toLowerCase() === (overview?.playerTitleId || matchIdentity?.playerTitleId)?.toLowerCase());
  const currentTier = overview?.currentRank?.competitiveTier || 0;
  const peakTier = overview?.peakRank?.competitiveTier || 0;
  const currentTierMeta = tiers.get(currentTier);
  const peakTierMeta = tiers.get(peakTier);
  const displayName = overview?.gameName || target?.gameName || activeAccount?.gameName || "Riot player";
  const tagLine = overview?.tagLine || target?.tagLine || activeAccount?.tagLine || "";

  const aggregate = useMemo(() => {
    const rows = matches.map((match) => match.localPlayer).filter(Boolean);
    const kills = rows.reduce((sum, item) => sum + item.kills, 0);
    const deaths = rows.reduce((sum, item) => sum + item.deaths, 0);
    const assists = rows.reduce((sum, item) => sum + item.assists, 0);
    const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return {
      kd: deaths ? kills / deaths : 0,
      kda: deaths ? (kills + assists) / deaths : 0,
      acs: avg(rows.map((item) => item.acs || 0)),
      hs: avg(rows.map((item) => item.hsPct || 0)),
    };
  }, [matches]);

  const summary = overview?.seasonSummary;
  const hasMatchStats = Boolean((summary?.matches || 0) > 0 || matches.length > 0);
  const currentSeasonId = matches[0]?.seasonId || "";
  const queueOptions = useMemo(
    () => Array.from(new Set(matches.map((match) => match.queueID).filter(Boolean)))
      .sort((left, right) => (QUEUE_LABELS[left.toLowerCase()] || left).localeCompare(QUEUE_LABELS[right.toLowerCase()] || right)),
    [matches],
  );
  const filteredMatches = useMemo(
    () => matches.filter((match) =>
      (!queueFilter || match.queueID.toLowerCase() === queueFilter.toLowerCase())
      && (!thisActOnly || !currentSeasonId || match.seasonId === currentSeasonId)),
    [currentSeasonId, matches, queueFilter, thisActOnly],
  );
  const visibleMatches = showAll ? filteredMatches : filteredMatches.slice(0, 8);
  const topAgents = agentStats.slice(0, 6);
  const topMaps = mapStats.slice(0, 6);

  const openMatchDetails = useCallback(async (match: ProfileMatchSummary) => {
    const request = ++detailRequest.current;
    setDetailMatch(match);
    setMatchDetails(null);
    setMatchDetailsError("");
    setMatchDetailsLoading(true);
    try {
      const details = await getProfileMatchDetails(match.matchId, { puuid, region });
      if (detailRequest.current === request) setMatchDetails(details);
    } catch (reason) {
      if (detailRequest.current === request) {
        setMatchDetailsError(reason instanceof Error ? reason.message : "The scoreboard could not be loaded.");
      }
    } finally {
      if (detailRequest.current === request) setMatchDetailsLoading(false);
    }
  }, [puuid, region]);

  const closeMatchDetails = () => {
    detailRequest.current += 1;
    setDetailMatch(null);
    setMatchDetails(null);
    setMatchDetailsError("");
    setMatchDetailsLoading(false);
  };

  if (loading && !overview) {
    return (
      <div className="mv2-profile">
        {target && onBack ? (
          <MobileBackHeader title="Player profile" detail={`${displayName}${tagLine ? `#${tagLine}` : ""}`} onBack={onBack} />
        ) : (
          <MobilePageHeader title="Profile" subtitle={`${displayName}${tagLine ? `#${tagLine}` : ""}`} />
        )}
        <MobileDataLoading
          kind="profile"
          title="Loading rank and profile"
          detail="Resolving current rank, RR, match history and performance."
        />
      </div>
    );
  }

  return (
    <div className="mv2-profile">
      {target && onBack ? (
        <MobileBackHeader
          title="Player profile"
          detail={`${displayName}${tagLine ? `#${tagLine}` : ""}`}
          onBack={onBack}
          action={onMessage ? <button type="button" className="mv2-header-action" onClick={() => onMessage(target)}><MobileIcon name="message" /></button> : undefined}
        />
      ) : (
        <MobilePageHeader
          title="Profile"
          subtitle={`${displayName}${tagLine ? `#${tagLine}` : ""}`}
          action={<MobileIcon name="refresh" />}
          actionLabel="Refresh profile"
          onAction={() => void refresh()}
        />
      )}
      {error ? <div className="mv2-inline-error">{error}</div> : null}

      <section className="mv2-profile-identity" style={card?.wideArt ? { backgroundImage: `linear-gradient(90deg,rgba(5,10,14,.25),rgba(5,10,14,.96)),url(${card.wideArt})` } : undefined}>
        <div className="mv2-profile-card">
          {card?.largeArt || card?.displayIcon
            ? <img src={card.largeArt || card.displayIcon} alt="" />
            : <img className="fallback" src="/brand-mark.svg" alt="" />}
          <i>{overview?.account?.level || "—"}</i>
        </div>
        <div className="mv2-profile-name">
          <h2>{displayName}<span>#{tagLine}</span></h2>
          <p>{title?.titleText || title?.displayName || "VALORANT player"}</p>
          <small>Account level {overview?.account?.level || "—"}</small>
        </div>
        <div className="mv2-current-rank">
          {currentTierMeta?.icon ? <img src={currentTierMeta.icon} alt="" /> : null}
          <span>Current rank</span>
          <strong>{tierName(currentTierMeta?.name || overview?.currentRank?.tierName) || "Unranked"}</strong>
          <small>{currentTier ? `${overview?.currentRank?.rankedRating || 0} RR` : "No current placement"}</small>
        </div>
      </section>

      <section className="mv2-profile-stats">
        <div><span>Matches</span><strong>{summary?.matches ?? (matches.length || "—")}</strong></div>
        <div><span>Win rate</span><strong>{summary ? percent(summary.winrate) : matches.length ? percent(matches.filter((item) => item.win).length / matches.length * 100) : "—"}</strong></div>
        <div><span>K/D</span><strong>{hasMatchStats ? ratio(aggregate.kd) : "—"}</strong></div>
        <div><span>KDA</span><strong>{hasMatchStats ? summary ? ratio(summary.avgKda) : ratio(aggregate.kda) : "—"}</strong></div>
        <div><span>ACS</span><strong>{aggregate.acs ? Math.round(aggregate.acs) : "—"}</strong></div>
        <div><span>HS%</span><strong>{hasMatchStats ? summary ? percent(summary.avgHsPct) : percent(aggregate.hs) : "—"}</strong></div>
      </section>

      <section className="mv2-rank-facts">
        <div>
          <span>Peak rank</span>
          {peakTierMeta?.icon ? <img src={peakTierMeta.icon} alt="" /> : null}
          <strong>{tierName(peakTierMeta?.name || overview?.peakRank?.tierName) || "Unavailable"}</strong>
        </div>
        <div>
          <span>Current act</span>
          <strong>{overview?.currentRank?.numberOfWins || 0} wins</strong>
          <small>{overview?.currentRank?.numberOfGames || 0} competitive games</small>
        </div>
      </section>

      <button className="mv2-profile-sync" type="button" onClick={() => void runSync()} disabled={syncing || sync?.inFlight}>
        <MobileIcon name="refresh" />
        <span>
          <strong>{syncing || sync?.inFlight ? "Updating profile automatically" : "Refresh profile data"}</strong>
          <small>{sync?.lastSyncedAt ? `${sync.totalMatches} cached · Updated ${formatRelative(sync.lastSyncedAt)}` : syncing || sync?.inFlight ? "Fetching identity, player card and matches" : "Automatic update queued when this profile opens"}</small>
        </span>
        <MobileIcon name="chevron" />
      </button>

      <MobileSectionHeader
        title="Recent matches"
        detail={matches.length ? `${matches.length} of ${totalMatches || matches.length} cached` : loading || syncing || sync?.inFlight ? "Updating…" : "No cached matches"}
        action={filteredMatches.length > 8 ? (showAll ? "Show less" : "View all") : undefined}
        onAction={filteredMatches.length > 8 ? () => setShowAll((value) => !value) : undefined}
      />
      {matches.length ? (
        <div className="mv2-match-filters">
          <button type="button" className={!queueFilter ? "selected" : ""} onClick={() => { setQueueFilter(""); setShowAll(false); }}>All</button>
          {queueOptions.map((queue) => (
            <button type="button" className={queueFilter === queue ? "selected" : ""} key={queue} onClick={() => { setQueueFilter(queue); setShowAll(false); }}>
              {QUEUE_LABELS[queue.toLowerCase()] || formatQueue(queue)}
            </button>
          ))}
          {currentSeasonId ? (
            <button type="button" className={thisActOnly ? "selected" : ""} onClick={() => { setThisActOnly((value) => !value); setShowAll(false); }}>This act</button>
          ) : null}
        </div>
      ) : null}
      <div className="mv2-match-list">
        {visibleMatches.map((match) => <MatchRow key={match.matchId} match={match} agents={agents} maps={maps} onOpen={(item) => void openMatchDetails(item)} />)}
        {!visibleMatches.length ? <p className="mv2-muted-row">{matches.length ? "No cached matches match these filters." : syncing || sync?.inFlight ? "Fetching this player’s latest match history…" : "No recent matches are available for this player."}</p> : null}
      </div>

      <RankProgress
        snapshots={rrHistory?.snapshots || overview?.lastDeltas || []}
        tiers={tiers}
        source={rrHistory?.source}
        loading={loading || syncing || Boolean(sync?.inFlight)}
      />

      {topAgents.length ? (
        <section className="mv2-performance-section">
          <MobileSectionHeader title="Top agents" detail="Cached match performance" />
          <div className="mv2-agent-stats">
            {topAgents.map((stat) => {
              const agent = agents.find((item) => item.uuid.toLowerCase() === stat.characterId.toLowerCase());
              return (
                <article key={stat.characterId}>
                  <span>{agent?.displayIcon ? <img src={agent.displayIcon} alt="" /> : "?"}</span>
                  <div><strong>{agent?.displayName || "Agent"}</strong><small>{stat.matches} matches · {percent(stat.winrate)} win</small></div>
                  <dl><div><dt>K/D</dt><dd>{ratio(stat.kd)}</dd></div><div><dt>KDA</dt><dd>{ratio(stat.kda)}</dd></div><div><dt>HS</dt><dd>{percent(stat.hsPct)}</dd></div></dl>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {topMaps.length ? (
        <section className="mv2-performance-section">
          <MobileSectionHeader title="Maps" detail="Win rate by map" />
          <div className="mv2-map-stats">
            {topMaps.map((stat) => {
              const map = maps.get(stat.mapID.toLowerCase());
              return (
                <article key={stat.mapID} style={map?.splash ? { backgroundImage: `linear-gradient(90deg,rgba(7,12,16,.3),rgba(7,12,16,.96)),url(${map.splash})` } : undefined}>
                  <div><strong>{map?.name || "Map"}</strong><small>{stat.matches} matches</small></div>
                  <span><strong>{percent(stat.winrate)}</strong><small>{stat.wins} wins</small></span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
      {detailMatch ? (
        <MatchDetailsSheet
          match={detailMatch}
          details={matchDetails}
          loading={matchDetailsLoading}
          error={matchDetailsError}
          agents={agents}
          maps={maps}
          tiers={tiers}
          onClose={closeMatchDetails}
          onOpenProfile={onOpenProfile ? (nextTarget) => {
            closeMatchDetails();
            onOpenProfile(nextTarget);
          } : undefined}
        />
      ) : null}
    </div>
  );
}
