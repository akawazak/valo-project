import { describe, expect, it } from "vitest";
import type { StorefrontResponse } from "./types";
import { storeRotation, storefrontItemIds, wishlistMatches } from "./wishlistAlerts";

const store = {
    SkinsPanelLayout: {
        SingleItemOffersRemainingDurationInSeconds: 3600,
        SingleItemStoreOffers: [
            { OfferID: "a", Rewards: [{ ItemID: "AAA-1" }] },
            { OfferID: "BBB-2", Rewards: [] },
        ],
    },
    BonusStore: { BonusStoreOffers: [{ Offer: { OfferID: "x", Rewards: [{ ItemID: "ccc-3" }] } }] },
} as unknown as StorefrontResponse;

describe("wishlist alerts", () => {
    it("reads daily and Night Market offers as lowercase item ids", () => {
        expect(storefrontItemIds(store)).toEqual(["aaa-1", "bbb-2", "ccc-3"]);
    });

    it("matches only wishlisted skins", () => {
        expect(wishlistMatches(store, { "ccc-3": "Prime Vandal" }).map((match) => match.name)).toEqual(["Prime Vandal"]);
    });

    it("keeps the same rotation while the countdown runs", () => {
        const now = 1_800_000_000_000;
        const later = { ...store, SkinsPanelLayout: { ...store.SkinsPanelLayout, SingleItemOffersRemainingDurationInSeconds: 1800 } } as StorefrontResponse;
        expect(storeRotation(later, now + 1_800_000)).toBe(storeRotation(store, now));
    });
});
