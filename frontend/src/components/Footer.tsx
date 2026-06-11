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

const BASE: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    fontWeight: 800,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderRadius: '7px',
    padding: '0.5rem 1.1rem',
    cursor: 'pointer',
    border: '1px solid transparent',
    transition: 'all 0.18s ease',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
};

export default function Footer({ onSaveAction, onCancelAction, onSaveAsNewAction, onApplyAction, onVariantAction, isDefaultPreset, isVariant }: FooterProps) {
  return (
    <footer className="footer mt-auto py-3 fixed-bottom">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem' }}>

        {/* Apply / Apply & Save — primary action */}
        <button onClick={onApplyAction} style={{ ...BASE, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>
          ✓ {isDefaultPreset ? 'Apply' : 'Apply & Save'}
        </button>

        {/* Save (edit mode only) */}
        {!isDefaultPreset && (
          <button onClick={onSaveAction} style={{ ...BASE, background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
            Save
          </button>
        )}

        {/* Save as New (default preset) */}
        {isDefaultPreset && (
          <button onClick={onSaveAsNewAction} style={{ ...BASE, background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}>
            Save as New
          </button>
        )}

        {/* Create Variant */}
        {!isDefaultPreset && !isVariant && (
          <button onClick={onVariantAction} style={{ ...BASE, background: 'transparent', borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}>
            + Variant
          </button>
        )}

        {/* Cancel */}
        <button onClick={onCancelAction} style={{ ...BASE, background: 'transparent', borderColor: 'rgba(255,255,255,0.06)', color: 'var(--text-dim)' }}>
          Cancel
        </button>

      </div>
    </footer>
  );
}
