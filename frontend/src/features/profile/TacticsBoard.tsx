"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { mapCalloutLabel, mapCalloutPlotPosition, type AgentMeta, type MapMeta } from "./profileShared";
import { blankBoard, boardId, clampPercent, loadPlaybook, PLAYBOOK_KEY, validBoardPlan, type BoardPhase, type BoardPiece, type BoardPlan, type BoardRoute, type BoardSide } from "./tacticsBoardModel";
import css from "./TacticsBoard.module.css";
import coverage from "./AbilityCoverage.module.css";
import { abilityCoverageRadii } from "./abilityCoverage";

type Tool = "move" | "route" | "spike" | "pan" | "agent" | "utility";
type Point = Pick<BoardPiece, "x" | "y">;
type Stroke = { pointer: number; piece?: BoardPiece; route?: BoardRoute; points: Point[] };
type Placement = Pick<BoardPiece, "kind" | "agentId" | "ability">;
type PaletteDrag = { pointer: number; start: Point; placement: Placement; moved: boolean };
const PREVIEW_ID = "palette-preview";
const tools = [
    ["move", "Move", "V", "M5 3l14 9-7 1-3 7z"],
    ["route", "Route", "R", "M4 19l6-7 4 2 6-9m-6 0h6v6"],
    ["spike", "Spike", "P", "M12 3l8 9-8 9-8-9zM12 8v8"],
    ["pan", "Pan", "H", "M12 3v18M3 12h18M9 6l3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3"],
] as const;

