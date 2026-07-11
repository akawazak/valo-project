"use client";

import { createPortal } from 'react-dom';
import { NamingMode } from '@/hooks/usePresets';
import { useState, useEffect, useRef } from 'react';

type PresetNameModalProps = {
    show: boolean;
    onCloseAction: () => void;
    onSaveAction: (name: string) => void;
    initialName?: string;
    namingMode: NamingMode;
};

export default function PresetNameModal({ show, onCloseAction, onSaveAction, initialName, namingMode }: PresetNameModalProps) {
    const [presetName, setPresetName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const titleMap: Record<NamingMode, string> = {
        [NamingMode.New]: 'Save New Preset',
        [NamingMode.SaveAsNew]: 'Save Preset As New',
        [NamingMode.Rename]: 'Rename Preset',
        [NamingMode.Variant]: 'Create Variant',
    };

    useEffect(() => {
        if (show) {
            setPresetName(initialName || '');
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [show, initialName]);

    const handleSave = () => {
        if (!presetName.trim()) return;
        onSaveAction(presetName);
        setPresetName('');
    };

    if (!show) return null;

    return createPortal(
        <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && onCloseAction()}>
            <div className="unified-modal-container preset-name-modal" role="dialog" aria-modal="true" aria-labelledby="preset-name-modal-title">
                {/* Header */}
                <div className="unified-modal-header preset-name-modal-header">
                    <div className="unified-modal-title-wrap">
                        <span className="kicker">// Preset</span>
                        <h3 id="preset-name-modal-title" className="unified-modal-title">{titleMap[namingMode]}</h3>
                    </div>
                    <button type="button" className="unified-modal-close-btn" onClick={onCloseAction}>✕</button>
                </div>

                {/* Body */}
                <form className="preset-name-modal-body" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
                    <label className="preset-name-modal-label" htmlFor="preset-name-input">
                        Preset Name
                    </label>
                    <input
                        ref={inputRef}
                        id="preset-name-input"
                        type="text"
                        className="tactical-input preset-name-modal-input"
                        placeholder="e.g. Competitive Main, Ranked Grind…"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                    />
                    <p className="preset-name-modal-help">You can rename or duplicate this preset later.</p>
                    <div className="preset-name-modal-actions">
                    <button
                        type="button"
                        onClick={onCloseAction}
                        className="btn-tactical btn-tactical-ghost"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!presetName.trim()}
                        className="btn-tactical btn-tactical-accent"
                    >
                        {namingMode === NamingMode.Rename ? "Rename" : "Create Preset"}
                    </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}
