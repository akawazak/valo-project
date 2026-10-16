"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image, { type ImageProps } from "next/image";
import { getProfileMatchHistory, getProfileOverview, getRRHistory, type ProfileMatchSummary, type ProfileOverview, type ProfileRRSnapshot } from "@/services/api";
import { groupSessions, matchOutcome, summarizeMatches } from "./reviewStats";
import { queueLabel as queueName } from "@/lib/gameMeta";
import s from "./CareerReview.module.css";
import CompareView from "./CompareView";

export interface ReviewPlayer { puuid: string; gameName: string; tagLine: string }
type ReviewArt = { mapVisuals?: Record<string, string>; agentVisuals?: Record<string, string>; agentIcons?: Record<string, string>; playerCardImages?: Record<string, string>; rankIcons?: Record<number, string> };
type Labels = { mapNames: Record<string, string>; agentNames: Record<string, string> } & ReviewArt;
const value = (n: number | null, digits = 0, suffix = "") => n === null ? "—" : `${n.toFixed(digits)}${suffix}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const date = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const duration = (ms: number) => { const minutes = Math.round(ms / 60000); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`; };
const nameFor = (id: string, labels: Record<string, string>, fallback: string) => labels[id.toLowerCase()] || fallback;

function ReviewImage(props: ImageProps) {
    const [failed, setFailed] = useState<ImageProps["src"] | null>(null);
    return failed === props.src ? null : <Image {...props} onError={() => setFailed(props.src)} />;
}

function topAgent(matches: ProfileMatchSummary[]) {
    const counts = new Map<string, number>();
    for (const match of matches) { const id = match.localPlayer.characterId.toLowerCase(); if (id) counts.set(id, (counts.get(id) || 0) + 1); }
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    return top ? { id: top[0], games: top[1] } : null;
}

function ReviewStatus({ title, detail, busy = false, children }: { title: string; detail?: string; busy?: boolean; children?: ReactNode }) {
    return <div className={s.state} role={busy ? "status" : undefined} aria-busy={busy || undefined}>
        {busy ? <span className={s.stateSpinner} aria-hidden="true" /> : null}
        <h3>{title}</h3>{detail ? <p>{detail}</p> : null}{children}
    </div>;
}

export function SessionRecap({ puuid, region, queue, queueLabel, focusMatchId, ...labels }: { puuid: string; region: string; queue: string; queueLabel: string; focusMatchId?: string } & Labels) {
    const [data, setData] = useState<{ matches: ProfileMatchSummary[]; total: number; rr: ProfileRRSnapshot[]; rrError: boolean } | null>(null);
    const [limit, setLimit] = useState(200);
    const [attempt, setAttempt] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError("");
        Promise.all([getProfileMatchHistory(0, limit, "", { puuid, region }), getRRHistory(undefined, { puuid, region }).then(result => {
            if (result.puuid.toLowerCase() !== puuid.toLowerCase()) throw new Error("RR profile mismatch");
            return { snapshots: result.source === "rr" ? result.snapshots || [] : [], failed: false };
        }).catch(() => ({ snapshots: [] as ProfileRRSnapshot[], failed: true }))])
            .then(([history, rank]) => {
                if (history.puuid.toLowerCase() !== puuid.toLowerCase()) throw new Error("The returned history does not match this player. Try again.");
                if (!cancelled) setData({ matches: history.matches || [], total: history.total, rr: rank.snapshots, rrError: rank.failed });
            })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load cached sessions."); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [puuid, region, limit, attempt]);
    if (loading && !data) return <ReviewStatus title="Loading your sessions" detail="Gathering matches and recorded RR." busy />;
    if (error) return <div role="alert"><ReviewStatus title="Sessions couldn't load" detail={error}><button onClick={() => setAttempt(a => a + 1)}>Try again</button></ReviewStatus></div>;
    return data ? <SessionRecapView {...data} {...labels} queue={queue} queueLabel={queueLabel} focusMatchId={focusMatchId} loading={loading} onRetry={() => setAttempt(n => n + 1)} onLoadMore={() => setLimit(n => n + 200)} /> : null;
}

