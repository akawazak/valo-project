"use client";

import type { CSSProperties } from "react";

export type ReleasePreviewKind = "insights" | "compare" | "badges";

const shares = [62, 44, 57];
const CARD = (id: string) => `url("https://media.valorant-api.com/playercards/${id}/largeart.png")`;

/** Small drawn previews of each headline feature, built in the app's own style so they never go stale with the art. */
export default function ReleasePreview({ kind }: { kind: ReleasePreviewKind }) {
    if (kind === "insights") return <div className="rn-preview rn-insights">
        <svg viewBox="0 0 120 120" aria-hidden="true">
            <polygon className="rn-grid" points="60,10 103.3,35 103.3,85 60,110 16.7,85 16.7,35" />
            <polygon className="rn-grid" points="60,27 88.6,43.5 88.6,76.5 60,93 31.4,76.5 31.4,43.5" />
            <polygon className="rn-grid" points="60,43.3 74.5,51.7 74.5,68.3 60,76.7 45.5,68.3 45.5,51.7" />
            <polygon className="rn-shape" points="60,17 83.8,46.3 86.8,75.5 60,84 28,78.5 34,45" />
        </svg>
        <div className="rn-identity">
            <small>You play like a</small>
            <span className="rn-plate">Fragger</span>
            <p><b>Aim</b><i style={{ "--v": "80%" } as CSSProperties} /><em>65</em></p>
            <p><b>Economy</b><i style={{ "--v": "66%" } as CSSProperties} /><em>58</em></p>
        </div>
    </div>;

    if (kind === "compare") return <div className="rn-preview rn-compare">
        <span className="rn-card" data-side="0" style={{ "--art": CARD("ba3f6dea-9040-4014-b44e-2a856e030f8f") } as CSSProperties}><b>You</b></span>
        <div className="rn-duel">
            <p><b data-lead>4</b><span>VS</span><b>2</b></p>
            {shares.map((share, index) => <span key={index} className="rn-tug" style={{ "--share": `${share}%`, animationDelay: `${0.25 + index * 0.08}s` } as CSSProperties}><i data-lead={share > 50 || undefined} /><i data-lead={share < 50 || undefined} /></span>)}
        </div>
        <span className="rn-card" data-side="1" style={{ "--art": CARD("3432dc3d-47da-4675-67ae-53adb1fdad5e") } as CSSProperties}><b>Them</b></span>
    </div>;

    return <div className="rn-preview rn-badges">
        <span className="rn-tip"><b>Headhunter</b> More headshots than 81% of the players you face</span>
        <ul>
            <li data-tone="good" data-open>Headhunter</li>
            <li data-tone="good">Eco menace</li>
            <li data-tone="neutral">Night owl</li>
            <li data-tone="neutral">Squad up</li>
        </ul>
    </div>;
}
