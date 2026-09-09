"use client";

import { createPortal } from "react-dom";

interface AccountDeleteModalProps {
    show: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    dontAskAgain: boolean;
    onToggleDontAskAgain: (v: boolean) => void;
}

export default function AccountDeleteModal({
    show, onCancel, onConfirm, dontAskAgain, onToggleDontAskAgain
}: AccountDeleteModalProps) {
    if (!show) return null;
    return createPortal(
        <div className="unified-modal-overlay compact-dialog-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
            <section className="unified-modal-container compact-dialog" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-account-title" aria-describedby="disconnect-account-message">
                <header className="compact-dialog-header">
                    <h2 id="disconnect-account-title">Disconnect account</h2>
                    <button type="button" className="unified-modal-close-btn" onClick={onCancel} aria-label="Close">×</button>
                </header>
                <p id="disconnect-account-message" className="compact-dialog-message">Remove this account from VantaVault on this device?</p>
                <label className="compact-dialog-check">
                    <input
                        type="checkbox"
                        checked={dontAskAgain}
                        onChange={e => onToggleDontAskAgain(e.target.checked)}
                    />
                    <span>Don&apos;t ask again</span>
                </label>
                <footer className="compact-dialog-actions">
                    <button type="button" className="compact-dialog-button secondary" onClick={onCancel}>Cancel</button>
                    <button type="button" className="compact-dialog-button danger" onClick={onConfirm}>Disconnect</button>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
