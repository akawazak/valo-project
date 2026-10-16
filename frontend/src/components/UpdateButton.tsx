"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import ReleasePreview from "./ReleasePreviews";
import type { ReleaseNotes } from "./ReleaseNotesModal";
import "./UpdateButton.css";

export type UpdatePhase = "downloading" | "ready" | "retry";

type Props = {
    phase: UpdatePhase;
    version: string;
    progress: number | null;
    notes: ReleaseNotes | null;
    busy?: boolean;
    onRestart: () => void;
    onRetry: () => void;
    onSeeAll: () => void;
};

const TONE: Record<string, string> = { insights: "#4fd6ff", compare: "#ffb03a", badges: "#2fd6a3" };
const PEEK_MS = 6000;

type Anchor = { top: number; right: number; pointer: number };

/**
 * Top-bar update button. The button itself shows the state (progress fill, then a pulsing "Update to"),
 * a one-line note pops out of it when the update is found and when it is ready, and clicking opens the card.
 * Nothing covers the page unless the player asks for it.
 */
export default function UpdateButton({ phase, version, progress, notes, busy, onRestart, onRetry, onSeeAll }: Props) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [peek, setPeek] = useState(false);
    const [anchor, setAnchor] = useState<Anchor | null>(null);
    const peekedRef = useRef("");

    // Pop the short note once when the update starts downloading and once when it is ready.
    useEffect(() => {
        const key = `${version}:${phase === "ready" ? "ready" : "found"}`;
        if (phase === "retry" || peekedRef.current === key) return;
        peekedRef.current = key;
        setPeek(true);
        const timer = window.setTimeout(() => setPeek(false), PEEK_MS);
        return () => window.clearTimeout(timer);
    }, [phase, version]);

    const place = useCallback(() => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        setAnchor({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right), pointer: rect.width / 2 - 6 });
    }, []);

    useLayoutEffect(() => {
        if (!open && !peek) return;
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, [open, peek, place]);

    // Any click or key hides the pop; the card closes on a click outside it or Escape.
    useEffect(() => {
        if (!open && !peek) return;
        const onDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (buttonRef.current?.contains(target) || cardRef.current?.contains(target)) return;
            setPeek(false);
            setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setPeek(false);
            setOpen(false);
        };
        window.addEventListener("pointerdown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("pointerdown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [open, peek]);

    const ready = phase === "ready";
    const pct = progress ?? 0;
    const label = ready ? `Update to ${version}` : phase === "retry" ? `Get ${version}` : progress !== null ? `Updating · ${pct}%` : "Updating";
    const highlights = notes?.highlights ?? [];
    const features = highlights.length ? highlights.map((item) => item.title.split(",")[0]) : notes?.added.slice(0, 3).map((item) => item.split(":")[0]) ?? [];
    const position = anchor ? ({ top: anchor.top, right: anchor.right, "--pointer": `${anchor.pointer}px` } as CSSProperties) : undefined;

    return <>
        <button
            ref={buttonRef}
            type="button"
            className={`vv-update-btn is-${phase}${open ? " is-open" : ""}`}
            style={{ "--pct": `${pct}%` } as CSSProperties}
            aria-expanded={open}
            aria-haspopup="dialog"
            title={ready ? `VantaVault ${version} is ready to install` : `VantaVault ${version}`}
            onClick={() => { setPeek(false); setOpen((value) => !value); }}
        >
            {!ready && <span className="vv-update-fill" aria-hidden="true" />}
            <svg viewBox="0 0 24 24" aria-hidden="true">
                {ready ? <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /> : <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />}
            </svg>
            <span>{label}</span>
            {ready && <i className="vv-update-dot" aria-hidden="true" />}
        </button>

        {peek && !open && anchor && createPortal(
            <div className="vv-update-peek" style={position} role="status">
                <b>VantaVault {version} {ready ? "is ready" : "is downloading"}</b>
                {features.length > 0 && <span>{features.join(" · ")}</span>}
                <button type="button" onClick={() => { setPeek(false); setOpen(true); }}>See what&apos;s new</button>
            </div>,
            document.body,
        )}

        {open && anchor && createPortal(
            <div ref={cardRef} className="vv-update-card" style={position} role="dialog" aria-label={`VantaVault ${version} update`}>
                <header>
                    <span>{ready ? "Update ready" : "Update available"}</span>
                    <button type="button" className="vv-update-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
                </header>
                <h3>VantaVault {version}</h3>
                {notes?.summary && <p>{notes.summary}</p>}
                {highlights.length > 0 && <div className="vv-update-mini">
                    {highlights.slice(0, 3).map((item) => <div key={item.title} className="vv-update-mini-card" style={item.preview ? { "--tone": TONE[item.preview] } as CSSProperties : undefined}>
                        {item.preview && <div className="vv-update-mini-art" aria-hidden="true"><div className="release-notes-art vv-update-mini-scale"><ReleasePreview kind={item.preview} /></div></div>}
                        <span>{item.title}</span>
                    </div>)}
                </div>}
                <div className="vv-update-status">
                    {ready
                        ? <span className="is-ready"><i />Downloaded and verified</span>
                        : phase === "retry"
                            ? <span className="is-error">The download didn&apos;t finish</span>
                            : <span><span className="vv-update-bar"><b style={{ width: `${pct}%` }} /></span>Downloading{progress !== null ? ` · ${pct}%` : ""}</span>}
                </div>
                <footer>
                    {notes ? <button type="button" className="vv-update-ghost" onClick={() => { setOpen(false); onSeeAll(); }}>See everything new</button> : <span />}
                    {phase === "retry"
                        ? <button type="button" className="vv-update-primary" onClick={onRetry}>Try again</button>
                        : <button type="button" className="vv-update-primary" disabled={!ready || busy} onClick={onRestart}>{busy ? "Restarting…" : ready ? "Restart to update" : "Restart when ready"}</button>}
                </footer>
            </div>,
            document.body,
        )}
    </>;
}
