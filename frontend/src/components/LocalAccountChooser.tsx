"use client";

import React from 'react';
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

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <section
                className="settings-modal-container local-account-chooser"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="local-account-chooser-title"
            >
                <button className="settings-modal-close" onClick={onClose} aria-label="Close chooser">&times;</button>
                <header className="local-account-chooser-header">
                    <span className="local-account-chooser-eyebrow">VALORANT ACCOUNT</span>
                    <h2 id="local-account-chooser-title">Use the account open in VALORANT?</h2>
                    <p>The game client and VantaVault currently have different accounts selected.</p>
                </header>

                <div className="local-account-chooser-body">
                    <div className="local-account-comparison">
                        <div className="local-account-option detected">
                            <span className="local-account-option-label">Open in VALORANT</span>
                            <strong>{pending.gameName}<small>#{pending.tagLine}</small></strong>
                            <span className="local-account-option-state">Detected locally</span>
                        </div>
                        <div className="local-account-option current">
                            <span className="local-account-option-label">Selected in VantaVault</span>
                            {active ? (
                                <strong>{active.gameName}<small>#{active.tagLine}</small></strong>
                            ) : (
                                <strong>No account</strong>
                            )}
                            <span className="local-account-option-state">Current selection</span>
                        </div>
                    </div>

                    <p className="local-account-chooser-note">
                        This choice controls which account is used for the store, presets, and loadout changes.
                    </p>

                    <div className="local-account-chooser-actions">
                        <button className="btn-tactical btn-tactical-primary" onClick={() => onChooseLocal(true)}>
                            Switch to {pending.gameName}
                        </button>
                        <button className="btn-tactical btn-tactical-secondary" onClick={() => onChooseLocal(false)}>
                            {active ? `Keep ${active.gameName}` : "Keep no account selected"}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
}
