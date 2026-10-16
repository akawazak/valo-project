"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import {
    fetchCachedPublicJson,
    getAccountXP,
    getDailyTicket,
    getItemUpgrades,
    getMissions,
    getProfileLeaderboard,
    type ProfileLeaderboard,
    type ProfileLeaderboardPlayer,
    type ProfileMatchSummary,
    type ProfileRRSnapshot,
    type ProfileRankActSummary,
    type AccountXPResponse,
    type DailyTicketResponse,
    type ItemUpgradeDefinition,
    subscribeProgressionEvents,
    type RiotMissionsResponse,
    type RiotContractProgress,
} from "@/services/api";
import { ProfileComparison, SessionRecap, type ReviewPlayer } from "./CareerReview";
import Accolades from "./Accolades";
import LeaderboardView from "./LeaderboardView";
import CareerCard from "./CareerCard";
import { ProgressionLoading } from "./ProfileLoading";
import s from "./ProfilePanel.module.css";

export type CareerView = "analytics" | "progression" | "leaderboard" | "sessions" | "comparison" | "accolades";
export type ProgressionSection = "missions" | "battlepass" | "agent-contracts" | "custom-contracts" | "account";
const PROGRESSION_MODES = [
    { id: "missions", label: "Missions", icon: "missions", detail: "Daily checkpoints and weekly XP" },
    { id: "battlepass", label: "Battle Pass", icon: "battlepass", detail: "This act's tiers and rewards" },
    { id: "agent-contracts", label: "Agent contracts", icon: "agents", detail: "Agent rewards" },
    { id: "custom-contracts", label: "Contracts", icon: "events", detail: "Event passes, live and past" },
    { id: "account", label: "Account level", icon: "account", detail: "Level and AP" },
] as const;
/** Tabs kept in code but hidden: Agent contracts are replaced by mastery, and the Profile rail already shows account level. */
const HIDDEN_SECTIONS = new Set<ProgressionSection>(["agent-contracts", "account"]);
interface IdentityCard { name: string; cardId: string; titleText: string; portrait?: string }
const PAGE_SIZE = 25;
const KINGDOM_CREDITS_ICON = "https://media.valorant-api.com/currencies/85ca954a-41f2-ce94-9b45-8ca3dd39a00d/displayicon.png";

interface ContractReward { type?: string; uuid?: string; amount?: number }
interface ContractMeta { uuid: string; displayName?: string; displayIcon?: string; content?: { relationType?: string; relationUuid?: string; chapters?: Array<{ isEpilogue?: boolean; levels?: Array<{ xp?: number; doughCost?: number; vpCost?: number; reward?: ContractReward }>; freeRewards?: ContractReward[] | null }> } }
interface MissionMeta { uuid: string; displayName?: string; title?: string; type?: string; xpGrant?: number; progressToComplete?: number; activationDate?: string; expirationDate?: string; objectives?: Array<{ objectiveUuid: string; objectiveId: string; value: number; description: string }> }
interface CurrencyMeta { uuid: string; displayName: string; displayNameSingular?: string; displayIcon?: string; largeIcon?: string; rewardPreviewIcon?: string }
interface SeasonMeta { uuid: string; displayName?: string; endTime?: string }
interface EventMeta { uuid: string; displayName: string; shortDisplayName?: string; startTime: string; endTime: string }
interface Props {
    view: CareerView | null; onClose: () => void; puuid: string; region: string; seasonId?: string; isOwnProfile: boolean;
    matches: ProfileMatchSummary[]; rr: ProfileRRSnapshot[]; agentNames: Record<string, string>; mapNames: Record<string, string>;
    agentVisuals: Record<string, string>; mapVisuals: Record<string, string>;
    playerCardImages: Record<string, string>; rewardAssets: Record<string, RewardAsset>; onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    rankActs: ProfileRankActSummary[]; seasonNames: Record<string, string>;
    /** Match history queue filter; the deeper stats follow it. */
    queue: string; queueLabel: string;
    /** The signed-in player's name, card and title, for previewing card and title rewards. */
    identityCard?: IdentityCard;
    /** XP center section to open on, from the profile rail shortcuts. */
    initialSection?: ProgressionSection;
    reviewPlayer: ReviewPlayer; comparisonCandidates: ReviewPlayer[];
    /** Match to open Session recap on; empty opens the latest session. */
    recapFocus?: string; selfPuuid?: string; rankIcons?: Record<number, string>; agentIcons?: Record<string, string>;
}
interface RewardAsset { name: string; image: string; hero?: string; type: string; owned: boolean }

