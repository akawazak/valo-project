"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    fetchCachedPublicJson,
    getAccountXP,
    getDailyTicket,
    getItemUpgrades,
    getMissions,
    getProfileLeaderboard,
    type ProfileLeaderboard,
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
import s from "./ProfilePanel.module.css";

export type CareerView = "analytics" | "progression" | "leaderboard";
const PAGE_SIZE = 25;

interface ContractReward { type?: string; uuid?: string; amount?: number }
interface ContractMeta { uuid: string; displayName?: string; displayIcon?: string; content?: { relationType?: string; relationUuid?: string; chapters?: Array<{ isEpilogue?: boolean; levels?: Array<{ xp?: number; doughCost?: number; vpCost?: number; reward?: ContractReward }>; freeRewards?: ContractReward[] | null }> } }
interface MissionMeta { uuid: string; displayName?: string; title?: string; type?: string; xpGrant?: number; progressToComplete?: number; activationDate?: string; expirationDate?: string; objectives?: Array<{ objectiveUuid: string; objectiveId: string; value: number; description: string }> }
interface CurrencyMeta { uuid: string; displayName: string; displayNameSingular?: string; displayIcon?: string; rewardPreviewIcon?: string }
interface EventMeta { uuid: string; displayName: string; shortDisplayName?: string; startTime: string; endTime: string }
interface Props {
    view: CareerView | null; onClose: () => void; puuid: string; region: string; seasonId?: string; isOwnProfile: boolean;
    matches: ProfileMatchSummary[]; rr: ProfileRRSnapshot[]; agentNames: Record<string, string>; mapNames: Record<string, string>;
    agentVisuals: Record<string, string>; mapVisuals: Record<string, string>;
    playerCardImages: Record<string, string>; rewardAssets: Record<string, RewardAsset>; onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    rankActs: ProfileRankActSummary[]; seasonNames: Record<string, string>;
}
interface RewardAsset { name: string; image: string; type: string; owned: boolean }

