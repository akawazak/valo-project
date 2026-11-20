"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import rt from "./ReplayTheater.module.css";
import { type ProfileMatchDetails, type ReplayRound } from "@/services/api";
import { fmtLength, mapCalloutLabel, mapCalloutPlotPosition, type AgentMeta, type MapMeta } from "./profileShared";
import { ReplayMapLayer, ReplayTimeline, buildReplayMoments, currentMomentId, isReplayUtilityVisible, replayClockLabel, replayHeldAt, replayMomentTime, replayPoses, replayUtilityMoments, replayUtilityPosition, smokeMoments, smokeTime, useReplayClock, type PlotFn, type ReplayHeldLabel, type ReplayMoment, type ReplaySide } from "./FullRoundReplay";
import { TacticsBoard, tacticsMaps } from "./TacticsBoard";
import { blankBoard, boardId, type BoardPiece, type BoardPlan } from "./tacticsBoardModel";
import { replayAbilityIcon } from "./abilityCoverage";

interface TheaterProps {
    detail: ProfileMatchDetails;
    map: MapMeta;
    maps?: Record<string, MapMeta>;
    agents: Record<string, AgentMeta>;
    plot: PlotFn;
    localSubject: string;
    localTeam: string;
    teamOf: (subject: string) => string;
    agentIcon: (subject?: string) => string | undefined;
    playerName: (subject?: string) => string;
    heldLabel: (subject: string, item: string) => ReplayHeldLabel | undefined;
    roundCount: number;
    loadRound: (index: number) => Promise<ReplayRound>;
    initialIndex: number;
    initialTime?: number;
    defaultRoundTime?: number;
    initialCallouts?: boolean;
    focusOnOpen?: boolean;
    inline?: boolean;
    onClose?: (index: number) => void;
}

/** The big replay view: the map as large as the window allows, both rosters and the round's moments. */
export function ReplayTheater(props: TheaterProps) {
    const { detail, map, localTeam, roundCount, loadRound, initialIndex, initialTime, inline, onClose } = props;
    const [index, setIndex] = useState(initialIndex);
    const [round, setRound] = useState<{ index: number; data: ReplayRound | null } | null>(null);
    const [vision, setVision] = useState(true);
    const [allNames, setAllNames] = useState(false);
    const [callouts, setCallouts] = useState(props.initialCallouts ?? true);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let current = true;
        const finish = (data: ReplayRound | null) => { if (current) setRound({ index, data }); };
        void loadRound(index).then(finish, () => finish(null));
        return () => { current = false; };
    }, [index, loadRound]);
    const focusOnOpen = props.focusOnOpen ?? !inline;
    useEffect(() => { if (focusOnOpen) rootRef.current?.focus(); }, [focusOnOpen]);

    const rounds = (detail.rounds || []).slice(0, roundCount);
    let ally = 0;
    let enemy = 0;
    const tiles = rounds.map((entry, position) => {
        const won = entry.winningTeam.toLowerCase() === localTeam;
        if (won) ally += 1; else enemy += 1;
        return { position, won, number: entry.roundNum + 1, score: `${ally}–${enemy}` };
    });
    const tile = tiles[index];
    const close = useCallback(() => onClose?.(index), [index, onClose]);
    const step = (delta: number) => setIndex((value) => Math.max(0, Math.min(roundCount - 1, value + delta)));

    const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
        // The match popup behind this view must not see these keys (its Escape and focus trap).
        if (!inline) event.stopPropagation();
        if (event.key === "Escape" && !inline) { event.preventDefault(); close(); }
        else if (event.key === "v" || event.key === "V") setVision((value) => !value);
        else if (event.key === "n" || event.key === "N") setAllNames((value) => !value);
        else if (event.key === "." || (!inline && event.key === "PageDown")) { event.preventDefault(); step(1); }
        else if (event.key === "," || (!inline && event.key === "PageUp")) { event.preventDefault(); step(-1); }
    };

    const theater = (
        <div
            ref={rootRef}
            className={rt.root}
            data-replay-theater
            data-inline={inline || undefined}
            role={inline ? "region" : "dialog"}
            aria-modal={inline ? undefined : true}
            aria-label={`Round ${tile?.number ?? index + 1} replay on ${map.name}`}
            tabIndex={-1}
            onKeyDown={onKey}
            onMouseDown={inline ? undefined : (event) => event.stopPropagation()}
            style={{ "--rt-map": map.splash ? `url("${map.splash}")` : "none" } as CSSProperties}
        >
            <header className={rt.top}>
                <div className={rt.title}>
                    <small>{map.name} · Full replay</small>
                    <h2>Round {tile?.number ?? index + 1} <span data-win={tile?.won || undefined}>{tile?.won ? "won" : "lost"}</span>{tile ? <em>{tile.score}</em> : null}</h2>
                </div>
                <div className={rt.rounds} role="group" aria-label="Rounds">
                    {tiles.map((entry) => <button
                        key={entry.position}
                        type="button"
                        data-win={entry.won || undefined}
                        aria-pressed={entry.position === index}
                        onClick={() => setIndex(entry.position)}
                        title={`Round ${entry.number}: ${entry.won ? "won" : "lost"}, score ${entry.score}`}
                    ><i>{entry.won ? "W" : "L"}</i><b>{entry.number}</b></button>)}
                </div>
                <div className={rt.toggles} role="group" aria-label="Show on the map">
                    <button type="button" aria-pressed={vision} onClick={() => setVision((value) => !value)} title="Vision cones (V)">Vision</button>
                    <button type="button" aria-pressed={allNames} onClick={() => setAllNames((value) => !value)} title="Every player's name (N)">Names</button>
                    <button type="button" aria-pressed={callouts} onClick={() => setCallouts((value) => !value)}>Callouts</button>
                </div>
                {!inline && <button type="button" className={rt.close} onClick={close} aria-label="Close the big replay view" title="Close (Esc)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>}
            </header>
            {round?.index === index && round.data ? (
                <TheaterRound
                    key={index}
                    {...props}
                    round={round.data}
                    roundIndex={index}
                    initialTime={index === initialIndex ? initialTime ?? props.defaultRoundTime : props.defaultRoundTime}
                    vision={vision}
                    allNames={allNames}
                    callouts={callouts}
                    onNextRound={index + 1 < roundCount ? () => step(1) : undefined}
                />
            ) : (
                <div className={rt.loading} role="status">{round?.index === index && round.data === null ? "This round could not be loaded." : <><span aria-hidden="true" />Loading round…</>}</div>
            )}
        </div>
    );
    return inline ? theater : createPortal(theater, document.body);
}

