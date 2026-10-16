"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import { isAndroidRuntime } from "@/lib/platform";
import { getProfileMatchHistory, getRRHistory, type ProfileMatchSummary } from "@/services/api";
import { summarizeMatches } from "@/features/profile/reviewStats";
import t from "./SessionEndToast.module.css";

/** ProfilePanel opens Session recap on mount when this is set. */
export const OPEN_RECAP_FLAG = "vv-open-session-recap";
const LAST_SHOWN_KEY = "vv-session-toast-last";
// Ignore very short game launches, and allow time for the last match to sync.
const MIN_OPEN_MS = 3 * 60 * 1000;
const CHECK_DELAYS_MS = [20_000, 75_000];

interface Recap { matches: ProfileMatchSummary[]; wins: number; losses: number; rr: number | null; minutes: number; bestMap?: string }

const readLastShown = () => { try { return localStorage.getItem(LAST_SHOWN_KEY) || ""; } catch { return ""; } };
const writeLastShown = (id: string) => { try { localStorage.setItem(LAST_SHOWN_KEY, id); } catch { /* storage unavailable */ } };

/** Shows a short session summary once VALORANT closes, on whatever tab is open. */
export default function SessionEndToast({ onOpenRecap, mapNames = {} }: { onOpenRecap: () => void; mapNames?: Record<string, string> }) {
    const { isLocalClientActive, localPuuid, activeAccount } = useData();
    const openedRef = useRef<{ at: number; puuid: string } | null>(null);
    const [recap, setRecap] = useState<Recap | null>(null);
    // Read through refs: closing the game also changes the account state, which must not cancel the pending check.
    const accountRef = useRef(activeAccount);
    const mapNamesRef = useRef(mapNames);
    const timersRef = useRef<number[]>([]);
    useEffect(() => { accountRef.current = activeAccount; mapNamesRef.current = mapNames; });
    useEffect(() => () => timersRef.current.forEach((timer) => window.clearTimeout(timer)), []);

    useEffect(() => {
        if (isAndroidRuntime()) return;
        if (isLocalClientActive && localPuuid) {
            if (!openedRef.current) openedRef.current = { at: Date.now(), puuid: localPuuid };
            return;
        }
        const opened = openedRef.current;
        openedRef.current = null;
        if (!opened || Date.now() - opened.at < MIN_OPEN_MS) return;
        const account = accountRef.current;
        // Only for the account the app is showing, so the numbers match the profile.
        if (account?.puuid && account.puuid.toLowerCase() !== opened.puuid.toLowerCase()) return;

        const check = async (attempt: number) => {
            try {
                const scope = { puuid: opened.puuid, region: account?.region || "" };
                const history = await getProfileMatchHistory(0, 15, "", scope);
                const played = (history.matches || []).filter((match) => match.gameStartMillis >= opened.at - 10 * 60 * 1000);
                if (!played.length) {
                    if (attempt + 1 < CHECK_DELAYS_MS.length) timersRef.current.push(window.setTimeout(() => void check(attempt + 1), CHECK_DELAYS_MS[attempt + 1]));
                    return;
                }
                const newest = played[0].matchId;
                if (readLastShown() === newest) return;
                const rr = await getRRHistory(undefined, scope).then((result) => result.snapshots || []).catch(() => []);
                const stats = summarizeMatches(played, rr);
                const byMap = played.reduce<Record<string, number>>((counts, match) => ({ ...counts, [match.mapID]: (counts[match.mapID] || 0) + 1 }), {});
                const topMap = Object.entries(byMap).sort((a, b) => b[1] - a[1])[0]?.[0];
                writeLastShown(newest);
                setRecap({ matches: played, wins: stats.wins, losses: stats.losses, rr: stats.rr, minutes: Math.round(stats.playedMillis / 60000), bestMap: topMap ? mapNamesRef.current[topMap.toLowerCase()] : undefined });
            } catch {
                // Offline or Riot unavailable: skip the popup rather than retrying in a loop.
            }
        };
        timersRef.current.push(window.setTimeout(() => void check(0), CHECK_DELAYS_MS[0]));
    }, [isLocalClientActive, localPuuid]);

    if (!recap) return null;
    const games = recap.matches.length;
    const duration = recap.minutes >= 60 ? `${Math.floor(recap.minutes / 60)}h ${recap.minutes % 60}m` : `${recap.minutes}m`;
    return <aside className={t.toast} role="status" aria-live="polite">
        <div className={t.body}>
            <em>Session over · VALORANT closed</em>
            <h4>Your session</h4>
            <div className={t.row}>
                <strong><span className={t.win}>{recap.wins}</span>W <span className={t.loss}>{recap.losses}</span>L</strong>
                {recap.rr !== null ? <b className={recap.rr >= 0 ? t.win : t.loss}>{recap.rr > 0 ? "+" : ""}{recap.rr} RR</b> : null}
            </div>
            <p>{games} {games === 1 ? "game" : "games"} · {duration}{recap.bestMap ? ` · mostly ${recap.bestMap}` : ""}</p>
            <div className={t.actions}>
                <button type="button" className={t.primary} onClick={() => { setRecap(null); onOpenRecap(); }}>View recap</button>
                <button type="button" onClick={() => setRecap(null)}>Later</button>
            </div>
        </div>
        <button type="button" className={t.close} onClick={() => setRecap(null)} aria-label="Dismiss session summary">×</button>
    </aside>;
}
