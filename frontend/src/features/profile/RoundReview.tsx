"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import rr from "./RoundReview.module.css";
import type { Weapon } from "@/lib/types";
import { type ProfileMatchDetails } from "@/services/api";
import s from "./ProfilePanel.module.css";
import { type AgentMeta, type MapMeta, mapCalloutLabel, mapCalloutPlotPosition, fmtLength, ROUND_CEREMONIES, statCount, type MatchKillEvent, fightEventKey, riotAbilitySlotKey } from "./profileShared";

export function RoundReview({
    detail,
    map,
    agents,
    weapons,
    initialRoundNum,
    onInspectFight,
}: {
    detail: ProfileMatchDetails;
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
    initialRoundNum?: number;
    onInspectFight?: (event: MatchKillEvent) => void;
}) {
    const rounds = useMemo(() => detail.rounds || [], [detail.rounds]);
    const local = detail.players.find((player) => player.isLocal);
    const localSubject = local?.subject.toLowerCase() || "";
    const localTeam = local?.teamId.toLowerCase() || "";
    const [selectedRoundNum, setSelectedRoundNum] = useState(initialRoundNum ?? rounds[0]?.roundNum ?? 0);
    // Which feed moment the map replays. It belongs to one round; another round starts at its first kill.
    const [moment, setMoment] = useState<{ round: number; id: string } | null>(null);
    const [replaying, setReplaying] = useState(false);
    const weaponById = useMemo(() => new Map(weapons.map((weapon) => [weapon.uuid.toLowerCase(), weapon])), [weapons]);
    const selectedRound = rounds.find((round) => round.roundNum === selectedRoundNum) || rounds[0];
    const selectedStat = selectedRound?.playerStats?.find((stat) => stat.subject.toLowerCase() === localSubject);
    const selectedKills = (detail.kills || []).filter((event) => event.roundNum === selectedRound?.roundNum);
    const localKills = selectedKills.filter((event) => event.killer.toLowerCase() === localSubject);
    const localDeaths = selectedKills.filter((event) => event.victim.toLowerCase() === localSubject);
    const localAssists = selectedKills.filter((event) => event.assistants?.some((assistant) => assistant.toLowerCase() === localSubject));
    const damageDone = selectedStat?.damage?.reduce((sum, event) => sum + event.damage, 0) || 0;
    const headshots = selectedStat?.damage?.reduce((sum, event) => sum + event.headshots, 0) || 0;
    const roundWon = selectedRound?.winningTeam.toLowerCase() === localTeam;
    const weapon = selectedStat?.economy.weapon ? weaponById.get(selectedStat.economy.weapon.toLowerCase()) : undefined;
    const hasDetailedRounds = rounds.some((round) => (round.playerStats?.length || 0) > 0);
    const selectedEvents = [...localKills, ...localDeaths];
    const canPlot = Boolean(map?.displayIcon && typeof map.xMultiplier === "number" && typeof map.yMultiplier === "number" && typeof map.xScalarToAdd === "number" && typeof map.yScalarToAdd === "number");
    const plot = (x: number, y: number) => ({
        left: Math.max(0, Math.min(1, y * map!.xMultiplier! + map!.xScalarToAdd!)) * 100,
        top: Math.max(0, Math.min(1, x * map!.yMultiplier! + map!.yScalarToAdd!)) * 100,
    });
    const playerBySubject = useMemo(() => new Map(detail.players.map((player) => [player.subject.toLowerCase(), player])), [detail.players]);
    const allLocalDeaths = (detail.kills || []).filter((event) => event.victim.toLowerCase() === localSubject);
    const tradedDeaths = allLocalDeaths.filter((death) => (detail.kills || []).some((event) => event.roundNum === death.roundNum && event.roundTime >= death.roundTime && event.roundTime - death.roundTime <= 5_000 && event.victim.toLowerCase() === death.killer.toLowerCase() && playerBySubject.get(event.killer.toLowerCase())?.teamId.toLowerCase() === localTeam)).length;
    const totalAbilityEffects = rounds.reduce((sum, round) => {
        const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
        return sum + (stat?.ability.grenade || 0) + (stat?.ability.ability1 || 0) + (stat?.ability.ability2 || 0) + (stat?.ability.ultimate || 0);
    }, 0);
    const abilityUsage = useMemo(() => ([
        ["grenade", local?.abilityCasts?.grenade || 0],
        ["ability1", local?.abilityCasts?.ability1 || 0],
        ["ability2", local?.abilityCasts?.ability2 || 0],
        ["ultimate", local?.abilityCasts?.ultimate || 0],
    ] as const).filter(([, count]) => count > 0).map(([slot, count]) => ({
        count,
        name: agents[local?.characterId.toLowerCase() || ""]?.abilities?.[slot]?.name || ({ grenade: "Signature", ability1: "Ability 1", ability2: "Ability 2", ultimate: "Ultimate" } as const)[slot],
    })), [agents, local?.abilityCasts?.ability1, local?.abilityCasts?.ability2, local?.abilityCasts?.grenade, local?.abilityCasts?.ultimate, local?.characterId]);
    const totalAbilityCasts = abilityUsage.reduce((sum, ability) => sum + ability.count, 0);
    const roundFacts = useMemo(() => {
        let yourScore = 0;
        let enemyScore = 0;
        return rounds.map((round) => {
            const won = round.winningTeam.toLowerCase() === localTeam;
            if (won) yourScore += 1;
            else enemyScore += 1;
            const events = (detail.kills || [])
                .filter((event) => event.roundNum === round.roundNum)
                .sort((a, b) => a.roundTime - b.roundTime || a.gameTime - b.gameTime);
            const stat = round.playerStats?.find((entry) => entry.subject.toLowerCase() === localSubject);
            const kills = events.filter((event) => event.killer.toLowerCase() === localSubject);
            const deaths = events.filter((event) => event.victim.toLowerCase() === localSubject);
            const assists = events.filter((event) => event.assistants?.some((assistant) => assistant.toLowerCase() === localSubject));
            const openingEvent = events[0];
            const openingResult = openingEvent?.killer.toLowerCase() === localSubject
                ? "won"
                : openingEvent?.victim.toLowerCase() === localSubject
                    ? "lost"
                    : "none";
            const traded = deaths.some((death) => events.some((event) => (
                event.roundTime >= death.roundTime
                && event.roundTime - death.roundTime <= 5_000
                && event.victim.toLowerCase() === death.killer.toLowerCase()
                && playerBySubject.get(event.killer.toLowerCase())?.teamId.toLowerCase() === localTeam
            )));
            const playerTeam = (subject: string) => playerBySubject.get(subject.toLowerCase())?.teamId.toLowerCase() || "";
            const allyLoadout = (round.playerStats || [])
                .filter((entry) => playerTeam(entry.subject) === localTeam)
                .reduce((sum, entry) => sum + (entry.economy.loadoutValue || 0), 0);
            const enemyLoadout = (round.playerStats || [])
                .filter((entry) => playerTeam(entry.subject) && playerTeam(entry.subject) !== localTeam)
                .reduce((sum, entry) => sum + (entry.economy.loadoutValue || 0), 0);
            const damage = stat?.damage?.reduce((sum, event) => sum + event.damage, 0) || 0;
            const localObjective = round.bombPlanter?.toLowerCase() === localSubject
                ? `Planted${round.plantSite ? ` ${round.plantSite}` : ""}`
                : round.bombDefuser?.toLowerCase() === localSubject
                    ? "Defused"
                    : "";
            return {
                round,
                won,
                stat,
                events,
                kills,
                deaths,
                assists,
                damage,
                openingResult,
                traded,
                allyLoadout,
                enemyLoadout,
                localObjective,
                yourScore,
                enemyScore,
            };
        });
    }, [detail.kills, localSubject, localTeam, playerBySubject, rounds]);
    const selectedFact = roundFacts.find((fact) => fact.round.roundNum === selectedRound?.roundNum) || roundFacts[0];
    const turningPoints = useMemo(() => {
        const notes: Array<{ roundNum: number; tone: "good" | "danger" | "neutral"; title: string; detail: string }> = [];
        const claimed = new Set<number>();
        const add = (note: (typeof notes)[number]) => {
            if (claimed.has(note.roundNum)) return;
            claimed.add(note.roundNum);
            notes.push(note);
        };
        for (let index = 0; index < roundFacts.length; index += 1) {
            const fact = roundFacts[index];
            const displayRound = fact.round.roundNum + 1;
            if (fact.openingResult === "won" && !fact.won) {
                add({ roundNum: fact.round.roundNum, tone: "danger", title: `R${displayRound} · Advantage lost`, detail: "You secured first blood, but the round did not convert." });
                continue;
            }
            if (fact.openingResult === "lost" && fact.won) {
                add({ roundNum: fact.round.roundNum, tone: "good", title: `R${displayRound} · Team recovery`, detail: "Your team recovered the round after you were first death." });
                continue;
            }
            if (fact.won && fact.enemyLoadout - fact.allyLoadout >= 3_000) {
                add({ roundNum: fact.round.roundNum, tone: "good", title: `R${displayRound} · Economy upset`, detail: `Won despite a ${Math.round((fact.enemyLoadout - fact.allyLoadout) / 100) / 10}k team-loadout deficit.` });
                continue;
            }
            if (index >= 2 && roundFacts[index - 1].won === roundFacts[index - 2].won && fact.won !== roundFacts[index - 1].won) {
                add({
                    roundNum: fact.round.roundNum,
                    tone: fact.won ? "good" : "danger",
                    title: `R${displayRound} · ${fact.won ? "Momentum recovered" : "Momentum broken"}`,
                    detail: fact.won ? "This win stopped a two-round losing run." : "This loss ended a two-round winning run.",
                });
            }
        }
        return notes.slice(0, 6);
    }, [roundFacts]);
    const reviewInsights = useMemo(() => {
        const insights: Array<{ id: string; tone: "good" | "danger" | "neutral"; label: string; value: string; evidence: string; tip: string; ratio?: number; ring: string }> = [];
        const lostRounds = roundFacts.filter((fact) => fact.stat && !fact.won).length;
        const openingFacts = roundFacts.filter((fact) => fact.openingResult !== "none");
        const openingWon = openingFacts.filter((fact) => fact.openingResult === "won");
        const openingConverted = openingWon.filter((fact) => fact.won).length;
        if (openingFacts.length) {
            const duelRate = Math.round((openingWon.length / openingFacts.length) * 100);
            insights.push({
                id: "opening-duels",
                tone: duelRate >= 55 ? "good" : duelRate < 40 ? "danger" : "neutral",
                label: "Opening duels",
                value: `${openingWon.length}/${openingFacts.length} won`,
                ratio: openingWon.length / openingFacts.length,
                ring: `${duelRate}%`,
                evidence: `${openingConverted}/${openingWon.length} opening advantages converted into round wins.`,
                tip: duelRate >= 55 ? "Keep choosing first contact when the setup gives you support." : "Take first contact closer to a teammate or after utility creates the advantage.",
            });
        }
        if (allLocalDeaths.length) {
            const tradeRate = Math.round((tradedDeaths / allLocalDeaths.length) * 100);
            insights.push({
                id: "trade-spacing",
                tone: tradeRate >= 55 ? "good" : tradeRate < 35 ? "danger" : "neutral",
                label: "Trade spacing",
                value: `${tradedDeaths} of ${allLocalDeaths.length} traded`,
                ratio: tradedDeaths / allLocalDeaths.length,
                ring: `${tradeRate}%`,
                evidence: `${tradedDeaths}/${allLocalDeaths.length} deaths were answered by a teammate within five seconds.`,
                tip: tradeRate >= 55 ? "Your spacing created reliable return kills; preserve it." : "Play within a teammate’s trade path instead of giving isolated fights.",
            });
        }
        const multiKillRounds = roundFacts.filter((fact) => fact.kills.length >= 2);
        if (multiKillRounds.length) {
            const converted = multiKillRounds.filter((fact) => fact.won).length;
            insights.push({
                id: "multikill-conversion",
                tone: converted === multiKillRounds.length ? "good" : converted / multiKillRounds.length < 0.6 ? "danger" : "neutral",
                label: "Multi-kill conversion",
                value: `${converted}/${multiKillRounds.length} rounds`,
                ratio: converted / multiKillRounds.length,
                ring: `${converted}/${multiKillRounds.length}`,
                evidence: `${multiKillRounds.length} rounds contained at least two of your kills.`,
                tip: converted === multiKillRounds.length ? "Your high-impact rounds consistently converted." : "After a multi-kill, reset around the objective instead of offering another isolated duel.",
            });
        }
        const lowDamageLosses = roundFacts.filter((fact) => fact.stat && !fact.won && fact.damage < 100);
        if (lowDamageLosses.length) {
            insights.push({
                id: "low-damage-losses",
                tone: "danger",
                label: "Low-damage losses",
                value: `${lowDamageLosses.length} round${lowDamageLosses.length === 1 ? "" : "s"}`,
                ratio: lostRounds ? lowDamageLosses.length / lostRounds : undefined,
                ring: lostRounds ? `${lowDamageLosses.length}/${lostRounds}` : String(lowDamageLosses.length),
                evidence: `Below 100 recorded damage in rounds ${lowDamageLosses.map((fact) => fact.round.roundNum + 1).join(", ")}.`,
                tip: "Use safer utility-assisted contact or reposition early enough to contribute before the round closes.",
            });
        }
        const weakBuyLosses = roundFacts.filter((fact) => !fact.won && fact.allyLoadout > 0 && fact.enemyLoadout - fact.allyLoadout >= 3_000);
        if (weakBuyLosses.length) {
            insights.push({
                id: "economy-deficit",
                tone: "neutral",
                label: "Economy pressure",
                value: `${weakBuyLosses.length} disadvantaged loss${weakBuyLosses.length === 1 ? "" : "es"}`,
                ratio: lostRounds ? weakBuyLosses.length / lostRounds : undefined,
                ring: String(weakBuyLosses.length),
                evidence: `Your team entered those rounds at least 3,000 loadout value behind.`,
                tip: "Treat these as lower-probability rounds: coordinate the buy, preserve weapons, and avoid judging aim from the result alone.",
            });
        }
        const objectiveRounds = roundFacts.filter((fact) => fact.localObjective);
        if (objectiveRounds.length) {
            const converted = objectiveRounds.filter((fact) => fact.won).length;
            insights.push({
                id: "objective-work",
                tone: converted / objectiveRounds.length >= 0.6 ? "good" : "neutral",
                label: "Objective work",
                value: `${converted}/${objectiveRounds.length} converted`,
                ratio: converted / objectiveRounds.length,
                ring: `${converted}/${objectiveRounds.length}`,
                evidence: objectiveRounds.map((fact) => `R${fact.round.roundNum + 1} ${fact.localObjective}`).join(" · "),
                tip: converted / objectiveRounds.length >= 0.6 ? "Your plant/defuse involvement produced round value." : "After the objective action, prioritize the safest post-plant or retake position.",
            });
        }
        if (totalAbilityCasts || totalAbilityEffects) {
            insights.push({
                id: "utility",
                tone: "neutral",
                label: "Utility record",
                value: totalAbilityCasts ? `${totalAbilityCasts} casts` : `${totalAbilityEffects} effects`,
                ring: String(totalAbilityCasts || totalAbilityEffects),
                evidence: abilityUsage.length ? abilityUsage.map((ability) => `${ability.name} ${ability.count}`).join(" · ") : `${totalAbilityEffects} round effects preserved.`,
                tip: "Use this as a factual usage count; the payload does not prove whether each cast had good timing.",
            });
        }
        const behavior = local?.behavior;
        if (behavior && (behavior.friendlyFireOutgoing > 0 || behavior.afkRounds > 0 || behavior.stayedInSpawnRounds > 0)) {
            const parts = [
                behavior.friendlyFireOutgoing ? `${behavior.friendlyFireOutgoing} friendly fire dealt` : "",
                behavior.friendlyFireIncoming ? `${behavior.friendlyFireIncoming} taken` : "",
                behavior.afkRounds ? `${behavior.afkRounds} AFK round${behavior.afkRounds === 1 ? "" : "s"}` : "",
                behavior.stayedInSpawnRounds ? `${behavior.stayedInSpawnRounds} round${behavior.stayedInSpawnRounds === 1 ? "" : "s"} in spawn` : "",
            ].filter(Boolean);
            insights.push({
                id: "riot-behavior",
                tone: behavior.afkRounds || behavior.friendlyFireOutgoing >= 100 ? "danger" : "neutral",
                label: "Riot behavior",
                value: behavior.friendlyFireOutgoing ? `${behavior.friendlyFireOutgoing} team damage` : behavior.afkRounds ? `${behavior.afkRounds} AFK` : `${behavior.stayedInSpawnRounds} in spawn`,
                evidence: parts.join(" · "),
                tip: behavior.friendlyFireOutgoing ? "Watch utility and spray lines around teammates; Riot tracks team damage." : "Riot reported idle or spawn time this match; check for connection or input issues.",
                ring: behavior.friendlyFireOutgoing ? "FF" : "!",
            });
        }
        const flaggedFacts = roundFacts.filter((fact) => fact.stat && (fact.stat.wasAfk || fact.stat.wasPenalized || fact.stat.stayedInSpawn));
        if (flaggedFacts.length) {
            insights.push({
                id: "riot-status",
                tone: "danger",
                label: "Riot status flags",
                value: `${flaggedFacts.length} round${flaggedFacts.length === 1 ? "" : "s"}`,
                ratio: flaggedFacts.length / roundFacts.length,
                ring: String(flaggedFacts.length),
                evidence: `AFK, penalty, or spawn state was reported in rounds ${flaggedFacts.map((fact) => fact.round.roundNum + 1).join(", ")}.`,
                tip: "This is Riot-reported state, not an intent judgment; review connection or interruption issues if it was unexpected.",
            });
        }
        return insights;
    }, [abilityUsage, allLocalDeaths.length, local?.behavior, roundFacts, totalAbilityCasts, totalAbilityEffects, tradedDeaths]);
    const teamOf = (subject?: string) => playerBySubject.get(subject?.toLowerCase() || "")?.teamId.toLowerCase() || "";
    const roundFeed = useMemo(() => {
        if (!selectedRound) return [];
        const sideOf = (subject?: string) => playerBySubject.get(subject?.toLowerCase() || "")?.teamId.toLowerCase() || "";
        const events = [...selectedKills].sort((a, b) => a.roundTime - b.roundTime || a.gameTime - b.gameTime);
        const enemyKills = new Map<string, number>();
        const feed: Array<{
            id: string;
            time: number;
            kind: "kill" | "plant" | "defuse";
            actor: string;
            target?: string;
            text?: string;
            tag?: "Opening" | "Trade" | "Ace" | "Alt fire";
            means?: string;
            meansIcon?: string;
            meansAbility?: boolean;
            ally: boolean;
            you: boolean;
        }> = events.map((event, index) => {
            const killer = event.killer.toLowerCase();
            const victim = event.victim.toLowerCase();
            if (sideOf(killer) !== sideOf(victim)) enemyKills.set(killer, (enemyKills.get(killer) || 0) + 1);
            const damageItem = event.damageItem?.trim().toLowerCase() || "";
            const killerAgent = agents[playerBySubject.get(killer)?.characterId.toLowerCase() || ""];
            const abilitySlot = riotAbilitySlotKey(event.damageType?.toLowerCase() || "", damageItem);
            const ability = abilitySlot ? killerAgent?.abilities?.[abilitySlot] : undefined;
            const usedWeapon = damageItem ? weaponById.get(damageItem) : undefined;
            const traded = events.slice(0, index).some((prior) => (
                event.roundTime >= prior.roundTime
                && event.roundTime - prior.roundTime <= 5_000
                && victim === prior.killer.toLowerCase()
                && sideOf(killer) === sideOf(prior.victim)
            ));
            return {
                id: fightEventKey(event),
                time: event.roundTime || event.gameTime,
                kind: "kill",
                actor: killer,
                target: victim,
                tag: enemyKills.get(killer) === 5 ? "Ace" : index === 0 ? "Opening" : traded ? "Trade" : event.secondaryFire ? "Alt fire" : undefined,
                means: ability?.name || usedWeapon?.displayName,
                meansIcon: ability?.icon || usedWeapon?.displayIcon,
                meansAbility: Boolean(ability?.icon),
                ally: sideOf(killer) === localTeam,
                you: killer === localSubject || victim === localSubject,
            };
        });
        if (selectedRound.bombPlanter) {
            const planter = selectedRound.bombPlanter.toLowerCase();
            feed.push({ id: "plant", time: selectedRound.plantRoundTime || 0, kind: "plant", actor: planter, text: `planted the spike${selectedRound.plantSite ? ` on ${selectedRound.plantSite}` : ""}`, ally: sideOf(planter) === localTeam, you: planter === localSubject });
        }
        if (selectedRound.bombDefuser) {
            const defuser = selectedRound.bombDefuser.toLowerCase();
            feed.push({ id: "defuse", time: selectedRound.defuseRoundTime || 0, kind: "defuse", actor: defuser, text: "defused the spike", ally: sideOf(defuser) === localTeam, you: defuser === localSubject });
        }
        // Stable sort keeps a plant after kills recorded on the same second.
        return feed.sort((a, b) => a.time - b.time);
    }, [agents, localSubject, localTeam, playerBySubject, selectedKills, selectedRound, weaponById]);
    const ace = roundFeed.find((item) => item.tag === "Ace");
    const ceremony = selectedRound ? ROUND_CEREMONIES[selectedRound.roundCeremony || ""] : undefined;
    // Riot credits a clutch to the winning team; the clutcher is its last survivor.
    const clutcher = (() => {
        if (ceremony !== "Clutch" || !selectedRound?.winningTeam) return undefined;
        const winners = detail.players.filter((player) => player.teamId.toLowerCase() === selectedRound.winningTeam.toLowerCase());
        const survivors = winners.filter((player) => !selectedKills.some((event) => event.victim.toLowerCase() === player.subject.toLowerCase()));
        return survivors.length === 1 ? survivors[0].subject.toLowerCase() : undefined;
    })();
    const playerName = (subject?: string) => !subject ? "Unknown player" : subject === localSubject ? "You" : playerBySubject.get(subject)?.gameName || "Player";
    const agentIcon = (subject?: string) => agents[playerBySubject.get(subject || "")?.characterId.toLowerCase() || ""]?.icon;
    const selectedSignals = selectedFact ? [
        selectedFact.openingResult === "won" ? { tone: "good", label: "Opening kill" } : selectedFact.openingResult === "lost" ? { tone: "danger", label: "First death" } : null,
        selectedFact.kills.length >= 2 ? { tone: "good", label: `${selectedFact.kills.length}K multi-kill` } : null,
        selectedFact.traded ? { tone: "good", label: "Death traded" } : selectedFact.deaths.length ? { tone: "danger", label: "Untraded death" } : null,
        ace ? { tone: "objective", label: ace.actor === localSubject ? "Your ace" : `${teamOf(ace.actor) === localTeam ? "Ace" : "Enemy ace"} · ${playerName(ace.actor)}` } : null,
        ceremony && !(ceremony === "Ace" && ace) ? {
            tone: roundWon ? "good" : "danger",
            label: clutcher === localSubject ? "Your clutch" : `${roundWon ? "" : "Enemy "}${roundWon ? ceremony : ceremony.toLowerCase()}${clutcher ? ` · ${playerName(clutcher)}` : ""}`,
        } : null,
        selectedFact.localObjective ? { tone: "objective", label: selectedFact.localObjective } : null,
        selectedFact.enemyLoadout - selectedFact.allyLoadout >= 3_000 ? { tone: "neutral", label: "Lower team buy" } : selectedFact.allyLoadout - selectedFact.enemyLoadout >= 3_000 ? { tone: "good", label: "Stronger team buy" } : null,
    ].filter((signal): signal is { tone: string; label: string } => Boolean(signal)) : [];
    const selectedRoundRead = (() => {
        if (!selectedFact) return "No detailed player receipt was recorded for this round.";
        if (selectedFact.openingResult === "won" && !selectedFact.won) return "You created the opening advantage, but the team did not convert it. After first blood, reduce unnecessary re-peeks and play the objective edge.";
        if (selectedFact.openingResult === "lost" && !selectedFact.traded) return "You were first death and the kill was not traded within five seconds. Take the same contact only with closer trade support or earlier utility.";
        if (selectedFact.kills.length >= 2 && !selectedFact.won) return "Your multi-kill did not convert. The next decision after gaining numbers mattered more than finding another duel.";
        if (!selectedFact.won && selectedFact.stat && selectedFact.damage < 100) return "Low-damage loss. Look for earlier, safer contribution — utility, a crossfire, or a supported first fight.";
        if (selectedFact.won && selectedFact.enemyLoadout - selectedFact.allyLoadout >= 3_000) return "Your team won against a stronger enemy loadout—one of the match’s clearest high-value rounds.";
        if (selectedFact.won && selectedFact.deaths.length === 0) return "You survived a converted round. Preserve the weapon and repeat the positioning that kept your impact available late.";
        const line = [selectedFact.stat ? `${selectedFact.damage} damage` : null, statCount(selectedFact.kills.length, "kill"), statCount(selectedFact.assists.length, "assist")]
            .filter(Boolean).join(", ");
        if (selectedFact.won) {
            return selectedFact.deaths.length
                ? `Your team won the round after you died${selectedFact.traded ? ", and your death was traded, so the fight still paid off" : ""}. You finished with ${line}.`
                : `Your team won the round. You finished with ${line}.`;
        }
        return `Your team lost the round. You finished with ${line}${selectedFact.deaths.length ? " and died" : " and survived"}.`;
    })();

    const activeMomentId = moment?.round === selectedRound?.roundNum && roundFeed.some((item) => item.id === moment.id)
        ? moment.id
        : roundFeed.find((item) => item.kind === "kill")?.id ?? null;
    const activeMomentIndex = roundFeed.findIndex((item) => item.id === activeMomentId);
    const pickMoment = useCallback((id: string) => {
        if (selectedRound) setMoment({ round: selectedRound.roundNum, id });
    }, [selectedRound]);
    useEffect(() => {
        if (!replaying) return;
        if (activeMomentIndex >= roundFeed.length - 1) { setReplaying(false); return; }
        const timer = window.setTimeout(() => pickMoment(roundFeed[activeMomentIndex + 1].id), 1600);
        return () => window.clearTimeout(timer);
    }, [replaying, activeMomentIndex, roundFeed, pickMoment]);
    useEffect(() => { setReplaying(false); }, [selectedRoundNum]);

    if (!rounds.length) return <div className={s.mapAnalyticsEmpty}><strong>Round evidence is not cached yet.</strong><span>Open this view while connected to refresh the match details.</span></div>;

    const round = selectedRound!;
    const outcome = (round.roundResult || round.roundCeremony || "").replace(/bomb/gi, "Spike");
    const outcomeTime = round.bombDefuser && round.defuseRoundTime ? ` at ${fmtLength(round.defuseRoundTime)}` : "";
    const allyLoadout = selectedFact?.allyLoadout || 0;
    const enemyLoadout = selectedFact?.enemyLoadout || 0;
    const killById = new Map(selectedKills.map((event) => [fightEventKey(event), event]));
    const activeMoment = activeMomentIndex >= 0 ? roundFeed[activeMomentIndex] : undefined;
    const activeKill = activeMoment?.kind === "kill" ? killById.get(activeMoment.id) : undefined;
    const snapshot = activeKill ?? roundFeed.slice(0, activeMomentIndex + 1).reverse().map((item) => killById.get(item.id)).find(Boolean);
    const earlierKills = roundFeed.slice(0, activeMomentIndex).map((item) => killById.get(item.id)).filter((event): event is MatchKillEvent => Boolean(event) && event !== activeKill);
    const deadBefore = new Set(earlierKills.map((event) => event.victim.toLowerCase()));
    const replayReady = canPlot && Boolean(snapshot?.playerLocations?.length);
    const killerSpot = activeKill?.playerLocations?.find((location) => location.subject?.toLowerCase() === activeKill.killer.toLowerCase());
    const momentTime = (item: (typeof roundFeed)[number]) => item.time || 0;
    // Spread the moments over the part of the round they happened in, with a little room at the end.
    const roundLength = Math.max(20_000, ...roundFeed.map(momentTime)) * 1.08;

    // Halves follow the mode: Riot's red team attacks first and sides swap at the half, then every overtime round.
    const queueId = (detail.matchInfo.queueID || "").toLowerCase();
    const halfLength = queueId === "swiftplay" ? 4 : queueId === "spikerush" ? 3 : 12;
    const startsOnAttack = localTeam === "red";
    const halves = [
        { key: "first", label: startsOnAttack ? "Attack" : "Defense", side: startsOnAttack ? "attack" : "defense", facts: roundFacts.filter((fact) => fact.round.roundNum < halfLength) },
        { key: "second", label: startsOnAttack ? "Defense" : "Attack", side: startsOnAttack ? "defense" : "attack", facts: roundFacts.filter((fact) => fact.round.roundNum >= halfLength && fact.round.roundNum < halfLength * 2) },
        { key: "overtime", label: "Overtime", side: "overtime", facts: roundFacts.filter((fact) => fact.round.roundNum >= halfLength * 2) },
    ].filter((half) => half.facts.length);
    const finalFact = roundFacts[roundFacts.length - 1];
    const yourAgent = agents[local?.characterId.toLowerCase() || ""];
    const roundTags = selectedSignals.filter((signal) => signal.tone === "good" || signal.tone === "objective").slice(0, 3).map((signal) => signal.label);

    // Deathmatch and other modes without rounds come back as one long round: skip the round tools for them.
    const singleRound = rounds.length <= 1;

    return <section className={rr.root} style={map?.splash ? { "--rr-map": `url("${map.splash}")` } as CSSProperties : undefined}>
        {reviewInsights.length && !singleRound ? <div className={rr.review} aria-label="Match review">
            {reviewInsights.map((insight) => <article key={insight.id} data-tone={insight.tone} title={`${insight.tip}${insight.evidence ? `\n${insight.evidence}` : ""}`}>
                <svg viewBox="0 0 40 40" aria-hidden="true">
                    <circle cx="20" cy="20" r="16" />
                    {insight.ratio !== undefined ? <circle cx="20" cy="20" r="16" pathLength={100} strokeDasharray={`${Math.max(1, Math.round(insight.ratio * 100))} 100`} transform="rotate(-90 20 20)" /> : null}
                </svg>
                <span><small>{insight.label}</small><b>{insight.value}</b></span>
            </article>)}
        </div> : null}
        {!hasDetailedRounds && !singleRound ? <p className={rr.note}>Objective timeline only. Buys and damage need a refresh while connected.</p> : null}

        {!singleRound ? <div className={rr.rounds} role="group" aria-label="Rounds">
            {halves.map((half) => <div key={half.key} className={rr.half} data-side={half.side} style={{ flexGrow: half.facts.length }}>
                <span className={rr.halfLabel}>{half.label}</span>
                <div>{half.facts.map((fact) => <button
                    key={fact.round.roundNum}
                    type="button"
                    className={rr.round}
                    data-win={fact.won || undefined}
                    aria-pressed={fact.round.roundNum === round.roundNum}
                    onClick={() => setSelectedRoundNum(fact.round.roundNum)}
                    title={`Round ${fact.round.roundNum + 1}: ${fact.won ? "won" : "lost"}, ${fact.kills.length} kill${fact.kills.length === 1 ? "" : "s"}${fact.deaths.length ? ", died" : ""}, score ${fact.yourScore}–${fact.enemyScore}`}
                >
                    <span className={rr.plate} aria-hidden="true">{fact.won ? "W" : "L"}</span>
                    <b>{fact.round.roundNum + 1}</b>
                    <span className={rr.pips} aria-hidden="true">{fact.kills.slice(0, 5).map((event) => <i key={fightEventKey(event)} />)}</span>
                </button>)}</div>
            </div>)}
            {finalFact ? <div className={rr.final} title="Final score"><b>{finalFact.yourScore}</b><span>–</span><b data-them>{finalFact.enemyScore}</b></div> : null}
        </div> : null}

        <div className={rr.hero} data-win={(!singleRound && roundWon) || undefined}>
            {yourAgent?.full ? <Image className={rr.agent} src={yourAgent.full} alt="" width={290} height={290} unoptimized /> : null}
            <div className={rr.title}>
                {singleRound ? <>
                    <h3>Whole match</h3>
                    <p>No rounds in this mode, so every fight is in one timeline</p>
                </> : <>
                <h3>Round {round.roundNum + 1} <em>· {roundWon ? "won" : "lost"}</em></h3>
                <p>{outcome ? <>{outcome}{outcomeTime}</> : "Round recorded"}{selectedFact ? <> · score {selectedFact.yourScore}–{selectedFact.enemyScore}</> : null}{roundTags.map((tag) => <b key={tag}> · {tag}</b>)}</p>
                </>}
            </div>
            <dl className={rr.stats}>
                <div><dt>Kills</dt><dd>{localKills.length}</dd></div>
                <div><dt>Deaths</dt><dd>{localDeaths.length}</dd></div>
                <div><dt>Assists</dt><dd>{localAssists.length}</dd></div>
                {!singleRound ? <div><dt>Damage</dt><dd>{selectedStat ? damageDone : "—"}</dd></div> : null}
                {selectedStat && !singleRound ? <div className={rr.gun}>
                    <dt>{weapon?.displayName || "No weapon"}{selectedStat.economy.armor ? "" : " · no armor"}{headshots ? ` · ${headshots} HS` : ""}</dt>
                    <dd>{weapon?.displayIcon ? <Image src={weapon.displayIcon} alt="" width={110} height={34} unoptimized /> : null}</dd>
                </div> : null}
            </dl>
        </div>

        <div className={rr.frame}>
            <section className={rr.cell}>
                <header className={rr.label}><b>01</b><span>Replay</span><small>{activeMoment ? fmtLength(activeMoment.time) : ""}</small></header>
                <div className={rr.mapWrap}>
                    <div className={rr.map} data-replay={replayReady || undefined}>
                        {map?.displayIcon ? <Image className={rr.mapImage} src={map.displayIcon} alt={`${map.name} tactical map`} fill sizes="560px" unoptimized /> : null}
                        {canPlot && map!.callouts.map((callout, index) => {
                            const { left, top } = mapCalloutPlotPosition(map!, callout);
                            return <span key={`${callout.superRegion}-${callout.name}-${index}`} className={rr.callout} style={{ left: `${left * 100}%`, top: `${top * 100}%` }} aria-hidden="true">{mapCalloutLabel(callout)}</span>;
                        })}
                        {replayReady && activeKill && killerSpot ? (() => {
                            const from = plot(killerSpot.x, killerSpot.y);
                            const to = plot(activeKill.victimX, activeKill.victimY);
                            return <svg className={rr.shot} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-side={activeMoment?.ally ? "ally" : "enemy"}>
                                <line x1={from.left} y1={from.top} x2={to.left} y2={to.top} />
                            </svg>;
                        })() : null}
                        {replayReady ? earlierKills.map((event) => {
                            const spot = plot(event.victimX, event.victimY);
                            return <i key={`dead-${fightEventKey(event)}`} className={rr.dead} data-side={teamOf(event.victim.toLowerCase()) === localTeam ? "ally" : "enemy"} style={{ left: `${spot.left}%`, top: `${spot.top}%` }} title={`${playerName(event.victim.toLowerCase())} died at ${fmtLength(event.roundTime)}`}>×</i>;
                        }) : null}
                        {replayReady ? snapshot!.playerLocations!.map((location) => {
                            const subject = location.subject?.toLowerCase() || "";
                            if (!subject || deadBefore.has(subject)) return null;
                            const victim = subject === activeKill?.victim.toLowerCase();
                            const spot = victim ? plot(activeKill!.victimX, activeKill!.victimY) : plot(location.x, location.y);
                            const icon = agentIcon(subject);
                            const shown = victim || subject === activeKill?.killer.toLowerCase() || subject === localSubject;
                            return <span key={subject} className={rr.player} data-side={teamOf(subject) === localTeam ? "ally" : "enemy"} data-you={subject === localSubject || undefined} data-victim={victim || undefined} data-killer={subject === activeKill?.killer.toLowerCase() || undefined} style={{ left: `${spot.left}%`, top: `${spot.top}%`, backgroundImage: icon ? `url("${icon}")` : undefined }} title={playerName(subject)}>
                                {shown ? <b>{playerName(subject)}</b> : null}
                            </span>;
                        }) : null}
                        {canPlot && !replayReady && selectedEvents.map((event) => {
                            const position = plot(event.victimX, event.victimY);
                            const isKill = event.killer.toLowerCase() === localSubject;
                            return <span key={fightEventKey(event)} className={rr.marker} data-kind={isKill ? "kill" : "death"} style={{ left: `${position.left}%`, top: `${position.top}%` }} title={isKill ? "Your kill" : "Your death"}>{isKill ? "+" : "×"}</span>;
                        })}
                        {canPlot && round.plantLocation && (round.plantLocation.x || round.plantLocation.y) ? (() => { const p = plot(round.plantLocation!.x, round.plantLocation!.y); return <i className={rr.spike} style={{ left: `${p.left}%`, top: `${p.top}%` }} title={`Spike planted${round.plantRoundTime ? ` at ${fmtLength(round.plantRoundTime)}` : ""}`}>◆</i>; })() : null}
                        {!canPlot ? <p className={rr.note}>This map has no position data yet.</p> : null}
                    </div>
                </div>
                {roundFeed.length ? <div className={rr.scrub}>
                    <button type="button" aria-label="Previous moment" disabled={activeMomentIndex <= 0} onClick={() => { setReplaying(false); pickMoment(roundFeed[activeMomentIndex - 1].id); }}>‹</button>
                    <button type="button" className={rr.play} aria-label={replaying ? "Pause the round" : "Play the round"} aria-pressed={replaying} onClick={() => {
                        if (!replaying && activeMomentIndex >= roundFeed.length - 1) pickMoment(roundFeed[0].id);
                        setReplaying((value) => !value);
                    }}>{replaying ? "❚❚" : "▶"}</button>
                    <div className={rr.track}>
                        <span style={{ width: `${activeMoment ? (momentTime(activeMoment) / roundLength) * 100 : 0}%` }} />
                        {roundFeed.map((item) => <button key={item.id} type="button" data-kind={item.kind} data-side={item.ally ? "ally" : "enemy"} data-active={item.id === activeMomentId || undefined} style={{ left: `${(momentTime(item) / roundLength) * 100}%` }} onClick={() => { setReplaying(false); pickMoment(item.id); }} aria-label={`${fmtLength(item.time)} ${item.kind === "kill" ? `${playerName(item.actor)} eliminated ${playerName(item.target)}` : item.text}`} />)}
                    </div>
                    <button type="button" aria-label="Next moment" disabled={activeMomentIndex >= roundFeed.length - 1} onClick={() => { setReplaying(false); pickMoment(roundFeed[activeMomentIndex + 1].id); }}>›</button>
                </div> : null}
            </section>

            <section className={rr.cell}>
                <header className={rr.label}><b>02</b><span>Kill feed</span><small>{selectedKills.length} kill{selectedKills.length === 1 ? "" : "s"} · click one to see it</small>{activeKill && onInspectFight ? <button type="button" className={rr.inspect} onClick={() => onInspectFight(activeKill)}>Open on Map ↗</button> : null}</header>
                {roundFeed.length ? <ol className={rr.feed} aria-label={`Round ${round.roundNum + 1} events`}>
                    {roundFeed.map((item) => <li key={item.id} data-kind={item.kind} data-side={item.ally ? "ally" : "enemy"} data-active={item.id === activeMomentId || undefined} onClick={() => { setReplaying(false); pickMoment(item.id); }}>
                        <time>{item.time ? fmtLength(item.time) : "0:00"}</time>
                        <span className={rr.who}><i style={{ backgroundImage: agentIcon(item.actor) ? `url("${agentIcon(item.actor)}")` : undefined }} /><b data-you={item.actor === localSubject || undefined}>{playerName(item.actor)}</b></span>
                        {item.target ? <>
                            <svg className={rr.arrow} viewBox="0 0 24 24" aria-label="eliminated"><path d="M5 12h12M13 7l5 5-5 5" /></svg>
                            <span className={rr.who} data-victim><i style={{ backgroundImage: agentIcon(item.target) ? `url("${agentIcon(item.target)}")` : undefined }} /><b data-you={item.target === localSubject || undefined}>{playerName(item.target)}</b></span>
                        </> : <span className={rr.text}>{item.text}</span>}
                        <span className={rr.means}>
                            {item.tag ? <em>{item.tag}</em> : item.kind !== "kill" ? <em data-kind={item.kind}>{item.kind === "plant" ? "Plant" : "Defuse"}</em> : null}
                            {item.kind === "kill" ? item.meansIcon ? <span className={rr.icon} data-ability={item.meansAbility || undefined} title={item.means}><Image src={item.meansIcon} alt={item.means || ""} width={72} height={22} unoptimized /></span> : <small>{item.means}</small> : null}
                        </span>
                    </li>)}
                </ol> : <p className={rr.note}>No kills or objective actions were recorded for this round.</p>}
                {!singleRound ? <div className={rr.take}>
                    <b>Takeaway</b>
                    <p>{selectedRoundRead}</p>
                    {allyLoadout || enemyLoadout ? <small>Team buy <span data-side="ally">{allyLoadout.toLocaleString()}</span> vs <span data-side="enemy">{enemyLoadout.toLocaleString()}</span>{selectedStat ? ` · you spent ${(selectedStat.economy.spent || 0).toLocaleString()}, kept ${(selectedStat.economy.remaining || 0).toLocaleString()}` : ""}</small> : null}
                </div> : null}
            </section>
        </div>

        {turningPoints.length ? <section className={rr.turning}>
            <header className={rr.label}><b>03</b><span>Turning points</span><small>{turningPoints.length} moments that changed the match</small></header>
            <div>{turningPoints.map((point) => <button key={`${point.roundNum}-${point.title}`} type="button" data-tone={point.tone} aria-pressed={point.roundNum === round.roundNum} onClick={() => setSelectedRoundNum(point.roundNum)}>
                <strong>{point.title}</strong><small>{point.detail}</small>
            </button>)}</div>
        </section> : null}
    </section>;
}
