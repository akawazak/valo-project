import type { ProfileMatchDetails } from "@/services/api";

export type RoundEnd = "elim" | "boom" | "defuse" | "time" | "other";
export type MatchSide = "all" | "attack" | "defense";

export interface RoundOutcome {
    roundNum: number;
    /** True when the viewed player's team won the round. */
    won: boolean;
    end: RoundEnd;
    label: string;
    /** True on the first round after the half-time side swap. */
    afterSwap: boolean;
}

export interface SideStats {
    rounds: number;
    kills: number;
    deaths: number;
    assists: number;
    acs: number;
    adr: number;
    hsPct: number;
    hasShots: boolean;
    firstKills: number;
    firstDeaths: number;
}

type Round = NonNullable<ProfileMatchDetails["rounds"]>[number];
type Kill = NonNullable<ProfileMatchDetails["kills"]>[number];

const END_LABELS: Record<RoundEnd, string> = {
    elim: "elimination",
    boom: "spike detonated",
    defuse: "spike defused",
    time: "time ran out",
    other: "round ended",
};

export function roundEnd(result?: string): RoundEnd {
    const value = (result || "").toLowerCase();
    if (value.includes("detonat")) return "boom";
    if (value.includes("defus")) return "defuse";
    if (value.includes("timer") || value.includes("time")) return "time";
    if (value.includes("elimin")) return "elim";
    return "other";
}

/** Rounds per half: 12 for standard modes, 4 for Swiftplay, 3 for Spike Rush. */
export function halfLength(queueId?: string): number {
    const queue = (queueId || "").toLowerCase();
    if (queue.includes("swiftplay")) return 4;
    if (queue.includes("spikerush")) return 3;
    return 12;
}

// Red attacks first. After regulation (two halves) overtime swaps every round,
// starting on first-half sides.
function attackingTeamByRule(roundNum: number, half: number): "red" | "blue" {
    if (roundNum < half) return "red";
    if (roundNum < half * 2) return "blue";
    return (roundNum - half * 2) % 2 === 0 ? "red" : "blue";
}

export function attackingTeam(round: Round, half: number, teamOf: Map<string, string>): "red" | "blue" {
    const planterTeam = round.bombPlanter ? teamOf.get(round.bombPlanter.toLowerCase()) : undefined;
    if (planterTeam === "red" || planterTeam === "blue") return planterTeam;
    const defuserTeam = round.bombDefuser ? teamOf.get(round.bombDefuser.toLowerCase()) : undefined;
    if (defuserTeam === "red") return "blue";
    if (defuserTeam === "blue") return "red";
    return attackingTeamByRule(round.roundNum, half);
}

function teamLookup(detail: ProfileMatchDetails) {
    return new Map(detail.players.map((player) => [player.subject.toLowerCase(), player.teamId.toLowerCase()]));
}

export function roundOutcomes(detail: ProfileMatchDetails, localTeamId: string, queueId?: string): RoundOutcome[] {
    const half = halfLength(queueId);
    const ownTeam = localTeamId.toLowerCase();
    let ours = 0;
    let theirs = 0;
    return [...(detail.rounds ?? [])]
        .sort((left, right) => left.roundNum - right.roundNum)
        .map((round) => {
            const won = round.winningTeam.toLowerCase() === ownTeam;
            if (won) ours += 1; else theirs += 1;
            const end = roundEnd(round.roundResult);
            return {
                roundNum: round.roundNum,
                won,
                end,
                // Marks half-time and the start of overtime / the decider round.
                afterSwap: round.roundNum === half || round.roundNum === half * 2,
                label: `Round ${round.roundNum + 1} · ${won ? "Won" : "Lost"} by ${END_LABELS[end]} · ${ours}–${theirs}`,
            };
        });
}

function firstKillsByRound(kills: Kill[]) {
    const first = new Map<number, Kill>();
    for (const kill of kills) {
        const current = first.get(kill.roundNum);
        if (!current || kill.roundTime < current.roundTime) first.set(kill.roundNum, kill);
    }
    return first;
}

