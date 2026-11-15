"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getReplayRound, getReplays, getReplaySummary, importReplay, type ReplayRound, type ReplaySummary } from "@/services/api";
import { isAndroidRuntime } from "@/lib/platform";

export type MatchReplayState =
    | { phase: "off" }
    | { phase: "checking" }
    | { phase: "missing"; folderFound: boolean }
    | { phase: "processing" }
    | { phase: "failed"; error: string }
    | { phase: "ready"; summary: ReplaySummary };

/**
 * The full-round replay for one match, from the .vrf file VALORANT saves when
 * "Download replay" is pressed. Nothing watches the folder: the app looks when
 * Round review opens and when the player asks it to check again.
 */
export function useMatchReplay(matchId: string) {
    const [state, setState] = useState<MatchReplayState>({ phase: isAndroidRuntime() ? "off" : "checking" });
    const rounds = useRef(new Map<number, Promise<ReplayRound>>());
    const alive = useRef(true);
    const id = matchId.toLowerCase();

    const check = useCallback(async () => {
        if (isAndroidRuntime() || !id) return;
        setState((current) => current.phase === "ready" ? current : { phase: "checking" });
        try {
            for (let attempt = 0; attempt < 120 && alive.current; attempt += 1) {
                const list = await getReplays();
                const entry = list.replays.find((replay) => replay.matchId === id);
                if (entry?.status === "ready") {
                    const summary = await getReplaySummary(id);
                    if (alive.current) setState({ phase: "ready", summary });
                    return;
                }
                if (!list.parserReady) {
                    setState({ phase: "off" });
                    return;
                }
                if (!entry) {
                    setState({ phase: "missing", folderFound: list.folderFound });
                    return;
                }
                if (entry.status === "failed") {
                    setState({ phase: "failed", error: entry.error || "The replay could not be read." });
                    return;
                }
                if (entry.status === "new") await importReplay(id);
                setState({ phase: "processing" });
                await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            }
        } catch {
            // No local backend (browser preview) or an old backend: stay quiet.
            if (alive.current) setState({ phase: "off" });
        }
    }, [id]);

    useEffect(() => {
        alive.current = true;
        rounds.current.clear();
        void check();
        return () => { alive.current = false; };
    }, [check]);

    const loadRound = useCallback((index: number) => {
        let pending = rounds.current.get(index);
        if (!pending) {
            pending = getReplayRound(id, index);
            pending.catch(() => rounds.current.delete(index));
            rounds.current.set(index, pending);
        }
        return pending;
    }, [id]);

    return { state, check, loadRound };
}
