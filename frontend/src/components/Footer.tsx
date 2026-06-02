"use client";

type FooterProps = {
    onSaveAction: () => void;
    onCancelAction: () => void;
    onSaveAsNewAction: () => void;
    onApplyAction: () => void;
    onVariantAction: () => void;
    isDefaultPreset: boolean;
    isVariant: boolean;
};

export default function Footer({ onSaveAction, onCancelAction, onSaveAsNewAction, onApplyAction, onVariantAction, isDefaultPreset, isVariant }: FooterProps) {
    return (
        <footer className="action-bar">
            {!isDefaultPreset && (
                <button className="btn-tactical" onClick={onSaveAction}>
                    Save
                </button>
            )}
            <button className="btn-tactical btn-tactical-success" onClick={onApplyAction}>
                {isDefaultPreset ? 'Apply' : 'Apply & Save'}
            </button>
            <button className="btn-tactical" onClick={onCancelAction}>
                Cancel
            </button>
            {isDefaultPreset && (
                <button className="btn-tactical" onClick={onSaveAsNewAction}>
                    Save as New
                </button>
            )}
            {!isDefaultPreset && !isVariant && (
                <button className="btn-tactical" onClick={onVariantAction}>
                    Create Variant
                </button>
            )}
        </footer>
    );
}
