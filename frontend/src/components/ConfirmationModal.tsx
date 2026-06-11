"use client";

import { createPortal } from 'react-dom';

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
        <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="unified-modal-container" style={{ maxWidth: '420px', height: 'auto', minHeight: 'unset' }}>
                <div className="unified-modal-header" style={{ padding: '1rem 1.5rem' }}>
                    <div className="unified-modal-title-wrap">
                        <span className="kicker">// Confirm Action</span>
                        <h3 className="unified-modal-title" style={{ fontSize: '1rem' }}>{title}</h3>
                    </div>
                    <button type="button" className="unified-modal-close-btn" onClick={onClose}>✕</button>
                </div>
                <div style={{ padding: '1.25rem 1.5rem', color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
                    {message}
                </div>
                <div style={{ padding: '0.75rem 1.5rem 1.25rem', display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-strong)',
                            color: 'var(--text-secondary)',
                            borderRadius: '6px',
                            padding: '0.5rem 1.1rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.18s ease',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text-secondary)')}
                        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        style={{
                            background: 'var(--danger, #ff4655)',
                            border: '1px solid var(--danger, #ff4655)',
                            color: '#fff',
                            borderRadius: '6px',
                            padding: '0.5rem 1.1rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.18s ease',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
