"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import type { Weapon } from "@/lib/types";
import { type ProfileMatchDetails } from "@/services/api";
import s from "./ProfilePanel.module.css";
import { type AgentMeta, type MapMeta, mapCalloutLabel, mapZoneLabel, mapCalloutPlotPosition, fmtLength, fmtRatio, statCount, type MatchKillEvent, TRADE_RANGE_METRES, MAP_MAX_ZOOM, gameUnitsToMetres, type DuelFocus, type DuelFinisher, fightEventKey, riotAbilitySlotKey, MapDuelMarker } from "./profileShared";

export function MatchMapAnalytics({
    detail,
    kills,
    map,
    agents,
    weapons,
    loading,
    error,
    initialFight,
    onBackToRound,
}: {
    detail: ProfileMatchDetails;
    kills: MatchKillEvent[];
    map?: MapMeta;
    agents: Record<string, AgentMeta>;
    weapons: Weapon[];
    loading: boolean;
    error: string;
    initialFight?: MatchKillEvent | null;
    onBackToRound?: () => void;
}) {
    const [filter, setFilter] = useState<"all" | "kill" | "death">("all");
    const [sideFilter, setSideFilter] = useState<"both" | "attack" | "defense">("both");
    const [focusedArea, setFocusedArea] = useState<string | null>(null);
    const [focusedZone, setFocusedZone] = useState<string | null>(null);
    const [hoveredZone, setHoveredZone] = useState<string | null>(null);
    const [duelFocus, setDuelFocus] = useState<DuelFocus | null>(initialFight ? { id: fightEventKey(initialFight), label: `Round ${initialFight.roundNum + 1} · ${fmtLength(initialFight.roundTime)}`, events: [initialFight], index: 0 } : null);
    const analysis = useMemo(() => {
        const localPlayer = detail.players.find((player) => player.isLocal);
        const localSubject = localPlayer?.subject.toLowerCase() || "";
        const localTeam = localPlayer?.teamId.toLowerCase() || "";
        const playerTeamBySubject = new Map(
            detail.players.map((player) => [player.subject.toLowerCase(), player.teamId.toLowerCase()]),
        );
        const roundWinnerByNumber = new Map(
            (detail.rounds || [])
                .filter((round) => round.winningTeam)
                .map((round) => [round.roundNum, round.winningTeam.toLowerCase()]),
        );
        const localWonRound = (roundNum: number) => {
            const winner = roundWinnerByNumber.get(roundNum);
            return winner ? winner === localTeam : null;
        };
        // Riot's red team attacks first; sides swap at the half, then every overtime round.
        const queueId = (detail.matchInfo.queueID || "").toLowerCase();
        const halfLength = queueId === "swiftplay" ? 4 : queueId === "spikerush" ? 3 : 12;
        const startsOnAttack = localTeam === "red";
        const sideOf = (roundNum: number): "attack" | "defense" => {
            const firstHalf = roundNum < halfLength || (roundNum >= halfLength * 2 && (roundNum - halfLength * 2) % 2 === 0);
            return firstHalf === startsOnAttack ? "attack" : "defense";
        };
        const points: Array<{ type: "kill" | "death"; x: number; y: number; round: number; gameTime: number; side: "attack" | "defense"; event: MatchKillEvent }> = [];
        for (const event of kills) {
            if (event.killer.toLowerCase() === localSubject) {
                points.push({ type: "kill", x: event.victimX, y: event.victimY, round: event.roundNum, gameTime: event.gameTime, side: sideOf(event.roundNum), event });
            }
            if (event.victim.toLowerCase() === localSubject) {
                points.push({ type: "death", x: event.victimX, y: event.victimY, round: event.roundNum, gameTime: event.gameTime, side: sideOf(event.roundNum), event });
            }
        }

        const firstByRound = new Map<number, MatchKillEvent>();
        for (const event of kills) {
            const current = firstByRound.get(event.roundNum);
            if (!current || event.gameTime < current.gameTime) firstByRound.set(event.roundNum, event);
        }
        let openingWins = 0;
        let openingLosses = 0;
        for (const event of firstByRound.values()) {
            if (event.killer.toLowerCase() === localSubject) openingWins += 1;
            if (event.victim.toLowerCase() === localSubject) openingLosses += 1;
        }

        const nearestCallout = (x: number, y: number) => {
            let nearest: MapMeta["callouts"][number] | undefined;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (const callout of map?.callouts || []) {
                const distance = (callout.x - x) ** 2 + (callout.y - y) ** 2;
                if (distance < nearestDistance) {
                    nearest = callout;
                    nearestDistance = distance;
                }
            }
            return nearest
                ? { area: mapCalloutLabel(nearest), zone: mapZoneLabel(nearest) }
                : { area: "Map area", zone: "Other" };
        };

        const openingEvents = [...firstByRound.values()]
            .filter((event) => event.killer.toLowerCase() === localSubject || event.victim.toLowerCase() === localSubject)
            .map((event) => ({
                result: event.killer.toLowerCase() === localSubject ? "win" as const : "loss" as const,
                roundNum: event.roundNum,
                round: event.roundNum + 1,
                teamWon: localWonRound(event.roundNum),
                x: event.victimX,
                y: event.victimY,
                event,
                ...nearestCallout(event.victimX, event.victimY),
            }))
            .sort((a, b) => a.round - b.round);

        const localDeaths = kills
            .filter((event) => event.victim.toLowerCase() === localSubject)
            .sort((a, b) => a.gameTime - b.gameTime);
        const tradedDeaths = localDeaths.filter((death) => kills.some((event) => (
            event.roundNum === death.roundNum
            && event.roundTime >= death.roundTime
            && event.roundTime - death.roundTime <= 5_000
            && event.victim.toLowerCase() === death.killer.toLowerCase()
            && playerTeamBySubject.get(event.killer.toLowerCase()) === localTeam
        ))).length;
        const tradePoint = localDeaths[0]
            ? { x: localDeaths[0].victimX, y: localDeaths[0].victimY, ...nearestCallout(localDeaths[0].victimX, localDeaths[0].victimY) }
            : null;

        const locatedPoints = points.map((point) => ({ ...point, ...nearestCallout(point.x, point.y) }));
        const hotspotMap = new Map<string, { name: string; kills: number; deaths: number; killRounds: number[]; deathRounds: number[]; killXTotal: number; killYTotal: number; deathXTotal: number; deathYTotal: number }>();
        const zoneMap = new Map<string, { name: string; focusZone: string; focusArea: string; kills: number; deaths: number; xTotal: number; yTotal: number; count: number; rounds: Set<number>; sides: Record<"attack" | "defense", { kills: number; deaths: number }> }>();
        for (const point of locatedPoints) {
            const name = point.area;
            const hotspot = hotspotMap.get(name) || { name, kills: 0, deaths: 0, killRounds: [], deathRounds: [], killXTotal: 0, killYTotal: 0, deathXTotal: 0, deathYTotal: 0 };
            hotspot[point.type === "kill" ? "kills" : "deaths"] += 1;
            hotspot[point.type === "kill" ? "killRounds" : "deathRounds"].push(point.round + 1);
            hotspot[point.type === "kill" ? "killXTotal" : "deathXTotal"] += point.x;
            hotspot[point.type === "kill" ? "killYTotal" : "deathYTotal"] += point.y;
            hotspotMap.set(name, hotspot);

            const zoneName = point.zone === "Other" ? point.area : point.zone;
            const zone = zoneMap.get(zoneName) || {
                name: zoneName,
                focusZone: point.zone === "Other" ? "" : point.zone,
                focusArea: point.zone === "Other" ? point.area : "",
                kills: 0,
                deaths: 0,
                xTotal: 0,
                yTotal: 0,
                count: 0,
                rounds: new Set<number>(),
                sides: { attack: { kills: 0, deaths: 0 }, defense: { kills: 0, deaths: 0 } },
            };
            zone[point.type === "kill" ? "kills" : "deaths"] += 1;
            zone.sides[point.side][point.type === "kill" ? "kills" : "deaths"] += 1;
            zone.xTotal += point.x;
            zone.yTotal += point.y;
            zone.count += 1;
            zone.rounds.add(point.round);
            zoneMap.set(zoneName, zone);
        }

        const hotspots = [...hotspotMap.values()]
            .sort((a, b) => (b.kills + b.deaths) - (a.kills + a.deaths));
        const killSpots = hotspots.filter((area) => area.kills > 0).sort((a, b) => b.kills - a.kills || a.killRounds[0] - b.killRounds[0]);
        const deathSpots = hotspots.filter((area) => area.deaths > 0).sort((a, b) => b.deaths - a.deaths || a.deathRounds[0] - b.deathRounds[0]);
        const zoneOrder = new Map([["A Site", 0], ["B Site", 1], ["C Site", 2], ["Mid", 3], ["Other", 4]]);
        const zones = [...zoneMap.values()]
            .filter((zone) => zone.kills + zone.deaths > 0)
            .map((zone) => {
                const decidedRounds = [...zone.rounds].filter((roundNum) => localWonRound(roundNum) !== null);
                return {
                    ...zone,
                    decidedRounds: decidedRounds.length,
                    roundWins: decidedRounds.filter((roundNum) => localWonRound(roundNum) === true).length,
                };
            })
            .sort((a, b) => (zoneOrder.get(a.name) ?? 9) - (zoneOrder.get(b.name) ?? 9));

        return {
            points: locatedPoints,
            kills: locatedPoints.filter((point) => point.type === "kill").length,
            deaths: locatedPoints.filter((point) => point.type === "death").length,
            openingWins,
            openingLosses,
            openingEvents,
            localSubject,
            localTeam,
            localDeaths,
            tradedDeaths,
            tradePoint,
            zones,
            sideOf,
            roundWon: localWonRound,
            killSpot: killSpots.find((spot) => spot.kills >= 2) || null,
            deathSpot: deathSpots.find((spot) => spot.deaths >= 2) || null,
        };
    }, [detail.matchInfo.queueID, detail.players, detail.rounds, kills, map?.callouts]);

    const canPlot = Boolean(
        map?.displayIcon
        && typeof map.xMultiplier === "number"
        && typeof map.yMultiplier === "number"
        && typeof map.xScalarToAdd === "number"
        && typeof map.yScalarToAdd === "number",
    );
    // Zoom and pan for the minimap: scroll zooms at the cursor, dragging moves it. Markers keep their size.
    const plotRef = useRef<HTMLDivElement | null>(null);
    const [plotNode, setPlotNode] = useState<HTMLDivElement | null>(null);
    const attachPlot = useCallback((node: HTMLDivElement | null) => {
        plotRef.current = node;
        setPlotNode(node);
    }, []);
    const [plotView, setPlotView] = useState({ scale: 1, x: 0, y: 0 });
    const plotDragRef = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
    const plotDraggedRef = useRef(false);
    const clampPlotView = useCallback((scale: number, x: number, y: number) => {
        const width = plotRef.current?.clientWidth || 0;
        const height = plotRef.current?.clientHeight || 0;
        return {
            scale,
            x: Math.min(0, Math.max(width - width * scale, x)),
            y: Math.min(0, Math.max(height - height * scale, y)),
        };
    }, []);
    const zoomPlot = useCallback((factor: number, originX?: number, originY?: number) => {
        setPlotView((current) => {
            const scale = Math.min(MAP_MAX_ZOOM, Math.max(1, current.scale * factor));
            if (scale === 1) return { scale: 1, x: 0, y: 0 };
            const cx = originX ?? (plotRef.current?.clientWidth || 0) / 2;
            const cy = originY ?? (plotRef.current?.clientHeight || 0) / 2;
            const ratio = scale / current.scale;
            return clampPlotView(scale, cx - (cx - current.x) * ratio, cy - (cy - current.y) * ratio);
        });
    }, [clampPlotView]);
    useEffect(() => {
        const plot = plotNode;
        if (!plot) return undefined;
        // React wheel listeners are passive, so the page would scroll too.
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            const rect = plot.getBoundingClientRect();
            zoomPlot(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top);
        };
        plot.addEventListener("wheel", onWheel, { passive: false });
        return () => plot.removeEventListener("wheel", onWheel);
    }, [plotNode, zoomPlot]);
    const startPlotDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || plotView.scale === 1) return;
        plotDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: plotView.x, y: plotView.y, moved: false };
    };
    const movePlotDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = plotDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        if (!drag.moved) {
            drag.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        setPlotView((current) => clampPlotView(current.scale, drag.x + dx, drag.y + dy));
    };
    const endPlotDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = plotDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        plotDraggedRef.current = drag.moved;
        plotDragRef.current = null;
    };
    // A drag ends with a click on whatever is under the cursor; do not open a fight for it.
    const swallowDragClick = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (!plotDraggedRef.current) return;
        plotDraggedRef.current = false;
        event.stopPropagation();
        event.preventDefault();
    };
    const visiblePoints = analysis.points.filter((point) => {
        if (filter !== "all" && point.type !== filter) return false;
        if (sideFilter !== "both" && point.side !== sideFilter) return false;
        if (focusedZone && point.zone !== focusedZone) return false;
        if (focusedArea && point.area !== focusedArea) return false;
        return true;
    });
    const playerBySubject = useMemo(
        () => new Map(detail.players.map((player) => [player.subject.toLowerCase(), player])),
        [detail.players],
    );
    const weaponById = useMemo(
        () => new Map(weapons.map((weapon) => [weapon.uuid.toLowerCase(), weapon])),
        [weapons],
    );
    const selectDuelGroup = useCallback((id: string, label: string, events: MatchKillEvent[]) => {
        const uniqueEvents = [...new Map(events.map((event) => [fightEventKey(event), event])).values()]
            .sort((a, b) => a.roundNum - b.roundNum || a.gameTime - b.gameTime);
        if (!uniqueEvents.length) return;
        setFilter("all");
        setFocusedArea(null);
        setFocusedZone(null);
        setDuelFocus((current) => current?.id === id ? null : { id, label, events: uniqueEvents, index: 0 });
    }, []);
    const selectedFight = duelFocus?.events[duelFocus.index] || null;
    const duelData = useMemo(() => {
        if (!selectedFight || !canPlot || !map) return null;
        const toPlotPoint = (x: number, y: number) => ({
            left: Math.max(0, Math.min(1, y * map.xMultiplier! + map.xScalarToAdd!)),
            top: Math.max(0, Math.min(1, x * map.yMultiplier! + map.yScalarToAdd!)),
        });
        const killerSubject = selectedFight.killer.toLowerCase();
        const victimSubject = selectedFight.victim.toLowerCase();
        const killerLocation = selectedFight.playerLocations?.find((location) => location.subject?.toLowerCase() === killerSubject);
        const killerPlayer = playerBySubject.get(killerSubject);
        const victimPlayer = playerBySubject.get(victimSubject);
        const damageItemKey = selectedFight.damageItem?.trim().toLowerCase() || "";
        const weapon = damageItemKey ? weaponById.get(damageItemKey) : undefined;
        const killerAgent = agents[killerPlayer?.characterId?.toLowerCase() || ""];
        const damageType = selectedFight.damageType?.toLowerCase() || "";
        const abilitySlot = riotAbilitySlotKey(damageType, damageItemKey);
        const isAbility = Boolean(abilitySlot);
        const ability = abilitySlot ? killerAgent?.abilities?.[abilitySlot] : undefined;
        const finisher: DuelFinisher | undefined = isAbility
            ? ability?.icon ? { name: ability.name, icon: ability.icon, kind: "ability" } : undefined
            : weapon?.displayIcon ? { name: weapon.displayName || "Weapon", icon: weapon.displayIcon, kind: "weapon" } : undefined;
        const localDeath = victimSubject === analysis.localSubject;
        const roundWinner = (detail.rounds || []).find((round) => round.roundNum === selectedFight.roundNum)?.winningTeam.toLowerCase();
        const roundWon = roundWinner ? roundWinner === analysis.localTeam : null;
        const locatedFight = analysis.points.find((point) => fightEventKey(point.event) === fightEventKey(selectedFight));
        // Nearest living teammate of the player who died, and whether their killer was traded within 5 seconds.
        const victimSpot = { x: selectedFight.victimX, y: selectedFight.victimY };
        const victimTeam = victimPlayer?.teamId.toLowerCase() || "";
        const nearestMate = (selectedFight.playerLocations || [])
            .filter((location) => {
                const subject = location.subject?.toLowerCase();
                return subject && subject !== victimSubject && playerBySubject.get(subject)?.teamId.toLowerCase() === victimTeam;
            })
            .map((location) => ({ location, metres: gameUnitsToMetres(location, victimSpot) }))
            .sort((a, b) => a.metres - b.metres)[0];
        const matePlayer = nearestMate ? playerBySubject.get(nearestMate.location.subject!.toLowerCase()) : undefined;
        const traded = kills.some((event) => (
            event.roundNum === selectedFight.roundNum
            && event.victim.toLowerCase() === killerSubject
            && event.roundTime >= selectedFight.roundTime
            && event.roundTime - selectedFight.roundTime <= 5_000
        ));
        const nearestFightCallout = map.callouts.reduce<MapMeta["callouts"][number] | undefined>((nearest, callout) => {
            const distance = (callout.x - selectedFight.victimX) ** 2 + (callout.y - selectedFight.victimY) ** 2;
            const nearestDistance = nearest ? (nearest.x - selectedFight.victimX) ** 2 + (nearest.y - selectedFight.victimY) ** 2 : Infinity;
            return distance < nearestDistance ? callout : nearest;
        }, undefined);
        return {
            killerPlayer,
            victimPlayer,
            killerAgent,
            victimAgent: agents[victimPlayer?.characterId?.toLowerCase() || ""],
            killerPoint: killerLocation ? toPlotPoint(killerLocation.x, killerLocation.y) : null,
            victimPoint: toPlotPoint(selectedFight.victimX, selectedFight.victimY),
            finisher,
            finisherName: isAbility ? ability?.name : weapon?.displayName,
            localDeath,
            roundWon,
            area: locatedFight?.area || (nearestFightCallout ? mapCalloutLabel(nearestFightCallout) : "Map area"),
            killDistance: killerLocation ? gameUnitsToMetres(killerLocation, victimSpot) : null,
            mate: nearestMate ? {
                player: matePlayer,
                agent: agents[matePlayer?.characterId?.toLowerCase() || ""],
                point: toPlotPoint(nearestMate.location.x, nearestMate.location.y),
                metres: nearestMate.metres,
            } : null,
            traded,
            tradeRingRadius: Math.abs(TRADE_RANGE_METRES * 100 * map.xMultiplier!),
        };
    }, [agents, analysis.localSubject, analysis.localTeam, analysis.points, canPlot, detail.rounds, kills, map, playerBySubject, selectedFight, weaponById]);

    const zoneRegions = useMemo(() => {
        if (!canPlot || !map) return [];
        const groups = new Map<string, Array<{ left: number; top: number }>>();
        for (const callout of map.callouts) {
            const zone = mapZoneLabel(callout);
            if (zone === "Other") continue;
            const { left, top } = mapCalloutPlotPosition(map, callout);
            const points = groups.get(zone) || [];
            points.push({ left, top });
            groups.set(zone, points);
        }
        return [...groups.entries()].map(([name, points]) => {
            let left = Math.min(...points.map((point) => point.left)) - 0.035;
            let right = Math.max(...points.map((point) => point.left)) + 0.035;
            let top = Math.min(...points.map((point) => point.top)) - 0.035;
            let bottom = Math.max(...points.map((point) => point.top)) + 0.035;
            const minSize = 0.15;
            if (right - left < minSize) {
                const center = (left + right) / 2;
                left = center - minSize / 2;
                right = center + minSize / 2;
            }
            if (bottom - top < minSize) {
                const center = (top + bottom) / 2;
                top = center - minSize / 2;
                bottom = center + minSize / 2;
            }
            left = Math.max(0, left);
            right = Math.min(1, right);
            top = Math.max(0, top);
            bottom = Math.min(1, bottom);
            return { name, left, top, width: right - left, height: bottom - top };
        });
    }, [canPlot, map]);
    const strongestZone = analysis.zones.filter((zone) => zone.kills + zone.deaths > 0).sort((a, b) => {
        const aRate = a.kills / Math.max(1, a.deaths);
        const bRate = b.kills / Math.max(1, b.deaths);
        return bRate - aRate || (b.kills + b.deaths) - (a.kills + a.deaths);
    })[0];
    // Takeaways: each one says what happened, why it matters and what to try, with the numbers behind it.
    const sideName = (side: "attack" | "defense") => side === "attack" ? "Attack" : "Defense";
    const roundList = (rounds: number[]) => rounds.length === 1 ? `Round ${rounds[0]}` : rounds.length <= 4 ? `Rounds ${rounds.join(", ")}` : `Rounds ${rounds[0]}–${rounds[rounds.length - 1]}`;
    const reviewNotes: Array<{ id: string; tone: "good" | "danger" | "neutral"; label: string; copy: string; chips: string[]; x: number; y: number; events: MatchKillEvent[] }> = [];
    const openingWinCount = analysis.openingEvents.filter((event) => event.result === "win").length;
    const openingLossCount = analysis.openingEvents.filter((event) => event.result === "loss").length;
    const openingKillsWithOutcome = analysis.openingEvents.filter((event) => event.result === "win" && event.teamWon !== null);
    if (openingKillsWithOutcome.length) {
        const converted = openingKillsWithOutcome.filter((event) => event.teamWon).length;
        const conversion = Math.round((converted / openingKillsWithOutcome.length) * 100);
        const tone = conversion >= 60 ? "good" : conversion < 50 ? "danger" : "neutral";
        reviewNotes.push({
            id: "opening-advantage",
            tone,
            label: tone === "good" ? "Your first kills win rounds" : tone === "danger" ? "First kills aren't turning into rounds" : "First kills only sometimes win the round",
            copy: tone === "good"
                ? `Your team won ${converted} of ${openingKillsWithOutcome.length} rounds where you got the first kill. Keep looking for that opening duel.`
                : `Your team won ${converted} of ${openingKillsWithOutcome.length} rounds where you got the first kill. After an opening pick, play with your team instead of chasing a second one.`,
            chips: [`${openingWinCount}–${openingLossCount} opening duels`, `${conversion}% rounds won`],
            x: openingKillsWithOutcome[0].x,
            y: openingKillsWithOutcome[0].y,
            events: openingKillsWithOutcome.map((event) => event.event),
        });
    }
    const openingDeathsWithOutcome = analysis.openingEvents.filter((event) => event.result === "loss" && event.teamWon !== null);
    // When most first deaths happened at the repeat death spot, that takeaway already covers them.
    const deathSpotName = analysis.deathSpot?.name;
    const firstDeathsAtSpot = deathSpotName ? openingDeathsWithOutcome.filter((event) => event.area === deathSpotName).length : 0;
    if (openingDeathsWithOutcome.length >= 2 && firstDeathsAtSpot / openingDeathsWithOutcome.length < 0.6) {
        const recovered = openingDeathsWithOutcome.filter((event) => event.teamWon).length;
        const recovery = Math.round((recovered / openingDeathsWithOutcome.length) * 100);
        const tone = recovery >= 50 ? "good" : "danger";
        reviewNotes.push({
            id: "opening-death",
            tone,
            label: tone === "danger" ? "Dying first is costing rounds" : "Your team covers your first deaths",
            copy: tone === "danger"
                ? `You died first in ${openingDeathsWithOutcome.length} rounds and your team won ${recovered} of them. Take the first fight with a teammate close enough to trade.`
                : `You died first in ${openingDeathsWithOutcome.length} rounds and your team still won ${recovered}.`,
            chips: [statCount(openingDeathsWithOutcome.length, "first death"), `${openingDeathsWithOutcome.length - recovered} rounds lost`],
            x: openingDeathsWithOutcome[0].x,
            y: openingDeathsWithOutcome[0].y,
            events: openingDeathsWithOutcome.map((event) => event.event),
        });
    }
    if (analysis.deathSpot) {
        const spot = analysis.deathSpot;
        const spotPoints = analysis.points.filter((point) => point.type === "death" && point.area === spot.name);
        const rounds = [...new Set(spot.deathRounds)];
        const decidedRounds = rounds.filter((round) => analysis.roundWon(round - 1) !== null);
        const lostRounds = decidedRounds.filter((round) => analysis.roundWon(round - 1) === false).length;
        const attackDeaths = spotPoints.filter((point) => point.side === "attack").length;
        const mainSide = attackDeaths / spotPoints.length >= 0.7 ? "attack" : attackDeaths / spotPoints.length <= 0.3 ? "defense" : null;
        reviewNotes.push({
            id: `repeat-death-${spot.name}`,
            tone: "danger",
            label: `Change how you play ${spot.name}`,
            copy: `You died there ${spot.deaths} times${firstDeathsAtSpot ? `, ${firstDeathsAtSpot === spot.deaths ? "every time" : `${firstDeathsAtSpot} times`} as the first death of the round` : ""}${mainSide ? `, mostly on ${sideName(mainSide)}` : ""}. Try a different angle, or wait for utility before you take that fight.`,
            chips: [statCount(spot.deaths, "death"), ...(decidedRounds.length ? [`Lost ${lostRounds} of ${decidedRounds.length} rounds`] : []), roundList(rounds)],
            x: spot.deathXTotal / Math.max(1, spot.deaths),
            y: spot.deathYTotal / Math.max(1, spot.deaths),
            events: spotPoints.map((point) => point.event),
        });
    }
    if (analysis.deaths >= 3) {
        const tradeRate = analysis.tradedDeaths / analysis.deaths;
        const tone = tradeRate >= 0.6 ? "good" : tradeRate < 0.35 ? "danger" : "neutral";
        reviewNotes.push({
            id: "trade-timing",
            tone,
            label: tone === "danger" ? "You're dying out of trade range" : tone === "good" ? "Your team is trading you" : "Some of your deaths get traded",
            copy: tone === "danger"
                ? `${analysis.tradedDeaths ? `Only ${analysis.tradedDeaths} of your ${analysis.deaths} deaths were` : `None of your ${analysis.deaths} deaths were`} traded by a teammate within 5 seconds. Fight closer to your team so they can punish your killer.`
                : `A teammate killed your killer within 5 seconds after ${analysis.tradedDeaths} of your ${analysis.deaths} deaths, so those fights still paid off.`,
            chips: [`${analysis.tradedDeaths}/${analysis.deaths} deaths traded`],
            x: analysis.tradePoint?.x ?? 0,
            y: analysis.tradePoint?.y ?? 0,
            events: analysis.localDeaths,
        });
    }
    const earlyDeaths = analysis.localDeaths.filter((event) => event.roundTime > 0 && event.roundTime < 25_000);
    if (earlyDeaths.length >= 3 && earlyDeaths.length / Math.max(1, analysis.deaths) >= 0.3) {
        reviewNotes.push({
            id: "early-deaths",
            tone: "danger",
            label: "You're dying early in rounds",
            copy: `${earlyDeaths.length === analysis.deaths ? `All ${analysis.deaths}` : `${earlyDeaths.length} of your ${analysis.deaths}`} deaths came in the first 25 seconds. Let the round develop before you take a fight.`,
            chips: [`${earlyDeaths.length} deaths before 0:25`],
            x: earlyDeaths[0].victimX,
            y: earlyDeaths[0].victimY,
            events: earlyDeaths,
        });
    }
    if (strongestZone && strongestZone.kills > strongestZone.deaths) {
        const bestSide = (["attack", "defense"] as const)
            .map((side) => ({ side, ...strongestZone.sides[side] }))
            .filter((side) => side.kills + side.deaths > 0)
            .sort((a, b) => (b.kills - b.deaths) - (a.kills - a.deaths))[0];
        reviewNotes.push({
            id: `strongest-area-${strongestZone.name}`,
            tone: "good",
            label: `${strongestZone.name} is your area`,
            copy: `You won ${strongestZone.kills} of ${strongestZone.kills + strongestZone.deaths} fights here${bestSide ? `, best on ${sideName(bestSide.side)} (${bestSide.kills}–${bestSide.deaths})` : ""}. Keep playing your fights from here.`,
            chips: [`${strongestZone.kills}–${strongestZone.deaths} fights`, ...(strongestZone.decidedRounds ? [`Won ${strongestZone.roundWins}/${strongestZone.decidedRounds} rounds`] : [])],
            x: strongestZone.xTotal / Math.max(1, strongestZone.count),
            y: strongestZone.yTotal / Math.max(1, strongestZone.count),
            events: analysis.points.filter((point) => (point.zone === "Other" ? point.area : point.zone) === strongestZone.name).map((point) => point.event),
        });
    }
    // Where your kills come from, when no single area stood out as yours above.
    if (analysis.killSpot && !reviewNotes.some((note) => note.id.startsWith("strongest-area-"))) {
        const spot = analysis.killSpot;
        const rounds = [...new Set(spot.killRounds)];
        reviewNotes.push({
            id: `kill-spot-${spot.name}`,
            tone: "good",
            label: `Your kills come from ${spot.name}`,
            copy: `You got ${spot.kills} kills there. Keep using that position.`,
            chips: [statCount(spot.kills, "kill"), roundList(rounds)],
            x: spot.killXTotal / Math.max(1, spot.kills),
            y: spot.killYTotal / Math.max(1, spot.kills),
            events: analysis.points.filter((point) => point.type === "kill" && point.area === spot.name).map((point) => point.event),
        });
    }
    // The area whose results changed most when the sides swapped at the half.
    const firstSide = analysis.sideOf(0);
    const secondSide = firstSide === "attack" ? "defense" : "attack";
    const sideSwing = [...new Set(analysis.points.map((point) => point.area))]
        .map((area) => {
            const record = (side: "attack" | "defense") => {
                const sidePoints = analysis.points.filter((point) => point.area === area && point.side === side);
                return { kills: sidePoints.filter((point) => point.type === "kill").length, deaths: sidePoints.filter((point) => point.type === "death").length };
            };
            const before = record(firstSide);
            const after = record(secondSide);
            return { area, before, after, change: (after.kills - after.deaths) - (before.kills - before.deaths) };
        })
        .filter((swing) => swing.before.kills + swing.before.deaths + swing.after.kills + swing.after.deaths >= 4 && Math.abs(swing.change) >= 2)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    // Things to work on first, but always keep the best thing you did when there is one.
    const workOn = reviewNotes.filter((note) => note.tone === "danger");
    const keepDoing = reviewNotes.filter((note) => note.tone === "good");
    const takeaways = [...workOn.slice(0, keepDoing.length ? 3 : 4), ...keepDoing, ...reviewNotes.filter((note) => note.tone === "neutral")].slice(0, 4);

    if (loading) {
        return <div className={s.mapAnalyticsEmpty}>Loading this match&apos;s map events...</div>;
    }
    if (error) {
        const needsRiotAccess = /auth|log in|session|token/i.test(error);
        return (
            <div className={s.mapAnalyticsEmpty} role="status">
                <strong>{needsRiotAccess ? "Map analysis needs Riot access" : "Map analysis unavailable"}</strong>
                <span>{needsRiotAccess ? "Reconnect this Riot account, then reopen the match." : error}</span>
            </div>
        );
    }
    if (!kills.length) {
        return <div className={s.mapAnalyticsEmpty}>No positional events were returned for this match.</div>;
    }
    if (!analysis.points.length) {
        return <div className={s.mapAnalyticsEmpty}>This match has no mapped fights involving you.</div>;
    }

    return (
        <section className={s.mapAnalytics}>
            <div className={s.mapAnalyticsLayout}>
                <div className={s.mapPlotPanel}>
                    <div className={s.mapPlotToolbar}>
                        <strong>
                            {duelFocus && selectedFight && duelData
                                ? `Fight detail · R${selectedFight.roundNum + 1} · ${duelData.area}`
                                : map?.name || "Map"}
                        </strong>
                        {duelFocus ? (
                            <div className={s.mapDuelControls} aria-label="Selected duel controls">
                                {onBackToRound && initialFight ? <button type="button" className={s.mapBackToRound} onClick={onBackToRound}>Back to R{initialFight.roundNum + 1}</button> : null}
                                <span>{duelFocus.label}</span>
                            </div>
                        ) : (
                            <div className={s.mapPlotFilterGroup}>
                            <div className={s.mapPlotFilters} aria-label="Side filter">
                                {(["both", "attack", "defense"] as const).map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={sideFilter === value ? s.mapPlotFilterActive : ""}
                                        aria-pressed={sideFilter === value}
                                        onClick={() => {
                                            setDuelFocus(null);
                                            setSideFilter(value);
                                        }}
                                    >
                                        {value === "both" ? "Both sides" : value === "attack" ? "Attack" : "Defense"}
                                    </button>
                                ))}
                            </div>
                            <div className={s.mapPlotFilters} aria-label="Map event filter">
                                {(["all", "kill", "death"] as const).map((value) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={filter === value ? s.mapPlotFilterActive : ""}
                                        onClick={() => {
                                            setDuelFocus(null);
                                            setFilter(value);
                                            setFocusedArea(null);
                                            setFocusedZone(null);
                                        }}
                                    >
                                        {value === "all" ? "All" : value === "kill" ? "Kills" : "Deaths"}
                                    </button>
                                ))}
                            </div>
                            </div>
                        )}
                    </div>
                    {canPlot ? (
                        <div className={s.mapPlot} ref={attachPlot} data-zoomed={plotView.scale > 1 || undefined} onPointerDown={startPlotDrag} onPointerMove={movePlotDrag} onPointerUp={endPlotDrag} onPointerCancel={endPlotDrag} onClickCapture={swallowDragClick}>
                            <div
                                className={s.mapPlotStage}
                                style={{ "--map-zoom": plotView.scale, transform: `translate(${plotView.x}px, ${plotView.y}px) scale(${plotView.scale})` } as CSSProperties}
                            >
                            <Image src={map!.displayIcon} alt={`${map!.name} minimap`} width={640} height={640} unoptimized className={s.mapPlotImage} draggable={false} />
                            {!selectedFight && zoneRegions.map((region) => {
                                const fights = analysis.zones.find((zone) => zone.name === region.name);
                                const count = (fights?.kills || 0) + (fights?.deaths || 0);
                                const isActive = focusedZone === region.name || hoveredZone === region.name;
                                return (
                                    <span
                                        key={region.name}
                                        className={`${s.mapZoneRegion} ${isActive ? s.mapZoneRegionActive : ""}`}
                                        data-zone={region.name.startsWith("A") ? "A" : region.name.startsWith("B") ? "B" : region.name.startsWith("C") ? "C" : "M"}
                                        style={{
                                            left: `${region.left * 100}%`,
                                            top: `${region.top * 100}%`,
                                            width: `${region.width * 100}%`,
                                            height: `${region.height * 100}%`,
                                        }}
                                        aria-hidden="true"
                                    >
                                        <strong>{region.name}</strong>
                                        <small>{count} {count === 1 ? "fight" : "fights"}</small>
                                    </span>
                                );
                            })}
                            {!selectedFight && map!.callouts.map((callout, index) => {
                                const { left, top } = mapCalloutPlotPosition(map!, callout);
                                return (
                                    <span
                                        key={`${callout.superRegion}-${callout.name}-${index}`}
                                        className={`${s.mapCallout} ${(focusedArea === mapCalloutLabel(callout) || focusedZone === mapZoneLabel(callout) || hoveredZone === mapZoneLabel(callout)) ? s.mapCalloutFocused : ""}`}
                                        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
                                    >
                                        {mapCalloutLabel(callout)}
                                    </span>
                                );
                            })}
                            {!selectedFight && visiblePoints.map((point, index) => {
                                const left = Math.max(0, Math.min(1, point.y * map!.xMultiplier! + map!.xScalarToAdd!));
                                const top = Math.max(0, Math.min(1, point.x * map!.yMultiplier! + map!.yScalarToAdd!));
                                return (
                                    <button
                                        key={`${point.round}-${point.gameTime}-${point.type}-${index}`}
                                        type="button"
                                        className={`${s.mapEvent} ${point.type === "kill" ? s.mapEventKill : s.mapEventDeath}`}
                                        style={{ left: `${left * 100}%`, top: `${top * 100}%` }}
                                        title={`${point.type === "kill" ? "Kill" : "Death"} · Round ${point.round + 1} · ${sideName(point.side)} · ${point.area}`}
                                        aria-label={`Inspect ${point.type}, round ${point.round + 1}, ${point.area}, ${fmtLength(point.event.roundTime)}`}
                                        onClick={() => selectDuelGroup(fightEventKey(point.event), `Round ${point.round + 1} · ${fmtLength(point.event.roundTime)}`, [point.event])}
                                    >
                                        <b className={s.mapPoint} aria-hidden="true" />
                                    </button>
                                );
                            })}
                            {selectedFight && duelData ? (
                                <>
                                    {duelData.localDeath ? (
                                        <>
                                            <span
                                                className={`${s.mapTradeRing} ${duelData.mate && duelData.mate.metres <= TRADE_RANGE_METRES ? s.mapTradeRingCovered : ""}`}
                                                style={{
                                                    left: `${duelData.victimPoint.left * 100}%`,
                                                    top: `${duelData.victimPoint.top * 100}%`,
                                                    width: `${duelData.tradeRingRadius * 200}%`,
                                                    height: `${duelData.tradeRingRadius * 200}%`,
                                                }}
                                                aria-hidden="true"
                                            >
                                                <small>{TRADE_RANGE_METRES} m trade range</small>
                                            </span>
                                            {duelData.mate ? (
                                                <>
                                                    <svg className={s.mapTradeLine} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                                        <line
                                                            x1={duelData.mate.point.left * 100}
                                                            y1={duelData.mate.point.top * 100}
                                                            x2={duelData.victimPoint.left * 100}
                                                            y2={duelData.victimPoint.top * 100}
                                                        />
                                                    </svg>
                                                    <span
                                                        className={s.mapTradeMate}
                                                        style={{ left: `${duelData.mate.point.left * 100}%`, top: `${duelData.mate.point.top * 100}%` }}
                                                        title={`Nearest teammate: ${duelData.mate.player?.gameName || "Teammate"}, ${duelData.mate.metres} m away`}
                                                    >
                                                        {duelData.mate.agent?.icon ? <Image src={duelData.mate.agent.icon} alt="" width={22} height={22} unoptimized /> : null}
                                                        <small>{duelData.mate.metres} m</small>
                                                    </span>
                                                </>
                                            ) : null}
                                        </>
                                    ) : null}
                                    {duelData.killerPoint ? (
                                        <svg className={`${s.mapDuelLine} ${duelData.localDeath ? s.mapDuelLineDeath : s.mapDuelLineKill}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                            <line
                                                x1={duelData.killerPoint.left * 100}
                                                y1={duelData.killerPoint.top * 100}
                                                x2={duelData.victimPoint.left * 100}
                                                y2={duelData.victimPoint.top * 100}
                                            />
                                            <line
                                                x1={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 - 1.15 / plotView.scale}
                                                y1={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 - 1.15 / plotView.scale}
                                                x2={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 + 1.15 / plotView.scale}
                                                y2={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 + 1.15 / plotView.scale}
                                            />
                                            <line
                                                x1={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 + 1.15 / plotView.scale}
                                                y1={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 - 1.15 / plotView.scale}
                                                x2={((duelData.killerPoint.left + duelData.victimPoint.left) / 2) * 100 - 1.15 / plotView.scale}
                                                y2={((duelData.killerPoint.top + duelData.victimPoint.top) / 2) * 100 + 1.15 / plotView.scale}
                                            />
                                        </svg>
                                    ) : null}
                                    {duelData.killerPoint ? (
                                        <MapDuelMarker
                                            point={duelData.killerPoint}
                                            player={duelData.killerPlayer}
                                            agent={duelData.killerAgent}
                                            dead={false}
                                            local={selectedFight.killer.toLowerCase() === analysis.localSubject}
                                            finisher={duelData.finisher}
                                            avoidPoint={duelData.victimPoint}
                                        />
                                    ) : null}
                                    <MapDuelMarker
                                        point={duelData.victimPoint}
                                        player={duelData.victimPlayer}
                                        agent={duelData.victimAgent}
                                        dead
                                        local={selectedFight.victim.toLowerCase() === analysis.localSubject}
                                    />
                                </>
                            ) : null}
                            </div>
                            <div className={s.mapZoomControls} onPointerDown={(event) => event.stopPropagation()}>
                                <button type="button" onClick={() => zoomPlot(1.5)} disabled={plotView.scale >= MAP_MAX_ZOOM} aria-label="Zoom in">+</button>
                                <button type="button" onClick={() => zoomPlot(1 / 1.5)} disabled={plotView.scale <= 1} aria-label="Zoom out">−</button>
                                {plotView.scale > 1 ? <button type="button" onClick={() => setPlotView({ scale: 1, x: 0, y: 0 })} aria-label="Reset zoom">Fit</button> : null}
                            </div>
                            {plotView.scale === 1 ? <small className={s.mapZoomHint} aria-hidden="true">Scroll to zoom</small> : null}
                        </div>
                    ) : (
                        <div className={s.mapAnalyticsEmpty}>This map does not provide minimap coordinate metadata.</div>
                    )}
                    {duelFocus ? (
                        <div className={s.mapDuelNavigator} aria-label="Choose a fight to display">
                            <span>Fight <b>{String(duelFocus.index + 1).padStart(2, "0")}</b><i>/ {String(duelFocus.events.length).padStart(2, "0")}</i></span>
                            <div className={s.mapDuelRounds}>
                                {duelFocus.events.map((event, index) => (
                                    <button
                                        key={fightEventKey(event)}
                                        type="button"
                                        className={index === duelFocus.index ? s.mapDuelRoundActive : ""}
                                        onClick={() => setDuelFocus((current) => current ? { ...current, index } : current)}
                                        aria-label={`Show fight ${index + 1} from round ${event.roundNum + 1}`}
                                        aria-pressed={index === duelFocus.index}
                                    >
                                        Round {event.roundNum + 1}
                                    </button>
                                ))}
                            </div>
                            <button type="button" className={s.mapDuelClear} onClick={() => setDuelFocus(null)}>Exit detail</button>
                        </div>
                    ) : null}
                    {!selectedFight ? (
                        <div className={s.mapLegend}>
                            <>
                                <span><i className={s.mapLegendKill} /> Kill location</span>
                                <span><i className={s.mapLegendDeath} /> Death location</span>
                            </>
                        </div>
                    ) : null}
                </div>
                <section className={s.mapInsights} aria-label="Map performance breakdown">
                    {selectedFight && duelData ? <section className={s.mapFightDetail} aria-label="Selected fight receipt">
                        <header><strong>Round {selectedFight.roundNum + 1} · {fmtLength(selectedFight.roundTime)}</strong><small>Recorded elimination</small></header>
                        <p><strong>{duelData.killerPlayer?.isLocal ? "You" : duelData.killerPlayer?.gameName || "Unknown player"}</strong><span aria-label="eliminated">→</span><strong>{duelData.victimPlayer?.isLocal ? "You" : duelData.victimPlayer?.gameName || "Unknown player"}</strong></p>
                        <dl><div><dt>Location</dt><dd>{duelData.area}</dd></div><div><dt>Finisher</dt><dd>{duelData.finisherName || "Unavailable"}</dd></div><div><dt>Your team</dt><dd>{duelData.roundWon === null ? "Outcome unavailable" : duelData.roundWon ? "Round won" : "Round lost"}</dd></div>{duelData.localDeath ? <><div><dt>Killer distance</dt><dd>{duelData.killDistance === null ? "Unavailable" : `${duelData.killDistance} m`}</dd></div><div><dt>Nearest teammate</dt><dd>{duelData.mate ? `${duelData.mate.player?.gameName || "Teammate"} · ${duelData.mate.metres} m` : "None alive"}</dd></div><div><dt>Traded</dt><dd className={duelData.traded ? s.mapKillText : s.mapDeathText}>{duelData.traded ? "Yes, within 5 s" : "No"}</dd></div></> : null}</dl>
                        {duelData.localDeath ? <p className={s.mapTradeVerdict} data-tone={duelData.traded ? "good" : duelData.mate && duelData.mate.metres <= TRADE_RANGE_METRES ? "neutral" : "danger"}>{duelData.traded
                            ? "Your team traded this death, so the fight still paid off."
                            : duelData.mate && duelData.mate.metres <= TRADE_RANGE_METRES
                                ? `${duelData.mate.player?.gameName || "A teammate"} was ${duelData.mate.metres} m away and could have traded, but didn't.`
                                : duelData.mate
                                    ? `Your nearest teammate was ${duelData.mate.metres} m away, too far to trade. Take this fight closer to your team.`
                                    : "No teammate was alive to trade this fight."}</p> : null}
                    </section> : null}
                    <header className={s.mapInsightsHeader}>
                        <div>
                            <span>Fight report</span>
                            <strong>Where you fought</strong>
                        </div>
                        <small>Whole match · {analysis.kills + analysis.deaths} fights</small>
                    </header>
                    {sideSwing ? (
                        <p className={s.mapSideSwing} data-tone={sideSwing.change > 0 ? "good" : sideSwing.after.kills < sideSwing.after.deaths ? "danger" : "neutral"}>
                            <b>Biggest change after the swap</b>
                            <span>
                                {sideSwing.area} went <strong>{sideSwing.before.kills}–{sideSwing.before.deaths}</strong> on {sideName(firstSide)}
                                {" "}and <strong>{sideSwing.after.kills}–{sideSwing.after.deaths}</strong> on {sideName(secondSide)}.
                            </span>
                        </p>
                    ) : null}
                    <div className={s.mapZoneList}>
                        {analysis.zones.map((zone) => {
                            const total = zone.kills + zone.deaths;
                            const share = total / Math.max(1, analysis.kills + analysis.deaths);
                            const zoneKey = zone.name === "A Site" ? "A" : zone.name === "B Site" ? "B" : zone.name === "C Site" ? "C" : zone.name === "Mid" ? "M" : "-";
                            const zoneAverageX = zone.xTotal / Math.max(1, zone.count);
                            const zoneAverageY = zone.yTotal / Math.max(1, zone.count);
                            const zoneMarkerLeft = canPlot
                                ? Math.max(0, Math.min(1, zoneAverageY * map!.xMultiplier! + map!.xScalarToAdd!))
                                : 0.5;
                            const zoneMarkerTop = canPlot
                                ? Math.max(0, Math.min(1, zoneAverageX * map!.yMultiplier! + map!.yScalarToAdd!))
                                : 0.5;
                            const zoneSummary = zone.kills > zone.deaths
                                    ? "Won more fights here"
                                    : zone.deaths > zone.kills
                                        ? "Lost more fights here"
                                        : "Even fights";
                            const zoneDetail = zone.kills > 0 && zone.deaths === 0
                                    ? "No deaths"
                                    : zone.kills === 0
                                        ? "No kills"
                                    : `${fmtRatio(zone.kills / zone.deaths)} K/D`;
                            const isFocused = zone.focusArea
                                ? focusedArea === zone.focusArea
                                : focusedZone === zone.focusZone;
                            return (
                                <button
                                    key={zone.name}
                                    type="button"
                                    data-zone={zoneKey}
                                    className={`${s.mapZoneCard} ${isFocused ? s.mapZoneCardActive : ""}`}
                                    onClick={() => {
                                        setDuelFocus(null);
                                        setFilter("all");
                                        if (zone.focusArea) {
                                            setFocusedZone(null);
                                            setFocusedArea((current) => current === zone.focusArea ? null : zone.focusArea);
                                        } else {
                                            setFocusedArea(null);
                                            setFocusedZone((current) => current === zone.focusZone ? null : zone.focusZone);
                                        }
                                    }}
                                    onMouseEnter={() => setHoveredZone(zone.focusZone || null)}
                                    onMouseLeave={() => setHoveredZone(null)}
                                    onFocus={() => setHoveredZone(zone.focusZone || null)}
                                    onBlur={() => setHoveredZone(null)}
                                    aria-pressed={isFocused}
                                >
                                    <span className={s.mapZoneThumb} aria-hidden="true">
                                        {map?.displayIcon ? <Image src={map.displayIcon} alt="" fill sizes="58px" unoptimized /> : null}
                                        <i style={{ left: `${zoneMarkerLeft * 100}%`, top: `${zoneMarkerTop * 100}%` }} />
                                    </span>
                                    <span className={s.mapZoneIdentity}>
                                        <strong>{zone.name}</strong>
                                        <small>{zoneSummary} <b>{zoneDetail}</b></small>
                                        <small className={s.mapZoneSides}>
                                            {(["attack", "defense"] as const).filter((side) => zone.sides[side].kills + zone.sides[side].deaths > 0).map((side) => (
                                                <span key={side}>{side === "attack" ? "Atk" : "Def"} <b className={s.mapKillText}>{zone.sides[side].kills}</b>–<b className={s.mapDeathText}>{zone.sides[side].deaths}</b></span>
                                            ))}
                                        </small>
                                    </span>
                                    <span className={s.mapZoneStats}>
                                        <span><small>Kills</small><b className={s.mapKillText}>{zone.kills}</b></span>
                                        <span><small>Deaths</small><b className={s.mapDeathText}>{zone.deaths}</b></span>
                                        <span><small>Fights</small><b>{total}</b></span>
                                    </span>
                                    <i className={s.mapZoneShare} aria-hidden="true"><b style={{ width: `${share * 100}%` }} /></i>
                                </button>
                            );
                        })}
                    </div>
                    <div className={s.mapMatchInsight}>
                        <div className={s.mapInsightSectionHeading}>
                            <span>Takeaways</span>
                            <small>Select one to see it on the map</small>
                        </div>
                        <div className={s.mapReviewList}>
                            {takeaways.map((note, index) => {
                                const markerLeft = canPlot ? Math.max(0, Math.min(1, note.y * map!.xMultiplier! + map!.xScalarToAdd!)) : 0.5;
                                const markerTop = canPlot ? Math.max(0, Math.min(1, note.x * map!.yMultiplier! + map!.yScalarToAdd!)) : 0.5;
                                const isDuelFocused = duelFocus?.id === note.id;
                                return (
                                <button
                                    key={`${note.label}-${note.copy}`}
                                    type="button"
                                    className={`${s.mapReviewCard} ${isDuelFocused ? s.mapReviewCardActive : ""}`}
                                    data-tone={note.tone}
                                    aria-pressed={isDuelFocused}
                                    onClick={() => selectDuelGroup(note.id, note.label, note.events)}
                                >
                                    <span className={s.mapReviewThumb} aria-hidden="true">
                                        {map?.displayIcon ? <Image src={map.displayIcon} alt="" fill sizes="52px" unoptimized /> : <b>{index + 1}</b>}
                                        <i style={{ left: `${markerLeft * 100}%`, top: `${markerTop * 100}%` }} />
                                    </span>
                                    <p>
                                        <small>{note.tone === "danger" ? "Work on" : note.tone === "good" ? "Keep doing" : "Worth knowing"}</small>
                                        <strong>{note.label}</strong>
                                        <span>{note.copy}</span>
                                        <em>{note.chips.map((chip) => <i key={chip}>{chip}</i>)}</em>
                                    </p>
                                </button>
                                );
                            })}
                        </div>
                    </div>
                </section>
            </div>
        </section>
    );
}
