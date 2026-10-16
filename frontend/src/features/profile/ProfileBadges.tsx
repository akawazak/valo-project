"use client";

import type { CSSProperties } from "react";
import type { ProfileMatchSummary } from "@/services/api";
import { profileBadges } from "./badgeRules";
import { useCareerInsights } from "./useCareerInsights";
import b from "./ProfileBadges.module.css";

const TONE = { good: "#2fd6a3", neutral: "#f0b941", bad: "#ff4f6d" };

/** Trait badges under the profile name, each earned from the player's real stats. */
export default function ProfileBadges({ puuid, region, queue, matches }: { puuid: string; region: string; queue: string; matches: ProfileMatchSummary[] }) {
    const { data } = useCareerInsights(puuid, region, queue);
    const badges = profileBadges(data, matches);
    if (!badges.length) return null;
    return <ul className={b.badges} aria-label="Playstyle badges">
        {badges.map((badge) => <li key={badge.id} className={b.item} data-tone={badge.tone} style={{ "--tone": TONE[badge.tone] } as CSSProperties}>
            <span className={b.badge} tabIndex={0}>{badge.label}</span>
            <span className={b.tip} role="tooltip"><strong>{badge.label}</strong>{badge.rarity ? <em>{badge.rarity}</em> : null}<small>{badge.detail}</small></span>
        </li>)}
    </ul>;
}
