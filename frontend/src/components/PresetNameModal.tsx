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

const BTN_BASE: React.CSSProperties = {
    borderRadius: '6px',
    padding: '0.5rem 1.25rem',
    fontSize: '0.8rem',
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    transition: 'all 0.18s ease',
    border: '1px solid transparent',
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
            <div className="unified-modal-container" style={{ maxWidth: '460px', height: 'auto', minHeight: 'unset' }}>
                {/* Header */}
                <div className="unified-modal-header" style={{ padding: '1rem 1.5rem' }}>
                    <div className="unified-modal-title-wrap">
                        <span className="kicker">// Preset</span>
                        <h3 className="unified-modal-title" style={{ fontSize: '1rem' }}>{titleMap[namingMode]}</h3>
                    </div>
                    <button type="button" className="unified-modal-close-btn" onClick={onCloseAction}>✕</button>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem 1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Preset Name
                    </label>
                    <input
                        ref={inputRef}
                        type="text"
                        className="tactical-input"
                        placeholder="e.g. Competitive Main, Ranked Grind…"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        style={{ width: '100%', fontSize: '0.9rem' }}
                    />
                </div>

                {/* Footer */}
                <div style={{ padding: '0.75rem 1.5rem 1.25rem', display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
                    <button
                        type="button"
                        onClick={onCloseAction}
                        style={{ ...BTN_BASE, background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!presetName.trim()}
                        style={{ ...BTN_BASE, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff', opacity: presetName.trim() ? 1 : 0.4 }}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
