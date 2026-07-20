"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

type Position = { x: number; y: number };

type DragState = Position & {
    startX: number;
    startY: number;
    width: number;
    height: number;
    moved: boolean;
};

export function useFloatingWidgetDrag(storageKey: string) {
    const [position, setPosition] = useState<Position | null>(null);
    const elementRef = useRef<HTMLElement | null>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const dragState = useRef<DragState | null>(null);
    const suppressClick = useRef(false);
    const viewportRef = useRef({ width: 0, height: 0 });

    useEffect(() => {
        setPosition(null);
        try {
            const stored = window.localStorage.getItem(`vantavault:widget-position:${storageKey}`);
            if (!stored) return;
            const parsed = JSON.parse(stored) as Position;
            if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) setPosition(parsed);
        } catch {
            // A malformed stored position should never block the widget.
        }
    }, [storageKey]);

    const clampPosition = useCallback((candidate: Position, element = elementRef.current) => {
        if (!element) return candidate;
        const rect = element.getBoundingClientRect();
        return {
            x: Math.round(Math.min(Math.max(12, candidate.x), Math.max(12, window.innerWidth - rect.width - 12))),
            y: Math.round(Math.min(Math.max(12, candidate.y), Math.max(12, window.innerHeight - rect.height - 12))),
        };
    }, []);

    const setElement = useCallback((element: HTMLElement | null) => {
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        elementRef.current = element;
        if (!element) return;
        setPosition((current) => {
            if (!current) return current;
            const next = clampPosition(current, element);
            if (next.x === current.x && next.y === current.y) return current;
            window.localStorage.setItem(`vantavault:widget-position:${storageKey}`, JSON.stringify(next));
            return next;
        });
        if (typeof ResizeObserver !== "undefined") {
            resizeObserverRef.current = new ResizeObserver(() => {
                setPosition((current) => {
                    if (!current) return current;
                    const next = clampPosition(current, element);
                    if (next.x === current.x && next.y === current.y) return current;
                    window.localStorage.setItem(`vantavault:widget-position:${storageKey}`, JSON.stringify(next));
                    return next;
                });
            });
            resizeObserverRef.current.observe(element);
        }
    }, [clampPosition, storageKey]);

    useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

    useEffect(() => {
        viewportRef.current = { width: window.innerWidth, height: window.innerHeight };
        const onResize = () => {
            const previousViewport = viewportRef.current;
            const nextViewport = { width: window.innerWidth, height: window.innerHeight };
            viewportRef.current = nextViewport;
            setPosition((current) => {
                if (!current) return current;
                const element = elementRef.current;
                const rect = element?.getBoundingClientRect();
                const previousMaxX = Math.max(12, previousViewport.width - (rect?.width || 0) - 12);
                const previousMaxY = Math.max(12, previousViewport.height - (rect?.height || 0) - 12);
                const wasDockedRight = Math.abs(current.x - previousMaxX) <= 2;
                const wasDockedBottom = Math.abs(current.y - previousMaxY) <= 2;
                const next = clampPosition(current, element);

                // A widget clamped to an edge in a smaller window should stay
                // attached to that edge when the window grows again. Without
                // this, a bottom pill keeps its old pixel Y and floats midway
                // up the restored fullscreen window.
                if (rect && wasDockedRight) {
                    next.x = Math.max(12, nextViewport.width - rect.width - 12);
                }
                if (rect && wasDockedBottom) {
                    next.y = Math.max(12, nextViewport.height - rect.height - 12);
                }
                if (next.x === current.x && next.y === current.y) return current;
                window.localStorage.setItem(`vantavault:widget-position:${storageKey}`, JSON.stringify(next));
                return next;
            });
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [clampPosition, storageKey]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, ignoreInteractive = false) => {
        if (event.button !== 0) return;
        if (ignoreInteractive && (event.target as HTMLElement).closest("button, input, a")) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const current = position || { x: rect.left, y: rect.top };
        dragState.current = {
            ...current,
            startX: event.clientX,
            startY: event.clientY,
            width: rect.width,
            height: rect.height,
            moved: false,
        };
        const onMove = (moveEvent: PointerEvent) => {
            const drag = dragState.current;
            if (!drag) return;
            const deltaX = moveEvent.clientX - drag.startX;
            const deltaY = moveEvent.clientY - drag.startY;
            if (Math.abs(deltaX) + Math.abs(deltaY) > 4) drag.moved = true;
            if (!drag.moved) return;

            const maxX = Math.max(12, window.innerWidth - drag.width - 12);
            const rawX = Math.min(Math.max(12, drag.x + deltaX), maxX);
            const next = {
                // Keep the panel attached to the nearest side throughout the drag.
                x: rawX + drag.width / 2 < window.innerWidth / 2 ? 12 : maxX,
                y: Math.round(Math.min(Math.max(12, drag.y + deltaY), Math.max(12, window.innerHeight - drag.height - 12))),
            };
            setPosition(next);
        };

        const onUp = (upEvent: PointerEvent) => {
            const drag = dragState.current;
            dragState.current = null;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (!drag?.moved) return;

            const maxX = Math.max(12, window.innerWidth - drag.width - 12);
            const rawX = Math.min(Math.max(12, drag.x + upEvent.clientX - drag.startX), maxX);
            const next = {
                // Widgets always dock to a side after a drag so they do not
                // linger over the middle of the app workspace.
                x: rawX + drag.width / 2 < window.innerWidth / 2 ? 12 : maxX,
                y: Math.round(Math.min(Math.max(12, drag.y + upEvent.clientY - drag.startY), Math.max(12, window.innerHeight - drag.height - 12))),
            };
            setPosition(next);
            suppressClick.current = true;
            window.localStorage.setItem(`vantavault:widget-position:${storageKey}`, JSON.stringify(next));
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
    }, [position, storageKey]);

    const consumeClick = useCallback(() => {
        if (!suppressClick.current) return false;
        suppressClick.current = false;
        return true;
    }, []);

    const resetPosition = useCallback(() => {
        setPosition(null);
        window.localStorage.removeItem(`vantavault:widget-position:${storageKey}`);
    }, [storageKey]);

    const style: CSSProperties | undefined = position
        ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
        : undefined;

    return { position, style, setElement, onPointerDown, consumeClick, resetPosition };
}
