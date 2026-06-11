const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'frontend', 'src', 'app', 'globals.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');

const newStyles = `
/* ==========================================================================
   VALOVAULT PREMIUM REDESIGN - WORKSPACE & UNIFIED MODAL
   ========================================================================== */

/* ── Centered Workspace Layout ── */
.workspace-centered-wrapper {
  max-width: 1380px;
  width: 100%;
  margin: 0 auto;
  padding: 1rem 0;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.workspace-title-area {
  display: flex;
  flex-direction: column;
}

.workspace-title-area h2 {
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  text-transform: uppercase;
  font-family: var(--font-sans);
}

.workspace-title-area .tactical-kicker {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--accent);
  letter-spacing: 0.15em;
  font-weight: 700;
}

.workspace-grid-5 {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 1.25rem;
  flex: 1;
  min-height: 0;
  width: 100%;
}

.workspace-column {
  display: flex;
  flex-direction: column;
  background: rgba(12, 19, 24, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 0.85rem;
  height: 100%;
  min-height: 0;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.workspace-column-title {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--text-secondary);
  text-transform: uppercase;
  margin-bottom: 0.85rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.workspace-column-title::before {
  content: "";
  display: inline-block;
  width: 4px;
  height: 4px;
  background: var(--accent);
}

.workspace-column-items {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  flex: 1;
  overflow-y: auto;
  padding-right: 2px;
}

/* ── Premium Split Selector Modal ── */
.unified-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(3, 5, 8, 0.88);
  backdrop-filter: blur(10px);
  animation: modal-fade-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.unified-modal-container {
  display: flex;
  flex-direction: column;
  width: min(92vw, 1080px);
  height: min(85vh, 680px);
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  animation: modal-scale-up 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modal-scale-up {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.unified-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.75rem;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
}

.unified-modal-title-wrap {
  display: flex;
  flex-direction: column;
}

.unified-modal-title-wrap .kicker {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

.unified-modal-title {
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  text-transform: uppercase;
}

.unified-modal-close-btn {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: 6px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1.05rem;
  transition: all var(--transition);
}

.unified-modal-close-btn:hover {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
  transform: rotate(90deg);
}

.unified-modal-content {
  display: grid;
  grid-template-columns: 460px 1fr;
  flex: 1;
  min-height: 0;
}

/* Left Panel: Preview & Customization */
.unified-modal-left {
  background: rgba(6, 11, 15, 0.45);
  border-right: 1px solid var(--border);
  padding: 1.5rem 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-y: auto;
}

.unified-modal-preview-box {
  position: relative;
  aspect-ratio: 2 / 1;
  width: 100%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.04) 0%, transparent 70%);
  border: 1px solid rgba(255, 255, 255, 0.02);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.unified-modal-preview-img {
  max-width: 90%;
  max-height: 85%;
  object-fit: contain;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.5));
}

.unified-modal-skin-meta {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.unified-modal-skin-meta h4 {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.unified-modal-skin-meta span {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  text-transform: uppercase;
}

.unified-modal-section-title {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.unified-modal-section-title::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* Chroma Swatches list */
.chroma-swatches-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.chroma-swatch-item {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 1px;
  cursor: pointer;
  transition: all var(--transition);
  background: transparent;
}

.chroma-swatch-item:hover {
  transform: scale(1.1);
}

.chroma-swatch-item.active {
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.chroma-swatch-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  background: var(--bg-elevated);
}

.chroma-swatch-inner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Levels Row */
.levels-select-grid {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.level-select-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.45rem 0.75rem;
  cursor: pointer;
  transition: all var(--transition);
  font-family: var(--font-sans);
  text-align: left;
}

.level-select-row:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-strong);
}

.level-select-row.active {
  background: var(--accent-dim);
  border-color: var(--accent);
}

.level-row-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-primary);
}

.level-row-status {
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
}

.level-select-row.active .level-row-status {
  color: var(--accent);
}

/* Buddy Section Left Panel */
.unified-modal-buddy-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.equipped-buddy-pill {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed var(--border-strong);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: all var(--transition);
}

.equipped-buddy-pill:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.25);
}

.equipped-buddy-pill.active {
  border-color: var(--green);
  background: var(--green-dim);
  border-style: solid;
}

.equipped-buddy-icon-wrap {
  width: 28px;
  height: 28px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border-radius: 4px;
}

.equipped-buddy-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.equipped-buddy-label {
  font-size: 0.55rem;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
}

.equipped-buddy-name {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Right Panel: Skins / Buddies Search and List */
.unified-modal-right {
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1.75rem;
  overflow: hidden;
}

.unified-modal-tabs-row {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: 1rem;
  gap: 1.25rem;
}

.unified-modal-tab-btn {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.5rem 0.25rem;
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
  text-transform: uppercase;
}

.unified-modal-tab-btn:hover {
  color: var(--text-primary);
}

.unified-modal-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.unified-modal-search-box {
  position: relative;
  margin-bottom: 1rem;
}

.unified-modal-search-box input {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.55rem 0.85rem 0.55rem 2.25rem;
  font-size: 0.8rem;
  font-family: var(--font-mono);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition);
}

.unified-modal-search-box input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.unified-modal-search-box svg {
  position: absolute;
  top: 50%;
  left: 0.85rem;
  transform: translateY(-50%);
  color: var(--text-dim);
}

.unified-modal-grid-scroll {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
}

.unified-modal-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 0.75rem;
  padding-bottom: 1rem;
}

.unified-modal-card-item {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all var(--transition);
  position: relative;
}

.unified-modal-card-item:hover {
  transform: translateY(-2px);
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-strong);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
}

.unified-modal-card-item.active {
  border-color: var(--accent);
  background: var(--accent-dim);
  box-shadow: 0 0 10px var(--accent-glow);
}

.unified-modal-card-img-wrap {
  width: 100%;
  aspect-ratio: 1.6 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.65rem;
  position: relative;
  background: radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.03) 0%, transparent 60%);
}

.unified-modal-card-img-wrap img {
  max-width: 95%;
  max-height: 90%;
  object-fit: contain;
  transition: transform 0.25s ease;
}

.unified-modal-card-item:hover .unified-modal-card-img-wrap img {
  transform: scale(1.04);
}

.unified-modal-card-tier-line {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  opacity: 0.85;
}

.unified-modal-card-info {
  padding: 0.45rem 0.55rem 0.5rem;
  border-top: 1px solid var(--border);
  text-align: center;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.unified-modal-card-name {
  font-size: 0.64rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unified-modal-card-status {
  font-size: 0.52rem;
  font-family: var(--font-mono);
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  margin-top: 0.15rem;
}

/* ── Buddy Selector Drawer inside Left Panel or inside Tab ── */
.unified-modal-buddy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.6rem;
  padding-bottom: 1rem;
}

.unified-modal-buddy-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.65rem 0.45rem;
  cursor: pointer;
  transition: all var(--transition);
}

.unified-modal-buddy-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--border-strong);
}

.unified-modal-buddy-card.active {
  border-color: var(--green);
  background: var(--green-dim);
}

.unified-modal-buddy-card.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.unified-modal-buddy-card-icon {
  width: 36px;
  height: 36px;
  position: relative;
  margin-bottom: 0.4rem;
}

.unified-modal-buddy-card-name {
  font-size: 0.58rem;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

/* ── Premium Circular Spray Wheel ── */
.cosmetics-panel-container {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  height: 100%;
}

.premium-spray-wheel-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem 0;
}

.circular-spray-wheel {
  position: relative;
  width: 180px;
  height: 180px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(255, 64, 85, 0.03) 0%, rgba(255, 255, 255, 0.01) 70%);
  border: 1px solid rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0.5rem 0;
}

.circular-spray-wheel-ring {
  position: absolute;
  inset: 24%;
  border: 1px dashed rgba(255, 255, 255, 0.07);
  border-radius: 50%;
  pointer-events: none;
}

.circular-spray-wheel-center {
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  font-weight: 800;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.circular-spray-slot {
  position: absolute;
  width: 46px;
  height: 46px;
  border-radius: 8px;
  background: rgba(18, 28, 36, 0.85);
  border: 1px solid var(--loadout-card-border);
  padding: 0.2rem;
  cursor: pointer;
  transition: all var(--transition);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}

.circular-spray-slot:hover {
  transform: scale(1.08);
  border-color: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
}

.circular-spray-slot.is-equipped {
  border-color: var(--border-strong);
  background: var(--loadout-card-bg);
}

.circular-spray-slot-inner {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.circular-spray-slot-inner img {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
}

.circular-spray-slot-empty {
  font-size: 0.9rem;
  color: var(--text-dim);
  font-weight: 600;
}

/* Position wheel slots */
.circular-spray-slot--top {
  top: 0;
  left: 50%;
  transform: translateX(-50%);
}

.circular-spray-slot--top:hover {
  transform: translateX(-50%) scale(1.08);
}

.circular-spray-slot--right {
  right: 0;
  top: 50%;
  transform: translateY(-50%);
}

.circular-spray-slot--right:hover {
  transform: translateY(-50%) scale(1.08);
}

.circular-spray-slot--bottom {
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
}

.circular-spray-slot--bottom:hover {
  transform: translateX(-50%) scale(1.08);
}

.circular-spray-slot--left {
  left: 0;
  top: 50%;
  transform: translateY(-50%);
}

.circular-spray-slot--left:hover {
  transform: translateY(-50%) scale(1.08);
}

.circular-spray-label-hint {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  color: var(--text-dim);
  text-align: center;
  margin-top: 0.35rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* Weapon Card Overrides for high-end look */
.valorant-weapon-card {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.valorant-weapon-card:hover {
  border-color: var(--accent);
}

.valorant-weapon-card-footer {
  background: linear-gradient(180deg, transparent 0%, rgba(3, 5, 8, 0.8) 72%);
}
`;

fs.writeFileSync(cssPath, cssContent + '\\n' + newStyles, 'utf8');
console.log('Appended styles successfully!');
