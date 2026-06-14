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
            <div className="settings-modal-container account-manager-modal" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close chooser">&times;</button>
                <div className="account-manager-header">
                    <div className="tactical-kicker">// LOCAL CLIENT DETECTED</div>
                    <h2 className="account-manager-title">Switch account?</h2>
                </div>

                <div className="account-manager-body">
                    <p>
                        Valorant appears to be running with the account <strong>{pending.gameName}#{pending.tagLine}</strong>.
                        You currently have {active ? <><strong>{active.gameName}#{active.tagLine}</strong> selected</> : 'no active account selected'} in the app.
                    </p>
                    <p className="small text-muted">Choose which identity the app should use for presets and the store.</p>

                    <div className="d-flex gap-2 mt-3">
                        <button className="btn-tactical btn-tactical-primary" onClick={() => onChooseLocal(true)}>
                            Use Local Client Account
                        </button>
                        <button className="btn-tactical btn-tactical-secondary" onClick={() => onChooseLocal(false)}>
                            Keep Current Account
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
