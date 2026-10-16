"use client";

import { useEffect, useState } from "react";
import { getCareerInsights, type CareerInsights } from "@/services/api";

// The playstyle radar and the Deeper look read the same report; share one request per filter.
const pending = new Map<string, Promise<CareerInsights>>();

export function useCareerInsights(puuid: string, region: string, queue: string) {
    const key = `${puuid}|${region}|${queue}`;
    const [state, setState] = useState<{ key: string; data: CareerInsights | null; error: string }>({ key: "", data: null, error: "" });
    useEffect(() => {
        let cancelled = false;
        let request = pending.get(key);
        if (!request) {
            request = getCareerInsights({ puuid, region }, queue);
            pending.set(key, request);
            // Keep the shared promise only while both readers mount; later opens fetch fresh data.
            request.finally(() => window.setTimeout(() => pending.delete(key), 2000)).catch(() => undefined);
        }
        request
            .then((data) => { if (!cancelled) setState({ key, data, error: "" }); })
            .catch((error: unknown) => { if (!cancelled) setState({ key, data: null, error: error instanceof Error ? error.message : String(error) }); });
        return () => { cancelled = true; };
    }, [key, puuid, queue, region]);
    return state.key === key ? { data: state.data, error: state.error } : { data: null, error: "" };
}