/**
 * Per-player stats for one side of the map. "all" keeps Riot's own totals for
 * ACS/ADR/HS and only adds first kills/deaths; a side filter rebuilds every
 * stat from the rounds that player's team spent on that side.
 */
export function sideStats(detail: ProfileMatchDetails, side: MatchSide, queueId?: string): Map<string, SideStats> {
    const half = halfLength(queueId);
    const teamOf = teamLookup(detail);
    const rounds = detail.rounds ?? [];
    const kills = detail.kills ?? [];
    const attackers = new Map(rounds.map((round) => [round.roundNum, attackingTeam(round, half, teamOf)]));
    const onSide = (subject: string, roundNum: number) => {
        if (side === "all") return true;
        const attacker = attackers.get(roundNum);
        if (!attacker) return false;
        const attacking = teamOf.get(subject.toLowerCase()) === attacker;
        return side === "attack" ? attacking : !attacking;
    };

    const out = new Map<string, SideStats>();
    for (const player of detail.players) {
        out.set(player.subject.toLowerCase(), {
            rounds: side === "all" ? player.roundsPlayed : 0,
            kills: side === "all" ? player.kills : 0,
            deaths: side === "all" ? player.deaths : 0,
            assists: side === "all" ? player.assists : 0,
            acs: side === "all" ? player.acs : 0,
            adr: side === "all" ? player.adr : 0,
            hsPct: side === "all" ? player.hsPct : 0,
            hasShots: side === "all" ? player.headshots + player.bodyshots + player.legshots > 0 : false,
            firstKills: 0,
            firstDeaths: 0,
        });
    }

    for (const kill of firstKillsByRound(kills).values()) {
        if (onSide(kill.killer, kill.roundNum)) {
            const killer = out.get(kill.killer.toLowerCase());
            if (killer) killer.firstKills += 1;
        }
        if (onSide(kill.victim, kill.roundNum)) {
            const victim = out.get(kill.victim.toLowerCase());
            if (victim) victim.firstDeaths += 1;
        }
    }
    if (side === "all") return out;

    const totals = new Map<string, { score: number; damage: number; head: number; body: number; leg: number }>();
    for (const round of rounds) {
        for (const stat of round.playerStats ?? []) {
            const subject = stat.subject.toLowerCase();
            const entry = out.get(subject);
            if (!entry || !onSide(subject, round.roundNum)) continue;
            entry.rounds += 1;
            const total = totals.get(subject) ?? { score: 0, damage: 0, head: 0, body: 0, leg: 0 };
            total.score += stat.score || 0;
            for (const hit of stat.damage ?? []) {
                total.damage += hit.damage || 0;
                total.head += hit.headshots || 0;
                total.body += hit.bodyshots || 0;
                total.leg += hit.legshots || 0;
            }
            totals.set(subject, total);
        }
    }
    for (const kill of kills) {
        if (onSide(kill.killer, kill.roundNum)) {
            const killer = out.get(kill.killer.toLowerCase());
            if (killer) killer.kills += 1;
        }
        if (onSide(kill.victim, kill.roundNum)) {
            const victim = out.get(kill.victim.toLowerCase());
            if (victim) victim.deaths += 1;
        }
        for (const assistant of kill.assistants ?? []) {
            if (!onSide(assistant, kill.roundNum)) continue;
            const helper = out.get(assistant.toLowerCase());
            if (helper) helper.assists += 1;
        }
    }
    for (const [subject, entry] of out) {
        const total = totals.get(subject);
        if (!total || entry.rounds === 0) continue;
        const shots = total.head + total.body + total.leg;
        entry.acs = total.score / entry.rounds;
        entry.adr = total.damage / entry.rounds;
        entry.hsPct = shots > 0 ? (total.head / shots) * 100 : 0;
        entry.hasShots = shots > 0;
    }
    return out;
}

/** Side filters need per-round player stats and kill events. */
export function hasRoundBreakdown(detail: ProfileMatchDetails): boolean {
    return (detail.rounds?.length ?? 0) > 0
        && (detail.kills?.length ?? 0) > 0
        && (detail.rounds ?? []).some((round) => (round.playerStats?.length ?? 0) > 0);
}
