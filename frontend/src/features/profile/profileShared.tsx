"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { type ProfileMatchDetails } from "@/services/api";
import s from "./ProfilePanel.module.css";

export interface AgentMeta {
    name: string;
    icon: string;
    full?: string;
    role: string;
    roleIcon: string;
    abilities?: Record<string, { name: string; icon: string }>;
}

export interface PublicAgent {
    uuid?: string;
    displayName: string;
    displayIcon?: string;
    killfeedPortrait?: string;
    fullPortrait?: string;
    role?: { displayName?: string; displayIcon?: string };
    abilities?: Array<{ slot?: string; displayName?: string; displayIcon?: string }>;
    developerName?: string;
    isPlayableCharacter?: boolean;
}
export interface PublicMap {
    uuid?: string;
    displayName: string;
    splash?: string;
    displayIcon?: string;
    assetPath?: string;
    mapUrl?: string;
    xMultiplier?: number;
    yMultiplier?: number;
    xScalarToAdd?: number;
    yScalarToAdd?: number;
    callouts?: Array<{ regionName?: string; superRegionName?: string; location?: { x?: number; y?: number } }>;
}
export interface PublicTierSet { tiers?: Array<{ tier?: number; smallIcon?: string }> }
export interface PublicSeason { uuid?: string; displayName?: string; parentUuid?: string; startTime?: string; assetPath?: string }
export interface MapMeta {
    uuid: string;
    name: string;
    splash: string;
    displayIcon: string;
    mode: "standard" | "teamdeathmatch" | "other";
    xMultiplier?: number;
    yMultiplier?: number;
    xScalarToAdd?: number;
    yScalarToAdd?: number;
    callouts: Array<{ name: string; superRegion: string; x: number; y: number }>;
}

export function mapCalloutLabel(callout: MapMeta["callouts"][number]): string {
    const region = callout.superRegion.trim();
    const name = callout.name.trim();
    if (!region || name.toLowerCase().startsWith(region.toLowerCase())) return name || region || "Map area";
    return `${region} ${name}`;
}

export function mapZoneLabel(callout: MapMeta["callouts"][number]): string {
    const region = callout.superRegion.trim().toLowerCase();
    if (region === "a" || region.startsWith("a ")) return "A Site";
    if (region === "b" || region.startsWith("b ")) return "B Site";
    if (region === "c" || region.startsWith("c ")) return "C Site";
    if (region.includes("mid")) return "Mid";
    return "Other";
}

export function mapCalloutPlotPosition(map: MapMeta, callout: MapMeta["callouts"][number]) {
    const left = callout.y * map.xMultiplier! + map.xScalarToAdd!;
    let top = callout.x * map.yMultiplier! + map.yScalarToAdd!;

    // Valorant-API's Breeze A Lobby anchor lands below the non-transparent minimap geometry.
    if (
        (map.uuid === "2fb9a4fd-47b8-4e7d-a969-74b4046ebd53" || map.name.trim().toLowerCase() === "breeze")
        && callout.superRegion.trim().toLowerCase() === "a"
        && callout.name.trim().toLowerCase() === "lobby"
    ) {
        top -= 0.065;
    }

    return {
        left: Math.max(0, Math.min(1, left)),
        top: Math.max(0, Math.min(1, top)),
    };
}
export interface SeasonMeta {
    uuid: string;
    name: string;
    parentUuid: string;
    startTime: number;
    isAct: boolean;
}
export const RANK_GROUPS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
export const RANK_COLORS = ["#9aa3a8", "#c58a5c", "#c9d4da", "#e8c15a", "#3fd0e0", "#c37cf2", "#3fd08a", "#e8566a"];
export const PAGE_SIZES = [10, 20, 50];
export const SEASON_QUEUES = [
    { value: "competitive", label: "Competitive" },
    { value: "all", label: "All modes" },
    { value: "swiftplay", label: "Swiftplay" },
    { value: "unrated", label: "Unrated" },
];
export const FALLBACK_RANK_ICON =
    "https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/smallicon.png";

// Session-scoped caches for valorant-api.com metadata so we only fetch
// agents / maps / competitive-tier icons once per app session.

export function tierLabel(tier: number, fallback?: string): string {
    if (!tier || tier <= 0) return "Unranked";
    if (tier >= 27) return "Radiant";
    const groupIdx = Math.floor((tier - 3) / 3);
    const sub = (tier - 3) % 3;
    const name = RANK_GROUPS[Math.min(groupIdx, RANK_GROUPS.length - 1)] ?? fallback ?? "Rank";
    return `${name} ${sub + 1}`;
}

export function rankIconUrl(tier: number, tierAssets: Map<number, { smallIcon: string }>): string | null {
    return tierAssets.get(tier)?.smallIcon || FALLBACK_RANK_ICON;
}
/** Puts the chosen comparison target first; ProfileComparison opens on the first candidate. */
export function orderCandidates<T extends { puuid: string }>(target: string, candidates: T[]): T[] {
    if (!target) return candidates;
    const key = target.toLowerCase();
    return [...candidates.filter((item) => item.puuid.toLowerCase() === key), ...candidates.filter((item) => item.puuid.toLowerCase() !== key)];
}

