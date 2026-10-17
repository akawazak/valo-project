"use client";

import type { CSSProperties } from "react";

export type ReleasePreviewKind = "insights" | "compare" | "badges" | "replay" | "trade" | "takeaways" | "accounts" | "killspot";

const ROUNDS = ["W", "W", "L", "W", "L", "W", "W"];

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

    if (kind === "replay") return <div className="rn-preview rn-replay">
        <svg viewBox="0 0 200 92" aria-hidden="true">
            <path className="rn-map" d="M24 14h58v14h36V10h58v40h-22v32H96V64H62v18H24z" />
            <line className="rn-shot" x1="142" y1="30" x2="84" y2="50" />
            <circle className="rn-foe" cx="142" cy="30" r="4" />
            <circle className="rn-foe" cx="160" cy="62" r="4" />
            <circle className="rn-foe" cx="128" cy="72" r="4" />
            <circle className="rn-ally" cx="50" cy="30" r="4" />
            <circle className="rn-ally" cx="40" cy="66" r="4" />
            <circle className="rn-ally" cx="70" cy="22" r="4" />
            <g className="rn-x" transform="translate(84 50)"><line x1="-4" y1="-4" x2="4" y2="4" /><line x1="4" y1="-4" x2="-4" y2="4" /></g>
        </svg>
        <div className="rn-rounds">
            {ROUNDS.map((result, index) => <i key={index} data-win={result === "W" || undefined} data-on={index === 3 || undefined} style={{ animationDelay: `${0.1 + index * 0.05}s` }}>{index + 1}</i>)}
        </div>
    </div>;

    if (kind === "trade") return <div className="rn-preview rn-trade">
        <svg viewBox="0 0 200 110" aria-hidden="true">
            <circle className="rn-ring" cx="92" cy="58" r="34" />
            <line className="rn-shot" x1="164" y1="30" x2="92" y2="58" />
            <line className="rn-mate-line" x1="92" y1="58" x2="64" y2="74" />
            <circle className="rn-foe" cx="164" cy="30" r="5" />
            <circle className="rn-ally" cx="64" cy="74" r="5" />
            <g className="rn-x" transform="translate(92 58)"><line x1="-5" y1="-5" x2="5" y2="5" /><line x1="5" y1="-5" x2="-5" y2="5" /></g>
            <text className="rn-label" x="58" y="92">6 m</text>
            <text className="rn-label rn-dim" x="92" y="18">10 m trade range</text>
        </svg>
        <span className="rn-verdict">Traded</span>
    </div>;

    if (kind === "accounts") return <div className="rn-preview rn-accounts">
        <span className="rn-pill"><i>2</i><b /> Vanta<em>#DEMO</em></span>
        <ul>
            <li data-state="sign-in"><b>Alt</b><em>#ONE</em><span>Sign-in required</span></li>
            <li data-state="soon"><b>Alt</b><em>#TWO</em><span>Riot login ends in 2 days</span></li>
        </ul>
    </div>;

    if (kind === "killspot") return <div className="rn-preview rn-killspot">
        <svg viewBox="0 0 120 92" aria-hidden="true">
            <path className="rn-map" d="M12 10h40v14h26V8h30v40H92v30H56V62H34v18H12z" />
            <circle className="rn-ally" cx="82" cy="24" r="3.4" />
            <circle className="rn-ally" cx="90" cy="30" r="3.4" />
            <circle className="rn-ally" cx="78" cy="34" r="3.4" />
            <circle className="rn-ally" cx="94" cy="20" r="3.4" />
            <circle className="rn-zone" cx="86" cy="27" r="16" />
        </svg>
        <p><small>Keep doing</small><b>Your kills come from A Site</b><em>6 kills this match</em></p>
    </div>;

    if (kind === "takeaways") return <div className="rn-preview rn-takeaways">
        <p data-tone="work"><small>Work on</small><b>Change how you play A Main</b><em>5 deaths</em></p>
        <p data-tone="keep"><small>Keep doing</small><b>Your B openings win 7 of 9</b><em>78%</em></p>
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
