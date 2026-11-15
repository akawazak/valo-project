"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import rr from "./RoundReview.module.css";
import rm from "./ReplayMap.module.css";
import coverage from "./AbilityCoverage.module.css";
import { abilityCoverageRadii } from "./abilityCoverage";
import { REPLAY_FRAME_MS, type ProfileMatchDetails, type ReplayRound, type ReplayUtility } from "@/services/api";
import { fmtLength } from "./profileShared";

export interface ReplayMoment {
    id: string;
    time: number;
    kind: string;
    ally?: boolean;
    actor?: string;
    target?: string;
    label: string;
    note?: string;
    utility?: ReplayUtility;
}

export type PlotFn = (x: number, y: number) => { left: number; top: number };
export type ReplaySide = "ally" | "enemy";
export type ReplayHeldLabel = { name: string; icon?: string; gun: boolean };

const SPEEDS = [1, 2, 4] as const;
// A kill's tracer stays on the map this long after the shot.
const SHOT_MS = 1_400;
// VALORANT's horizontal field of view, and how far a vision cone reaches (game units, 1 m = 100).
const FOV_DEGREES = 103;
const VISION_RANGE = 1_400;

type Pose = { x: number; y: number; yaw: number };

function poseAt(samples: number[], frames: number, frame: number): Pose | null {
    const clamped = Math.max(0, Math.min(frames - 1, frame));
    const index = Math.floor(clamped);
    const next = Math.min(frames - 1, index + 1);
    const fraction = clamped - index;
    const yawA = samples[index * 3 + 2];
    if (yawA === undefined || yawA < 0) return null;
    const yawB = samples[next * 3 + 2] < 0 ? yawA : samples[next * 3 + 2];
    const turn = ((yawB - yawA + 540) % 360) - 180;
    return {
        x: samples[index * 3] + (samples[next * 3] - samples[index * 3]) * fraction,
        y: samples[index * 3 + 1] + (samples[next * 3 + 1] - samples[index * 3 + 1]) * fraction,
        yaw: yawA + turn * fraction,
    };
}

export function replayRange(round: ReplayRound) {
    return { firstMs: round.frameMs, lastMs: round.frameMs + (round.frames - 1) * REPLAY_FRAME_MS };
}

/** Each player's pose at a round time, and whether they are still alive. */
export function replayPoses(round: ReplayRound, time: number) {
    const poses = new Map<string, Pose & { dead: boolean; deathMs: number }>();
    const frame = (time - round.frameMs) / REPLAY_FRAME_MS;
    for (const track of round.tracks || []) {
        const dead = track.deathMs >= 0 && time >= track.deathMs;
        const pose = poseAt(track.samples, round.frames, dead ? (track.deathMs - round.frameMs) / REPLAY_FRAME_MS : frame);
        if (pose) poses.set(track.subject, { ...pose, dead, deathMs: track.deathMs });
    }
    return poses;
}

/** What a player has in their hands at a round time ("gun:<id>", "ability:<slot>", "melee", "spike", "defuser"). */
export function replayHeldAt(round: ReplayRound, subject: string, time: number) {
    const held = round.tracks?.find((track) => track.subject === subject)?.held;
    let item: string | undefined;
    for (const change of held || []) {
        if (change.ms > time) break;
        item = change.item;
    }
    return item;
}

