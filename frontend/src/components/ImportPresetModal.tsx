"use client";

interface ImportPresetModalProps {
    show: boolean;
    onClose: () => void;
    onImport: () => void;
    importCode: string;
    onChangeImportCode: (v: string) => void;
    importError: string;
}

export default function ImportPresetModal({
    show, onClose, onImport, importCode, onChangeImportCode, importError
}: ImportPresetModalProps) {
    if (!show) return null;
    return (
        <div className="acc-delete-modal-overlay" onClick={onClose}>
            <div className="acc-delete-modal" style={{ maxWidth: '480px', width: '90%' }} onClick={e => e.stopPropagation()}>
                <h5 className="acc-delete-modal-title">Import Preset</h5>
                <p className="acc-delete-modal-body">Paste a preset share code below to import it as a new preset.</p>
                <textarea
                    className="tactical-input mb-2"
                    rows={4}
                    placeholder="Paste share code here..."
                    value={importCode}
                    onChange={e => onChangeImportCode(e.target.value)}
                    style={{ fontSize: '0.78rem', resize: 'vertical' }}
                />
                {importError && (
                    <div className="text-danger font-monospace small mb-2">{importError}</div>
                )}
                <div className="acc-delete-modal-actions">
                    <button type="button" className="acc-delete-modal-btn cancel" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="acc-delete-modal-btn confirm"
                        disabled={!importCode.trim()}
                        onClick={onImport}
                    >
                        Import
                    </button>
                </div>
            </div>
        </div>
    );
}
