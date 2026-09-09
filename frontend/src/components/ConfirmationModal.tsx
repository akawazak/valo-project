"use client";

import { createPortal } from "react-dom";

interface ConfirmationModalProps {
    show: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
}

export default function ConfirmationModal({ show, onClose, onConfirm, title, message }: ConfirmationModalProps) {
    if (!show) return null;

    return createPortal(
        <div className="unified-modal-overlay compact-dialog-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
            <section className="unified-modal-container compact-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
                <header className="compact-dialog-header">
                    <h2 id="confirmation-title">{title}</h2>
                    <button type="button" className="unified-modal-close-btn" onClick={onClose} aria-label="Close">×</button>
                </header>
                <p id="confirmation-message" className="compact-dialog-message">{message}</p>
                <footer className="compact-dialog-actions">
                    <button type="button" className="compact-dialog-button secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="compact-dialog-button danger" onClick={onConfirm}>Delete</button>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