/** Riot's kill feed, plant and defuse for one round, on the replay's clock (0 = barrier drop). */
export function buildReplayMoments(detail: ProfileMatchDetails, roundIndex: number, side: (subject: string) => ReplaySide, playerName: (subject?: string) => string): ReplayMoment[] {
    const round = detail.rounds?.[roundIndex];
    if (!round) return [];
    const moments: ReplayMoment[] = (detail.kills || [])
        .filter((event) => event.roundNum === round.roundNum)
        .map((event, index) => {
            const actor = event.killer.toLowerCase();
            const target = event.victim.toLowerCase();
            return { id: `k${index}-${event.gameTime}`, time: event.roundTime, kind: "kill", ally: side(actor) === "ally", actor, target, label: `${playerName(actor)} eliminated ${playerName(target)}` };
        });
    if (round.bombPlanter) {
        const actor = round.bombPlanter.toLowerCase();
        moments.push({ id: "plant", time: round.plantRoundTime || 0, kind: "plant", ally: side(actor) === "ally", actor, label: `${playerName(actor)} planted the spike${round.plantSite ? ` on ${round.plantSite}` : ""}` });
    }
    if (round.bombDefuser) {
        const actor = round.bombDefuser.toLowerCase();
        moments.push({ id: "defuse", time: round.defuseRoundTime || 0, kind: "defuse", ally: side(actor) === "ally", actor, label: `${playerName(actor)} defused the spike` });
    }
    return moments.sort((a, b) => a.time - b.time);
}

export function smokeMoments(round: ReplayRound, moments: ReplayMoment[], side: (subject: string) => ReplaySide, playerName: (subject?: string) => string): ReplayMoment[] {
    return (round.smokes || []).map((smoke, index) => {
        let nearest: number | undefined;
        for (const moment of moments) {
            const delta = moment.time - smoke.startMs;
            if (moment.kind !== "kill" || !moment.target || Math.abs(delta) > 10_000 ||
                (nearest !== undefined && Math.abs(delta) >= Math.abs(nearest))) continue;
            const victim = round.tracks?.find((track) => track.subject === moment.target);
            if (!victim) continue;
            const pose = poseAt(victim.samples, round.frames, (moment.time - round.frameMs) / REPLAY_FRAME_MS);
            if (pose && Math.hypot(pose.x - smoke.x, pose.y - smoke.y) <= 2_000) nearest = delta;
        }
        const duration = `${((smoke.endMs - smoke.startMs) / 1_000).toFixed(1)}s active`;
        const note = nearest === undefined ? duration : Math.abs(nearest) < 50
            ? "Nearby elimination as smoke opened"
            : `Nearby elimination ${(Math.abs(nearest) / 1_000).toFixed(1)}s ${nearest > 0 ? "after" : "before"}`;
        const owner = smoke.subject ? playerName(smoke.subject) : "Omen";
        return {
            id: `smoke-${index}`,
            time: smoke.startMs,
            kind: "smoke",
            ally: smoke.subject ? side(smoke.subject) === "ally" : undefined,
            actor: smoke.subject,
            label: `${owner} deployed Dark Cover · ${duration}${note === duration ? "" : ` · ${note} (within 20 m)`}`,
            note,
        };
    });
}

export function replayMomentTime(moment: ReplayMoment) {
    return moment.kind === "smoke" || moment.utility ? moment.time : moment.time - 2_000;
}

export function replayUtilityMoments(round: ReplayRound, side: (subject: string) => ReplaySide, playerName: (subject?: string) => string): Array<ReplayMoment & { utility: ReplayUtility }> {
    return (round.utility ?? []).map((ability, index) => ({
        id: `utility-${index}`, time: ability.startMs, kind: "utility", utility: ability,
        actor: ability.subject, ally: ability.subject ? side(ability.subject) === "ally" : undefined,
        label: ability.kind === "teleport" ? `${ability.name} teleport` : ability.name,
        note: ability.subject ? playerName(ability.subject) : undefined,
    }));
}

export function isReplayUtilityVisible(ability: ReplayUtility, time: number) {
    return time >= ability.startMs && time < (ability.endMs ?? ability.startMs + 1_600);
}

export function smokeTime(time: number) {
    return `${time < 0 ? "Buy −" : ""}${(Math.abs(time) / 1_000).toFixed(1)}s`;
}