function TheaterRound({
    detail,
    inline,
    map,
    maps,
    agents,
    plot,
    localSubject,
    localTeam,
    teamOf,
    agentIcon,
    playerName,
    heldLabel,
    round,
    roundIndex,
    initialTime,
    vision,
    allNames,
    callouts,
    onNextRound,
}: TheaterProps & { round: ReplayRound; roundIndex: number; vision: boolean; allNames: boolean; callouts: boolean; onNextRound?: () => void }) {
    const clock = useReplayClock(round, initialTime);
    const abilityIcon = useCallback((name: string, subject?: string) => replayAbilityIcon(name, subject, detail.players, agents), [detail.players, agents]);
    const { time, toggle, seek } = clock;
    const [focus, setFocus] = useState<string | null>(null);
    const [pinned, setPinned] = useState<string | null>(null);
    const [board, setBoard] = useState<BoardPlan | null>(null);
    const [comparison, setComparison] = useState<{ smokeId: string; smokeTime: number; entryTime?: number } | null>(null);
    const pickSmoke = (moment: ReplayMoment) => setComparison({ smokeId: moment.id, smokeTime: moment.time });
    const entryDelta = comparison?.entryTime === undefined ? undefined : comparison.entryTime - comparison.smokeTime;
    const side = useCallback((subject: string): ReplaySide => teamOf(subject) === localTeam ? "ally" : "enemy", [localTeam, teamOf]);
    const moments = useMemo(() => {
        const events = buildReplayMoments(detail, roundIndex, side, playerName);
        return [...events, ...smokeMoments(round, events, side, playerName), ...replayUtilityMoments(round, side, playerName)].sort((a, b) => a.time - b.time);
    }, [detail, playerName, round, roundIndex, side]);
    const current = currentMomentId(moments, time);
    const riotRound = detail.rounds?.[roundIndex];
    const plant = riotRound?.plantLocation && (riotRound.plantLocation.x || riotRound.plantLocation.y)
        ? { time: riotRound.plantRoundTime || 0, x: riotRound.plantLocation.x, y: riotRound.plantLocation.y }
        : undefined;
    const poses = replayPoses(round, time);
    const openBoard = () => {
        clock.setPlaying(false);
        const place = (x: number, y: number) => {
            const location = plot(x, y);
            return { id: boardId(), x: location.left, y: location.top };
        };
        const pieces: BoardPiece[] = detail.players.flatMap(player => {
            const subject = player.subject.toLowerCase();
            const pose = poses.get(subject);
            return pose && !pose.dead ? [{ ...place(pose.x, pose.y), kind: "agent", side: side(subject), agentId: (player.characterId || "").toLowerCase() }] : [];
        });
        const omen = Object.entries(agents).find(([, agent]) => agent.name === "Omen");
        const darkCover = Object.entries(omen?.[1].abilities || {}).find(([, ability]) => ability.name === "Dark Cover")?.[0] || "dark-cover";
        for (const smoke of round.smokes || []) {
            if (smoke.startMs <= time && time < smoke.endMs) {
                pieces.push({ ...place(smoke.x, smoke.y), kind: "utility", side: smoke.subject ? side(smoke.subject) : "ally", agentId: omen?.[0] || "", ability: darkCover });
            }
        }
        for (const effect of round.utility ?? []) {
            if (!effect.subject || !isReplayUtilityVisible(effect, time)) continue;
            const player = detail.players.find((entry) => entry.subject.toLowerCase() === effect.subject);
            const agentId = player?.characterId?.toLowerCase() || "";
            const ability = Object.entries(agents[agentId]?.abilities ?? {}).find(([, entry]) => entry.name.toLowerCase() === effect.name.toLowerCase())?.[0];
            if (ability) {
                const position = replayUtilityPosition(effect, time);
                pieces.push({ ...place(position.x, position.y), kind: "utility", side: side(effect.subject), agentId, ability });
            }
        }
        if (plant && plant.time <= time && (!riotRound?.bombDefuser || time < (riotRound.defuseRoundTime || 0))) {
            pieces.push({ ...place(plant.x, plant.y), kind: "spike", side: side(riotRound?.bombPlanter?.toLowerCase() || ""), agentId: "" });
        }
        setBoard(blankBoard(map.uuid, pieces, `Round ${(riotRound?.roundNum ?? roundIndex) + 1} · ${replayClockLabel(time)}`));
    };
    const shownFocus = focus ?? pinned;

    // Zoom: the wheel zooms on the cursor, a drag pans, a double click resets. Tokens keep their size.
    const boardRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
    const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
    const clampView = useCallback((scale: number, x: number, y: number) => {
        const size = boardRef.current?.clientWidth || 1;
        const s = Math.max(1, Math.min(4, scale));
        return { scale: s, x: Math.min(0, Math.max(size * (1 - s), x)), y: Math.min(0, Math.max(size * (1 - s), y)) };
    }, []);
    const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
        setView((current) => {
            const size = boardRef.current?.clientWidth || 1;
            const cx = px ?? size / 2;
            const cy = py ?? size / 2;
            const scale = Math.max(1, Math.min(4, current.scale * factor));
            const ratio = scale / current.scale;
            return clampView(scale, cx - (cx - current.x) * ratio, cy - (cy - current.y) * ratio);
        });
    }, [clampView]);
    useEffect(() => {
        const board = boardRef.current;
        if (!board || inline) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = board.getBoundingClientRect();
            zoomAt(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top);
        };
        board.addEventListener("wheel", onWheel, { passive: false });
        return () => board.removeEventListener("wheel", onWheel);
    }, [inline, zoomAt]);
    const onBoardDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (view.scale === 1 || (event.target as HTMLElement).closest("button")) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onBoardMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        setView(clampView(view.scale, start.vx + event.clientX - start.x, start.vy + event.clientY - start.y));
    };

    // Capture before the dialog stops key events from reaching the match popup.
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            const target = event.target;
            if (board || !(target instanceof HTMLElement) || !boardRef.current?.closest("[data-replay-theater]")?.contains(target)) return;
            if (target.closest("button, a, input, select, textarea, [contenteditable], [role=slider]")) return;
            if (event.key === " ") { event.preventDefault(); toggle(); }
            else if (event.key === "ArrowRight") { event.preventDefault(); seek(time + (event.shiftKey ? 10_000 : 5_000)); }
            else if (event.key === "ArrowLeft") { event.preventDefault(); seek(time - (event.shiftKey ? 10_000 : 5_000)); }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [board, seek, time, toggle]);

    const kills = new Map<string, number>();
    for (const moment of moments) {
        if (moment.kind === "kill" && moment.time <= time && moment.actor) kills.set(moment.actor, (kills.get(moment.actor) || 0) + 1);
    }
    const roster = (team: ReplaySide) => detail.players
        .filter((player) => side(player.subject.toLowerCase()) === team)
        .sort((a, b) => Number(b.subject.toLowerCase() === localSubject) - Number(a.subject.toLowerCase() === localSubject));
    const aliveCount = (team: ReplaySide) => roster(team).filter((player) => {
        const pose = poses.get(player.subject.toLowerCase());
        return pose && !pose.dead;
    }).length;

    const renderRoster = (team: ReplaySide) => (
        <section className={rt.team} data-side={team}>
            <header><strong>{team === "ally" ? "Your team" : "Enemy team"}</strong><span>{aliveCount(team)} alive</span></header>
            <ul>
                {roster(team).map((player) => {
                    const subject = player.subject.toLowerCase();
                    const pose = poses.get(subject);
                    const dead = Boolean(pose?.dead);
                    const count = kills.get(subject) || 0;
                    const item = dead ? undefined : replayHeldAt(round, subject, time);
                    const held = item ? heldLabel(subject, item) : undefined;
                    return <li key={subject}>
                        <button
                            type="button"
                            data-dead={dead || undefined}
                            data-focus={subject === shownFocus || undefined}
                            aria-pressed={subject === pinned}
                            onMouseEnter={() => setFocus(subject)}
                            onMouseLeave={() => setFocus(null)}
                            onFocus={() => setFocus(subject)}
                            onBlur={() => setFocus(null)}
                            onClick={() => setPinned((value) => value === subject ? null : subject)}
                            title={subject === pinned ? "Stop highlighting" : "Highlight on the map"}
                        >
                            <i style={{ backgroundImage: agentIcon(subject) ? `url("${agentIcon(subject)}")` : undefined }} />
                            <span>
                                <b>{subject === localSubject ? "You" : playerName(subject)}</b>
                                <small>{dead ? `Died ${fmtLength(pose!.deathMs)}` : held?.name || "Alive"}</small>
                            </span>
                            {held?.icon ? <img className={rt.held} data-gun={held.gun || undefined} src={held.icon} alt="" draggable={false} /> : null}
                            {count ? <em>{count}K</em> : null}
                        </button>
                    </li>;
                })}
            </ul>
        </section>
    );

    const controls = (
        <footer className={rt.bottom}>
            {comparison ? <div className={rt.smokeComparison}>
                <strong>Dark Cover <time>{smokeTime(comparison.smokeTime)}</time></strong>
                <span aria-live="polite">{entryDelta === undefined ? "Scrub to a teammate’s entry to compare timing." : Math.abs(entryDelta) < 50
                    ? "Entry as smoke opened"
                    : `Entry ${smokeTime(entryDelta < 0 ? -entryDelta : entryDelta)} ${entryDelta < 0 ? "before" : "after"} smoke opened`}</span>
                <button type="button" onClick={() => {
                    clock.setPlaying(false);
                    setComparison({ ...comparison, entryTime: time });
                }}>Mark entry</button>
            </div> : null}
            <ReplayTimeline clock={clock} moments={moments} current={current} onPickSmoke={pickSmoke}>
                <button type="button" className={rt.plan} onClick={openBoard} title="Open this replay position as an editable play">Plan from here</button>
                {onNextRound && time >= clock.lastMs ? <button type="button" className={rt.next} onClick={onNextRound}>Next round</button> : null}
            </ReplayTimeline>
            <p className={rt.keys}>Space play · ←/→ seek · V vision · N names{inline ? "" : " · Esc close"}</p>
        </footer>
    );

    return (
        <>
            {inline && controls}
            <div className={rt.body}>
                <aside className={rt.side}>{renderRoster("ally")}</aside>
                <div className={rt.stage}>
                    <div
                        ref={boardRef}
                        className={rt.board}
                        data-zoomed={view.scale > 1 || undefined}
                        onPointerDown={onBoardDown}
                        onPointerMove={onBoardMove}
                        onPointerUp={() => { drag.current = null; }}
                        onPointerCancel={() => { drag.current = null; }}
                        onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
                    >
                      <div className={rt.zoom} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, "--z": view.scale } as CSSProperties}>
                        {map.displayIcon ? <img className={rt.mapImage} src={map.displayIcon} alt={`${map.name} tactical map`} draggable={false} /> : null}
                        {callouts ? map.callouts.map((callout, position) => {
                            const { left, top } = mapCalloutPlotPosition(map, callout);
                            return <span key={`${callout.superRegion}-${callout.name}-${position}`} className={rt.callout} style={{ left: `${left * 100}%`, top: `${top * 100}%` }} aria-hidden="true">{mapCalloutLabel(callout)}</span>;
                        }) : null}
                        <ReplayMapLayer
                            round={round}
                            time={time}
                            plot={plot}
                            side={side}
                            localSubject={localSubject}
                            agentIcon={agentIcon}
                            abilityIcon={abilityIcon}
                            playerName={playerName}
                            moments={moments}
                            plant={plant}
                            vision={vision}
                            names={allNames ? "all" : "involved"}
                            focus={shownFocus}
                            selectedSmoke={comparison?.smokeId}
                            size="theater"
                        />
                      </div>
                      <div className={rt.zoomControls}>
                        <button type="button" onClick={() => zoomAt(1.4)} disabled={view.scale >= 4} aria-label="Zoom in">+</button>
                        <button type="button" onClick={() => zoomAt(1 / 1.4)} disabled={view.scale <= 1} aria-label="Zoom out">−</button>
                        {view.scale > 1 ? <button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Reset zoom">{Math.round(view.scale * 10) / 10}×</button> : null}
                      </div>
                    </div>
                </div>
                <aside className={rt.side}>
                    {renderRoster("enemy")}
                    <section className={rt.moments}>
                        <header><strong>Moments</strong><span>{moments.length}</span></header>
                        <ol>
                            {moments.map((moment) => <li key={moment.id}>
                                <button type="button" data-side={moment.ally === undefined ? undefined : moment.ally ? "ally" : "enemy"} data-kind={moment.kind} data-past={moment.time <= time || undefined} data-active={(moment.kind === "smoke" && comparison ? moment.id === comparison.smokeId : moment.id === current) || undefined} onClick={() => {
                                    if (moment.utility) clock.setPlaying(false);
                                    if (moment.kind === "smoke") {
                                        clock.setPlaying(false);
                                        pickSmoke(moment);
                                    }
                                    seek(replayMomentTime(moment));
                                }} aria-pressed={moment.kind === "smoke" ? moment.id === comparison?.smokeId : undefined} aria-label={moment.kind === "smoke" ? `${smokeTime(moment.time)} · ${moment.label}` : undefined} title={moment.label}>
                                    <time>{moment.kind === "smoke" || moment.utility ? smokeTime(moment.time) : fmtLength(moment.time)}</time>
                                    {moment.kind === "smoke" || moment.utility ? <span className={rt.abilityIcon} aria-hidden="true">
                                        {abilityIcon(moment.utility?.name ?? "Dark Cover", moment.actor)
                                            ? <img src={abilityIcon(moment.utility?.name ?? "Dark Cover", moment.actor)} alt="" />
                                            : <b>{(moment.utility?.name ?? "Dark Cover").slice(0, 2)}</b>}
                                    </span> : <i style={{ backgroundImage: agentIcon(moment.actor) ? `url("${agentIcon(moment.actor)}")` : undefined }} />}
                                    {moment.target ? <>
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h12M13 7l5 5-5 5" /></svg>
                                        <i data-victim style={{ backgroundImage: agentIcon(moment.target) ? `url("${agentIcon(moment.target)}")` : undefined }} />
                                    </> : moment.kind !== "smoke" && !moment.utility ? <span className={rt.objective}>{moment.kind === "plant" ? "Plant" : "Defuse"}</span> : null}
                                    <span className={rt.who}>
                                        <b>{moment.kind === "smoke" ? "Dark Cover" : moment.utility ? moment.label : moment.actor === localSubject ? "You" : playerName(moment.actor)}</b>
                                        <small>{moment.note ?? (moment.utility ? undefined : moment.target ? (moment.target === localSubject ? "You" : playerName(moment.target)) : moment.kind === "plant" ? "Spike down" : "Round over")}</small>
                                    </span>
                                </button>
                            </li>)}
                        </ol>
                    </section>
                </aside>
            </div>
            {!inline && controls}
            {board ? <TacticsBoard maps={tacticsMaps(maps || {}, map)} agents={agents} seed={board} confirmUntouchedSeed={!inline} onClose={() => setBoard(null)} /> : null}
        </>
    );
}
