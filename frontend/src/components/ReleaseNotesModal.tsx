"use client";

import { useEffect, useRef } from "react";

export type ReleaseNotes = {
    version: string;
    title: string;
    summary: string;
    added: string[];
    improved: string[];
    fixed: string[];
};

type Props = {
    notes: ReleaseNotes;
    onClose: () => void;
};

export default function ReleaseNotesModal({ notes, onClose }: Props) {
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const groups = [
        { label: "Added", tone: "added", items: notes.added },
        { label: "Improved", tone: "improved", items: notes.improved },
        { label: "Fixed", tone: "fixed", items: notes.fixed },
    ];

    return (
        <div className="release-notes-backdrop" role="presentation">
            <section
                className="release-notes-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="release-notes-title"
                aria-describedby="release-notes-summary"
            >
                <aside className="release-notes-rail" aria-hidden="true">
                    <span>V{notes.version}</span>
                    <strong>VV</strong>
                    <i />
                </aside>

                <div className="release-notes-content">
                    <header className="release-notes-header">
                        <div>
                            <span className="release-notes-version">VantaVault {notes.version}</span>
                            <h2 id="release-notes-title">{notes.title}</h2>
                            <p id="release-notes-summary">{notes.summary}</p>
                        </div>
                        <button ref={closeRef} className="release-notes-close" type="button" onClick={onClose} aria-label="Close what’s new">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                        </button>
                    </header>

                    <div className="release-notes-groups">
                        {groups.map((group) => (
                            <section className={`release-notes-group release-notes-${group.tone}`} key={group.label}>
                                <h3>{group.label}</h3>
                                <ul>
                                    {group.items.map((item) => <li key={item}>{item}</li>)}
                                </ul>
                            </section>
                        ))}
                    </div>

                    <footer className="release-notes-footer">
                        <span>Update installed successfully</span>
                        <button type="button" onClick={onClose}>Continue to VantaVault</button>
                    </footer>
                </div>
            </section>
        </div>
    );
}
