"use client";

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
    return (
        <div className="acc-delete-modal-overlay" onClick={onCancel}>
            <div className="acc-delete-modal" onClick={e => e.stopPropagation()}>
                <div className="acc-delete-modal-icon">×</div>
                <h5 className="acc-delete-modal-title">Disconnect Account</h5>
                <p className="acc-delete-modal-body">
                    Are you sure you want to remove this account from ValoVault?
                </p>
                <label className="acc-delete-modal-skip">
                    <input
                        type="checkbox"
                        checked={dontAskAgain}
                        onChange={e => onToggleDontAskAgain(e.target.checked)}
                    />
                    <span>Don&apos;t ask again</span>
                </label>
                <div className="acc-delete-modal-actions">
                    <button type="button" className="acc-delete-modal-btn cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button type="button" className="acc-delete-modal-btn confirm" onClick={onConfirm}>
                        Remove
                    </button>
                </div>
            </div>
        </div>
    );
}