/** Play, pause, speed and seeking for one round. */
export function useReplayClock(round: ReplayRound, initialTime?: number) {
    const { firstMs, lastMs } = replayRange(round);
    const [time, setTime] = useState(() => Math.max(firstMs, Math.min(lastMs, initialTime ?? firstMs)));
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
    const opened = useRef(round);

    useEffect(() => {
        if (opened.current === round) return;
        opened.current = round;
        setTime(round.frameMs);
        setPlaying(false);
    }, [round]);

    useEffect(() => {
        if (!playing) return;
        let frame = 0;
        let previous = performance.now();
        const step = (now: number) => {
            const elapsed = now - previous;
            previous = now;
            setTime((current) => {
                const next = current + elapsed * speed;
                if (next >= lastMs) {
                    setPlaying(false);
                    return lastMs;
                }
                return next;
            });
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [lastMs, playing, speed]);

    const seek = useCallback((value: number) => setTime(Math.max(firstMs, Math.min(lastMs, value))), [firstMs, lastMs]);
    const toggle = useCallback(() => {
        setPlaying((value) => {
            if (!value) setTime((current) => current >= lastMs ? firstMs : current);
            return !value;
        });
    }, [firstMs, lastMs]);
    const cycleSpeed = useCallback(() => setSpeed((value) => SPEEDS[(SPEEDS.indexOf(value) + 1) % SPEEDS.length]), []);
    return { time, seek, playing, setPlaying, toggle, speed, cycleSpeed, firstMs, lastMs };
}

export type ReplayClock = ReturnType<typeof useReplayClock>;

export function replayClockLabel(time: number) {
    return time < 0 ? `Buy ${fmtLength(-time)}` : fmtLength(time);
}

/** Players, vision cones, deaths, tracers and the spike over a map backdrop. */
export function ReplayMapLayer({
    round,
    time,
    plot,
    side,
    localSubject,
    agentIcon,
    playerName,
    moments,
    plant,
    vision = true,
    names = "involved",
    focus,
    selectedSmoke,
    size = "panel",
}: {
    round: ReplayRound;
    time: number;
    plot: PlotFn;
    side: (subject: string) => ReplaySide;
    localSubject: string;
    agentIcon: (subject?: string) => string | undefined;
    playerName: (subject?: string) => string;
    moments: ReplayMoment[];
    plant?: { time: number; x: number; y: number };
    vision?: boolean;
    names?: "all" | "involved";
    focus?: string | null;
    selectedSmoke?: string;
    size?: "panel" | "theater";
}) {
    const poses = replayPoses(round, time);
    const recentShots = moments.filter((moment) => moment.kind === "kill" && moment.time <= time && time - moment.time < SHOT_MS && moment.actor && moment.target);
    const involved = new Set(recentShots.flatMap((moment) => [moment.actor!, moment.target!]));
    const cone = (pose: Pose) => {
        const points = [plot(pose.x, pose.y)];
        for (let step = 0; step <= 10; step += 1) {
            const angle = ((pose.yaw - FOV_DEGREES / 2 + (FOV_DEGREES * step) / 10) * Math.PI) / 180;
            points.push(plot(pose.x + VISION_RANGE * Math.cos(angle), pose.y + VISION_RANGE * Math.sin(angle)));
        }
        return points.map((point) => `${point.left},${point.top}`).join(" ");
    };
    const alive = [...poses.entries()].filter(([, pose]) => !pose.dead);
    const defuse = moments.find((moment) => moment.kind === "defuse");
    const smokeZones = [
        ...(round.smokes ?? []).map((effect, i) => ({ ...effect, name: "Dark Cover", id: `smoke-${i}` })),
        ...(round.utility ?? []).flatMap((effect, i) => effect.kind === "smoke"
            ? [{ ...effect, id: `utility-${i}` }] : []),
    ];

    return (
        <div className={rm.layer} data-size={size} data-focus={focus ? true : undefined}>
            {smokeZones.map((smoke) => {
                const radius = abilityCoverageRadii.get(smoke.name);
                if (!radius || time < smoke.startMs || time >= (smoke.endMs ?? smoke.startMs)) return null;
                const center = plot(smoke.x, smoke.y);
                const edge = plot(smoke.x + radius, smoke.y + radius);
                return <span key={smoke.id} className={`${rm.smoke} ${coverage.texture}`}
                    data-effect={smoke.name} data-ability={smoke.name}
                    data-side={smoke.subject ? side(smoke.subject) : undefined}
                    data-selected={selectedSmoke === smoke.id || undefined}
                    style={{ left: `${center.left}%`, top: `${center.top}%`, width: `${2 * Math.abs(center.left - edge.left)}%`, height: `${2 * Math.abs(center.top - edge.top)}%` }}
                    title={smoke.name} aria-hidden="true" />;
            })}
            <svg className={rm.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {vision ? alive.map(([subject, pose]) => (
                    <polygon
                        key={`cone-${subject}`}
                        className={rm.cone}
                        points={cone(pose)}
                        data-side={side(subject)}
                        data-you={subject === localSubject || undefined}
                        data-focus={subject === focus || undefined}
                    />
                )) : null}
                {round.utility?.map((ability, index) => {
                    if (!isReplayUtilityVisible(ability, time) || (ability.kind === "smoke" && abilityCoverageRadii.has(ability.name))) return null;
                    const spot = plot(ability.x, ability.y);
                    const origin = ability.origin && plot(ability.origin.x, ability.origin.y);
                    return <g key={`utility-${index}`}>
                        {origin && <>
                            <line className={rm.teleportLine} x1={origin.left} y1={origin.top} x2={spot.left} y2={spot.top} />
                            <circle className={rm.teleportOrigin} cx={origin.left} cy={origin.top} r={0.72} />
                        </>}
                        <circle className={rm.utilityPoint} cx={spot.left} cy={spot.top} r={1.12}
                            data-ability={ability.name} data-effect={ability.kind}
                            data-side={ability.subject ? side(ability.subject) : undefined}>
                            <title>{ability.kind === "teleport" ? `${ability.name} destination` : ability.name}</title>
                        </circle>
                    </g>;
                })}
                {recentShots.map((moment) => {
                    const from = poses.get(moment.actor!);
                    const to = poses.get(moment.target!);
                    if (!from || !to) return null;
                    const a = plot(from.x, from.y);
                    const b = plot(to.x, to.y);
                    return <line key={moment.id} className={rm.shot} x1={a.left} y1={a.top} x2={b.left} y2={b.top} data-side={moment.ally ? "ally" : "enemy"} style={{ opacity: 1 - (time - moment.time) / SHOT_MS }} />;
                })}
            </svg>
            {plant && time >= plant.time && (!defuse || time < defuse.time) ? (() => {
                const spot = plot(plant.x, plant.y);
                return <i className={rm.spike} style={{ left: `${spot.left}%`, top: `${spot.top}%` }} title={`Spike planted at ${fmtLength(plant.time)}`} />;
            })() : null}
            {[...poses.entries()].map(([subject, pose]) => {
                const spot = plot(pose.x, pose.y);
                const icon = agentIcon(subject);
                const you = subject === localSubject;
                const showName = !pose.dead && (names === "all" || you || involved.has(subject) || subject === focus);
                return <span
                    key={subject}
                    className={rm.token}
                    data-side={side(subject)}
                    data-you={you || undefined}
                    data-dead={pose.dead || undefined}
                    data-hot={involved.has(subject) || undefined}
                    data-focus={subject === focus || undefined}
                    style={{ left: `${spot.left}%`, top: `${spot.top}%`, backgroundImage: icon ? `url("${icon}")` : undefined }}
                    title={pose.dead ? `${playerName(subject)} died at ${fmtLength(pose.deathMs)}` : playerName(subject)}
                >
                    {showName ? <b>{you ? "You" : playerName(subject)}</b> : null}
                </span>;
            })}
        </div>
    );
}

/** Play, speed, a draggable round timeline with kill and plant markers, and the round clock. */
export function ReplayTimeline({ clock, moments, current, compact = false, onPickSmoke, children }: { clock: ReplayClock; moments: ReplayMoment[]; current: string | null; compact?: boolean; onPickSmoke?: (moment: ReplayMoment) => void; children?: ReactNode }) {
    const { time, seek, playing, toggle, speed, cycleSpeed, firstMs, lastMs } = clock;
    const trackRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect) return;
        seek(firstMs + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (lastMs - firstMs));
    };
    const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
        const jump = event.shiftKey ? 10_000 : 3_000;
        if (event.key === "ArrowRight") seek(time + jump);
        else if (event.key === "ArrowLeft") seek(time - jump);
        else if (event.key === "Home") seek(firstMs);
        else if (event.key === "End") seek(lastMs);
        else if (event.key === " " || event.key === "Enter") toggle();
        else return;
        event.preventDefault();
        event.stopPropagation();
    };
    const at = (value: number) => ((value - firstMs) / Math.max(1, lastMs - firstMs)) * 100;
    const label = replayClockLabel(time);
    return (
        <div className={rm.timeline} data-compact={compact || undefined}>
            <button type="button" className={rm.play} aria-label={playing ? "Pause the round" : "Play the round"} aria-pressed={playing} onClick={toggle}>
                {playing
                    ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>}
            </button>
            <button type="button" className={rm.speed} onClick={cycleSpeed} aria-label={`Playback speed ${speed}x`}>{speed}×</button>
            <div
                ref={trackRef}
                className={rm.track}
                role="slider"
                tabIndex={0}
                aria-label="Round time"
                aria-valuemin={Math.round(firstMs / 1000)}
                aria-valuemax={Math.round(lastMs / 1000)}
                aria-valuenow={Math.round(time / 1000)}
                aria-valuetext={label}
                onKeyDown={onKey}
                onPointerDown={(event) => {
                    if ((event.target as HTMLElement).tagName === "BUTTON") return;
                    dragging.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    seekFromPointer(event);
                }}
                onPointerMove={(event) => { if (dragging.current) seekFromPointer(event); }}
                onPointerUp={() => { dragging.current = false; }}
                onPointerCancel={() => { dragging.current = false; }}
            >
                <span className={rm.buy} style={{ width: `${at(0)}%` }} aria-hidden="true" />
                <span className={rm.progress} style={{ width: `${at(time)}%` }} aria-hidden="true" />
                <i className={rm.thumb} style={{ left: `${at(time)}%` }} aria-hidden="true" />
                {moments.map((moment) => <button
                    key={moment.id}
                    type="button"
                    tabIndex={-1}
                    data-kind={moment.kind}
                    data-effect={moment.utility?.kind}
                    data-side={moment.ally === undefined ? undefined : moment.ally ? "ally" : "enemy"}
                    data-active={moment.id === current || (moment.kind === "smoke" && moment.time === time) || undefined}
                    data-past={moment.time <= time || undefined}
                    style={{ left: `${at(moment.time)}%` }}
                    onClick={() => {
                        if (moment.utility) clock.setPlaying(false);
                        if (moment.kind === "smoke") {
                            clock.setPlaying(false);
                            onPickSmoke?.(moment);
                        }
                        seek(replayMomentTime(moment));
                    }}
                    aria-label={`${moment.kind === "smoke" || moment.utility ? smokeTime(moment.time) : fmtLength(moment.time)} ${moment.label}`}
                    title={`${moment.kind === "smoke" || moment.utility ? smokeTime(moment.time) : fmtLength(moment.time)} · ${moment.label}`}
                />)}
            </div>
            {time < -3_000 ? <button type="button" className={rm.skip} onClick={() => seek(-2_000)} title="Jump to just before the barrier drops">Skip buy</button> : null}
            <time className={rm.clock}>{label}</time>
            {children}
        </div>
    );
}