const VIEW_COPY: Record<CareerView, { eyebrow: string; title: string; detail: string }> = {
    analytics: { eyebrow: "", title: "Career insights", detail: "Your form, playstyle and trends across your synced matches." },
    progression: { eyebrow: "PROGRESSION", title: "XP center", detail: "Account level, XP sources, missions, contracts and Battle Pass." },
    leaderboard: { eyebrow: "COMPETITIVE", title: "Regional leaderboard", detail: "Current act standings for your region." },
    sessions: { eyebrow: "", title: "Session recap", detail: "Your sessions, match by match, from locally synced history." },
    comparison: { eyebrow: "", title: "Compare profiles", detail: "Two players, the same queue and act, with sample sizes shown." },
    accolades: { eyebrow: "", title: "Accolades", detail: "Your personal bests this act and lifetime." },
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const numberFrom = (value: unknown, key: string) => typeof value === "object" && value && typeof (value as Record<string, unknown>)[key] === "number" ? (value as Record<string, number>)[key] : 0;

export default function ProfileExtras({ view, onClose, puuid, region, seasonId, isOwnProfile, matches, rr, seasonNames, agentNames, mapNames, agentVisuals, mapVisuals, playerCardImages, rewardAssets, onViewProfile, queue, queueLabel, identityCard, initialSection, reviewPlayer, comparisonCandidates, rankIcons, agentIcons, recapFocus, selfPuuid }: Props) {
    const dialogRef = useRef<HTMLElement>(null);
    const [section, setSection] = useState<ProgressionSection>("missions");
    useEffect(() => { if (view === "progression") setSection(initialSection && !HIDDEN_SECTIONS.has(initialSection) ? initialSection : "missions"); }, [view, initialSection]);
    const [missions, setMissions] = useState<RiotMissionsResponse | null>(null);
    const [accountXP, setAccountXP] = useState<AccountXPResponse | null>(null);
    const [dailyTicket, setDailyTicket] = useState<DailyTicketResponse | null>(null);
    const [dailyTicketError, setDailyTicketError] = useState("");
    const [contractMeta, setContractMeta] = useState<ContractMeta[]>([]);
    const [missionMeta, setMissionMeta] = useState<MissionMeta[]>([]);
    const [currencies, setCurrencies] = useState<CurrencyMeta[]>([]);
    const [events, setEvents] = useState<EventMeta[]>([]);
    const [seasons, setSeasons] = useState<SeasonMeta[]>([]);
    const [progressionLoaded, setProgressionLoaded] = useState(false);
    const [progressionUpdatedAt, setProgressionUpdatedAt] = useState<number | null>(null);
    const [itemUpgrades, setItemUpgrades] = useState<ItemUpgradeDefinition[]>([]);
    const [leaderboard, setLeaderboard] = useState<ProfileLeaderboard | null>(null);
    const [query, setQuery] = useState("");
    // The submitted search, kept apart from the input so typing never reshapes the board.
    const [searchResult, setSearchResult] = useState<{ term: string; players: ProfileLeaderboardPlayer[] } | null>(null);
    const [loading, setLoading] = useState("");
    const [error, setError] = useState("");

    useEffect(() => { setMissions(null); setAccountXP(null); setDailyTicket(null); setDailyTicketError(""); setProgressionLoaded(false); setProgressionUpdatedAt(null); }, [puuid]);
    useEffect(() => { setLeaderboard(null); setQuery(""); setSearchResult(null); }, [region, seasonId]);
    useEffect(() => {
        if (!view) return;
        const previous = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        dialogRef.current?.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')?.focus();
        const close = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
            if (event.key !== "Tab") return;
            const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') || []).filter(item => item.getClientRects().length > 0);
            const first = items[0], last = items.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        window.addEventListener("keydown", close);
        return () => { window.removeEventListener("keydown", close); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
    }, [onClose, view]);

    useEffect(() => {
        if (view !== "progression" || !isOwnProfile || progressionLoaded) return;
        let cancelled = false;
        setLoading("progression"); setError("");
        Promise.allSettled([
            getMissions(),
            getAccountXP(),
            getDailyTicket(),
            fetchCachedPublicJson<{ data?: ContractMeta[] }>("https://valorant-api.com/v1/contracts").catch(() => ({ data: [] })),
            fetchCachedPublicJson<{ data?: MissionMeta[] }>("https://valorant-api.com/v1/missions").catch(() => ({ data: [] })),
            fetchCachedPublicJson<{ data?: CurrencyMeta[] }>("https://valorant-api.com/v1/currencies").catch(() => ({ data: [] })),
            fetchCachedPublicJson<{ data?: EventMeta[] }>("https://valorant-api.com/v1/events").catch(() => ({ data: [] })),
            getItemUpgrades().catch(() => []),
            fetchCachedPublicJson<{ data?: SeasonMeta[] }>("https://valorant-api.com/v1/seasons").catch(() => ({ data: [] })),
        ]).then(([progress, account, daily, contracts, missionDefinitions, currencyDefinitions, eventDefinitions, upgrades, seasonDefinitions]) => {
            if (cancelled) return;
            if (progress.status === "fulfilled") setMissions(progress.value);
            else setError(progress.reason instanceof Error ? progress.reason.message : String(progress.reason));
            if (account.status === "fulfilled") setAccountXP(account.value);
            if (daily.status === "fulfilled") { setDailyTicket(daily.value); setDailyTicketError(""); }
            else setDailyTicketError(daily.reason instanceof Error ? daily.reason.message : String(daily.reason));
            if (contracts.status === "fulfilled") setContractMeta(contracts.value.data || []);
            if (missionDefinitions.status === "fulfilled") setMissionMeta((missionDefinitions.value.data || []).map((mission) => ({ ...mission, displayName: mission.displayName || mission.title, objectives: mission.objectives?.map((objective) => ({ ...objective, objectiveId: objective.objectiveUuid, description: mission.title || mission.displayName || "Mission objective" })) })));
            if (currencyDefinitions.status === "fulfilled") setCurrencies(currencyDefinitions.value.data || []);
            if (eventDefinitions.status === "fulfilled") setEvents(eventDefinitions.value.data || []);
            if (upgrades.status === "fulfilled") setItemUpgrades(upgrades.value);
            if (seasonDefinitions.status === "fulfilled") setSeasons(seasonDefinitions.value.data || []);
            setProgressionUpdatedAt(Date.now());
            setProgressionLoaded(true);
        })
            .finally(() => { if (!cancelled) setLoading(""); });
        return () => { cancelled = true; };
    }, [isOwnProfile, progressionLoaded, view]);
    const refreshProgression = useCallback(() => setProgressionLoaded(false), []);
    useEffect(() => {
        if (view !== "progression" || !isOwnProfile) return;
        const controller = new AbortController();
        let timer = 0;
        void subscribeProgressionEvents(() => {
            clearTimeout(timer);
            timer = window.setTimeout(refreshProgression, 700);
        }, controller.signal).catch(() => undefined);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [isOwnProfile, refreshProgression, view]);

    const analytics = useMemo(() => {
        const gains = rr.filter((item) => item.rrEarned > 0).map((item) => item.rrEarned);
        const losses = rr.filter((item) => item.rrEarned < 0).map((item) => item.rrEarned);
        const recent = matches.slice(0, 10);
        const stacked = recent.filter((match) => (match.partyMembers?.length || 0) > 0);
        const solo = recent.filter((match) => !(match.partyMembers?.length || 0));
        const winrate = (items: ProfileMatchSummary[]) => items.length ? Math.round(items.filter((item) => item.win).length / items.length * 100) : null;
        const bestOf = (key: (match: ProfileMatchSummary) => string) => [...new Set(recent.map(key).filter(Boolean))].map((id) => { const games = recent.filter((match) => key(match) === id); return { id, games: games.length, wins: games.filter((match) => match.win).length }; }).filter((item) => item.games >= 2).sort((a, b) => b.wins / b.games - a.wins / a.games)[0];
        return { net: rr.reduce((sum, item) => sum + item.rrEarned, 0), avgGain: Math.round(average(gains)), avgLoss: Math.round(average(losses)), recentWins: recent.filter((match) => match.win).length, recentGames: recent.length, soloWR: winrate(solo), stackWR: winrate(stacked), soloGames: solo.length, stackGames: stacked.length, bestAgent: bestOf((match) => match.localPlayer?.characterId || ""), bestMap: bestOf((match) => match.mapID) };
    }, [matches, rr]);

    const loadLeaderboard = async (reset: boolean, search = query) => {
        const term = search.trim();
        setLoading("leaderboard"); setError("");
        try {
            if (term) {
                // Riot searches by game name only; the tag narrows the results here.
                const [gameName, tagLine = ""] = term.split("#").map(part => part.trim().toLowerCase());
                const matches = (player: ProfileLeaderboardPlayer) => !player.IsAnonymized && (player.gameName || "").toLowerCase().includes(gameName) && (!tagLine || (player.tagLine || "").toLowerCase().startsWith(tagLine));
                // Riot often returns nothing for a query, so loaded rows still count.
                const remote = gameName ? await getProfileLeaderboard(seasonId, gameName, 0, PAGE_SIZE).then(page => page.Players || []).catch(() => []) : [];
                const found = new Map<string, ProfileLeaderboardPlayer>();
                [...remote, ...(leaderboard?.Players || [])].filter(matches).forEach(player => found.set(player.puuid || `#${player.leaderboardRank}`, player));
                setSearchResult({ term, players: [...found.values()].sort((a, b) => a.leaderboardRank - b.leaderboardRank) });
                return;
            }
            setSearchResult(null);
            if (reset && leaderboard && !search) return;
            const start = reset ? 0 : (leaderboard?.Players?.length || 0);
            const page = await getProfileLeaderboard(seasonId, "", start, PAGE_SIZE);
            setLeaderboard(reset || !leaderboard ? page : { ...page, Players: [...(leaderboard.Players || []), ...(page.Players || [])] });
        } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        finally { setLoading(""); }
    };
    useEffect(() => {
        if (view === "leaderboard" && !leaderboard && loading !== "leaderboard") void loadLeaderboard(true, "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view]);

    if (!view || typeof document === "undefined") return null;
    const copy = VIEW_COPY[view];
    return createPortal(<div className={`${s.careerBackdrop} ${view === "sessions" || view === "comparison" ? s.careerReviewBackdrop : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className={`${s.careerDialog} ${s.careerDialogSingle} ${view === "sessions" || view === "comparison" ? s.careerReviewDialog : ""}`} role="dialog" aria-modal="true" aria-label={copy.title}>
            {view === "accolades" ? <Accolades onClose={onClose} currentActId={seasonId} acts={seasons} /> : null}
            {view === "accolades" ? null : view === "progression" ? <header className={s.xpBar}>
                <h2>{copy.title}</h2>
                {isOwnProfile && missions ? <nav aria-label="Progression sections">{PROGRESSION_MODES.filter(({ id }) => !HIDDEN_SECTIONS.has(id)).map(({ id, label, icon, detail }) => <button key={id} type="button" className={s.xpTab} data-active={section === id} aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)}><i><ProgressionIcon kind={icon} /></i><span><strong>{label}</strong><small>{detail}</small></span></button>)}</nav> : null}
                <div className={s.xpBarTools}>
                    {progressionUpdatedAt ? <small>Synced {new Date(progressionUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small> : null}
                    <button type="button" onClick={refreshProgression} disabled={loading === "progression"} aria-label="Refresh progress" title="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg></button>
                    <button type="button" onClick={onClose} aria-label={`Close ${copy.title}`}>×</button>
                </div>
            </header> : <header className={`${s.careerHeader} ${view === "analytics" ? s.careerHeaderCompact : ""}`}><div>{copy.eyebrow ? <span>{copy.eyebrow}</span> : null}<h2>{copy.title}</h2><p>{copy.detail}</p></div><button onClick={onClose} aria-label={`Close ${copy.title}`}>×</button></header>}
            {view === "accolades" ? null : <div className={s.careerBody}>
                {error ? <div className={s.extrasError}>{error}</div> : null}
                {view === "sessions" ? <SessionRecap key={`${puuid}:${region}:${recapFocus || ""}`} focusMatchId={recapFocus} puuid={puuid} region={region} queue={queue} queueLabel={queueLabel} agentNames={agentNames} mapNames={mapNames} agentVisuals={agentVisuals} agentIcons={agentIcons} mapVisuals={mapVisuals} /> : null}
                {view === "comparison" ? <ProfileComparison key={`${puuid}:${region}:${seasonId}:${queue}`} player={reviewPlayer} selfPuuid={selfPuuid} candidates={comparisonCandidates} region={region} seasonId={seasonId} queue={queue} queueLabel={queueLabel} agentNames={agentNames} agentVisuals={agentVisuals} playerCardImages={playerCardImages} rankIcons={rankIcons} /> : null}
                {view === "analytics" ? <CareerCard puuid={puuid} region={region} queue={queue} data={analytics} matches={matches} rr={rr} agentNames={agentNames} mapNames={mapNames} agentVisuals={agentVisuals} mapVisuals={mapVisuals} rankIcons={rankIcons} agentIcons={agentIcons} /> : null}
                {view === "progression" ? <Progression data={missions} accountXP={accountXP} dailyTicket={dailyTicket} dailyTicketError={dailyTicketError} contracts={contractMeta} missionMeta={missionMeta} currencies={currencies} events={events} itemUpgrades={itemUpgrades} seasons={seasons} seasonId={seasonId} rewardAssets={rewardAssets} agentVisuals={agentVisuals} loading={loading === "progression" || !progressionLoaded} isOwn={isOwnProfile} updatedAt={progressionUpdatedAt} onRefresh={refreshProgression} section={section} onSection={setSection} identityCard={identityCard} /> : null}
                {view === "leaderboard" ? <LeaderboardView data={leaderboard} results={searchResult} loading={loading === "leaderboard"} query={query} setQuery={setQuery} load={loadLeaderboard} pageSize={PAGE_SIZE} close={onClose} openProfile={onViewProfile} rankIcons={rankIcons} regionLabel={region ? region.toUpperCase() : undefined} actLabel={seasonId ? seasonNames[seasonId.toLowerCase()] : undefined} me={isOwnProfile ? { puuid: reviewPlayer.puuid, name: `${reviewPlayer.gameName}${reviewPlayer.tagLine ? ` #${reviewPlayer.tagLine}` : ""}`, cardId: identityCard?.cardId } : undefined} /> : null}
            </div>}
        </section>
    </div>, document.body);
}


function Progression({ data, accountXP, dailyTicket, dailyTicketError, contracts, missionMeta, currencies, events, itemUpgrades, seasons, seasonId, rewardAssets, agentVisuals, loading, isOwn, updatedAt, onRefresh, section, onSection, identityCard }: { data: RiotMissionsResponse | null; accountXP: AccountXPResponse | null; dailyTicket: DailyTicketResponse | null; dailyTicketError: string; contracts: ContractMeta[]; missionMeta: MissionMeta[]; currencies: CurrencyMeta[]; events: EventMeta[]; itemUpgrades: ItemUpgradeDefinition[]; seasons: SeasonMeta[]; seasonId?: string; rewardAssets: Record<string, RewardAsset>; agentVisuals: Record<string, string>; loading: boolean; isOwn: boolean; updatedAt: number | null; onRefresh: () => void; section: ProgressionSection; onSection: (section: ProgressionSection) => void; identityCard?: IdentityCard }) {
    const canvasRef = useRef<HTMLElement>(null);
    const lastExpiryRefresh = useRef(0);
    const refreshExpiredProgress = useCallback(() => {
        const now = Date.now();
        if (now - lastExpiryRefresh.current < 60_000) return;
        lastExpiryRefresh.current = now;
        onRefresh();
    }, [onRefresh]);
    useEffect(() => {
        canvasRef.current?.scrollTo({ top: 0 });
    }, [section]);
    useEffect(() => {
        if (section !== "missions") return;
        const refreshVisible = () => { if (document.visibilityState === "visible") onRefresh(); };
        const interval = window.setInterval(refreshVisible, 60_000);
        window.addEventListener("focus", refreshVisible);
        document.addEventListener("visibilitychange", refreshVisible);
        return () => { clearInterval(interval); window.removeEventListener("focus", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
    }, [onRefresh, section]);
    if (!isOwn) return <Empty text="Progress is private to the signed-in account." />;
    if (loading && !data) return <ProgressionLoading gameName={identityCard?.name} cardArt={identityCard?.portrait} />;
    if (!data) return <Empty text="Progress is unavailable for this account." />;
    const definition = contracts.find((contract) => contract.content?.relationType?.toLowerCase() === "season" && contract.content?.relationUuid?.toLowerCase() === seasonId?.toLowerCase());
    const active = definition ? (data.Contracts || []).find((contract) => contract.ContractDefinitionID.toLowerCase() === definition.uuid.toLowerCase()) : undefined;
    const totalXP = active ? numberFrom(active.ContractProgression, "TotalProgressionEarned") : 0;
    const missionDefinitions = Object.fromEntries(missionMeta.map((mission) => [mission.uuid.toLowerCase(), mission]));
    const now = Date.now();
    const currencyById = Object.fromEntries(currencies.map((currency) => [currency.uuid.toLowerCase(), currency]));
    const recentXP = accountXP?.History?.slice(0, 5) || [];
    const contractMatches = [...(data.ProcessedMatches || [])].reverse().slice(0, 5);
    const nextFirstWin = accountXP?.NextTimeFirstWinAvailable ? new Date(accountXP.NextTimeFirstWinAvailable) : null;
    const firstWinClaimed = !!nextFirstWin && nextFirstWin.getTime() > now;
    const dailyReset = dailyTicket ? new Date((updatedAt || now) + dailyTicket.RemainingLifetimeSeconds * 1000) : null;
    const activeMissions = (data.Missions || []).filter((mission) => !mission.Complete);
    const completedMissions = (data.Missions || []).filter((mission) => mission.Complete);
    const weeklyCheckpoint = data.MissionMetadata?.WeeklyCheckpoint ? new Date(data.MissionMetadata.WeeklyCheckpoint).getTime() : 0;
    const completedWeeklyDefinitions = weeklyCheckpoint ? missionMeta.filter((mission) => mission.type?.toLowerCase().includes("weekly") && mission.activationDate && Math.abs(new Date(mission.activationDate).getTime() - weeklyCheckpoint) < 12 * 60 * 60 * 1000) : [];
    const liveMissionIDs = new Set((data.Missions || []).map((mission) => mission.ID.toLowerCase()));
    const releasedAfterCheckpoint = missionMeta.filter((mission) => mission.type?.toLowerCase().includes("weekly") && mission.activationDate && new Date(mission.activationDate).getTime() > weeklyCheckpoint + 12 * 60 * 60 * 1000 && !liveMissionIDs.has(mission.uuid.toLowerCase()));
    const queuedWeeklies = releasedAfterCheckpoint.filter((mission) => new Date(mission.activationDate || 0).getTime() <= now);
    const futureWeeklies = releasedAfterCheckpoint.filter((mission) => new Date(mission.activationDate || 0).getTime() > now);
    return <div className={s.progressionWorkspace}>
        <main ref={canvasRef} className={s.progressionCanvas}>
        {section === "account" ? <AccountXPView accountXP={accountXP} battlePassXP={totalXP} recent={recentXP} contractMatches={contractMatches} nextFirstWin={nextFirstWin} missionMeta={missionMeta} contracts={contracts} /> : null}
        {section === "missions" ? <div className={s.mxPage}>
            {dailyTicketError && !dailyTicket ? <div className={s.mxWarn}><span>Daily checkpoints didn&apos;t load. {dailyTicketError}</span><button type="button" onClick={onRefresh} disabled={loading}>{loading ? "Retrying…" : "Try again"}</button></div> : null}
            <section className={s.mxToday}>
                <div className={s.mxInfo}>
                    <h3>Today</h3>
                    <p>{dailyReset ? <>Resets in <CountdownTimer target={dailyReset} label="Resets in" onExpire={refreshExpiredProgress} /></> : "Reset time unavailable"}</p>
                    <div className={s.mxFirstWin} data-claimed={firstWinClaimed}>
                        <i aria-hidden="true" />
                        <span><strong>First win of the day</strong><small>{firstWinClaimed && nextFirstWin ? <>Claimed · back in <CountdownTimer target={nextFirstWin} label="Back in" onExpire={refreshExpiredProgress} /></> : "Win one match to claim"}</small></span>
                        <b>+1,000 XP</b>
                    </div>
                    <div className={s.mxPerk}><img src={KINGDOM_CREDITS_ICON} alt="" />Each checkpoint gives <b>150 KC</b> and <b>1,000 XP</b></div>
                </div>
                <div className={s.dailyCheckpoints}>{[0, 1, 2, 3].map((index) => { const milestone = dailyTicket?.Milestones?.[index]; const progress = Math.max(0, Math.min(4, milestone?.Progress || 0)); return <div key={index} data-charges={progress} className={progress >= 4 ? s.dailyCheckpointDone : progress > 0 ? s.dailyCheckpointActive : ""}><i><b>{index + 1}</b></i><small>{dailyTicket ? (progress >= 4 ? "Claimed" : `${progress}/4 charges`) : "Unavailable"}{milestone?.BonusApplied ? " · bonus" : ""}</small></div>; })}</div>
            </section>
            <section className={s.mxWeek}>
                <header>
                    <div><h3>This week</h3><p>{data.MissionMetadata?.WeeklyRefillTime ? <>{(data.Missions || []).length ? "Refills in" : "New missions in"} <CountdownTimer target={data.MissionMetadata.WeeklyRefillTime} label="Refills in" onExpire={refreshExpiredProgress} /></> : "Refill time unavailable"}</p></div>
                    {(data.Missions || []).length ? <span className={s.mxCount}><b>{completedMissions.length}</b> of {(data.Missions || []).length} done</span> : null}
                </header>
                {(data.Missions || []).length ? <ul className={s.mxRows}>{data.Missions.map((mission) => {
                    const meta = missionDefinitions[mission.ID.toLowerCase()];
                    const objective = meta?.objectives?.[0];
                    const current = objective ? mission.Objectives?.[objective.objectiveId] || 0 : 0;
                    const target = objective?.value || 0;
                    return <li key={mission.ID} data-done={mission.Complete}>
                        <i aria-hidden="true">{mission.Complete ? "✓" : ""}</i>
                        <strong title={missionKind(meta?.type)}>{meta?.displayName || "Weekly mission"}</strong>
                        <span className={s.mxBar}><em style={{ width: `${mission.Complete ? 100 : target ? Math.min(100, current / target * 100) : 0}%` }} /></span>
                        <small>{mission.Complete ? "Done" : target ? `${current.toLocaleString()} / ${target.toLocaleString()}` : "In progress"}</small>
                        <b>{meta?.xpGrant ? `+${meta.xpGrant.toLocaleString()} XP` : ""}</b>
                    </li>;
                })}</ul> : completedWeeklyDefinitions.length ? <>
                    <div className={s.mxAllDone}><i aria-hidden="true">✓</i><span><strong>Weekly missions done</strong><small>You finished the set on {new Date(data.MissionMetadata.WeeklyCheckpoint).toLocaleDateString([], { month: "short", day: "numeric" })} for <b>+{completedWeeklyDefinitions.reduce((sum, mission) => sum + (mission.xpGrant || 0), 0).toLocaleString()} XP</b></small></span></div>
                    <ul className={s.mxRows}>{completedWeeklyDefinitions.map((mission) => <li key={mission.uuid} data-done="true"><i aria-hidden="true">✓</i><strong>{mission.displayName || mission.title || "Weekly mission"}</strong><span className={s.mxBar}><em style={{ width: "100%" }} /></span><small>Done</small><b>+{(mission.xpGrant || 0).toLocaleString()} XP</b></li>)}</ul>
                </> : <p className={s.mxEmpty}>No weekly missions right now. New ones arrive when the set refills.</p>}
            </section>
            {queuedWeeklies.length ? <MissionSchedule title="Queued weeklies" detail="Released and waiting behind your current set" missions={queuedWeeklies} /> : null}
            {futureWeeklies.length ? <MissionSchedule title="Coming up" detail="Weekly sets Riot has already published" missions={futureWeeklies} groupByDate /> : null}
        </div> : null}
        {section === "battlepass" ? <BattlePassView definition={definition} progress={active} rewardAssets={rewardAssets} currencies={currencyById} seasonEnd={seasons.find((season) => season.uuid.toLowerCase() === seasonId?.toLowerCase())?.endTime} dailyTicket={dailyTicket} weeklyLeft={activeMissions.filter((mission) => missionDefinitions[mission.ID.toLowerCase()]?.type?.toLowerCase().includes("weekly")).length} onOpenMissions={() => onSection("missions")} identityCard={identityCard} accountLevel={accountXP?.Progress.Level} /> : null}
        {section === "agent-contracts" ? <ContractsBrowser key="agent-contracts" scope="gear" contracts={contracts} progress={data.Contracts || []} upgrades={itemUpgrades} events={events} rewardAssets={rewardAssets} currencies={currencyById} agentVisuals={agentVisuals} /> : null}
        {section === "custom-contracts" ? <CustomContracts contracts={contracts} progress={data.Contracts || []} events={events} rewardAssets={rewardAssets} currencies={currencyById} identityCard={identityCard} accountLevel={accountXP?.Progress.Level} /> : null}
        </main>
    </div>;
}

function CountdownTimer({ target, label, onExpire }: { target: Date | string | number; label: string; onExpire?: () => void }) {
    const targetTime = target instanceof Date ? target.getTime() : new Date(target).getTime();
    const [currentTime, setCurrentTime] = useState(() => Date.now());
    const notifiedTarget = useRef<number | null>(null);
    useEffect(() => {
        if (!Number.isFinite(targetTime)) return;
        const update = () => setCurrentTime(Date.now());
        update();
        const interval = window.setInterval(update, 1000);
        return () => window.clearInterval(interval);
    }, [targetTime]);
    useEffect(() => {
        if (!onExpire || !Number.isFinite(targetTime) || currentTime < targetTime || notifiedTarget.current === targetTime) return;
        notifiedTarget.current = targetTime;
        onExpire();
    }, [currentTime, onExpire, targetTime]);
    if (!Number.isFinite(targetTime)) return <span className={s.countdownUnavailable}>time unavailable</span>;
    const seconds = Math.max(0, Math.ceil((targetTime - currentTime) / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const pad = (value: number) => String(value).padStart(2, "0");
    const text = seconds <= 0 ? "now" : days ? `${days}d ${hours}h ${pad(minutes)}m` : `${hours}h ${pad(minutes)}m ${pad(seconds % 60)}s`;
    return <b className={s.mxTimer} role="timer" aria-label={`${label} ${text}`}>{text}</b>;
}

function missionKind(type?: string) {
    const kind = (type || "").split("::").pop()?.replace(/_/g, " ").toLowerCase() || "mission";
    return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function ProgressionIcon({ kind }: { kind: "valorant" | "missions" | "battlepass" | "agents" | "events" | "account" }) {
    if (kind === "valorant") return <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M4 5l10 12.5V27L2 13.7V5h2zm24 0v8.7L17 26v-8.5L27 5h1z" /></svg>;
    const iconProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
    if (kind === "missions") return <svg {...iconProps}><path d="M9 5h6M9 3h6v4H9zM7 5H5v16h14V5h-2" /><path d="m8 14 2.2 2.2L16 10.5" /></svg>;
    if (kind === "battlepass") return <svg {...iconProps}><path d="M4 6h12v14H4zM8 3h12v14h-4" /><path d="M7.5 10h5M7.5 14h5" /></svg>;
    if (kind === "agents") return <svg {...iconProps}><circle cx="12" cy="8" r="3" /><path d="M6.5 20v-2.5A5.5 5.5 0 0 1 12 12a5.5 5.5 0 0 1 5.5 5.5V20M4 3h16v18H4z" /></svg>;
    if (kind === "events") return <svg {...iconProps}><path d="M5 4h14v16H5zM8 2v4M16 2v4M5 9h14" /><path d="m12 12 .8 1.7 1.9.2-1.4 1.3.4 1.8-1.7-.9-1.7.9.4-1.8-1.4-1.3 1.9-.2z" /></svg>;
    return <svg {...iconProps}><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0M4 3h16v18H4z" /></svg>;
}

function AccountXPView({ accountXP, battlePassXP, recent, contractMatches, nextFirstWin, missionMeta, contracts }: { accountXP: AccountXPResponse | null; battlePassXP: number; recent: AccountXPResponse["History"]; contractMatches: RiotMissionsResponse["ProcessedMatches"]; nextFirstWin: Date | null; missionMeta: MissionMeta[]; contracts: ContractMeta[] }) {
    const ap = accountXP?.Progress.XP || 0;
    const available = !nextFirstWin || nextFirstWin <= new Date();
    const missionById = new Map(missionMeta.map((mission) => [mission.uuid.toLowerCase(), mission]));
    const contractById = new Map(contracts.map((contract) => [contract.uuid.toLowerCase(), contract]));
    const receipts = contractMatches.slice(0, 5).map((match) => {
        const grants = match.XPGrants;
        const baseXP = grants ? grants.GamePlayed + grants.GameWon + grants.RoundPlayed + grants.RoundWon : 0;
        const missionXP = grants ? Object.values(grants.Missions || {}).reduce((sum, value) => sum + value, 0) : 0;
        const totalXP = Math.round((baseXP + missionXP) * (grants?.Modifier?.Value || 1));
        const contractXP = Object.values(match.ContractDeltas || {}).reduce((sum, delta) => sum + Math.max(0, delta.TotalXPAfter - delta.TotalXPBefore), 0);
        const missionSteps = Object.values(match.MissionDeltas || {}).reduce((sum, mission) => sum + Object.values(mission.ObjectiveDeltas || {}).filter((objective) => objective.ProgressAfter > objective.ProgressBefore).length, 0);
        const missionLabels = Object.values(match.MissionDeltas || {}).flatMap((mission) => {
            const meta = missionById.get((mission.ID || "").toLowerCase());
            const progressedObjectives = Object.values(mission.ObjectiveDeltas || {}).filter((objective) => objective.ProgressAfter > objective.ProgressBefore);
            const objectiveLabels = progressedObjectives.map((objective) => meta?.objectives?.find((definition) => definition.objectiveId.toLowerCase() === objective.ID.toLowerCase() || definition.objectiveUuid.toLowerCase() === objective.ID.toLowerCase())?.description).filter(Boolean);
            if (objectiveLabels.length) return objectiveLabels as string[];
            return progressedObjectives.length ? [meta?.displayName || meta?.title || "Mission progress"] : [];
        });
        const contractLabels = Object.values(match.ContractDeltas || {}).flatMap((delta) => {
            if (delta.TotalXPAfter <= delta.TotalXPBefore) return [];
            return [contractById.get((delta.ID || "").toLowerCase())?.displayName || "Contract progress"];
        });
        const progressLabels = [...new Set([...missionLabels, ...contractLabels])];
        return { ...match, totalXP, baseXP, missionXP, contractXP, missionSteps, progressLabels, afkRounds: grants?.NumAFKRounds || 0 };
    });
    return <div className={s.accountXPPage}><section className={s.accountLevelHero}><div className={s.accountLevelBadge}><span>LEVEL</span><strong>{accountXP?.Progress.Level ?? "—"}</strong></div><div className={s.accountLevelProgress}><span>ACCOUNT POINTS</span><strong>{ap.toLocaleString()} <small>/ 5,000 AP</small></strong><i><b style={{ width: `${Math.min(100, ap / 5000 * 100)}%` }} /></i><p>{Math.max(0, 5000 - ap).toLocaleString()} AP until Level {(accountXP?.Progress.Level || 0) + 1}</p></div><div className={s.accountLevelFacts}><div><span>FIRST WIN</span><strong>{available ? "Available" : "Claimed"}</strong><small>{available ? "Bonus AP on your next win" : `Returns ${nextFirstWin?.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}</small></div><div><span>BATTLE PASS XP</span><strong>{battlePassXP.toLocaleString()}</strong><small>Tracked separately from AP</small></div></div></section><section className={s.accountActivity}><header><div><span>RECENT ACCOUNT PROGRESS</span><strong>AP earned by match</strong></div><small>{recent.length} recent grants</small></header><div>{recent.map((entry) => <article key={entry.ID}><time>{new Date(entry.MatchStart).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><div><strong>+{entry.XPDelta.toLocaleString()} AP</strong><span>{entry.XPSources?.map((source) => `${xpSourceLabel(source.ID)} +${source.Amount}`).join(" · ") || "Match AP"}</span></div><small>Level {entry.StartProgress.Level}{entry.EndProgress.Level > entry.StartProgress.Level ? ` → ${entry.EndProgress.Level}` : ""}</small></article>)}</div></section>{receipts.length ? <section className={s.xpReceipts}><header><div><span>MATCH XP RECEIPTS</span><strong>Where your progression came from</strong></div><small>{receipts.length} recent matches</small></header><div>{receipts.map((receipt) => <article key={receipt.ID}><time>{new Date(receipt.StartTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><div><strong>{receipt.totalXP ? `+${receipt.totalXP.toLocaleString()} XP` : "XP processed"}</strong><small>{receipt.afkRounds ? `${receipt.afkRounds} AFK round${receipt.afkRounds === 1 ? "" : "s"} reported` : "No AFK rounds reported"}</small>{receipt.progressLabels.length ? <small title={receipt.progressLabels.join(" · ")}>{receipt.progressLabels.join(" · ")}</small> : null}</div><dl><div><dt>Match</dt><dd>{receipt.baseXP.toLocaleString()}</dd></div><div><dt>Missions</dt><dd>{receipt.missionXP.toLocaleString()}</dd></div><div><dt>Contract</dt><dd>{receipt.contractXP.toLocaleString()}</dd></div><div><dt>Objectives</dt><dd>{receipt.missionSteps}</dd></div></dl></article>)}</div></section> : null}</div>;
}

function MissionSchedule({ title, detail, missions, groupByDate = false }: { title: string; detail: string; missions: MissionMeta[]; groupByDate?: boolean }) {
    const groups = groupByDate ? Object.entries(Object.groupBy(missions, (mission) => new Date(mission.activationDate || 0).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))) : [["", missions] as [string, MissionMeta[]]];
    return <section className={s.mxWeek}><header><div><h3>{title}</h3><p>{detail}</p></div><span className={s.mxCount}><b>{missions.length}</b> missions</span></header>{groups.map(([date, items]) => <div key={date || title}>{date ? <time className={s.mxDate}>{date}</time> : null}<ul className={`${s.mxRows} ${s.mxRowsPlain}`}>{(items || []).map((mission) => <li key={mission.uuid}><i aria-hidden="true" /><strong>{mission.displayName || mission.title || "Weekly mission"}</strong><b>+{(mission.xpGrant || 0).toLocaleString()} XP</b></li>)}</ul></div>)}</section>;
}

function resolveReward(reward: ContractReward | undefined, assets: Record<string, RewardAsset>, currencies: Record<string, CurrencyMeta>) {
    const id = reward?.uuid?.toLowerCase() || "";
    const asset = assets[id];
    const currency = currencies[id];
    return {
        name: currency?.displayNameSingular || currency?.displayName || asset?.name || rewardLabel(reward?.type),
        image: currency?.rewardPreviewIcon || currency?.displayIcon || asset?.image || "",
        hero: currency?.largeIcon || currency?.displayIcon || asset?.hero || asset?.image || "",
        type: currency ? "Currency" : asset?.type || rewardLabel(reward?.type),
        owned: asset?.owned || false,
        amount: reward?.amount || 1,
    };
}

function RewardVisual({ reward, assets, currencies }: { reward?: ContractReward; assets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta> }) {
    const resolved = resolveReward(reward, assets, currencies);
    return <div className={s.rewardVisual}>{resolved.image ? <img src={resolved.image} alt="" /> : <span>{resolved.type.slice(0, 2).toUpperCase()}</span>}<div><strong>{resolved.name}</strong><small>{resolved.type}{resolved.amount > 1 ? ` · ×${resolved.amount}` : ""}</small></div></div>;
}

function timeLeft(end?: string) {
    const ms = end ? new Date(end).getTime() - Date.now() : NaN;
    if (!Number.isFinite(ms)) return null;
    if (ms <= 0) return "Ended";
    const hours = Math.floor(ms / 3_600_000);
    if (hours >= 48) return `${Math.floor(hours / 24)} days`;
    if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
    return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/** A tall player card in the in-game layout: art, name, title and level. */
function PlayerCardPreview({ art, name, title, level, highlight }: { art?: string; name: string; title: string; level?: number; highlight: "card" | "title" }) {
    return <div className={s.bpCard} data-highlight={highlight}>
        {level ? <span className={s.bpCardLevel}>{level}</span> : null}
        <div className={s.bpCardFace}>
            {art ? <img src={art} alt="" /> : null}
            <div className={s.bpCardScrim}>
                <svg viewBox="0 57 100 43" preserveAspectRatio="none" aria-hidden="true"><path d="M7.7 62V78.3L49.4 95.8L91.4 78.3V62" fill="none" stroke="currentColor" strokeWidth="0.9" vectorEffect="non-scaling-stroke" /></svg>
                <strong>{name}</strong>
                <span>{title}</span>
            </div>
        </div>
    </div>;
}

/** In-game style reward track for the Battle Pass and for event passes (custom contracts). */
function BattlePassView({ definition, progress, rewardAssets, currencies, seasonEnd, dailyTicket, weeklyLeft = 0, onOpenMissions, identityCard, accountLevel, title, trackLabel = "Premium" }: { definition?: ContractMeta; progress?: RiotContractProgress; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta>; seasonEnd?: string; dailyTicket?: DailyTicketResponse | null; weeklyLeft?: number; onOpenMissions?: () => void; identityCard?: IdentityCard; accountLevel?: number; title?: string; trackLabel?: string }) {
    const lastWheel = useRef(0);
    const chapters = useMemo(() => {
        let tier = 0;
        const source = (definition?.content?.chapters || []).map((chapter) => ({
            isEpilogue: !!chapter.isEpilogue,
            levels: (chapter.levels || []).map((level) => ({ tier: ++tier, cost: Math.max(0, level.xp || 0), reward: level.reward })),
            free: chapter.freeRewards || [],
        }));
        // Event passes can put many tiers in one chapter; show them five at a time like the game.
        return source.flatMap((chapter) => {
            if (chapter.levels.length <= 6) return [chapter];
            const pages = [];
            for (let start = 0; start < chapter.levels.length; start += 5) pages.push({ ...chapter, levels: chapter.levels.slice(start, start + 5), free: start + 5 >= chapter.levels.length ? chapter.free : [] });
            return pages;
        });
    }, [definition]);
    const levels = chapters.flatMap((chapter) => chapter.levels);
    const totalXP = numberFrom(progress?.ContractProgression, "TotalProgressionEarned");
    let reached = 0;
    let toward = totalXP;
    if (levels.some((level) => level.cost > 0)) {
        for (const level of levels) {
            if (level.cost > 0 && toward < level.cost) break;
            toward -= level.cost;
            reached += 1;
        }
    }
    if ((progress?.ProgressionLevelReached || 0) > reached) {
        reached = progress?.ProgressionLevelReached || 0;
        toward = progress?.ProgressionTowardsNextLevel || 0;
    }
    const complete = levels.length > 0 && reached >= levels.length;
    const openingTier = Math.min(levels.length, reached + 1);
    const [selected, setSelected] = useState<string | null>(null);
    const key = selected || `t${openingTier}`;
    const chapterOf = (tier: number) => Math.max(0, chapters.findIndex((chapter) => chapter.levels.some((level) => level.tier === tier)));
    const chapterIndex = key.startsWith("f") ? Number(key.slice(1).split("-")[0]) : chapterOf(Number(key.slice(1)));
    const chapter = chapters[chapterIndex];
    if (!definition || !chapter) return <Empty text={`${title || "The current Battle Pass"} has no rewards to show.`} />;

    const selectedLevel = key.startsWith("t") ? chapter.levels.find((level) => `t${level.tier}` === key) : undefined;
    const selectedReward = selectedLevel ? selectedLevel.reward : chapter.free[Number(key.split("-")[1])];
    const shown = resolveReward(selectedReward, rewardAssets, currencies);
    const lastTier = chapter.levels.at(-1)?.tier || 0;
    const shownUnlocked = selectedLevel ? selectedLevel.tier <= reached : lastTier <= reached;
    const shownName = shown.amount > 1 ? `${shown.amount} ${shown.name}` : shown.name;
    const order = chapters.flatMap((item, index) => [...item.levels.map((level) => `t${level.tier}`), ...item.free.map((_, freeIndex) => `f${index}-${freeIndex}`)]);
    const step = (direction: number) => { const next = order[order.indexOf(key) + direction]; if (next) setSelected(next); };
    const onWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (Math.abs(event.deltaY) < 4 || event.timeStamp - lastWheel.current < 140) return;
        lastWheel.current = event.timeStamp;
        step(event.deltaY > 0 ? 1 : -1);
    };
    const playerName = identityCard?.name || "Player";
    const pickChapter = (index: number) => { const target = chapters[index]; if (target?.levels[0]) setSelected(`t${target.levels[0].tier}`); };
    const nextLevel = levels[reached];
    const nextReward = nextLevel ? resolveReward(nextLevel.reward, rewardAssets, currencies) : null;
    const checkpointIndex = dailyTicket ? dailyTicket.Milestones.findIndex((milestone) => (milestone.Progress || 0) < 4) : -1;
    const checkpoint = dailyTicket ? (checkpointIndex < 0 ? dailyTicket.Milestones.length : checkpointIndex + 1) : null;
    const checkpointProgress = dailyTicket && checkpointIndex >= 0 ? Math.min(4, dailyTicket.Milestones[checkpointIndex]?.Progress || 0) : 4;
    const ends = timeLeft(seasonEnd);
    const ended = ends === "Ended";
    const tile = (reward: ContractReward | undefined, id: string, label: string, unlocked: boolean) => {
        const item = resolveReward(reward, rewardAssets, currencies);
        return <button key={id} type="button" className={s.bpTile} data-selected={key === id} data-unlocked={unlocked} data-kind={item.type.toLowerCase().replace(/\s+/g, "-")} onClick={() => setSelected(id)} aria-pressed={key === id} title={item.name}>
            <span>{item.image ? <img src={item.image} alt="" /> : <b>{item.type.slice(0, 2).toUpperCase()}</b>}{item.amount > 1 ? <em>×{item.amount}</em> : null}{unlocked ? <i aria-label="Unlocked">✓</i> : null}</span>
            <small>{label}</small>
        </button>;
    };

    return <div className={s.bpStage} onWheel={onWheel}>
        <header className={s.bpTop}>
            <div className={s.bpAct}><h3>{title || definition.displayName || "Current act"}</h3>{ends ? <p>{ended ? `Ended ${new Date(seasonEnd || 0).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : <>Ends in <b>{ends}</b></>}</p> : null}<small>{totalXP.toLocaleString()} XP earned · Tier {Math.min(reached, levels.length)} of {levels.length}</small></div>
            {onOpenMissions ? <div className={s.bpSide}>
                {checkpoint ? <button type="button" onClick={onOpenMissions}><small>Daily checkpoint</small><b>{checkpoint}</b><em>{checkpointProgress}/4</em></button> : null}
                <button type="button" onClick={onOpenMissions}><small>Weekly missions</small><b>{weeklyLeft}</b><em>left</em></button>
            </div> : null}
        </header>
        <div className={s.bpHero} data-kind={shown.type.toLowerCase().replace(/\s+/g, "-")}>
            {shown.type === "Title" ? <PlayerCardPreview key={shown.name} art={rewardAssets[identityCard?.cardId.toLowerCase() || ""]?.hero} name={playerName} title={shown.name} level={accountLevel} highlight="title" />
                : shown.type === "Player Card" ? <PlayerCardPreview key={shown.hero} art={shown.hero} name={playerName} title={identityCard?.titleText || ""} level={accountLevel} highlight="card" />
                : shown.hero ? <img key={shown.hero} src={shown.hero} alt="" /> : null}
        </div>
        <div className={s.bpName}><h4>{shownName}</h4><small>{shown.type}{selectedLevel ? ` · Tier ${selectedLevel.tier}` : " · Free reward"} · <b data-unlocked={shownUnlocked}>{shown.owned ? "Owned" : shownUnlocked ? "Unlocked" : "Locked"}</b></small></div>
        <div className={s.bpBottom}>
            <div className={s.bpStrip}>
                <div><span>{chapter.isEpilogue ? "Epilogue" : trackLabel}</span><div>{chapter.levels.map((level) => tile(level.reward, `t${level.tier}`, `Tier ${level.tier}`, level.tier <= reached))}</div></div>
                {chapter.free.length ? <><i aria-hidden="true">+</i><div><span>Free</span><div>{chapter.free.map((reward, index) => tile(reward, `f${chapterIndex}-${index}`, "Free", lastTier <= reached))}</div></div></> : null}
            </div>
            <div className={s.bpStatus}>{complete ? <><b>Completed</b><small>All {levels.length} tiers unlocked</small></> : ended ? <><b>Event ended</b><small>You reached tier {reached} of {levels.length}</small></> : <><small>Tier {reached + 1}{nextReward ? ` · next: ${nextReward.name}` : ""}</small><b>{toward.toLocaleString()} <u>/ {(nextLevel?.cost || 0).toLocaleString()} XP</u></b><i><em style={{ width: `${nextLevel?.cost ? Math.min(100, toward / nextLevel.cost * 100) : 0}%` }} /></i><small>{Math.max(0, (nextLevel?.cost || 0) - toward).toLocaleString()} XP to go</small></>}</div>
        </div>
        {chapters.length > 1 ? <nav className={s.bpStepper} aria-label="Chapters">
            <button type="button" onClick={() => pickChapter(chapterIndex - 1)} disabled={chapterIndex === 0} aria-label="Previous chapter">‹</button>
            <div>{chapters.map((item, index) => {
                const done = (item.levels.at(-1)?.tier || 0) <= reached;
                return <button type="button" key={index} onClick={() => pickChapter(index)} data-current={index === chapterIndex} data-done={done} data-epilogue={item.isEpilogue} aria-label={item.isEpilogue ? "Epilogue" : `Chapter ${index + 1}`} aria-current={index === chapterIndex ? "step" : undefined}>{item.isEpilogue ? <span>{done ? "✓" : "E"}</span> : index === chapterIndex ? <span>{index + 1}</span> : null}</button>;
            })}</div>
            <button type="button" onClick={() => pickChapter(chapterIndex + 1)} disabled={chapterIndex === chapters.length - 1} aria-label="Next chapter">›</button>
        </nav> : null}
    </div>;
}

type ContractEntry = {
    id: string; kind: "gear" | "event"; name: string; status: "live" | "completed" | "progressed" | "expired" | "locked"; cover: string;
    upgrade?: ItemUpgradeDefinition; contract?: ContractMeta; progress?: RiotContractProgress; event?: EventMeta; agent?: RewardAsset;
};

function ContractsBrowser({ scope, contracts, progress, upgrades, events, rewardAssets, currencies, agentVisuals }: { scope: ContractEntry["kind"]; contracts: ContractMeta[]; progress: RiotContractProgress[]; upgrades: ItemUpgradeDefinition[]; events: EventMeta[]; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta>; agentVisuals: Record<string, string> }) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<"all" | ContractEntry["status"]>("all");
    const [selectedId, setSelectedId] = useState("");
    const [showExpired, setShowExpired] = useState(false);
    const progressById = useMemo(() => Object.fromEntries(progress.map((item) => [item.ContractDefinitionID.toLowerCase(), item])), [progress]);
    const eventById = useMemo(() => Object.fromEntries(events.map((item) => [item.uuid.toLowerCase(), item])), [events]);
    const entries = useMemo<ContractEntry[]>(() => {
        const now = Date.now();
        const gear = contracts.filter((contract) => contract.content?.relationType?.toLowerCase() === "agent").flatMap((contract) => {
            const agentID = contract.content?.relationUuid?.toLowerCase() || "";
            const agent = rewardAssets[agentID];
            if (!agent) return [];
            const rewards = contract.content?.chapters?.flatMap((chapter) => chapter.levels || []) || [];
            const owned = rewards.filter((level) => level.reward?.uuid && rewardAssets[level.reward.uuid.toLowerCase()]?.owned).length;
            const status: ContractEntry["status"] = owned >= rewards.length && rewards.length ? "completed" : owned ? "progressed" : !agent.owned ? "locked" : "live";
            const upgrade = upgrades.find((item) => item.ID.toLowerCase() === contract.uuid.toLowerCase() || item.Item.ItemID.toLowerCase() === contract.uuid.toLowerCase() || item.RequiredEntitlement.ItemID.toLowerCase() === agentID);
            return [{ id: contract.uuid, kind: "gear" as const, name: contract.displayName || `${agent.name} Gear`, status, cover: agentVisuals[agentID] || agent.image, upgrade, contract, agent }];
        });
        const passes = contracts.filter((contract) => contract.content?.relationType?.toLowerCase() === "event").map((contract) => {
            const event = contract.content?.relationUuid ? eventById[contract.content.relationUuid.toLowerCase()] : undefined;
            const accountProgress = progressById[contract.uuid.toLowerCase()];
            const levels = contract.content?.chapters?.flatMap((chapter) => chapter.levels || []) || [];
            const reached = accountProgress?.ProgressionLevelReached || 0;
            const status: ContractEntry["status"] = event && new Date(event.endTime).getTime() <= now ? "expired" : event && new Date(event.startTime).getTime() <= now ? "live" : reached >= levels.length && levels.length ? "completed" : reached ? "progressed" : "locked";
            const firstArt = levels.map((level) => level.reward?.uuid ? rewardAssets[level.reward.uuid.toLowerCase()]?.image : "").find(Boolean) || "";
            return { id: contract.uuid, kind: "event" as const, name: event?.shortDisplayName || contract.displayName || "Event Pass", status, cover: contract.displayIcon || firstArt, contract, progress: accountProgress, event };
        });
        const statusOrder: Record<ContractEntry["status"], number> = { live: 0, progressed: 1, locked: 2, completed: 3, expired: 4 };
        return [...gear, ...passes].sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name));
    }, [agentVisuals, contracts, eventById, progressById, rewardAssets, upgrades]);
    const scopedEntries = entries.filter((entry) => entry.kind === scope);
    const expiredCount = scopedEntries.filter((entry) => entry.status === "expired").length;
    const visible = scopedEntries.filter((entry) => (filter === "expired" || showExpired || entry.status !== "expired") && (filter === "all" || filter === entry.status) && entry.name.toLowerCase().includes(query.trim().toLowerCase()));
    const selected = visible.find((entry) => entry.id === selectedId) || visible[0];
    const filters: ReadonlyArray<readonly [typeof filter, string]> = scope === "gear"
        ? [["all", "All"], ["live", "Available"], ["progressed", "In Progress"], ["completed", "Completed"], ["locked", "Locked"]]
        : [["all", "All"], ["live", "Live"], ["progressed", "In Progress"], ["completed", "Completed"], ["expired", "Archive"], ["locked", "Locked"]];
    const noun = scope === "gear" ? "agent contract" : "custom contract";
    return <div className={s.contractBrowser}><aside><div className={s.contractTools}><label><span>Find {noun}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${scope === "gear" ? "agents" : "events"}`} /></label><div>{filters.map(([value, label]) => <button type="button" key={value} data-active={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div><div className={s.contractLibrary}>{visible.map((entry) => <button key={entry.id} data-status={entry.status} data-selected={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)}><i style={entry.cover ? { backgroundImage: `url(${entry.cover})` } : undefined} /><span><strong>{entry.name}</strong><small>{entry.kind === "gear" ? "Agent Contract" : "Custom Contract"} · {entry.status}</small></span></button>)}{expiredCount && filter !== "expired" ? <button className={s.expiredToggle} onClick={() => setShowExpired((value) => !value)}><span><strong>{showExpired ? "Hide archived contracts" : `Show ${expiredCount} archived contracts`}</strong><small>Archived contracts are displayed in gray</small></span></button> : null}</div></aside><main>{selected ? selected.kind === "gear" ? <GearDetail entry={selected} rewardAssets={rewardAssets} currencies={currencies} /> : <EventDetail entry={selected} rewardAssets={rewardAssets} currencies={currencies} /> : <Empty text={`No ${noun}s match this filter.`} />}</main></div>;
}

function CustomContracts({ contracts, progress, events, rewardAssets, currencies, identityCard, accountLevel }: { contracts: ContractMeta[]; progress: RiotContractProgress[]; events: EventMeta[]; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta>; identityCard?: IdentityCard; accountLevel?: number }) {
    const [selectedId, setSelectedId] = useState("");
    const [showArchive, setShowArchive] = useState(false);
    const entries = useMemo(() => {
        const now = Date.now();
        const progressById = new Map(progress.map((item) => [item.ContractDefinitionID.toLowerCase(), item]));
        const eventById = new Map(events.map((item) => [item.uuid.toLowerCase(), item]));
        return contracts.filter((contract) => contract.content?.relationType?.toLowerCase() === "event").map((contract) => {
            const event = eventById.get(contract.content?.relationUuid?.toLowerCase() || "");
            const levels = contract.content?.chapters?.flatMap((chapter) => chapter.levels || []) || [];
            const firstArt = levels.map((level) => level.reward?.uuid ? rewardAssets[level.reward.uuid.toLowerCase()]?.image : "").find(Boolean) || "";
            const end = event ? new Date(event.endTime).getTime() : NaN;
            return { contract, event, progress: progressById.get(contract.uuid.toLowerCase()), tiers: levels.length, name: event?.shortDisplayName || event?.displayName || contract.displayName || "Event pass", cover: contract.displayIcon || firstArt, expired: Number.isFinite(end) && end <= now, end };
        }).filter((entry) => entry.tiers > 0).sort((a, b) => Number(a.expired) - Number(b.expired) || (a.expired ? b.end - a.end : a.end - b.end));
    }, [contracts, events, progress, rewardAssets]);
    const live = entries.filter((entry) => !entry.expired);
    const archive = entries.filter((entry) => entry.expired);
    const listed = showArchive || !live.length ? entries : live;
    const selected = entries.find((entry) => entry.contract.uuid === selectedId) || listed[0];
    if (!entries.length) return <Empty text="No custom contracts are available." />;
    return <div className={s.evPage}>
        <nav className={s.evPicker} aria-label="Custom contracts">
            {listed.map((entry) => {
                const reached = entry.progress?.ProgressionLevelReached || 0;
                const ends = timeLeft(entry.event?.endTime);
                return <button key={entry.contract.uuid} type="button" data-selected={selected?.contract.uuid === entry.contract.uuid} data-expired={entry.expired} onClick={() => setSelectedId(entry.contract.uuid)}>
                    <i style={entry.cover ? { backgroundImage: `url(${entry.cover})` } : undefined} />
                    <span><strong>{entry.name}</strong><small>{entry.expired ? `Ended · tier ${reached}/${entry.tiers}` : ends ? `Ends in ${ends} · tier ${reached}/${entry.tiers}` : `Tier ${reached}/${entry.tiers}`}</small></span>
                </button>;
            })}
            {archive.length && live.length ? <button type="button" className={s.evArchive} onClick={() => setShowArchive((value) => !value)}>{showArchive ? "Hide past events" : `Past events · ${archive.length}`}</button> : null}
        </nav>
        {selected ? <BattlePassView key={selected.contract.uuid} definition={selected.contract} progress={selected.progress} rewardAssets={rewardAssets} currencies={currencies} seasonEnd={selected.event?.endTime} title={selected.name} trackLabel="Rewards" identityCard={identityCard} accountLevel={accountLevel} /> : null}
    </div>;
}

function GearDetail({ entry, rewardAssets, currencies }: { entry: ContractEntry; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta> }) {
    const contractLevels = entry.contract?.content?.chapters?.flatMap((chapter) => chapter.levels || []) || [];
    const upgradeLevels = entry.upgrade?.RewardSchedule.RewardsPerLevel || [];
    const levels = contractLevels.length ? contractLevels.map((level) => ({ reward: level.reward, cost: level.doughCost })) : upgradeLevels.map((level, index) => { const reward = level.EntitlementRewards[0]; return { reward: reward ? { uuid: reward.ItemID, amount: reward.Amount } : undefined, cost: entry.upgrade?.ProgressionSchedule.ProgressionDeltaPerLevel?.[index] }; });
    const currency = currencies[(entry.upgrade?.ProgressionSchedule.ProgressionCurrencyID || "85ca954a-41f2-ce94-9b45-8ca3dd39a00d").toLowerCase()];
    const costs = levels.map((level) => level.cost || 0);
    const ownedCount = levels.filter((level) => level.reward?.uuid && rewardAssets[level.reward.uuid.toLowerCase()]?.owned).length;
    const remaining = costs.slice(ownedCount).reduce((sum, cost) => sum + cost, 0);
    return <div className={s.contractDetail}><header style={entry.cover ? { backgroundImage: `linear-gradient(90deg,rgba(10,16,23,.96),rgba(10,16,23,.56)),url(${entry.cover})` } : undefined}><span>AGENT GEAR</span><h3>{entry.name}</h3><p>{entry.agent?.owned ? "Agent owned · gear tiers unlock in order" : "Requires owning the associated agent"}</p><div><b>{ownedCount}/{levels.length} owned</b>{currency ? <b>{remaining.toLocaleString()} {currency.displayName} remaining</b> : null}</div></header><section className={s.contractRewardList}>{levels.map((level, index) => { const owned = Boolean(level.reward?.uuid && rewardAssets[level.reward.uuid.toLowerCase()]?.owned); return <article key={index} data-state={owned ? "complete" : index === ownedCount ? "current" : "locked"}><span>GEAR {index + 1}</span><RewardVisual reward={level.reward} assets={rewardAssets} currencies={currencies} /><div><strong>{owned ? "Owned" : costs[index] && currency ? `${costs[index].toLocaleString()} ${currency.displayNameSingular || currency.displayName}` : costs[index] === 0 ? "No KC cost" : "Cost unavailable"}</strong><small>{owned ? "Unlocked" : index > ownedCount ? "Unlock previous tier first" : "Next available tier"}</small></div></article>; })}</section></div>;
}

function EventDetail({ entry, rewardAssets, currencies }: { entry: ContractEntry; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta> }) {
    const levels = entry.contract?.content?.chapters?.flatMap((chapter) => chapter.levels || []) || [];
    const reached = entry.progress?.ProgressionLevelReached || 0;
    return <div className={s.contractDetail}><header style={entry.cover ? { backgroundImage: `linear-gradient(90deg,rgba(10,16,23,.96),rgba(10,16,23,.56)),url(${entry.cover})` } : undefined}><span>{entry.status === "live" ? "LIVE EVENT" : "EVENT ARCHIVE"}</span><h3>{entry.name}</h3><p>{entry.event ? `${new Date(entry.event.startTime).toLocaleDateString()} – ${new Date(entry.event.endTime).toLocaleDateString()}` : "Event dates unavailable"}</p><div><b>{reached}/{levels.length} tiers</b><b>{numberFrom(entry.progress?.ContractProgression, "TotalProgressionEarned").toLocaleString()} XP</b></div></header><section className={s.contractRewardList}>{levels.map((level, index) => <article key={index} data-state={index < reached ? "complete" : index === reached ? "current" : "locked"}><span>TIER {index + 1}</span><RewardVisual reward={level.reward} assets={rewardAssets} currencies={currencies} /><div><strong>{index < reached ? "Completed" : `${(level.xp || 0).toLocaleString()} XP`}</strong><small>{index === reached ? `${entry.progress?.ProgressionTowardsNextLevel || 0} XP earned` : index < reached ? "Unlocked" : "Upcoming"}</small></div></article>)}</section></div>;
}

function xpSourceLabel(id: string) {
    return ({ "time-played": "Time played", "match-win": "Match win", "first-win-of-the-day": "First win" } as Record<string, string>)[id] || id.replace(/-/g, " ");
}

function rewardLabel(type?: string) {
    const value = (type || "Reward").replace(/^E?Ares/, "").replace(/Item$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    return value || "Reward";
}


function Empty({ text }: { text: string }) { return <div className={s.extrasEmpty}>{text}</div>; }