export function SessionRecapView({ matches, total, rr, rrError, queue, queueLabel, focusMatchId, mapNames, agentNames, mapVisuals = {}, agentVisuals = {}, agentIcons = {}, loading, onLoadMore, onRetry }: { matches: ProfileMatchSummary[]; total: number; rr: ProfileRRSnapshot[]; rrError: boolean; queue: string; queueLabel: string; focusMatchId?: string; loading: boolean; onLoadMore: () => void; onRetry?: () => void } & Labels) {
    const sessions = useMemo(() => groupSessions(matches).map(all => ({ id: all[0].matchId, all, matches: all.filter(m => !queue || m.queueID === queue) })).filter(session => session.matches.length), [matches, queue]);
    const [selected, setSelected] = useState("");
    // Opened from a match-history day: start on the session holding that match.
    const focused = focusMatchId ? sessions.find(item => item.all.some(match => match.matchId === focusMatchId)) : undefined;
    const session = sessions.find(item => item.id === selected) || focused || sessions[0];
    const listRef = useRef<HTMLElement>(null);
    const focusedId = focused?.id;
    useEffect(() => { if (focusedId) listRef.current?.querySelector("[aria-pressed=\"true\"]")?.scrollIntoView({ block: "nearest" }); }, [focusedId]);
    if (!session) return <ReviewStatus title="Your next session starts here" detail={`Sync your match history to see a recap${queue ? ` for ${queueLabel}` : ""}.`}>
        {matches.length < total ? <button disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Load older sessions"}</button> : null}
    </ReviewStatus>;
    const stats = summarizeMatches(session.matches, rr);
    const first = session.all[0], last = session.all.at(-1)!;
    const finalMatch = session.matches.at(-1)!;
    const mapArt = mapVisuals[finalMatch.mapID.toLowerCase()];
    const agent = topAgent(session.matches);
    const agentArt = agent ? agentVisuals[agent.id] : undefined;
    const oldestLoaded = matches.reduce((oldest, match) => Math.min(oldest, match.gameStartMillis), Infinity);
    const partial = matches.length < total && session.all[0].gameStartMillis === oldestLoaded;
    return <div className={s.review} data-review="sessions">
        <div className={s.context}><span>{queueLabel} <i /> {matches.length} of {total} synced matches</span><small title="A gap of more than two hours between match starts creates a new session.">Sessions split after a 2h break</small></div>
        {rrError ? <div className={s.notice} role="status">RR is unavailable right now. Your matches are ready. {onRetry ? <button disabled={loading} onClick={onRetry}>Retry RR</button> : null}</div> : null}
        <div className={s.sessionLayout}>
            <nav ref={listRef} className={s.sessionList} aria-label="Choose a session">
                {sessions.map(item => {
                    const record = summarizeMatches(item.matches, rr);
                    const preview = mapVisuals[item.matches.at(-1)!.mapID.toLowerCase()];
                    return <button key={item.id} aria-pressed={item.id === session.id} onClick={() => setSelected(item.id)}>
                        {preview ? <ReviewImage className={s.sessionPreview} src={preview} alt="" fill sizes="220px" unoptimized /> : null}
                        <span className={s.sessionDate}><strong>{date(item.all[0].gameStartMillis)}</strong><small>{time(item.all[0].gameStartMillis)} · {item.matches.length} games</small></span>
                        <span className={s.sessionListRecord}><b>{record.wins}W <span>{record.losses}L</span>{record.draws ? ` ${record.draws}D` : ""}</b><span className={s.miniForm} aria-hidden="true" title="Last eight match results">{item.matches.slice(-8).map(m => <i key={m.matchId} data-result={matchOutcome(m)} />)}</span></span>
                    </button>;
                })}
                {matches.length < total ? <button className={s.loadMore} disabled={loading} onClick={onLoadMore}>{loading ? "Loading…" : "Older sessions"}</button> : null}
            </nav>
            <section key={session.id} className={s.sessionDetail} aria-label="Selected session recap">
                <header className={s.sessionHero}>
                    {mapArt ? <ReviewImage className={s.sessionHeroMap} src={mapArt} alt="" fill sizes="900px" unoptimized /> : null}
                    {agentArt ? <ReviewImage className={s.sessionHeroAgent} src={agentArt} alt="" width={300} height={300} unoptimized /> : null}
                    <div className={s.sessionHeading}>
                        <div><h3>{date(first.gameStartMillis)}{date(first.gameStartMillis) !== date(last.gameStartMillis) ? ` – ${date(last.gameStartMillis)}` : ""}</h3><p>{time(first.gameStartMillis)} – {time(last.gameStartMillis + Math.max(0, last.gameLengthMillis))} · {duration(stats.playedMillis)} played</p></div>
                        <div className={s.record}><strong>{stats.wins}<span>W</span><em>{stats.losses}<span>L</span></em>{stats.draws ? <small>{stats.draws} draws</small> : null}</strong><small>{stats.games} matches · {stats.decided} decided</small></div>
                    </div>
                    <div className={s.sessionHeroFoot}><span>Last match <b>{nameFor(finalMatch.mapID, mapNames, "Unknown map")}</b></span>{agent ? <span>Most played <b>{nameFor(agent.id, agentNames, "Unknown agent")}</b></span> : null}</div>
                </header>
                {partial ? <p className={s.notice}>This session continues beyond the loaded history. Load older matches for the full recap.</p> : null}
                <div className={s.metrics}>
                    <div data-positive={stats.rr !== null && stats.rr > 0 || undefined}><span>{stats.rrRecorded < stats.ranked ? "RR recorded so far" : "Ranked RR"}</span><strong>{stats.rr === null ? "—" : signed(stats.rr)}</strong><small>{stats.ranked ? `${stats.rrRecorded}/${stats.ranked} ranked matches recorded` : "No ranked matches"}</small></div>
                    <div><span>K / D / A</span><strong>{stats.kills}<i>/</i>{stats.deaths}<i>/</i>{stats.assists}</strong><small>{value(stats.kd, 2)} K/D</small></div>
                    <div><span>Headshots</span><strong>{value(stats.hs, 1, "%")}</strong><small>Across this session</small></div>
                    <div><span>Damage / round</span><strong>{value(stats.adr)}</strong><small>{value(stats.acs)} ACS{stats.roundGames < stats.games ? ` · ${stats.roundGames}/${stats.games} games with rounds` : ""}</small></div>
                </div>
                <div className={s.timelineHeading}><h4>Match by match</h4><small>First to last · {queueLabel}</small></div>
                <div className={s.timelineColumns} aria-hidden="true"><span>Time</span><span>Result</span><span>Map / agent</span><span>K / D / A</span><span>RR</span></div>
                <ol className={s.timeline}>{session.matches.map((match, index) => {
                    const outcome = matchOutcome(match), snapshot = rr.find(item => item.matchId === match.matchId);
                    const mapImage = mapVisuals[match.mapID.toLowerCase()], portrait = agentIcons[match.localPlayer.characterId.toLowerCase()];
                    return <li key={match.matchId} data-outcome={outcome}>
                        <span className={s.matchOrder}><b>{String(index + 1).padStart(2, "0")}</b><time>{time(match.gameStartMillis)}</time></span>
                        <span className={s.matchMap}>{mapImage ? <ReviewImage src={mapImage} alt="" fill sizes="110px" unoptimized /> : null}<span className={s.outcome}>{outcome === "placement" ? (match.placement ? `#${match.placement}` : "FFA") : outcome === "unknown" ? "PLAYED" : outcome.toUpperCase()}</span></span>
                        <span className={s.matchIdentity}><span className={s.matchAgent}>{portrait ? <ReviewImage src={portrait} alt="" fill sizes="38px" unoptimized /> : null}</span><span><strong>{nameFor(match.mapID, mapNames, "Unknown map")}</strong><small>{nameFor(match.localPlayer.characterId, agentNames, "Unknown agent")} · {queue ? queueLabel : queueName(match.queueID)}</small></span></span>
                        <span className={s.matchKda} aria-label={`${match.localPlayer.kills} kills, ${match.localPlayer.deaths} deaths, ${match.localPlayer.assists} assists`}>{match.localPlayer.kills}<i>/</i>{match.localPlayer.deaths}<i>/</i>{match.localPlayer.assists}</span>
                        <b className={s.matchRr} data-positive={match.isRanked && snapshot && snapshot.rrEarned > 0 || undefined}>{match.isRanked && snapshot ? <>{signed(snapshot.rrEarned)}<small>RR</small></> : "—"}</b>
                    </li>;
                })}</ol>
            </section>
        </div>
    </div>;
}

const samePlayer = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function ProfileComparison({ player, selfPuuid, candidates, region, seasonId, queue, queueLabel, agentNames, ...art }: { player: ReviewPlayer; selfPuuid?: string; candidates: ReviewPlayer[]; region: string; seasonId?: string; queue: string; queueLabel: string; agentNames: Record<string, string> } & ReviewArt) {
    const [targetId, setTargetId] = useState(candidates[0]?.puuid || "");
    const target = candidates.find(candidate => candidate.puuid === targetId) || candidates[0];
    const selectedPuuid = target?.puuid || "", selectedName = target?.gameName || "", selectedTag = target?.tagLine || "";
    // The signed-in player always sits on the left.
    const identities = useMemo(() => {
        const pair = [{ puuid: player.puuid, gameName: player.gameName, tagLine: player.tagLine }, { puuid: selectedPuuid, gameName: selectedName, tagLine: selectedTag }];
        return samePlayer(selectedPuuid, selfPuuid) ? pair.reverse() : pair;
    }, [player.puuid, player.gameName, player.tagLine, selectedPuuid, selectedName, selectedTag, selfPuuid]);
    const [data, setData] = useState<ComparisonData[] | null>(null);
    const [error, setError] = useState("");
    const [attempt, setAttempt] = useState(0);
    // "act" compares the current act; "all" every synced match. An empty act falls back to all.
    const [range, setRange] = useState<"act" | "all">("act");
    const [fellBack, setFellBack] = useState(false);
    useEffect(() => {
        if (!identities.every(identity => identity.puuid) || (range === "act" && !seasonId)) return;
        let cancelled = false;
        setData(null); setError(""); setFellBack(false);
        const load = (act: string) => Promise.all(identities.map(async identity => {
            const scope = { puuid: identity.puuid, region };
            const [overview, history] = await Promise.all([getProfileOverview(scope), getProfileMatchHistory(0, 200, queue, scope, act)]);
            if (overview.rankError) throw new Error(overview.rankError);
            if (overview.puuid.toLowerCase() !== identity.puuid.toLowerCase() || history.puuid.toLowerCase() !== identity.puuid.toLowerCase()) throw new Error("The returned profile does not match the selected player. Try again.");
            return { player: identity, overview, matches: history.matches || [], total: history.total };
        }));
        load(range === "act" ? seasonId || "" : "")
            .then(async result => {
                if (range === "act" && result.some(item => !item.matches.length)) {
                    const all = await load("");
                    if (!cancelled) { setFellBack(true); setData(all); }
                    return;
                }
                if (!cancelled) setData(result);
            })
            .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not compare these profiles."); });
        return () => { cancelled = true; };
    }, [identities, region, seasonId, queue, attempt, range]);
    return <div className={s.review}>
        <div className={s.compareControls}><label>Compare with <select value={target?.puuid || ""} onChange={event => setTargetId(event.target.value)} disabled={!candidates.length}>{!candidates.length ? <option value="">No known players yet</option> : candidates.map(candidate => <option key={candidate.puuid} value={candidate.puuid}>{candidate.gameName || "Player"}{candidate.tagLine ? `#${candidate.tagLine}` : ""}</option>)}</select></label><div className={s.rangeSwitch} role="group" aria-label="Matches to compare"><button type="button" aria-pressed={range === "act" && !fellBack} onClick={() => setRange("act")}>This act</button><button type="button" aria-pressed={range === "all" || fellBack} onClick={() => setRange("all")}>All synced</button></div>{fellBack ? <span>No matches this act yet</span> : null}</div>
        {!target ? <div className={s.state}><h3>Find someone to compare</h3><p>Open another player&apos;s profile, or sync matches with teammates. Those players will appear here.</p></div> : range === "act" && !seasonId ? <p className={s.state}>The current act is unavailable. Switch to All synced, or reopen the profile after its rank loads.</p> : error ? <div className={s.state} role="alert"><p>{error}</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button></div> : !data || data.some((item, index) => item.player.puuid !== identities[index].puuid) ? <ReviewStatus title="Lining up both profiles" detail="Loading ranks and synced matches." busy /> : <CompareView data={data} selfPuuid={selfPuuid} region={region} queue={queue} agentNames={agentNames} rankIcons={art.rankIcons} rangeLabel={`${queueLabel} · ${range === "act" && !fellBack ? "this act" : "all synced"} · latest 200 each`} />}
    </div>;
}

export interface ComparisonData { player: ReviewPlayer; overview: ProfileOverview; matches: ProfileMatchSummary[]; total: number }
export function ProfileComparisonView({ data, selfPuuid, agentNames, agentVisuals = {}, playerCardImages = {}, rankIcons = {} }: { data: ComparisonData[]; selfPuuid?: string; agentNames: Record<string, string> } & ReviewArt) {
    const stats = data.map(item => summarizeMatches(item.matches));
    const rows = [
        { label: "Win rate", hint: "Decided team matches", digits: 1, suffix: "%", values: stats.map(item => item.winrate) },
        { label: "K/D", hint: "Kills per death", digits: 2, suffix: "", values: stats.map(item => item.kd) },
        { label: "Average combat score", hint: "Per recorded round", digits: 0, suffix: "", values: stats.map(item => item.acs) },
        { label: "Headshots", hint: "Of recorded hits", digits: 1, suffix: "%", values: stats.map(item => item.hs) },
        { label: "Damage / round", hint: "Per recorded round", digits: 0, suffix: "", values: stats.map(item => item.adr) },
    ].map(row => {
        // Compare the shown numbers, so a tie on screen never highlights a winner.
        const [a, b] = row.values.map(n => n === null ? null : Number(n.toFixed(row.digits)));
        const lead = a === null || b === null || a === b ? -1 : a > b ? 0 : 1;
        return { ...row, lead, diff: lead < 0 ? 0 : Math.abs(a! - b!) };
    });
    const score = [0, 1].map(index => rows.filter(row => row.lead === index).length);
    const names = data.map(item => item.player.gameName || "Player");
    return <div className={`${s.review} ${s.comparison}`} key={data.map(item => item.player.puuid).join(":")}>
        <div className={s.compareIdentities}>
            {data.map((item, index) => {
                const agent = topAgent(item.matches);
                const art = agent ? agentVisuals[agent.id] : undefined;
                const card = item.overview.playerCardId ? playerCardImages[item.overview.playerCardId.toLowerCase()] : undefined;
                const rank = item.overview.currentRank;
                const rankIcon = rankIcons[rank.competitiveTier];
                return <article key={item.player.puuid} className={s.identity} data-player={index}>
                    {card ? <ReviewImage className={s.identityCard} src={card} alt="" fill sizes="600px" unoptimized /> : null}
                    <span className={s.identityFallback} aria-hidden="true">{Array.from(item.player.gameName || "P")[0].toUpperCase()}</span>
                    {art ? <ReviewImage className={s.identityAgent} src={art} alt="" width={320} height={320} unoptimized /> : null}
                    <div className={s.identityCopy}>
                        <span className={s.identityTag}>{samePlayer(item.player.puuid, selfPuuid) ? "You" : "Player"}</span>
                        <h3>{names[index]}<small>#{item.player.tagLine || "—"}</small></h3>
                        <div className={s.rankPlate}>{rankIcon ? <ReviewImage src={rankIcon} alt="" width={38} height={38} unoptimized /> : null}<span><strong>{rank.tierName || "Unranked"}</strong><small>{rank.competitiveTier > 0 ? `${rank.rankedRating} RR` : "No ranked rating"}{item.overview.rankSource === "cache" ? " · Cached rank" : ""}</small></span></div>
                        <p>{item.matches.length} of {item.total} synced matches</p>
                    </div>
                    <div className={s.identityFoot}>{agent ? <><span>Most played</span><strong>{nameFor(agent.id, agentNames, "Unknown agent")}</strong><small>{agent.games} games</small></> : <span>No matches in this sample</span>}</div>
                </article>;
            })}
            <span className={s.versus} role="img" aria-label={`${names[0]} leads ${score[0]} stats, ${names[1]} leads ${score[1]}`}><b data-player={0} data-ahead={score[0] > score[1] || undefined}>{score[0]}</b><i>VS</i><b data-player={1} data-ahead={score[1] > score[0] || undefined}>{score[1]}</b></span>
        </div>
        <table className={s.compareTable}>
            <caption>Same queue and match range. Bars compare the two players on each stat; each player&apos;s match sample can differ.</caption>
            <thead className={s.srOnly}><tr><th scope="col">{names[0]}</th><th scope="col">Metric</th><th scope="col">{names[1]}</th></tr></thead>
            <tbody>{rows.map(row => {
                const scale = Math.max(1e-9, ...row.values.map(n => n ?? 0));
                const cell = (index: number) => {
                    const number = row.values[index];
                    return <td data-player={index} data-lead={row.lead === index || undefined}>
                        <div className={s.compareCell}>
                            <strong>{value(number, row.digits)}<small>{number === null ? "" : row.suffix}</small></strong>
                            <span className={s.compareTrack} aria-hidden="true"><i style={{ width: `${number === null ? 0 : Math.max(2, Math.min(100, number / scale * 100))}%` }} /></span>
                        </div>
                        {(row.label === "Average combat score" || row.label === "Damage / round") && stats[index].roundGames < stats[index].games ? <small className={s.sampleNote}>{stats[index].roundGames} games with round data</small> : null}
                    </td>;
                };
                return <tr key={row.label}>{cell(0)}<th scope="row"><span className={s.compareLabel}>{row.label}</span><small>{row.hint}</small>{row.lead >= 0 ? <span className={s.compareDiff} data-player={row.lead}>+{row.diff.toFixed(row.digits)}{row.suffix}<span className={s.srOnly}> to {names[row.lead]}</span></span> : <span className={s.compareDiff}>Even</span>}</th>{cell(1)}</tr>;
            })}</tbody>
        </table>
        <div className={s.compareSupport}>{data.map((item, index) => <dl key={item.player.puuid} data-player={index} aria-label={`${names[index]} match totals`}><div><dt>Record</dt><dd><b className={s.win}>{stats[index].wins}<small>W</small></b> <i>/</i> <b className={s.loss}>{stats[index].losses}<small>L</small></b>{stats[index].draws ? <> <i>/</i> {stats[index].draws}<small>D</small></> : null}</dd></div><div><dt>K / D / A</dt><dd>{stats[index].kills} <i>/</i> {stats[index].deaths} <i>/</i> {stats[index].assists}</dd></div></dl>)}</div>
    </div>;
}
