"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { canvasBlob, copyShareImage, saveShareImage } from "@/lib/shareCard";
import s from "./ShareButton.module.css";

type State = { kind: "idle" } | { kind: "busy" } | { kind: "ready"; url: string; blob: Blob; copied: boolean } | { kind: "error"; message: string };

/** Draws a share card, copies it, and shows a small preview with Save. */
export default function ShareButton({ build, filename, label = "Share", className }: {
    build: () => Promise<HTMLCanvasElement>;
    filename: string;
    label?: string;
    className?: string;
}) {
    const [state, setState] = useState<State>({ kind: "idle" });
    const wrapRef = useRef<HTMLSpanElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [place, setPlace] = useState<CSSProperties>({});
    const url = state.kind === "ready" ? state.url : "";

    useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
    useEffect(() => {
        if (state.kind !== "ready" && state.kind !== "error") return;
        const close = (event: MouseEvent | KeyboardEvent) => {
            if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrapRef.current?.contains(event.target as Node) && !popRef.current?.contains(event.target as Node)) {
                event.stopPropagation();
                setState({ kind: "idle" });
            }
        };
        document.addEventListener("mousedown", close, true);
        document.addEventListener("keydown", close, true);
        return () => { document.removeEventListener("mousedown", close, true); document.removeEventListener("keydown", close, true); };
    }, [state.kind]);

    const run = async () => {
        if (state.kind === "busy") return;
        setState({ kind: "busy" });
        try {
            const blob = await canvasBlob(await build());
            const copied = await copyShareImage(blob);
            // The preview floats above dialogs, so a clipped header cannot cut it off.
            const r = wrapRef.current?.getBoundingClientRect();
            if (r) {
                const width = 330, height = 300;
                const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
                const top = r.bottom + 8 + height > window.innerHeight ? Math.max(8, r.top - 8 - height) : r.bottom + 8;
                setPlace({ left, top });
            }
            setState({ kind: "ready", url: URL.createObjectURL(blob), blob, copied });
        } catch (err) {
            setState({ kind: "error", message: err instanceof Error ? err.message : "Could not create the image." });
        }
    };

    return <span className={s.wrap} ref={wrapRef}>
        <button type="button" className={`${s.button} ${className || ""}`} onClick={run} aria-busy={state.kind === "busy" || undefined} aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
            {state.kind === "busy" ? "Making image…" : label}
        </button>
        {state.kind === "ready" ? createPortal(<div ref={popRef} className={s.pop} style={place} role="dialog" aria-label="Share image">
            <img src={state.url} alt="Share image preview" width={300} height={158} />
            <p role="status">{state.copied ? <><b>Copied.</b> Paste it into Discord or anywhere.</> : "Your clipboard didn't take the image. Save it instead."}</p>
            <div className={s.actions}>
                <button type="button" className={s.save} onClick={() => saveShareImage(state.blob, filename)}>Save image</button>
                <button type="button" className={s.done} onClick={() => setState({ kind: "idle" })}>Done</button>
            </div>
        </div>, document.body) : null}
        {state.kind === "error" ? <div className={s.pop} role="alert"><p>{state.message}</p><div className={s.actions}><button type="button" className={s.save} onClick={run}>Try again</button></div></div> : null}
    </span>;
}
