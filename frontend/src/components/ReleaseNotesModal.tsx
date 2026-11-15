"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import ReleasePreview, { getRecordedExample, type ReleasePreviewKind } from "./ReleasePreviews";

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
const TONE: Record<ReleasePreviewKind, string> = {
    insights: "#4fd6ff", compare: "#ffb03a", badges: "#2fd6a3", replay: "#8b7bff", trade: "#22d3a3",
    takeaways: "#ffb03a", accounts: "#ffb03a", killspot: "#22d3a3", notifications: "#f0c451",
    recordedreplay: "#b6a7ff", recordedtactics: "#73ead0", recordedutility: "#ffc579",
};

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
    const viewerRef = useRef<HTMLDialogElement>(null);
    const [selectedExample, setSelectedExample] = useState<ReturnType<typeof getRecordedExample>>();

    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !viewerRef.current?.open) onClose();
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
                                    {item.preview && (
                                        <HighlightArt kind={item.preview} title={item.title} onEnlarge={(example) => {
                                            setSelectedExample(example);
                                            viewerRef.current?.showModal();
                                        }} />
                                    )}
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

                <dialog ref={viewerRef} className="release-notes-viewer" aria-labelledby="release-example-title" onClose={() => setSelectedExample(undefined)}>
                    <header>
                        <div>
                            <h3 id="release-example-title">{selectedExample?.caption}</h3>
                            <p>Recorded replay · Player names anonymized</p>
                        </div>
                        <form method="dialog">
                            <button className="release-notes-close" type="submit" aria-label="Close example">×</button>
                        </form>
                    </header>
                    {selectedExample && <Image src={selectedExample.asset + ".webp"} alt={selectedExample.alt} width={1440} height={900} />}
                </dialog>
            </section>
        </div>
    );
}

function HighlightArt({ kind, title, onEnlarge }: {
    kind: ReleasePreviewKind;
    title: string;
    onEnlarge: (example: NonNullable<ReturnType<typeof getRecordedExample>>) => void;
}) {
    const example = getRecordedExample(kind);
    if (!example) return <div className="release-notes-art" aria-hidden="true"><ReleasePreview kind={kind} /></div>;

    return (
        <div className="release-notes-art release-notes-art-recorded">
            <button className="release-notes-example" type="button" aria-label={`Enlarge ${title} example`} onClick={() => onEnlarge(example)}>
                <ReleasePreview kind={kind} />
                <span className="release-notes-expand" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M14 5h5v5m0-5-5 5M10 19H5v-5m0 5 5-5" /></svg>
                </span>
            </button>
        </div>
    );
}
