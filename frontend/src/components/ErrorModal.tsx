"use client";

import { createPortal } from "react-dom";

type ErrorModalProps = {
    show: boolean;
    onClose: () => void;
    message: string;
};

export default function ErrorModal({ show, onClose, message }: ErrorModalProps) {
    if (!show) return null;

    return createPortal(
        <div className="unified-modal-overlay compact-dialog-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
            <section className="unified-modal-container compact-dialog" role="alertdialog" aria-modal="true" aria-labelledby="error-dialog-title" aria-describedby="error-dialog-message">
                <header className="compact-dialog-header">
                    <h2 id="error-dialog-title">Couldn&apos;t complete that</h2>
                    <button type="button" className="unified-modal-close-btn" onClick={onClose} aria-label="Close">×</button>
                </header>
                <p id="error-dialog-message" className="compact-dialog-message">{message}</p>
                <footer className="compact-dialog-actions">
                    <button type="button" className="compact-dialog-button primary" onClick={onClose}>Close</button>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
