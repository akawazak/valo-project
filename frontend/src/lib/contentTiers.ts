/** Skin edition (content tier) colours, keyed by valorant-api.com content tier UUID. */
export const CONTENT_TIERS: Record<string, { name: string; color: string; icon: string }> = {
    "12683d76-48d7-84a3-4e09-6985794f0445": { name: "Select", color: "#5a9fe2", icon: "" },
    "0cebb8be-46d7-c12a-d306-e9907bfc5a25": { name: "Deluxe", color: "#009587", icon: "" },
    "60bca009-4182-7998-dee7-b8a2558dc369": { name: "Premium", color: "#d1548d", icon: "" },
    "e046854e-406c-37f4-6607-19a9ba8426fc": { name: "Exclusive", color: "#f5955b", icon: "" },
    "411e4a55-4e59-7757-41f0-86a53f101bb5": { name: "Ultra", color: "#fad663", icon: "" },
};
for (const [uuid, tier] of Object.entries(CONTENT_TIERS)) {
    tier.icon = `https://media.valorant-api.com/contenttiers/${uuid}/displayicon.png`;
}

/** Colour used for default and battle-pass skins, which have no edition. */
export const NO_TIER_COLOR = "#6b7280";

export function tierColor(contentTierUuid?: string | null) {
    return (contentTierUuid && CONTENT_TIERS[contentTierUuid.toLowerCase()]?.color) || NO_TIER_COLOR;
}

/** uuid -> colour, for call sites that only need the colour. */
export const TIER_COLORS: Record<string, string> = Object.fromEntries(
    Object.entries(CONTENT_TIERS).map(([uuid, tier]) => [uuid, tier.color]),
);