/** The latest moment at or before the clock. */
export function currentMomentId(moments: ReplayMoment[], time: number) {
    let id: string | null = null;
    for (const moment of moments) if (moment.time <= time) id = moment.id;
    return id;
}

/**
 * Every player's movement through one round inside the Round review panel.
 * Time is Riot's round clock: 0 is the barrier drop, so kill-feed moments line up.
 */
export function FullRoundReplay({
    round,
    plot,
    teamOf,
    localSubject,
    localTeam,
    agentIcon,
    playerName,
    moments,
    activeMomentId,
    onMoment,
    onExpand,
    plant,
    children,
}: {
    round: ReplayRound;
    plot: PlotFn;
    teamOf: (subject: string) => string;
    localSubject: string;
    localTeam: string;
    agentIcon: (subject?: string) => string | undefined;
    playerName: (subject?: string) => string;
    moments: ReplayMoment[];
    activeMomentId: string | null;
    onMoment: (id: string) => void;
    onExpand: (time: number) => void;
    plant?: { time: number; x: number; y: number };
    children: ReactNode;
}) {
    const clock = useReplayClock(round);
    const { time, seek } = clock;
    const emitted = useRef<string | null>(null);
    // The feed's pick when this round opened is not a request to jump.
    const activeRef = useRef(activeMomentId);
    const lastSeen = useRef(activeMomentId);
    useEffect(() => { activeRef.current = activeMomentId; });
    useEffect(() => {
        emitted.current = null;
        lastSeen.current = activeRef.current;
    }, [round]);

    // Follow the clock in the kill feed, and jump when a feed moment is picked there.
    const current = useMemo(() => currentMomentId(moments, time), [moments, time]);
    useEffect(() => {
        if (current && current !== activeMomentId) {
            emitted.current = current;
            onMoment(current);
        }
    }, [activeMomentId, current, onMoment]);
    useEffect(() => {
        if (activeMomentId === lastSeen.current) return;
        lastSeen.current = activeMomentId;
        if (!activeMomentId || activeMomentId === emitted.current) return;
        const picked = moments.find((moment) => moment.id === activeMomentId);
        if (!picked) return;
        emitted.current = activeMomentId;
        seek(picked.time - 2_000);
    }, [activeMomentId, moments, seek]);

    const side = useCallback((subject: string): ReplaySide => teamOf(subject) === localTeam ? "ally" : "enemy", [localTeam, teamOf]);
    const smokes = useMemo(() => smokeMoments(round, moments, side, playerName), [round, moments, side, playerName]);
    const utility = useMemo(() => replayUtilityMoments(round, side, playerName), [round, side, playerName]);
    const timeline = useMemo(() => [...moments, ...smokes, ...utility].sort((a, b) => a.time - b.time), [moments, smokes, utility]);
    const activeSmoke = (round.smokes || []).reduce((active, smoke, index) => (
        smoke.startMs <= time && time < smoke.endMs ? index : active
    ), -1);

    return (
        <>
            <div className={rr.mapWrap}>
                <div className={rr.map} data-replay data-full>
                    {children}
                    <ReplayMapLayer round={round} time={time} plot={plot} side={side} localSubject={localSubject} agentIcon={agentIcon} playerName={playerName} moments={moments} plant={plant} />
                    <button type="button" className={rm.expand} onClick={() => { clock.setPlaying(false); onExpand(time); }} aria-label="Open the big replay view" title="Big replay view">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
                    </button>
                </div>
            </div>
            <ReplayTimeline clock={clock} moments={timeline} current={current} compact />
            {smokes.length ? <div className={rm.smokeRow} aria-label="Dark Cover deployments">
                <span>Dark Cover</span>
                <div className={rm.smokeTimes}>
                    {smokes.map((smoke, index) => <button key={smoke.id} type="button" title={smoke.label}
                        aria-label={`${smokeTime(smoke.time)} · ${smoke.label}`} data-active={index === activeSmoke || undefined}
                        onClick={() => { clock.setPlaying(false); seek(smoke.time); }}>
                        {smokeTime(smoke.time)}
                    </button>)}
                </div>
                {activeSmoke >= 0 ? <small>{smokes[activeSmoke].note}</small> : null}
            </div> : null}
            {utility.length > 0 && <div className={rm.utilityRow} aria-label="Recorded abilities">
                {utility.map(moment => <button type="button" key={moment.id}
                    aria-pressed={isReplayUtilityVisible(moment.utility, time)}
                    onClick={() => { clock.setPlaying(false); seek(moment.time); }}>
                    <time>{smokeTime(moment.time)}</time> {moment.label}
                </button>)}
            </div>}
        </>
    );
}
