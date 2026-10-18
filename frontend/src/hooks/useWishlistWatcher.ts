"use client";

import { useEffect } from "react";
import { getStorefront } from "@/services/api";
import { announceWishlistMatches, readWishlist, storeRotation, wishlistMatches } from "@/lib/wishlistAlerts";

const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_MS = 20 * 1000;

/**
 * Checks the active account's store in the background, so a wishlisted skin is announced even when the
 * Store tab is never opened (or the app sits in the tray). One storefront read per hour and after each reset.
 */
export function useWishlistWatcher(puuid: string | undefined, enabled: boolean) {
    useEffect(() => {
        if (!puuid || !enabled) return;
        let cancelled = false;
        let timer = 0;
        const schedule = (ms: number) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void check(), ms);
        };
        const check = async () => {
            if (cancelled) return;
            if (!Object.keys(readWishlist(puuid)).length) {
                schedule(CHECK_EVERY_MS);
                return;
            }
            try {
                const storefront = await getStorefront();
                if (cancelled) return;
                announceWishlistMatches(puuid, wishlistMatches(storefront, readWishlist(puuid)), storeRotation(storefront));
                const resetIn = (storefront.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds ?? 0) * 1000;
                // Look again just after the reset if that comes before the next hourly check.
                schedule(resetIn > 0 && resetIn + 90_000 < CHECK_EVERY_MS ? resetIn + 90_000 : CHECK_EVERY_MS);
            } catch {
                schedule(CHECK_EVERY_MS);
            }
        };
        schedule(FIRST_CHECK_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [puuid, enabled]);
}
