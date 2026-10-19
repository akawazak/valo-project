/**
 * Wishlist alerts: when a wishlisted skin shows up in the daily store or Night Market, say so once per store
 * rotation. The Store tab and the background watcher both report here, so an offer never alerts twice.
 */
import type { StorefrontResponse } from "./types";
import { publishAppNotification } from "./appNotifications";
import { playUiSound } from "./uiSounds";
import { notifyDesktop } from "../services/desktopNotify";

export interface WishlistMatch {
    id: string;
    name: string;
    image?: string;
}

const SEEN_LIMIT = 40;

export function wishlistKey(puuid?: string) {
    return `vantavault:wishlist:${puuid || "guest"}`;
}

export function readWishlist(puuid?: string): Record<string, string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(wishlistKey(puuid)) || "{}");
        return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch {
        return {};
    }
}

/** Skin levels on offer right now, keyed the way the wishlist stores them. */
export function storefrontItemIds(storefront: StorefrontResponse): string[] {
    const daily = storefront.SkinsPanelLayout?.SingleItemStoreOffers ?? [];
    const night = (storefront.BonusStore?.BonusStoreOffers ?? []).map((offer) => offer.Offer);
    return [...daily, ...night]
        .map((offer) => (offer?.Rewards?.[0]?.ItemID || offer?.OfferID || "").toLowerCase())
        .filter(Boolean);
}

export function wishlistMatches(storefront: StorefrontResponse, wishlist: Record<string, string>): WishlistMatch[] {
    return storefrontItemIds(storefront)
        .filter((id) => wishlist[id])
        .map((id) => ({ id, name: wishlist[id], image: `https://media.valorant-api.com/weaponskinlevels/${id}/displayicon.png` }));
}

/** The rotation an offer belongs to, as the hour the daily store resets; steady across refreshes. */
export function storeRotation(storefront: StorefrontResponse, now = Date.now()) {
    const seconds = storefront.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds ?? 0;
    return Math.round((now + seconds * 1000) / 3_600_000);
}

function seenKey(puuid?: string) {
    return `vantavault:wishlist-alerts:${puuid || "guest"}`;
}

export function announceWishlistMatches(puuid: string | undefined, matches: WishlistMatch[], rotation: number) {
    if (!matches.length || typeof window === "undefined") return false;
    const signature = matches.map((match) => match.id).sort().join(",");
    const id = `wishlist:${puuid || "guest"}:${rotation}:${signature}`;
    let seen: string[] = [];
    try {
        seen = JSON.parse(localStorage.getItem(seenKey(puuid)) || "[]");
        if (!Array.isArray(seen)) seen = [];
    } catch {
        seen = [];
    }
    if (seen.includes(id)) return false;
    try {
        localStorage.setItem(seenKey(puuid), JSON.stringify([id, ...seen].slice(0, SEEN_LIMIT)));
    } catch {
        // Worst case the same offer alerts again after a restart.
    }
    const names = matches.map((match) => match.name).join(", ");
    const title = matches.length === 1 ? `${matches[0].name} is in your store` : `${matches.length} wishlist skins are in your store`;
    publishAppNotification({ id, kind: "wishlist", title, body: names, image: matches[0]?.image, action: "store", accountPuuid: puuid });
    playUiSound("wishlist");
    void notifyDesktop(title, matches.length === 1 ? "On your wishlist. Open VantaVault to see the price." : names);
    return true;
}
