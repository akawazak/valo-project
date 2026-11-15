type Point = { x: number; y: number };
export type BoardSide = "ally" | "enemy";
export type BoardPiece = Point & {
    id: string;
    side: BoardSide;
    agentId: string;
    kind: "agent" | "utility" | "spike";
    ability?: string;
};
export type BoardRoute = { id: string; side: BoardSide; points: Point[] };
export type BoardPhase = { name: string; seconds: number; notes: string; pieces: BoardPiece[]; routes: BoardRoute[] };
export type BoardPlan = { id: string; mapId: string; name: string; source?: string; phases: BoardPhase[] };

export const PLAYBOOK_KEY = "vv:tactics-playbook:v1";
export const boardId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
export const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const point = (value: unknown): value is Point => {
    const item = value as Point | null;
    return !!item && Number.isFinite(item.x) && Number.isFinite(item.y) && item.x >= 0 && item.x <= 100 && item.y >= 0 && item.y <= 100;
};
const side = (value: unknown) => value === "ally" || value === "enemy";
const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

export function validBoardPlan(value: unknown): value is BoardPlan {
    const plan = value as BoardPlan | null;
    if (!plan || !string(plan.id, 80) || !string(plan.mapId, 100) || !string(plan.name, 100) ||
        (plan.source !== undefined && !string(plan.source, 140)) ||
        !Array.isArray(plan.phases) || !plan.phases.length || plan.phases.length > 20) return false;
    return plan.phases.every((phase) => phase && string(phase.name, 60) && string(phase.notes, 2000) &&
        Number.isInteger(phase.seconds) && phase.seconds >= 1 && phase.seconds <= 90 &&
        Array.isArray(phase.pieces) && phase.pieces.length <= 80 && phase.pieces.every((piece) =>
            piece && point(piece) && string(piece.id, 80) && side(piece.side) && string(piece.agentId, 100) &&
            (piece.kind === "agent" || piece.kind === "spike" || (piece.kind === "utility" && string(piece.ability, 40)))) &&
        Array.isArray(phase.routes) && phase.routes.length <= 60 && phase.routes.every((route) =>
            route && string(route.id, 80) && side(route.side) && Array.isArray(route.points) &&
            route.points.length >= 2 && route.points.length <= 100 && route.points.every(point)) &&
        new Set([...phase.pieces, ...phase.routes].map(entry => entry.id)).size === phase.pieces.length + phase.routes.length);
}

export function loadPlaybook(): BoardPlan[] {
    try {
        const data: unknown = JSON.parse(localStorage.getItem(PLAYBOOK_KEY) || "[]");
        return Array.isArray(data) ? data.filter(validBoardPlan) : [];
    } catch { return []; }
}

export function blankBoard(mapId: string, pieces: BoardPiece[] = [], source?: string): BoardPlan {
    return { id: boardId(), name: source ? "Replay study" : "Untitled play", mapId, source,
        phases: [{ name: "Setup", seconds: 6, notes: "", pieces, routes: [] }] };
}