const VIEW_COPY: Record<CareerView, { eyebrow: string; title: string; detail: string }> = {
    analytics: { eyebrow: "MATCH REVIEW", title: "Career insights", detail: "Recent form from your locally synced matches." },
    progression: { eyebrow: "PROGRESSION", title: "XP center", detail: "Account level, XP sources, missions, contracts and Battle Pass." },
    leaderboard: { eyebrow: "COMPETITIVE", title: "Regional leaderboard", detail: "Current act standings for your region." },
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const labelKey = (value: string, labels: Record<string, string>, fallback: string) => labels[value?.toLowerCase()] || fallback;
const numberFrom = (value: unknown, key: string) => typeof value === "object" && value && typeof (value as Record<string, unknown>)[key] === "number" ? (value as Record<string, number>)[key] : 0;

export default function ProfileExtras({ view, onClose, puuid, region, seasonId, isOwnProfile, matches, rr, rankActs, seasonNames, agentNames, mapNames, agentVisuals, mapVisuals, playerCardImages, rewardAssets, onViewProfile }: Props) {
    const [missions, setMissions] = useState<RiotMissionsResponse | null>(null);
    const [accountXP, setAccountXP] = useState<AccountXPResponse | null>(null);
    const [dailyTicket, setDailyTicket] = useState<DailyTicketResponse | null>(null);
    const [dailyTicketError, setDailyTicketError] = useState("");
    const [contractMeta, setContractMeta] = useState<ContractMeta[]>([]);
    const [missionMeta, setMissionMeta] = useState<MissionMeta[]>([]);
    const [currencies, setCurrencies] = useState<CurrencyMeta[]>([]);
    const [events, setEvents] = useState<EventMeta[]>([]);
    const [progressionLoaded, setProgressionLoaded] = useState(false);
    const [progressionUpdatedAt, setProgressionUpdatedAt] = useState<number | null>(null);
    const [itemUpgrades, setItemUpgrades] = useState<ItemUpgradeDefinition[]>([]);
    const [leaderboard, setLeaderboard] = useState<ProfileLeaderboard | null>(null);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState("");
    const [error, setError] = useState("");

    useEffect(() => { setMissions(null); setAccountXP(null); setDailyTicket(null); setDailyTicketError(""); setProgressionLoaded(false); setProgressionUpdatedAt(null); }, [puuid]);
    useEffect(() => { setLeaderboard(null); setQuery(""); }, [region, seasonId]);
    useEffect(() => {
        if (!view) return;
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
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
        ]).then(([progress, account, daily, contracts, missionDefinitions, currencyDefinitions, eventDefinitions, upgrades]) => {
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
        const start = reset ? 0 : (leaderboard?.Players?.length || 0);
        setLoading("leaderboard"); setError("");
        try {
            const page = await getProfileLeaderboard(seasonId, search, start, PAGE_SIZE);
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
    return createPortal(<div className={s.careerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section className={`${s.careerDialog} ${s.careerDialogSingle}`} role="dialog" aria-modal="true" aria-label={copy.title}>
            <header className={s.careerHeader}><div><span>{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.detail}</p></div><button onClick={onClose} aria-label={`Close ${copy.title}`}>×</button></header>
            <div className={s.careerBody}>
                {error ? <div className={s.extrasError}>{error}</div> : null}
                {view === "analytics" ? <Analytics data={analytics} rrCount={rr.length} rankActs={rankActs} seasonNames={seasonNames} agentNames={agentNames} mapNames={mapNames} agentVisuals={agentVisuals} mapVisuals={mapVisuals} /> : null}
                {view === "progression" ? <Progression data={missions} accountXP={accountXP} dailyTicket={dailyTicket} dailyTicketError={dailyTicketError} contracts={contractMeta} missionMeta={missionMeta} currencies={currencies} events={events} itemUpgrades={itemUpgrades} seasonId={seasonId} rewardAssets={rewardAssets} agentVisuals={agentVisuals} loading={loading === "progression"} isOwn={isOwnProfile} updatedAt={progressionUpdatedAt} onRefresh={refreshProgression} /> : null}
                {view === "leaderboard" ? <Leaderboard data={leaderboard} loading={loading === "leaderboard"} query={query} setQuery={setQuery} load={loadLeaderboard} cards={playerCardImages} close={onClose} openProfile={onViewProfile} /> : null}
            </div>
        </section>
    </div>, document.body);
}

function Analytics({ data, rrCount, rankActs, seasonNames, agentNames, mapNames, agentVisuals, mapVisuals }: { data: { net: number; avgGain: number; avgLoss: number; recentWins: number; recentGames: number; soloWR: number | null; stackWR: number | null; soloGames: number; stackGames: number; bestAgent?: { id: string; games: number; wins: number }; bestMap?: { id: string; games: number; wins: number } }; rrCount: number; rankActs: ProfileRankActSummary[]; seasonNames: Record<string, string>; agentNames: Record<string, string>; mapNames: Record<string, string>; agentVisuals: Record<string, string>; mapVisuals: Record<string, string> }) {
    const agentImage = data.bestAgent ? agentVisuals[data.bestAgent.id.toLowerCase()] : "";
    const mapImage = data.bestMap ? mapVisuals[data.bestMap.id.toLowerCase()] : "";
    return <div className={s.analyticsVisual}>
        <section className={s.analyticsScore}><div><span>LAST {data.recentGames} MATCHES</span><strong>{data.recentWins}<i>W</i><em>{data.recentGames - data.recentWins}<i>L</i></em></strong><small>{data.stackWR == null ? "No party sample" : `${data.stackWR}% with a party`} · {data.soloWR == null ? "No solo sample" : `${data.soloWR}% solo`}</small></div><div><span>RANKED MOVEMENT</span><strong>{signed(data.net)} <i>RR</i></strong><small>{rrCount ? `${signed(data.avgGain)} average win · ${signed(data.avgLoss)} average loss` : "Sync ranked matches to populate RR"}</small></div></section>
        <section className={s.analyticsFeature} style={mapImage ? { backgroundImage: `linear-gradient(90deg,rgba(8,13,20,.12),rgba(8,13,20,.9)),url(${mapImage})` } : undefined}><div><span>STRONG RECENT MAP</span><strong>{data.bestMap ? labelKey(data.bestMap.id, mapNames, "Map") : "More matches needed"}</strong><small>{data.bestMap ? `${data.bestMap.wins} wins across ${data.bestMap.games} games` : "Play a map at least twice"}</small></div></section>
        <section className={s.analyticsAgent}><div className={s.analyticsAgentArt} style={agentImage ? { backgroundImage: `url(${agentImage})` } : undefined} /><div><span>STRONG RECENT AGENT</span><strong>{data.bestAgent ? labelKey(data.bestAgent.id, agentNames, "Agent") : "More matches needed"}</strong><small>{data.bestAgent ? `${data.bestAgent.wins} wins across ${data.bestAgent.games} games` : "Play an agent at least twice"}</small></div></section>
        {rankActs.length ? <section className={s.actArchive}><header><div><span>COMPETITIVE ARCHIVE</span><strong>Your acts at a glance</strong></div><small>{rankActs.length} cached acts</small></header><div>{rankActs.slice(0, 8).map((act) => <article key={act.seasonId}><span>{seasonNames[act.seasonId.toLowerCase()] || `Act ${act.seasonId.slice(0, 6)}`}</span><strong>{act.games ? `${Math.round(act.wins / act.games * 100)}% WR` : "No games"}</strong><small>{act.wins}W · {act.games - act.wins}L</small><b>{act.rankedRating} RR</b></article>)}</div></section> : null}
    </div>;
}

function Progression({ data, accountXP, dailyTicket, dailyTicketError, contracts, missionMeta, currencies, events, itemUpgrades, seasonId, rewardAssets, agentVisuals, loading, isOwn, updatedAt, onRefresh }: { data: RiotMissionsResponse | null; accountXP: AccountXPResponse | null; dailyTicket: DailyTicketResponse | null; dailyTicketError: string; contracts: ContractMeta[]; missionMeta: MissionMeta[]; currencies: CurrencyMeta[]; events: EventMeta[]; itemUpgrades: ItemUpgradeDefinition[]; seasonId?: string; rewardAssets: Record<string, RewardAsset>; agentVisuals: Record<string, string>; loading: boolean; isOwn: boolean; updatedAt: number | null; onRefresh: () => void }) {
    const [section, setSection] = useState<"missions" | "battlepass" | "agent-contracts" | "custom-contracts" | "account">("missions");
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
        if (section !== "battlepass") return;
        const frame = requestAnimationFrame(() => document.getElementById("battlepass-current-tier")?.scrollIntoView({ block: "center" }));
        return () => cancelAnimationFrame(frame);
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
    if (loading && !data) return <Empty text="Loading current missions and contracts…" />;
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
    const dailyReset = dailyTicket ? new Date((updatedAt || now) + dailyTicket.RemainingLifetimeSeconds * 1000) : null;
    const activeMissions = (data.Missions || []).filter((mission) => !mission.Complete);
    const completedMissions = (data.Missions || []).filter((mission) => mission.Complete);
    const weeklyCheckpoint = data.MissionMetadata?.WeeklyCheckpoint ? new Date(data.MissionMetadata.WeeklyCheckpoint).getTime() : 0;
    const completedWeeklyDefinitions = weeklyCheckpoint ? missionMeta.filter((mission) => mission.type?.toLowerCase().includes("weekly") && mission.activationDate && Math.abs(new Date(mission.activationDate).getTime() - weeklyCheckpoint) < 12 * 60 * 60 * 1000) : [];
    const liveMissionIDs = new Set((data.Missions || []).map((mission) => mission.ID.toLowerCase()));
    const releasedAfterCheckpoint = missionMeta.filter((mission) => mission.type?.toLowerCase().includes("weekly") && mission.activationDate && new Date(mission.activationDate).getTime() > weeklyCheckpoint + 12 * 60 * 60 * 1000 && !liveMissionIDs.has(mission.uuid.toLowerCase()));
    const queuedWeeklies = releasedAfterCheckpoint.filter((mission) => new Date(mission.activationDate || 0).getTime() <= now);
    const futureWeeklies = releasedAfterCheckpoint.filter((mission) => new Date(mission.activationDate || 0).getTime() > now);
    const modes = [
        { id: "missions", label: "Missions", detail: "Daily and weekly progress", icon: "missions" },
        { id: "battlepass", label: "Battle Pass", detail: "Chapters and rewards", icon: "battlepass" },
        { id: "agent-contracts", label: "Agent Contracts", detail: "Agent gear and rewards", icon: "agents" },
        { id: "custom-contracts", label: "Custom Contracts", detail: "Event passes and archives", icon: "events" },
        { id: "account", label: "Account Level", detail: "AP and first-win history", icon: "account" },
    ] as const;
    const currentMode = modes.find(({ id }) => id === section)!;
    const selectSection = (id: typeof section) => {
        if (id !== section) return setSection(id);
        if (id === "battlepass") {
            document.getElementById("battlepass-current-tier")?.scrollIntoView({ block: "center", behavior: "smooth" });
        } else {
            canvasRef.current?.scrollTo({ top: 0, behavior: "smooth" });
        }
    };
    return <div className={s.progressionWorkspace}>
        <aside className={s.progressionRail}>
            <nav aria-label="Progression sections">{modes.map(({ id, label, detail, icon }, index) => <button key={id} data-active={section === id} aria-current={section === id ? "page" : undefined} onClick={() => selectSection(id)}><i><ProgressionIcon kind={icon} /></i><span><strong>{label}</strong><small>{detail}</small></span><em>{String(index + 1).padStart(2, "0")}</em></button>)}</nav>
        </aside>
        <main ref={canvasRef} className={s.progressionCanvas}>
        <header className={s.progressionModeHeader}><div className={s.progressionModeIdentity}><i><ProgressionIcon kind={currentMode.icon} /></i><div><span>{currentMode.label}</span><p>{currentMode.detail}</p></div></div><div className={s.progressionModeMeta}><b>{String(modes.findIndex(({ id }) => id === section) + 1).padStart(2, "0")} <span>/ {String(modes.length).padStart(2, "0")}</span></b><small>{updatedAt ? `Last synced ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Not synced yet"}</small></div></header>
        {section === "account" ? <AccountXPView accountXP={accountXP} battlePassXP={totalXP} recent={recentXP} contractMatches={contractMatches} nextFirstWin={nextFirstWin} missionMeta={missionMeta} contracts={contracts} /> : null}
        {section === "missions" ? <div className={s.missionsPage}>
            <div className={`${s.dailyFetchStatus} ${dailyTicket ? s.dailyFetchLive : dailyTicketError ? s.dailyFetchFailed : ""}`}><div><span>{dailyTicket ? "Daily checkpoints connected" : dailyTicketError ? "Daily checkpoints request failed" : "Connecting daily checkpoints"}</span><small>{dailyTicket ? `${dailyTicket.Milestones?.length || 0} milestones returned by Riot` : dailyTicketError || "Waiting for Riot response"}</small></div><button onClick={onRefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
            <section className={s.dailyPanel}><header><div><span>DAILY ACTIVITIES</span><strong>First Win of the Day</strong></div><b>+1,000 XP</b></header><div className={s.firstWinState}><i /> <span>{nextFirstWin && nextFirstWin > new Date() ? "Claimed today" : "Available"}</span>{dailyReset ? <CountdownTimer target={dailyReset} label="RESET IN" className={s.dailyCountdown} onExpire={refreshExpiredProgress} /> : nextFirstWin && nextFirstWin > new Date() ? <CountdownTimer target={nextFirstWin} label="AVAILABLE IN" className={s.dailyCountdown} onExpire={refreshExpiredProgress} /> : <small>Win one match to claim</small>}</div><div className={s.checkpointHead}><strong>CHECKPOINTS</strong><span>+1,000 XP + 150 KC per checkpoint</span></div><div className={s.dailyCheckpoints}>{[0, 1, 2, 3].map((index) => { const milestone = dailyTicket?.Milestones?.[index]; const progress = Math.max(0, Math.min(4, milestone?.Progress || 0)); return <div key={index} data-charges={progress} className={progress >= 4 ? s.dailyCheckpointDone : progress > 0 ? s.dailyCheckpointActive : ""}><i><b>{index + 1}</b></i><small>{dailyTicket ? `${progress}/4 charges${milestone?.BonusApplied ? " · bonus" : ""}` : "Unavailable"}</small></div>; })}</div></section>
            <section className={s.weeklyPanel}><header><strong>WEEKLY MISSIONS</strong>{data.MissionMetadata?.WeeklyRefillTime ? <CountdownTimer target={data.MissionMetadata.WeeklyRefillTime} label="REFILL IN" className={s.weeklyCountdown} onExpire={refreshExpiredProgress} /> : <span>Refill unavailable</span>}</header>{(data.Missions || []).length ? <div className={s.missionBoard}><div>{data.Missions.map((mission) => { const meta = missionDefinitions[mission.ID.toLowerCase()]; const objectives = meta?.objectives || []; return <article key={mission.ID} className={mission.Complete ? s.missionComplete : ""}><div><span>{(meta?.type || "MISSION").replace(/_/g, " ")}</span><strong>{meta?.displayName || "Active mission"}</strong>{mission.Complete ? <small>Complete</small> : <small>In progress</small>}</div><b>{meta?.xpGrant ? `+${meta.xpGrant.toLocaleString()} XP` : "XP REWARD"}</b>{objectives.map((objective) => { const current = mission.Objectives?.[objective.objectiveId] || 0; const pct = Math.min(100, current / Math.max(1, objective.value) * 100); return <div className={s.missionObjective} key={objective.objectiveId}><span>{objective.description}</span><strong>{current.toLocaleString()} / {objective.value.toLocaleString()}</strong><i><b style={{ width: `${pct}%` }} /></i></div>; })}</article>; })}</div></div> : <div className={s.weeklyEmpty}><i>◇</i><span>No active weekly missions.</span></div>}</section>
            {completedWeeklyDefinitions.length ? <section className={s.completedMissions}><header><strong>LAST COMPLETED WEEKLY SET</strong><span>{new Date(data.MissionMetadata.WeeklyCheckpoint).toLocaleDateString()}</span></header><div>{completedWeeklyDefinitions.map((mission) => <article key={mission.uuid}><i>✓</i><div><strong>{mission.displayName || mission.title || "Weekly mission"}</strong><small>WEEKLY · +{(mission.xpGrant || 0).toLocaleString()} XP</small></div></article>)}</div></section> : null}
            {completedMissions.length ? <section className={s.completedMissions}><header><strong>COMPLETED MISSIONS RETURNED LIVE</strong><span>{completedMissions.length} records</span></header><div>{completedMissions.map((mission) => { const meta = missionDefinitions[mission.ID.toLowerCase()]; return <article key={mission.ID}><i>✓</i><div><strong>{meta?.displayName || "Completed mission"}</strong><small>{meta?.type?.replace(/_/g, " ") || "MISSION"}{meta?.xpGrant ? ` · +${meta.xpGrant.toLocaleString()} XP` : ""}</small></div></article>; })}</div></section> : null}
            {queuedWeeklies.length ? <MissionSchedule title="QUEUED WEEKLIES" detail="Released sets waiting behind your current missions" missions={queuedWeeklies} /> : null}
            {futureWeeklies.length ? <MissionSchedule title="FUTURE WEEKLIES" detail="Upcoming sets published by Riot" missions={futureWeeklies} groupByDate /> : null}
            {!completedMissions.length && !completedWeeklyDefinitions.length ? <div className={s.completedNone}>Riot returned {activeMissions.length} active missions and no completed weekly checkpoint to reconstruct.</div> : null}
        </div> : null}
        {section === "battlepass" ? <BattlePassView definition={definition} progress={active} rewardAssets={rewardAssets} currencies={currencyById} /> : null}
        {section === "agent-contracts" ? <ContractsBrowser key="agent-contracts" scope="gear" contracts={contracts} progress={data.Contracts || []} upgrades={itemUpgrades} events={events} rewardAssets={rewardAssets} currencies={currencyById} agentVisuals={agentVisuals} /> : null}
        {section === "custom-contracts" ? <ContractsBrowser key="custom-contracts" scope="event" contracts={contracts} progress={data.Contracts || []} upgrades={itemUpgrades} events={events} rewardAssets={rewardAssets} currencies={currencyById} agentVisuals={agentVisuals} /> : null}
        </main>
    </div>;
}

function CountdownTimer({ target, label, className = "", onExpire }: { target: Date | string | number; label: string; className?: string; onExpire?: () => void }) {
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
    if (!Number.isFinite(targetTime)) return <span className={s.countdownUnavailable}>Time unavailable</span>;
    const seconds = Math.max(0, Math.ceil((targetTime - currentTime) / 1000));
    const parts = [
        { label: "DAYS", value: Math.floor(seconds / 86400) },
        { label: "HRS", value: Math.floor(seconds % 86400 / 3600) },
        { label: "MIN", value: Math.floor(seconds % 3600 / 60) },
        { label: "SEC", value: seconds % 60 },
    ];
    return <div className={`${s.detailedCountdown} ${className}`} data-slot="countdown" role="timer" aria-label={`${label.toLowerCase()} ${parts.map((part) => `${part.value} ${part.label.toLowerCase()}`).join(" ")}`}>
        <div className={s.countdownHeading} data-slot="countdown-heading"><strong>{seconds > 0 ? label : "ENDED"}</strong></div>
        <div className={s.countdownDigits} data-slot="countdown-digits">{parts.map((part) => <span data-slot="countdown-unit" key={part.label}><b>{String(part.value).padStart(2, "0")}</b><small>{part.label}</small></span>)}</div>
    </div>;
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
    const groups = groupByDate ? Object.entries(Object.groupBy(missions, (mission) => new Date(mission.activationDate || 0).toLocaleDateString())) : [["", missions] as [string, MissionMeta[]]];
    return <section className={s.missionSchedule}><header><strong>{title}</strong><span>{detail}</span></header>{groups.map(([date, items]) => <div key={date || title}>{date ? <time>{date}</time> : null}<div>{(items || []).map((mission) => <article key={mission.uuid}><div><strong>{mission.displayName || mission.title || "Weekly mission"}</strong><small>{mission.activationDate ? `Available ${new Date(mission.activationDate).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Release time unavailable"}</small></div><b>+{(mission.xpGrant || 0).toLocaleString()} XP</b></article>)}</div></div>)}</section>;
}

function resolveReward(reward: ContractReward | undefined, assets: Record<string, RewardAsset>, currencies: Record<string, CurrencyMeta>) {
    const id = reward?.uuid?.toLowerCase() || "";
    const asset = assets[id];
    const currency = currencies[id];
    return {
        name: currency?.displayNameSingular || currency?.displayName || asset?.name || rewardLabel(reward?.type),
        image: currency?.rewardPreviewIcon || currency?.displayIcon || asset?.image || "",
        type: currency ? "Currency" : asset?.type || rewardLabel(reward?.type),
        owned: asset?.owned || false,
        amount: reward?.amount || 1,
    };
}

function RewardVisual({ reward, assets, currencies }: { reward?: ContractReward; assets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta> }) {
    const resolved = resolveReward(reward, assets, currencies);
    return <div className={s.rewardVisual}>{resolved.image ? <img src={resolved.image} alt="" /> : <span>{resolved.type.slice(0, 2).toUpperCase()}</span>}<div><strong>{resolved.name}</strong><small>{resolved.type}{resolved.amount > 1 ? ` · ×${resolved.amount}` : ""}</small></div></div>;
}

function BattlePassView({ definition, progress, rewardAssets, currencies }: { definition?: ContractMeta; progress?: RiotContractProgress; rewardAssets: Record<string, RewardAsset>; currencies: Record<string, CurrencyMeta> }) {
    const chapters = definition?.content?.chapters || [];
    const totalXP = numberFrom(progress?.ContractProgression, "TotalProgressionEarned");
    const tierCosts = chapters.flatMap((chapter) => chapter.levels || []).map((level) => Math.max(0, level.xp || 0));
    const hasTierCosts = tierCosts.some((cost) => cost > 0);
    let reached = 0;
    let toward = totalXP;
    if (hasTierCosts) {
        for (const cost of tierCosts) {
			if (cost <= 0) {
				reached += 1;
				continue;
			}
            if (toward < cost) break;
            toward -= cost;
            reached += 1;
        }
    } else {
        reached = progress?.ProgressionLevelReached || 0;
        toward = progress?.ProgressionTowardsNextLevel || 0;
    }
	const currentTier = Math.min(tierCosts.length, reached < tierCosts.length ? reached + 1 : reached);
    useEffect(() => {
        const frame = requestAnimationFrame(() => document.getElementById("battlepass-current-tier")?.scrollIntoView({ block: "center" }));
        return () => cancelAnimationFrame(frame);
    }, [definition?.uuid]);
    if (!definition) return <Empty text="The current Battle Pass definition is unavailable." />;
    let tierNumber = 0;
    return <div className={s.battlePassPage}>
        <section className={s.battlePassHero} style={definition.displayIcon ? { backgroundImage: `linear-gradient(90deg,rgba(10,17,27,.96),rgba(10,17,27,.55)),url(${definition.displayIcon})` } : undefined}><div><span>CURRENT BATTLE PASS</span><h3>{definition.displayName || "Current act"}</h3><p>{totalXP.toLocaleString()} XP earned</p></div><strong><small>CURRENT TIER</small>{currentTier}</strong></section>
        <div className={s.battlePassChapters}>{chapters.map((chapter, chapterIndex) => {
            const firstTier = tierNumber + 1;
            const rows = (chapter.levels || []).map((level) => {
                tierNumber += 1;
                const number = tierNumber;
                const state = number <= reached ? "complete" : number === reached + 1 ? "current" : "upcoming";
                const cost = Math.max(0, level.xp || 0);
                const remaining = Math.max(0, cost - toward);
                const percent = cost > 0 ? Math.min(100, toward / cost * 100) : 0;
                return <article id={state === "current" ? "battlepass-current-tier" : undefined} key={number} data-state={state}><div className={s.tierMarker}><span>{number}</span><i /></div><RewardVisual reward={level.reward} assets={rewardAssets} currencies={currencies} /><div className={s.tierProgress}><strong>{state === "complete" ? "Completed" : state === "current" ? `${toward.toLocaleString()} / ${cost.toLocaleString()} XP` : `${cost.toLocaleString()} XP`}</strong><small>{state === "current" ? `${remaining.toLocaleString()} XP remaining` : state}</small>{state === "current" ? <i><b style={{ width: `${percent}%` }} /></i> : null}</div></article>;
            });
            const lastTier = tierNumber;
            return <section key={chapterIndex} className={s.battlePassChapter}><header><div><span>{chapter.isEpilogue ? "EPILOGUE" : `CHAPTER ${chapterIndex + 1}`}</span><strong>Tiers {firstTier}–{lastTier}</strong></div><small>{lastTier <= reached ? "Complete" : currentTier >= firstTier ? "In progress" : "Upcoming"}</small></header><div>{rows}</div>{(chapter.freeRewards || []).map((reward, index) => <div className={s.freeRewardRow} key={index}><span>FREE CHAPTER REWARD</span><RewardVisual reward={reward} assets={rewardAssets} currencies={currencies} /><small>{lastTier <= reached ? "Unlocked" : `Complete Tier ${lastTier}`}</small></div>)}</section>;
        })}</div>
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

function Leaderboard({ data, loading, query, setQuery, load, cards, close, openProfile }: { data: ProfileLeaderboard | null; loading: boolean; query: string; setQuery: (value: string) => void; load: (reset: boolean, search?: string) => Promise<void>; cards: Record<string, string>; close: () => void; openProfile: Props["onViewProfile"] }) {
    const players = data?.Players || []; const more = !query.trim() && players.length < (data?.totalPlayers || 0);
    return <div className={s.leaderboardClean}><form className={s.leaderboardSearch} onSubmit={(event) => { event.preventDefault(); void load(true); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Riot ID" /><button disabled={loading}>{loading ? "Loading…" : "Search"}</button></form><div className={s.leaderboardCleanHead}><span>RANK</span><span>PLAYER</span><span>RATING</span></div><div className={s.leaderboardCleanRows}>{players.map((player) => { const card = player.PlayerCardID ? cards[player.PlayerCardID.toLowerCase()] : ""; return <button key={player.puuid || player.leaderboardRank} disabled={player.IsAnonymized || !player.puuid} onClick={() => { close(); openProfile(player); }}><strong>#{player.leaderboardRank}</strong><i style={card ? { backgroundImage: `url(${card})` } : undefined} /><span><strong>{player.IsAnonymized ? "Anonymous" : player.gameName}</strong><small>{player.IsAnonymized ? "Hidden player" : `#${player.tagLine}`}</small></span><span><strong>{player.rankedRating.toLocaleString()} RR</strong><small>{player.numberOfWins} wins</small></span></button>; })}</div>{more ? <button className={s.leaderboardMore} disabled={loading} onClick={() => void load(false, "")}>{loading ? "Loading…" : `Load ${PAGE_SIZE} more`}</button> : null}{data && !players.length ? <Empty text="No leaderboard players found." /> : null}</div>;
}

function Empty({ text }: { text: string }) { return <div className={s.extrasEmpty}>{text}</div>; }