export function seasonLabel(id: string, seasons: Record<string, SeasonMeta>): string {
    const key = (id || "").toLowerCase();
    const season = seasons[key];
    if (!season) {
        // Show something more helpful than just an uppercase blob if the
        // short code doesn't match — Riot codes like "e7a3" can be expanded
        // by hand to "E7 A3" so the user knows it's a real act.
        if (/^e?\d{1,2}a\d{1,2}$/.test(key)) {
            return key.toUpperCase();
        }
        if (/^v\d{1,2}a\d{1,2}$/.test(key)) {
            return key.toUpperCase();
        }
        return id;
    }
    const parent = season.parentUuid ? seasons[season.parentUuid.toLowerCase()] : undefined;
    return parent ? `${parent.name} · ${season.name}` : season.name;
}

export function fmtDate(ms: number): string {
    if (!ms) return "Never";
    return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function fmtLength(ms: number): string {
    if (!ms || ms < 0) return "--";
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtPct(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return `${(n ?? 0).toFixed(1)}%`;
}

export function fmtRatio(n: number | undefined): string {
    if (!Number.isFinite(n ?? NaN)) return "--";
    return (n ?? 0).toFixed(2);
}

/** Riot round ceremonies worth calling out; CeremonyDefault and blanks are skipped. */
export const ROUND_CEREMONIES: Record<string, string> = {
    CeremonyClutch: "Clutch",
    CeremonyAce: "Ace",
    CeremonyTeamAce: "Team ace",
    CeremonyFlawless: "Flawless",
    CeremonyThrifty: "Thrifty",
    CeremonyCloser: "Closer",
};

/** 1 → "1ST", 2 → "2ND", 11 → "11TH". */
export function placeLabel(n: number): string {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[n % 10] || "TH";
    return `${n}${suffix}`;
}

export function statCount(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/** True when a sync timestamp is within the last 15 minutes. */
export function isRecent(ms: number | undefined): boolean {
    return Boolean(ms) && Date.now() - (ms ?? 0) < 15 * 60_000;
}

export function fmtAgo(ms: number): string {
    if (!ms) return "—";
    const diff = Date.now() - ms;
    if (diff < 0) return "just now";
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function fmtClock(ms: number): string {
    if (!ms) return "--";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Match history is grouped by calendar day so a long list stays scannable.
export function dayStart(ms: number): number {
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return 0;
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

export function dayHeadline(ms: number): string {
    const key = dayStart(ms);
    if (!key) return "Unknown date";
    const today = dayStart(Date.now());
    const diffDays = Math.round((today - key) / 86_400_000);
    const date = new Date(key);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
    const sameYear = date.getFullYear() === new Date(today).getFullYear();
    return date.toLocaleDateString(undefined, sameYear
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" });
}

export function dayAgo(ms: number): string {
    const key = dayStart(ms);
    if (!key) return "";
    const diffDays = Math.round((dayStart(Date.now()) - key) / 86_400_000);
    if (diffDays <= 1) return "";
    if (diffDays < 7) return `${diffDays} days ago`;
    return "";
}

// Fixed game-identity hues per agent role. These deliberately ignore the active
// accent theme so the Duelist/Initiator/etc. colour language stays learnable.
export const AGENT_ROLE_TONES: Record<string, string> = {
    duelist: "agentRoleDuelist",
    initiator: "agentRoleInitiator",
    controller: "agentRoleController",
    sentinel: "agentRoleSentinel",
    flex: "agentRoleFlex",
};

export function agentRoleTone(role: string | undefined): keyof typeof s {
    const key = (role || "flex").trim().toLowerCase();
    const tone = AGENT_ROLE_TONES[key] || AGENT_ROLE_TONES.flex;
    return s[tone] as unknown as keyof typeof s;
}

export function kdColor(kd: number | undefined): string {
    if (!Number.isFinite(kd ?? NaN)) return "";
    const v = kd ?? 0;
    if (v >= 2.0) return s.statElite;
    if (v >= 1.5) return s.statGreat;
    if (v >= 1.0) return s.statGood;
    if (v >= 0.8) return s.statAvg;
    return s.statPoor;
}
export function hsColor(hs: number | undefined): string {
    if (!Number.isFinite(hs ?? NaN)) return "";
    const v = hs ?? 0;
    if (v >= 30) return s.statElite;
    if (v >= 22) return s.statGreat;
    if (v >= 15) return s.statGood;
    if (v >= 10) return s.statAvg;
    return s.statPoor;
}
export function acsColor(acs: number | undefined): string {
    if (!Number.isFinite(acs ?? NaN)) return "";
    const v = acs ?? 0;
    if (v >= 280) return s.statElite;
    if (v >= 220) return s.statGreat;
    if (v >= 160) return s.statGood;
    if (v >= 120) return s.statAvg;
    return s.statPoor;
}


export function cleanError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err || "");
    if (!raw) return "Something went wrong.";
    if (/error sending request|failed to fetch|connection refused|unable to connect|localhost:31719/i.test(raw)) {
        return "Local backend is not reachable. Restart ValoVault, then sync again.";
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed?.message) return String(parsed.message);
        if (parsed?.error) return String(parsed.error);
    } catch {
        // Keep the original string.
    }
    if (/expired|unauthorized|forbidden|401|403/i.test(raw)) {
        return "Token expired or Riot rejected the session. Reconnect this account.";
    }
    return raw;
}


export type MatchKillEvent = NonNullable<ProfileMatchDetails["kills"]>[number];
// Distance at which a teammate can usually trade a death; Riot positions are in game units (100 per metre).
export const TRADE_RANGE_METRES = 10;
export const MAP_MAX_ZOOM = 4;
export const gameUnitsToMetres = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 100);
export type MatchDetailPlayer = ProfileMatchDetails["players"][number];

export interface DuelFocus {
    id: string;
    label: string;
    events: MatchKillEvent[];
    index: number;
}

export interface DuelFinisher {
    name: string;
    icon: string;
    kind: "ability" | "weapon";
}

export function fightEventKey(event: MatchKillEvent): string {
    return `${event.roundNum}:${event.gameTime}:${event.killer.toLowerCase()}:${event.victim.toLowerCase()}`;
}

export const RIOT_ABILITY_WEAPON_SLOTS: Record<string, string> = {
    "856d9a7e-4b06-dc37-15dc-9d809c37cb90": "ability1", // Chamber — Headhunter
    "39099fb5-4293-def4-1e09-2e9080ce7456": "ultimate", // Chamber — Tour de Force
    "95336ae4-45d4-1032-cfaf-6bad01910607": "ultimate", // Neon — Overdrive
};

export function riotAbilitySlotKey(damageType: string, damageItem: string): string {
    if (damageType.includes("ability")) {
        return damageItem === "grenadeability" ? "grenade" : damageItem;
    }
    return RIOT_ABILITY_WEAPON_SLOTS[damageItem] || "";
}

export function MapDuelFinisher({ finisher, offset }: { finisher: DuelFinisher; offset: { x: number; y: number } }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
        <span
            className={`${s.mapDuelWeapon} ${finisher.kind === "ability" ? s.mapDuelWeaponAbility : s.mapDuelWeaponGun}`}
            title={finisher.name}
            style={{ "--weapon-x": `${offset.x}px`, "--weapon-y": `${offset.y}px` } as CSSProperties}
        >
            <Image
                src={finisher.icon}
                alt={finisher.name}
                width={finisher.kind === "ability" ? 20 : 40}
                height={finisher.kind === "ability" ? 20 : 18}
                unoptimized
                onError={() => setFailed(true)}
            />
        </span>
    );
}

export function MapDuelMarker({
    point,
    player,
    agent,
    dead,
    local,
    finisher,
    avoidPoint,
}: {
    point: { left: number; top: number };
    player?: MatchDetailPlayer;
    agent?: AgentMeta;
    dead: boolean;
    local: boolean;
    finisher?: DuelFinisher;
    avoidPoint?: { left: number; top: number };
}) {
    const playerName = local ? "You" : player?.gameName || agent?.name || "Player";
    const weaponOffset = useMemo(() => {
        if (!avoidPoint) return { x: 0, y: -30 };
        const dx = point.left - avoidPoint.left;
        const dy = point.top - avoidPoint.top;
        const y = Math.abs(dy) < 0.035 ? -30 : dy > 0 ? 37 : -30;
        const blockedByVerticalEdge = (y < 0 && point.top < 0.11) || (y > 0 && point.top > 0.88);
        if (!blockedByVerticalEdge) return { x: 0, y };

        let x = dx >= 0 ? 34 : -34;
        if ((x < 0 && point.left < 0.11) || (x > 0 && point.left > 0.89)) x *= -1;
        return { x, y: 0 };
    }, [avoidPoint, point.left, point.top]);
    return (
        <span
            className={`${s.mapDuelMarker} ${dead ? s.mapDuelMarkerDead : ""} ${local ? s.mapDuelMarkerLocal : ""}`}
            style={{ left: `${point.left * 100}%`, top: `${point.top * 100}%` }}
            title={`${playerName}${dead ? local ? " were eliminated" : " was eliminated" : " got the elimination"}`}
            aria-label={`${playerName}${dead ? local ? " were eliminated" : " was eliminated" : " got the elimination"}`}
        >
            {!dead && finisher?.icon ? <MapDuelFinisher key={finisher.icon} finisher={finisher} offset={weaponOffset} /> : null}
            <span className={s.mapDuelPortrait}>
                {agent?.icon ? (
                    <Image src={agent.icon} alt={agent.name} width={42} height={42} unoptimized />
                ) : (
                    <b>{(agent?.name || playerName).slice(0, 1)}</b>
                )}
                {dead ? <i aria-hidden="true" /> : null}
            </span>
            <small>{playerName}</small>
        </span>
    );
}

/* ── Match row with expandable scoreboard ── */