export function tacticsMaps(maps: Record<string, MapMeta>, replayMap?: MapMeta) {
    const available = Object.values(maps).filter(map => map.mode === "standard" && map.displayIcon &&
        [map.xMultiplier, map.yMultiplier, map.xScalarToAdd, map.yScalarToAdd].every(Number.isFinite));
    if (replayMap) available.push(replayMap);
    return [...new Map(available.map(map => [map.uuid, map])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function TacticsBoard({ maps, agents, seed, confirmUntouchedSeed = true, onClose }: {
    maps: MapMeta[]; agents: Record<string, AgentMeta>; seed?: BoardPlan; confirmUntouchedSeed?: boolean; onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const zoomAnchor = useRef<{ screen: Point; map: Point } | null>(null);
    const stroke = useRef<Stroke | null>(null);
    const pan = useRef<{ pointer: number; start: Point; scroll: Point } | null>(null);
    const paletteDrag = useRef<PaletteDrag | null>(null);
    const suppressPaletteClick = useRef(false);
    const paletteFilter = useId();
    const [playbook, setPlaybook] = useState(loadPlaybook);
    const [history, setHistory] = useState(() => ({
        past: [] as BoardPlan[], now: seed ?? blankBoard(maps[0]?.uuid || ""), future: [] as BoardPlan[],
    }));
    const plan = history.now;
    const map = maps.find(entry => entry.uuid === plan.mapId);
    const [stepIndex, setStep] = useState(0);
    const step = Math.min(stepIndex, plan.phases.length - 1);
    const phase = plan.phases[step];
    const palette = Object.entries(agents).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const [agentId, setAgent] = useState(() => seed?.phases[0].pieces.find(piece => agents[piece.agentId]?.name === "Omen")?.agentId || palette[0]?.[0] || "");
    const agent = agents[agentId];
    const [ability, setAbility] = useState("");
    const [role, setRole] = useState("");
    const [side, setSide] = useState<BoardSide>("ally");
    const [tool, setTool] = useState<Tool>("move");
    const [selected, setSelected] = useState<string>();
    const [draft, setDraft] = useState<Stroke | null>(null);
    const [palettePreview, setPalettePreview] = useState<BoardPiece | null>(null);
    const [panning, setPanning] = useState(false);
    const [callouts, setCallouts] = useState(false);
    const [showPlaybook, setShowPlaybook] = useState(false);
    const [gameColors, setGameColors] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [playing, setPlaying] = useState(false);
    const [message, setMessage] = useState("");
    const [importedId, setImportedId] = useState("");
    const saved = playbook.find(entry => entry.id === plan.id);
    const dirty = saved
        ? JSON.stringify(plan) !== JSON.stringify(saved)
        : (confirmUntouchedSeed && seed?.id === plan.id) || importedId === plan.id || history.past.length > 0;
    const mayDiscard = () => {
        const focused = document.activeElement;
        const pending = (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && focused.value !== focused.defaultValue;
        return !(dirty || pending) || window.confirm("Leave this play without saving the changes?");
    };
    const close = () => { if (mayDiscard()) onClose(); };

    useEffect(() => {
        const element = dialog.current;
        element?.showModal();
        return () => { element?.close(); };
    }, []);
    useEffect(() => {
        if (!playing) return;
        const timer = window.setTimeout(() => {
            if (step + 1 < plan.phases.length) setStep(step + 1);
            else setPlaying(false);
        }, phase.seconds * 1000);
        return () => window.clearTimeout(timer);
    }, [phase.seconds, plan.phases.length, playing, step]);
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const onWheel = (event: WheelEvent) => {
            const board = mapRef.current;
            if (!board || event.ctrlKey || !event.deltaY) return;
            event.preventDefault();
            const next = Math.min(2, Math.max(1, zoom - Math.sign(event.deltaY) * 0.25));
            if (next === zoom) return;
            const rect = board.getBoundingClientRect();
            zoomAnchor.current = {
                screen: { x: event.clientX, y: event.clientY },
                map: { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height },
            };
            setZoom(next);
        };
        viewport.addEventListener("wheel", onWheel, { passive: false });
        return () => viewport.removeEventListener("wheel", onWheel);
    }, [zoom]);
    useLayoutEffect(() => {
        const anchor = zoomAnchor.current;
        zoomAnchor.current = null;
        const viewport = viewportRef.current;
        const rect = mapRef.current?.getBoundingClientRect();
        if (!anchor || !viewport || !rect) return;
        viewport.scrollBy(rect.left + rect.width * anchor.map.x - anchor.screen.x, rect.top + rect.height * anchor.map.y - anchor.screen.y);
    }, [zoom]);

    const commit = (next: BoardPlan) => {
        setHistory(previous => ({ past: [...previous.past.slice(-39), previous.now], now: next, future: [] }));
        setMessage("");
    };
    const update = (next: BoardPhase) => commit({ ...plan, phases: plan.phases.map((entry, i) => i === step ? next : entry) });
    const chooseStep = (index: number) => { setPlaying(false); setSelected(undefined); setStep(index); };
    const chooseTool = (next: Tool) => { setTool(next); setSelected(undefined); };
    const open = (next: BoardPlan, imported = false) => {
        if (!mayDiscard()) return;
        setHistory({ past: [], now: next, future: [] });
        chooseStep(0);
        setZoom(1);
        setImportedId(imported ? next.id : "");
        setMessage(imported ? "Play imported. Save it to keep it in your playbook." : "");
    };
    const undo = () => {
        setSelected(undefined);
        setMessage("");
        setHistory(previous => previous.past.length ? {
            past: previous.past.slice(0, -1), now: previous.past[previous.past.length - 1], future: [previous.now, ...previous.future],
        } : previous);
    };
    const redo = () => {
        setSelected(undefined);
        setMessage("");
        setHistory(previous => previous.future.length ? {
            past: [...previous.past, previous.now], now: previous.future[0], future: previous.future.slice(1),
        } : previous);
    };
    const store = (entries: BoardPlan[]) => {
        try {
            localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(entries));
            setPlaybook(entries);
            return true;
        } catch {
            setMessage("Could not save locally. Export the play to keep a copy.");
            return false;
        }
    };
    const save = () => {
        const normalized = { ...plan, name: plan.name.trim() || "Untitled play" };
        if (map && store([normalized, ...loadPlaybook().filter(entry => entry.id !== plan.id)])) {
            setHistory(previous => ({ ...previous, now: normalized }));
            setMessage("Saved on this device.");
        }
    };
    const exportPlan = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = (plan.name.trim() || "valorant-play").replace(/[^a-z0-9_-]+/gi, "-") + ".json";
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const importPlan = async (file?: File) => {
        if (!file) return;
        try {
            if (file.size > 4_000_000) throw new Error();
            const imported: unknown = JSON.parse(await file.text());
            if (!validBoardPlan(imported) || !maps.some(candidate => candidate.uuid === imported.mapId)) throw new Error();
            open({ ...imported, id: boardId() }, true);
        } catch { setMessage("Could not open this play file. Choose a VantaVault plan for an available map."); }
    };
    const addStep = () => {
        const name = ["Setup", "Execute", "Post-plant", "Retake"][plan.phases.length] || "Step " + (plan.phases.length + 1);
        const phases = [...plan.phases];
        phases.splice(step + 1, 0, { ...phase, name, seconds: 6, notes: "", routes: [] });
        commit({ ...plan, phases });
        chooseStep(step + 1);
    };
    const place = (position: Point, placement: Placement) => {
        if (phase.pieces.length >= 80 || (placement.kind !== "spike" && !agents[placement.agentId])) return;
        const piece: BoardPiece = { ...position, ...placement, id: boardId(), side };
        update({ ...phase, pieces: [...(piece.kind === "spike" ? phase.pieces.filter(entry => entry.kind !== "spike") : phase.pieces), piece] });
        setSelected(piece.id);
    };
    const addPiece = (position: Point) => {
        if (tool === "move" || tool === "route" || tool === "pan") return;
        place(position, { kind: tool, agentId: tool === "spike" ? "" : agentId, ability: tool === "utility" ? ability : undefined });
    };
    const palettePosition = (event: PointerEvent<HTMLButtonElement>) => {
        const board = mapRef.current;
        return board?.contains(document.elementFromPoint(event.clientX, event.clientY)) ? locate(event, board) : null;
    };
    const finishPalette = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
        const drag = paletteDrag.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        paletteDrag.current = null;
        setPalettePreview(null);
        if (!drag.moved) return;
        suppressPaletteClick.current = true;
        const position = !cancel && !playing && palettePosition(event);
        if (!position) return;
        setTool("move");
        setAgent(drag.placement.agentId);
        place(position, drag.placement);
    };
    const paletteHandlers = (placement: Placement, select: () => void) => ({
        onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
            if (playing || paletteDrag.current || stroke.current || pan.current || !event.isPrimary || event.button !== 0) return;
            suppressPaletteClick.current = false;
            paletteDrag.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, placement, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
            const drag = paletteDrag.current;
            if (!drag || drag.pointer !== event.pointerId) return;
            drag.moved ||= Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 5;
            if (!drag.moved) return;
            const position = palettePosition(event);
            setPalettePreview(position ? { ...position, ...drag.placement, id: PREVIEW_ID, side } : null);
        },
        onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finishPalette(event),
        onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finishPalette(event, true),
        onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finishPalette(event, true),
        onClick: (event: MouseEvent<HTMLButtonElement>) => {
            if (!suppressPaletteClick.current || event.detail === 0) select();
            suppressPaletteClick.current = false;
        },
    });
    const movePiece = (piece: BoardPiece, position: Point) => update({ ...phase, pieces: phase.pieces.map(entry => entry.id === piece.id ? { ...entry, ...position } : entry) });
    const moveRoute = (route: BoardRoute, start: Point, end: Point) => {
        const moved = shiftRoute(route, start, end);
        if (moved !== route) update({ ...phase, routes: phase.routes.map(entry => entry.id === route.id ? moved : entry) });
    };
    const removeSelected = () => {
        if (!selected) return;
        update({ ...phase, pieces: phase.pieces.filter(piece => piece.id !== selected), routes: phase.routes.filter(route => route.id !== selected) });
        setSelected(undefined);
    };
    const locate = (event: { clientX: number; clientY: number }, target: HTMLElement): Point => {
        const rect = target.getBoundingClientRect();
        return { x: clampPercent((event.clientX - rect.left) / rect.width * 100), y: clampPercent((event.clientY - rect.top) / rect.height * 100) };
    };
    const down = (event: PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary || stroke.current || pan.current || paletteDrag.current) return;
        const viewport = viewportRef.current;
        if (viewport && (event.button === 1 || (event.button === 0 && tool === "pan"))) {
            event.preventDefault();
            pan.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, scroll: { x: viewport.scrollLeft, y: viewport.scrollTop } };
            event.currentTarget.setPointerCapture(event.pointerId);
            setPanning(true);
            return;
        }
        if (playing || event.button !== 0 || tool === "pan") return;
        const position = locate(event, event.currentTarget);
        const routeId = (event.target as Element).closest<SVGElement>("[data-route]")?.dataset.route;
        const route = tool === "move" ? phase.routes.find(entry => entry.id === routeId) : undefined;
        const id = (event.target as Element).closest<HTMLElement>("[data-piece]")?.dataset.piece;
        const piece = tool !== "route" ? phase.pieces.find(entry => entry.id === id) : undefined;
        if (!piece && tool !== "move" && tool !== "route") { addPiece(position); return; }
        if (tool !== "route") {
            setSelected(piece?.id || route?.id);
            if (tool === "move" && piece?.agentId && agents[piece.agentId]) setAgent(piece.agentId);
        }
        if (tool === "move" && !piece && !route || tool === "route" && phase.routes.length >= 60) return;
        stroke.current = { pointer: event.pointerId, piece, route, points: [position] };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent<HTMLDivElement>) => {
        const activePan = pan.current;
        if (activePan?.pointer === event.pointerId) {
            viewportRef.current?.scrollTo(activePan.scroll.x + activePan.start.x - event.clientX, activePan.scroll.y + activePan.start.y - event.clientY);
            return;
        }
        const active = stroke.current;
        if (!active || active.pointer !== event.pointerId) return;
        const position = locate(event, event.currentTarget);
        const last = active.points[active.points.length - 1];
        if (Math.hypot(position.x - last.x, position.y - last.y) < 0.6) return;
        const next = { ...active, points: [...active.points.slice(0, active.piece || active.route ? 1 : 98), position] };
        stroke.current = next;
        setDraft(next);
    };
    const shift = (piece: Point, start: Point, end: Point) => ({
        x: clampPercent(piece.x + end.x - start.x), y: clampPercent(piece.y + end.y - start.y),
    });
    const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
        if (pan.current?.pointer === event.pointerId) {
            pan.current = null;
            setPanning(false);
            return;
        }
        const active = stroke.current;
        if (!active || active.pointer !== event.pointerId) return;
        stroke.current = null;
        setDraft(null);
        if (cancel) return;
        const end = locate(event, event.currentTarget);
        const start = active.points[0];
        if (active.piece) {
            if (Math.hypot(end.x - start.x, end.y - start.y) > 0.35) movePiece(active.piece, shift(active.piece, start, end));
        } else if (active.route) {
            if (Math.hypot(end.x - start.x, end.y - start.y) > 0.35) moveRoute(active.route, start, end);
        } else {
            const last = active.points[active.points.length - 1];
            const points = end.x === last.x && end.y === last.y ? active.points : [...active.points, end];
            if (points.some(point => Math.hypot(point.x - start.x, point.y - start.y) > 1)) {
                update({ ...phase, routes: [...phase.routes, { id: boardId(), side, points }] });
            }
        }
    };
    const onKey = (event: KeyboardEvent<HTMLDialogElement>) => {
        event.stopPropagation();
        if (playing || (event.target as Element).closest("input, textarea, select")) return;
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
        else if (key === "delete") { event.preventDefault(); removeSelected(); }
        else if (!event.ctrlKey && !event.metaKey) {
            const item = tools.find(([, , shortcut]) => shortcut.toLowerCase() === key);
            if (item) chooseTool(item[0]);
        }
    };
    const drawRoute = (route: BoardRoute, index?: number) => {
        const points = route.points.map(p => p.x + "," + p.y).join(" ");
        return <g key={route.id}>
            <polyline data-side={route.side} data-selected={selected === route.id || undefined} points={points} markerEnd={"url(#tactics-arrow-" + route.side + ")"} />
            {index !== undefined && tool === "move" && !playing ? <polyline className={css.routeHit} points={points} data-route={route.id}
                role="button" tabIndex={0} aria-label={(route.side === "ally" ? "Ally" : "Enemy") + " route " + (index + 1)}
                aria-pressed={selected === route.id} onClick={() => setSelected(route.id)}
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(route.id);
                    }
                    const delta = arrowDelta(event);
                    if (delta) {
                        setSelected(route.id);
                        moveRoute(route, { x: 0, y: 0 }, delta);
                    }
                }} /> : null}
        </g>;
    };
    const hint = {
        move: "Drag items onto the map, or drag pieces and routes to move them.",
        route: "Drag on the map to draw.",
        pan: zoom <= 1 ? "Zoom in, then drag to pan." : "Drag to pan the map.",
        agent: "Click to place " + (agent?.name || "an agent") + ".",
        utility: "Click to place " + (agent?.abilities?.[ability]?.name || "an ability") + ".",
        spike: "Click to place the spike.",
    }[tool];

    return createPortal(<dialog ref={dialog} className={css.shell} aria-labelledby="tactics-title" onKeyDown={onKey}
        onCancel={event => { event.preventDefault(); close(); }} onClick={event => event.stopPropagation()}>
        <header className={css.header} style={{ "--map-art": map?.splash ? "url(" + map.splash + ")" : "none" } as CSSProperties}>
            <div className={css.identity}><h2 id="tactics-title">Tactics board</h2>{plan.source ? <span>{plan.source}</span> : null}</div>
            <label><span>Play name</span><input key={plan.id + plan.name} defaultValue={plan.name} maxLength={100} disabled={playing}
                onBlur={event => { if (event.currentTarget.value !== plan.name) commit({ ...plan, name: event.currentTarget.value }); }}
                onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            <label><span>Map</span><select value={plan.mapId} disabled={playing} onChange={event => open(blankBoard(event.currentTarget.value))}>
                {maps.map(entry => <option key={entry.uuid} value={entry.uuid}>{entry.name}</option>)}
            </select></label>
            <button type="button" className={css.inspectorButton} aria-expanded={showPlaybook} aria-controls="tactics-playbook" onClick={() => setShowPlaybook(value => !value)}>Playbook</button>
            <button type="button" className={css.save} disabled={!map || playing} onClick={save}>Save play</button>
            <button type="button" className={css.close} aria-label="Close tactics board" onClick={close}>×</button>
        </header>
        <div className={css.layout} data-inspector={showPlaybook || undefined}>
            <main className={css.stage}>
                <div className={css.stageBar}>
                    <div className={css.toolList} aria-label="Board tools">{tools.map(([id, label, key, icon]) =>
                    <button key={id} type="button" aria-label={label} title={label + " (" + key + ")"} aria-keyshortcuts={key} disabled={playing} aria-pressed={tool === id} onClick={() => chooseTool(id)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg><span>{label}</span>
                    </button>)}</div>
                    <div className={css.viewTools}>
                    <button type="button" disabled={playing || !history.past.length} onClick={undo}>Undo</button>
                    <button type="button" disabled={playing || !history.future.length} onClick={redo}>Redo</button>
                    <button type="button" aria-pressed={callouts} onClick={() => setCallouts(value => !value)}>Callouts</button>
                    <button type="button" aria-pressed={gameColors} onClick={() => setGameColors(value => !value)}>Game colors</button>
                    </div>
                </div>
                <div ref={viewportRef} className={css.mapScroll}>
                    {map ? <div ref={mapRef} className={css.map} data-tool={tool} data-panning={panning || undefined} data-playing={playing || undefined} tabIndex={0} aria-label={map.name + " tactics map"}
                        style={{ "--zoom": zoom, "--map-palette": `url("#${paletteFilter}")` } as CSSProperties} onPointerDown={down} onPointerMove={move}
                        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
                        onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget && !playing) addPiece({ x: 50, y: 50 }); }}>
                        <img className={css.mapImage} data-tactical={!gameColors || undefined} src={map.displayIcon} alt={map.name + " minimap"} draggable={false} />
                        {map.callouts.map((item, index) => {
                            const site = /^[A-C]$/i.test(item.superRegion.trim()) && /^(?:[A-C] )?Site$/i.test(item.name.trim());
                            if (!site && !callouts) return null;
                            const position = mapCalloutPlotPosition(map, item);
                            return <span key={index} className={css.callout} data-callout="" data-site={site || undefined} style={{ left: position.left * 100 + "%", top: position.top * 100 + "%" }}>{site ? item.superRegion.trim() : mapCalloutLabel(item)}</span>;
                        })}
                        <svg className={css.routes} viewBox="0 0 100 100" aria-label="Planned routes">
                            <defs>
                                <filter id={paletteFilter} colorInterpolationFilters="sRGB"><feComponentTransfer>
                                    <feFuncR type="table" tableValues="0 .014 .023 .042 .07 .116 .21 .43 .63" />
                                    <feFuncG type="table" tableValues=".025 .05 .078 .10 .17 .27 .42 .62 .80" />
                                    <feFuncB type="table" tableValues=".038 .07 .102 .15 .24 .34 .55 .69 .82" />
                                </feComponentTransfer></filter>
                                {(["ally", "enemy"] as const).map(team => <marker key={team} id={"tactics-arrow-" + team} markerWidth="4" markerHeight="4" refX="3.3" refY="2" orient="auto" viewBox="0 0 4 4"><path data-side={team} d="M0 0l4 2-4 2 1-2z" /></marker>)}
                            </defs>
                            {phase.routes.map((route, index) => drawRoute(draft?.route?.id === route.id
                                ? shiftRoute(route, draft.points[0], draft.points[draft.points.length - 1])
                                : route, index))}
                            {draft && !draft.piece && !draft.route ? drawRoute({ id: "draft", side, points: draft.points }) : null}
                        </svg>
                        {(palettePreview ? [...phase.pieces, palettePreview] : phase.pieces).map(piece => {
                            const preview = piece === palettePreview;
                            const meta = agents[piece.agentId];
                            const utility = piece.kind === "utility" ? meta?.abilities?.[piece.ability || ""] : undefined;
                            const name = piece.kind === "spike" ? "Spike" : piece.kind === "agent" ? meta?.name || "Agent" : utility?.name || (piece.ability === "dark-cover" ? "Dark Cover" : "Utility");
                            const radius = piece.kind === "utility" ? abilityCoverageRadii.get(name) : undefined;
                            const icon = piece.kind === "agent" ? meta?.icon : utility?.icon;
                            const position = draft?.piece?.id === piece.id ? shift(piece, draft.points[0], draft.points[draft.points.length - 1]) : piece;
                            const coverageStyle = radius ? {
                                "--coverage-width": Math.abs(map.xMultiplier || 0) * radius * 200 + "cqw",
                                "--coverage-height": Math.abs(map.yMultiplier || 0) * radius * 200 + "cqw",
                            } : undefined;
                            return <div key={preview ? "preview:" + piece.id : piece.id} className={css.pin} data-kind={piece.kind} data-side={piece.side} data-coverage={radius ? true : undefined}
                                data-preview={preview || undefined} aria-hidden={preview || undefined}
                                style={{ left: position.x + "%", top: position.y + "%", ...coverageStyle } as CSSProperties}>
                                {radius ? <span aria-hidden="true" className={`${css.abilityCoverage} ${coverage.texture}`} data-effect={name} /> : null}
                                <button type="button" data-piece={piece.id} title={name} aria-label={name + " · " + (piece.side === "ally" ? "Ally" : "Enemy")}
                                    aria-pressed={selected === piece.id} disabled={playing || preview} onFocus={() => { if (tool === "move") setSelected(piece.id); }}
                                    onKeyDown={event => {
                                        const delta = arrowDelta(event);
                                        if (delta) movePiece(piece, shift(piece, { x: 0, y: 0 }, delta));
                                    }}>{radius ? null : icon ? <img src={icon} alt="" draggable={false} /> : piece.kind === "spike" ? "◇" : name.slice(0, 2)}</button>
                            </div>;
                        })}
                    </div> : <p className={css.empty}>Choose an available map.</p>}
                </div>
                <footer className={css.stageFoot}><span>{playing ? "Previewing " + phase.name : hint}</span><div>
                    <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(zoom - 0.25)}>−</button>
                    <button type="button" title="Reset map zoom" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                    <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(zoom + 0.25)}>+</button>
                </div></footer>
            </main>
            <aside className={css.rail} id="tactics-playbook" aria-label="Playbook and step details" hidden={!showPlaybook}>
                <section><div className={css.sectionHead}><h3>Playbook</h3><button type="button" onClick={() => open(blankBoard(plan.mapId))}>New</button></div>
                    <select aria-label="Saved plays" value={saved?.id || ""} onChange={event => {
                        const entry = playbook.find(item => item.id === event.currentTarget.value);
                        if (entry) open(entry);
                    }}><option value="">Unsaved play</option>{playbook.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {maps.find(item => item.uuid === entry.mapId)?.name || "Unknown map"}</option>)}</select>
                    <div className={css.fileActions}>
                        <button type="button" onClick={() => input.current?.click()}>Import</button>
                        <button type="button" disabled={!map} onClick={exportPlan}>Export</button>
                        {saved ? <button type="button" className={css.remove} onClick={() => {
                            if (window.confirm("Delete this play?") && store(loadPlaybook().filter(entry => entry.id !== saved.id))) {
                                setHistory({ past: [], now: blankBoard(plan.mapId), future: [] });
                                chooseStep(0);
                                setMessage("Play deleted.");
                            }
                        }}>Delete play</button> : null}
                        <input ref={input} type="file" accept=".json,application/json" hidden onChange={event => { void importPlan(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
                    </div>
                </section>
                <section key={JSON.stringify([plan.id, step, phase.name, phase.seconds, phase.notes])}>
                    <h3>Step details</h3>
                    <div className={css.stepFields}>
                        <label><span>Step name</span><input defaultValue={phase.name} maxLength={60} disabled={playing} onBlur={event => {
                            if (phase.name !== event.currentTarget.value) update({ ...phase, name: event.currentTarget.value });
                        }} /></label>
                        <label><span>Seconds</span><input type="number" min={1} max={90} defaultValue={phase.seconds} disabled={playing} onBlur={event => {
                            const seconds = Math.min(90, Math.max(1, Math.round(Number(event.currentTarget.value) || phase.seconds)));
                            event.currentTarget.value = String(seconds);
                            if (phase.seconds !== seconds) update({ ...phase, seconds });
                        }} /></label>
                    </div>
                    <label><span>Notes</span><textarea defaultValue={phase.notes} maxLength={2000} disabled={playing} placeholder="What should the team do here?" onBlur={event => {
                        if (phase.notes !== event.currentTarget.value) update({ ...phase, notes: event.currentTarget.value });
                    }} /></label>
                    <div className={css.fileActions}>
                        {selected ? <button type="button" disabled={playing} onClick={removeSelected}>Remove selected</button> : null}
                        {plan.phases.length > 1 ? <button type="button" className={css.remove} disabled={playing} onClick={() => {
                            commit({ ...plan, phases: plan.phases.filter((_, index) => index !== step) });
                            chooseStep(Math.max(0, step - 1));
                        }}>Remove step</button> : null}
                    </div>
                </section>
            </aside>
        </div>
        <section className={css.dock} aria-label="Sequence and agent palette">
            <div className={css.dockTop}>
                <div className={css.sequence}>
                    <button type="button" className={css.preview} aria-label={playing ? "Stop preview" : "Preview play"} title={playing ? "Stop preview" : "Preview play"} disabled={!map} onClick={() => { setSelected(undefined); if (!playing) setStep(0); setPlaying(!playing); }}>
                        <span aria-hidden="true">{playing ? "■" : "▶"}</span>
                    </button>
                    <ol className={css.steps}>{plan.phases.map((entry, index) => <li key={index}><button type="button" aria-current={index === step ? "step" : undefined} onClick={() => chooseStep(index)}>
                        <b>{index + 1}</b><span>{entry.name || "Untitled step"}</span><time>{entry.seconds}s</time>
                    </button></li>)}</ol>
                    <button type="button" disabled={!map || playing || plan.phases.length >= 20} onClick={addStep}>+ Step</button>
                </div>
                <div className={css.abilityRow}>
                    <div className={css.teams} aria-label="Placement team">{(["ally", "enemy"] as const).map(team =>
                        <button key={team} type="button" disabled={playing} data-side={team} aria-pressed={side === team} onClick={() => setSide(team)}>{team === "ally" ? "Ally" : "Enemy"}</button>)}</div>
                    {agent?.abilities ? <div className={css.abilities} aria-label={agent.name + " abilities"}>
                        <strong>{agent.name}</strong>
                        {Object.entries(agent.abilities).filter(([slot]) => slot !== "passive").map(([slot, entry]) =>
                            <button key={slot} type="button" title={"Drag or click to place " + entry.name} aria-label={"Place " + entry.name} disabled={playing}
                                aria-pressed={tool === "utility" && ability === slot}
                                {...paletteHandlers({ kind: "utility", agentId, ability: slot }, () => { setAbility(slot); chooseTool("utility"); })}>
                                {entry.icon ? <span className={`${css.abilitySwatch} ${coverage.texture}`} data-effect={abilityCoverageRadii.has(entry.name) ? entry.name : undefined}>
                                    <img src={entry.icon} alt="" draggable={false} />
                                </span> : null}<span>{entry.name}</span>
                            </button>)}
                    </div> : null}
                </div>
            </div>
            <div className={css.roster}>
                <select className={css.roleFilter} aria-label="Filter agents by role" value={role} onChange={event => setRole(event.currentTarget.value)}>
                    <option value="">All roles</option>
                    {["Controller", "Duelist", "Initiator", "Sentinel"].map(option => <option key={option}>{option}</option>)}
                </select>
                <div className={css.agents}>{palette.filter(([, entry]) => !role || entry.role === role).map(([id, entry]) =>
                    <button key={id} type="button" title={"Drag or click to place " + entry.name} aria-label={"Place " + entry.name} disabled={playing}
                        aria-pressed={agentId === id} {...paletteHandlers({ kind: "agent", agentId: id }, () => { setAgent(id); chooseTool("agent"); })}>
                        {entry.icon ? <img src={entry.icon} alt="" draggable={false} /> : entry.name.slice(0, 2)}
                    </button>)}</div>
            </div>
        </section>
        <div className={css.status} role="status">{message || (dirty ? "Unsaved changes" : saved ? "Saved on this device" : "")}</div>
    </dialog>, document.body);
}

function shiftRoute(route: BoardRoute, start: Point, end: Point): BoardRoute {
    const xs = route.points.map(point => point.x);
    const ys = route.points.map(point => point.y);
    // Bound the whole translation so the route retains its shape at the edge.
    const dx = Math.max(-Math.min(...xs), Math.min(100 - Math.max(...xs), end.x - start.x));
    const dy = Math.max(-Math.min(...ys), Math.min(100 - Math.max(...ys), end.y - start.y));
    return dx || dy ? { ...route, points: route.points.map(({ x, y }) => ({ x: x + dx, y: y + dy })) } : route;
}

function arrowDelta(event: KeyboardEvent): Point | undefined {
    const amount = event.shiftKey ? 5 : 1;
    const delta: Record<string, Point> = {
        ArrowLeft: { x: -amount, y: 0 }, ArrowRight: { x: amount, y: 0 },
        ArrowUp: { x: 0, y: -amount }, ArrowDown: { x: 0, y: amount },
    };
    if (!event.key.startsWith("Arrow") || !delta[event.key]) return;
    event.preventDefault();
    return delta[event.key];
}
