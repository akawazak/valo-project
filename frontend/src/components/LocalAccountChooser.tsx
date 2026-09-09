"use client";

import { createPortal } from 'react-dom';
import { RiotAccount } from '@/lib/types';

interface Props {
    isOpen: boolean;
    pending: RiotAccount | null;
    active: RiotAccount | null;
    onChooseLocal: (useLocal: boolean) => void;
    onClose: () => void;
}

export default function LocalAccountChooser({ isOpen, pending, active, onChooseLocal, onClose }: Props) {
    if (!isOpen || !pending) return null;

    return createPortal(
        <div className="unified-modal-overlay compact-dialog-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
            <section
                className="compact-dialog local-account-chooser"
                role="dialog"
                aria-modal="true"
                aria-labelledby="local-account-chooser-title"
            >
                <header className="local-account-chooser-header">
                    <div>
                        <span className="local-account-chooser-eyebrow">Riot client</span>
                        <h2 id="local-account-chooser-title">Switch account?</h2>
                    </div>
                    <button type="button" className="unified-modal-close-btn" onClick={onClose} aria-label="Keep current account">×</button>
                </header>

                <div className="local-account-chooser-body">
                    <p className="local-account-chooser-message">
                        VALORANT is signed in as <strong>{pending.gameName}<small>#{pending.tagLine}</small></strong>.
                        Your current account stays selected unless you switch.
                    </p>

                    {active && <div className="local-account-current">
                        <span>Current</span>
                        <strong>{active.gameName}<small>#{active.tagLine}</small></strong>
                    </div>}

                    <div className="local-account-chooser-actions">
                        <button type="button" className="compact-dialog-button secondary" onClick={() => onChooseLocal(false)}>
                            Keep current
                        </button>
                        <button type="button" className="compact-dialog-button primary" onClick={() => onChooseLocal(true)}>
                            Switch to {pending.gameName}
                        </button>
                    </div>
                </div>
            </section>
        </div>,
        document.body,
    );
}
