"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import ReleasePreview, { type ReleasePreviewKind } from "./ReleasePreviews";

export type ReleaseHighlight = {
    title: string;
    text: string;
    /** Which feature to draw on the card. */
    preview?: ReleasePreviewKind;
};

export type ReleaseNotes = {
    version: string;
    title: string;
    summary: string;
    highlights?: ReleaseHighlight[];
    added: string[];
    improved: string[];
    fixed: string[];
};

// Each feature card wears its profile-menu colour.
const TONE: Record<ReleasePreviewKind, string> = { insights: "#4fd6ff", compare: "#ffb03a", badges: "#2fd6a3", replay: "#8b7bff", trade: "#22d3a3", takeaways: "#ffb03a", accounts: "#ffb03a", killspot: "#22d3a3", notifications: "#f0c451" };

type Props = {
    notes: ReleaseNotes;
    onClose: () => void;
    /** Footer for previewing an update that is not installed yet. */
    footerNote?: string;
    actionLabel?: string;
    onAction?: () => void;
};

export default function ReleaseNotesModal({ notes, onClose, footerNote, actionLabel, onAction }: Props) {
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    // "Added" items that are not headline cards join the improvements list.
    const better = [...notes.added, ...notes.improved];

    return (
        <div className="release-notes-backdrop" role="presentation">
            <section
                className="release-notes-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="release-notes-title"
                aria-describedby={notes.summary ? "release-notes-summary" : undefined}
            >
                <header className="release-notes-header">
                    <div>
                        <span className="release-notes-version">VantaVault {notes.version}</span>
                        <h2 id="release-notes-title">{notes.title}</h2>
                        {notes.summary ? <p id="release-notes-summary">{notes.summary}</p> : null}
                    </div>
                    <button ref={closeRef} className="release-notes-close" type="button" onClick={onClose} aria-label="Close what’s new">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </button>
                </header>

                <div className="release-notes-body">
                    {notes.highlights?.length ? (
                        <div className="release-notes-highlights">
                            {notes.highlights.map((item) => (
                                <article className="release-notes-highlight" key={item.title} style={item.preview ? { "--tone": TONE[item.preview] } as CSSProperties : undefined}>
                                    {item.preview ? <div className="release-notes-art" aria-hidden="true"><ReleasePreview kind={item.preview} /></div> : null}
                                    <div>
                                        <h3>{item.title}</h3>
                                        <p>{item.text}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : null}

                    <div className="release-notes-lists">
                        {better.length ? <section className="release-notes-list" data-kind="better"><h4>Also better</h4><ul>{better.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                        {notes.fixed.length ? <section className="release-notes-list" data-kind="fixed"><h4>Fixed</h4><ul>{notes.fixed.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                    </div>
                </div>

                <footer className="release-notes-footer">
                    <span>{footerNote ?? `Updated to ${notes.version}`}</span>
                    <button type="button" onClick={onAction ?? onClose}>{actionLabel ?? "Continue to VantaVault"}</button>
                </footer>
            </section>
        </div>
    );
}
