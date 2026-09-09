"use client";

import { createPortal } from "react-dom";

interface ImportPresetModalProps {
    show: boolean;
    onClose: () => void;
    onImport: () => void;
    importCode: string;
    onChangeImportCode: (v: string) => void;
    importError: string;
}

export default function ImportPresetModal({
    show, onClose, onImport, importCode, onChangeImportCode, importError,
}: ImportPresetModalProps) {
    if (!show) return null;
    return createPortal(
        <div className="unified-modal-overlay compact-dialog-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
            <section className="unified-modal-container compact-dialog compact-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="import-preset-title">
                <header className="compact-dialog-header">
                    <h2 id="import-preset-title">Import preset</h2>
                    <button type="button" className="unified-modal-close-btn" onClick={onClose} aria-label="Close">×</button>
                </header>
                <div className="compact-dialog-form">
                    <label htmlFor="preset-share-code">Share code</label>
                    <textarea id="preset-share-code" className="tactical-input compact-dialog-textarea" rows={5} placeholder="Paste a VantaVault preset code" value={importCode} onChange={(event) => onChangeImportCode(event.target.value)} autoFocus />
                    {importError ? <p className="compact-dialog-error" role="alert">{importError}</p> : null}
                </div>
                <footer className="compact-dialog-actions">
                    <button type="button" className="compact-dialog-button secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className="compact-dialog-button primary" disabled={!importCode.trim()} onClick={onImport}>Import</button>
                </footer>
            </section>
        </div>,
        document.body,
    );
}
