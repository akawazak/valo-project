"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
    AccessoryStoreOffer, BundleInfo, ContentTier, StorefrontBonusOffer, StorefrontBundleItem,
    StorefrontOffer, StorefrontResponse, Weapon,
} from "@/lib/types";
import { getStorefront, getWallet } from "@/services/api";
import { useData } from "@/context/DataContext";

const VP_ID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
const RP_ID = "e59aa87c-4cbf-517a-5983-6e81511be9b7";

const VP_ICON = "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const RP_ICON = "https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png";

type StoreOfferCard = {
    uuid: string;
    name: string;
    weaponName: string;
    image: string;
    tierName: string;
    tierIcon?: string;
    tierColor?: string;
    priceValue: number;
    discount?: number;
    isOwned?: boolean;
};

type AccessoryOfferCard = {
    uuid: string;
    name: string;
    kind: string;
    image: string;
    priceValue: number;
};

function hexToRgba(hex: string, opacity = 1): string {
    if (!hex) return `rgba(255, 255, 255, ${opacity})`;
    const h = hex.replace("#", "").trim();
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function firstCost(cost?: Record<string, number>) {
    return Object.values(cost || {})[0] || 0;
}

function formatDuration(totalSeconds: number) {
    const s = Math.max(0, totalSeconds);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
}

function findSkinOffer(
    itemId: string, weapons: Weapon[], tierMap: Record<string, ContentTier>,
    priceValue: number, ownedLevelIDs: string[], discount?: number
): StoreOfferCard | null {
    const target = itemId.toLowerCase();
    for (const weapon of weapons) {
        for (const skin of weapon.skins) {
            const ok =
                skin.uuid.toLowerCase() === target ||
                skin.levels.some(l => l.uuid.toLowerCase() === target) ||
                skin.chromas.some(c => c.uuid.toLowerCase() === target);
            if (!ok) continue;
            const tier = tierMap[skin.contentTierUuid];
            return {
                uuid: `${itemId}-${discount ?? 0}`,
                name: skin.displayName,
                weaponName: weapon.displayName,
                image: skin.chromas?.[0]?.fullRender || skin.displayIcon || "",
                tierName: tier?.displayName || "Select Edition",
                tierIcon: tier?.displayIcon,
                tierColor: tier?.highlightColor,
                priceValue,
                discount,
                isOwned: skin.levels.some(l => ownedLevelIDs.includes(l.uuid.toLowerCase())),
            };
        }
    }
    return null;
}

function cardFromOffer(
    offer: StorefrontOffer, weapons: Weapon[], tierMap: Record<string, ContentTier>,
    ownedLevelIDs: string[], discount?: number, discountedCost?: Record<string, number>
) {
    const rewardId = offer.Rewards?.[0]?.ItemID || offer.OfferID;
    return findSkinOffer(rewardId, weapons, tierMap, firstCost(discountedCost || offer.Cost), ownedLevelIDs, discount);
}

function accessoryFromOffer(
    offer: StorefrontOffer,
    sprays: ReturnType<typeof useData>["sprays"],
    cards: ReturnType<typeof useData>["playerCards"],
    buddies: ReturnType<typeof useData>["ownedBuddies"]
): AccessoryOfferCard | null {
    const rewardId = offer.Rewards?.[0]?.ItemID || offer.OfferID;
    const rewardKey = rewardId.toLowerCase();
    const spray = sprays.find(item => item.uuid.toLowerCase() === rewardKey);
    if (spray) {
        return { uuid: rewardId, name: spray.displayName, kind: "Spray", image: spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon || "", priceValue: firstCost(offer.Cost) };
    }
    const card = cards.find(item => item.uuid.toLowerCase() === rewardKey);
    if (card) {
        return { uuid: rewardId, name: card.displayName, kind: "Card", image: card.displayIcon || card.smallArt || card.wideArt || "", priceValue: firstCost(offer.Cost) };
    }
    const buddy = buddies.find(item => item.uuid.toLowerCase() === rewardKey || item.levels.some(level => level.uuid.toLowerCase() === rewardKey));
    if (buddy) {
        return { uuid: rewardId, name: buddy.displayName, kind: "Buddy", image: buddy.levels[0]?.displayIcon || "", priceValue: firstCost(offer.Cost) };
    }
    return null;
}

function OfferCard({ offer }: { offer: StoreOfferCard }) {
    const tc = offer.tierColor || "ffffff";
    return (
        <div
            className={`store-card${offer.isOwned ? " owned" : ""}`}
            style={{
                "--tier-color-border": hexToRgba(tc, 0.25),
                "--tier-color-hover-border": hexToRgba(tc, 0.6),
                "--tier-bg-gradient": `linear-gradient(180deg, ${hexToRgba(tc, 0.06)} 0%, rgba(18,22,30,0.9) 100%)`,
                "--tier-color-raw": hexToRgba(tc, 1),
            } as React.CSSProperties}
        >
            <div className="store-card-header">
                <div className="store-card-tier-badge" style={{ color: hexToRgba(tc, 0.9) }}>
                    {offer.tierIcon && (
                        <Image src={offer.tierIcon} alt="" width={14} height={14} unoptimized />
                    )}
                    <span>{offer.tierName.replace(" Edition", "")}</span>
                </div>
                {offer.isOwned && <span className="store-card-owned-badge">✓ OWNED</span>}
            </div>
            <div className="store-card-name">{offer.name}</div>
            <div className="store-card-category">{offer.weaponName}</div>
            <div className="store-card-image-container">
                {offer.image ? (
                    <Image className="store-card-image" src={offer.image} alt={offer.name} width={320} height={160} unoptimized />
                ) : (
                    <div className="store-card-no-image">No image</div>
                )}
            </div>
            <div className="store-card-footer">
                {offer.discount != null && offer.discount > 0 ? (
                    <div className="d-flex align-items-center gap-2">
                        <div className="store-card-price-pill">
                            <Image src={VP_ICON} alt="VP" width={14} height={14} unoptimized className="currency-icon" />
                            {offer.priceValue.toLocaleString()}
                        </div>
                        <div className="store-card-discount-badge">-{Math.round(offer.discount * 100)}%</div>
                    </div>
                ) : (
                    <div className="store-card-price-pill">
                        <Image src={VP_ICON} alt="VP" width={14} height={14} unoptimized className="currency-icon" />
                        {offer.priceValue.toLocaleString()}
                    </div>
                )}
            </div>
        </div>
    );
}

interface StorePanelsProps {
    refreshKey?: number;
    onConnectAccount?: () => void;
}

export default function StorePanels({ refreshKey = 0, onConnectAccount }: StorePanelsProps) {
    const { weapons, contentTiers, bundles, ownedLevelIDs, ownedBuddies, sprays, playerCards, activeAccount, isTokenExpired, setIsTokenExpired } = useData();
    const [storefront, setStorefront] = useState<StorefrontResponse | null>(null);
    const [wallet, setWallet] = useState<Record<string, number> | null>(null);
    const [storefrontError, setStorefrontError] = useState("");
    const [isLoadingStorefront, setIsLoadingStorefront] = useState(false);
    const [secondsUntilReset, setSecondsUntilReset] = useState(0);
    const [bundleSeconds, setBundleSeconds] = useState(0);
    const [nightMarketSeconds, setNightMarketSeconds] = useState(0);
    const [bundleOpen, setBundleOpen] = useState(false);

    const lastRefreshKeyRef = useRef(-1);

    const tierMap = useMemo(() =>
        contentTiers.reduce<Record<string, ContentTier>>((acc, t) => {
            acc[t.uuid] = t;
            return acc;
        }, {}),
        [contentTiers]
    );

    const refreshStorefront = useCallback(() => {
        if (!activeAccount) {
            setStorefront(null);
            setWallet(null);
            setStorefrontError("");
            return;
        }
        setIsLoadingStorefront(true);
        setStorefrontError("");
        setIsTokenExpired(false);
        Promise.all([getStorefront(), getWallet()])
            .then(([sf, w]) => {
                setStorefront(sf);
                setWallet(w);
                setSecondsUntilReset(sf.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 0);
                const rawB = sf.FeaturedBundle?.Bundles?.[0] ?? sf.FeaturedBundle?.Bundle;
                setBundleSeconds(rawB?.DurationRemainingInSeconds || 0);
                setNightMarketSeconds(sf.BonusStore?.BonusStoreRemainingDurationInSeconds || 0);
            })
            .catch(e => {
                setStorefront(null);
                setWallet(null);
                const msg = e instanceof Error ? e.message : "Live storefront unavailable.";
                setStorefrontError(msg);
                if (msg.includes("status 401") || msg.includes("unauthorized") || msg.includes("authentication required") || msg.includes("token")) {
                    setIsTokenExpired(true);
                }
            })
            .finally(() => setIsLoadingStorefront(false));
    }, [activeAccount, setIsTokenExpired]);

    useEffect(() => {
        if (lastRefreshKeyRef.current === refreshKey) return;
        lastRefreshKeyRef.current = refreshKey;
        refreshStorefront();
    }, [refreshKey, refreshStorefront]);

    useEffect(() => {
        const t = window.setInterval(() => {
            setSecondsUntilReset(s => Math.max(0, s - 1));
            setBundleSeconds(s => Math.max(0, s - 1));
            setNightMarketSeconds(s => Math.max(0, s - 1));
        }, 1000);
        return () => clearInterval(t);
    }, []);

    const dailyOffers = useMemo(() =>
        (storefront?.SkinsPanelLayout?.SingleItemStoreOffers ?? [])
            .map(o => cardFromOffer(o, weapons, tierMap, ownedLevelIDs))
            .filter((o): o is StoreOfferCard => o !== null),
        [storefront, weapons, tierMap, ownedLevelIDs]
    );

    const nightMarket = useMemo(() =>
        (storefront?.BonusStore?.BonusStoreOffers ?? [])
            .map((o: StorefrontBonusOffer) =>
                cardFromOffer(o.Offer, weapons, tierMap, ownedLevelIDs, o.DiscountPercent, o.DiscountCosts))
            .filter((o): o is StoreOfferCard => o !== null),
        [storefront, weapons, tierMap, ownedLevelIDs]
    );

    const accessories = useMemo(() =>
        (storefront?.AccessoryStore?.AccessoryStoreOffers ?? [])
            .map((entry: AccessoryStoreOffer) => accessoryFromOffer(entry.Offer, sprays, playerCards, ownedBuddies))
            .filter((item): item is AccessoryOfferCard => item !== null),
        [storefront, sprays, playerCards, ownedBuddies]
    );

    const resolvedBundle = useMemo(() => {
        const rawBundle = storefront?.FeaturedBundle?.Bundles?.[0] ?? storefront?.FeaturedBundle?.Bundle;
        if (!rawBundle?.Items?.length) return null;
        const bundleAliases = rawBundle as typeof rawBundle & { ID?: string; id?: string; dataAssetID?: string };
        const assetId = (bundleAliases.DataAssetID || bundleAliases.ID || bundleAliases.id || bundleAliases.dataAssetID)?.toLowerCase();
        const meta: BundleInfo | undefined = assetId ? bundles.find(b => b.uuid.toLowerCase() === assetId) : undefined;
        const items = rawBundle.Items
            .map((item: StorefrontBundleItem) => {
                const card = findSkinOffer(item.Item.ItemID, weapons, tierMap, item.DiscountedPrice ?? item.BasePrice, ownedLevelIDs);
                return card ? { ...card, priceValue: item.DiscountedPrice ?? item.BasePrice } : null;
            })
            .filter((i): i is StoreOfferCard => i !== null);
        const totalBase = rawBundle.Items.reduce((s, i) => s + i.BasePrice, 0);
        const totalDisc = rawBundle.Items.reduce((s, i) => s + (i.DiscountedPrice ?? i.BasePrice), 0);
        const bannerImage = meta?.displayIcon2 || meta?.displayIcon || "";
        return { name: meta?.displayName || "Featured Bundle", description: meta?.description ?? "", banner: bannerImage, items, totalBase, totalDisc };
    }, [storefront, weapons, tierMap, ownedLevelIDs, bundles]);

    const vpBalance = wallet?.[VP_ID] ?? 0;
    const rpBalance = wallet?.[RP_ID] ?? 0;

    if (!activeAccount) {
        return (
            <div className="storefront-page scrollable-col">
                <section className="store-empty-hero clip-tactical">
                    <div>
                        <div className="tactical-kicker">// ACCOUNT REQUIRED</div>
                        <h1>Connect Riot to unlock your live store.</h1>
                        <p>Daily offers, featured bundles, Night Market, wallet balance, and accessories will appear here once you connect a Riot account.</p>
                    </div>
                    <button type="button" className="connect-mega-btn clip-tactical-sm" onClick={onConnectAccount}>
                        Connect Riot Account
                    </button>
                </section>
            </div>
        );
    }

    return (
        <div className="storefront-page scrollable-col">
            <div className="storefront-title-container d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
                <div>
                    <div className="tactical-kicker">// STORE</div>
                    <h2 className="mb-1 tactical-title">Riot Storefront</h2>
                    <p className="text-muted small mb-0">Daily shop, bundles, night market, and accessories</p>
                </div>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    {wallet && !isTokenExpired && (
                        <div className="wallet-bar">
                            <span className="wallet-value">
                                <Image src={VP_ICON} alt="VP" width={16} height={16} unoptimized className="currency-icon" />
                                {vpBalance.toLocaleString()}
                            </span>
                            <span className="wallet-value rp">
                                <Image src={RP_ICON} alt="RP" width={16} height={16} unoptimized className="currency-icon" />
                                {rpBalance.toLocaleString()}
                            </span>
                        </div>
                    )}
                    <button type="button" className="btn-tactical" onClick={refreshStorefront} disabled={isLoadingStorefront}>
                        {isLoadingStorefront ? "⟳ Refreshing…" : "⟳ Refresh"}
                    </button>
                    <span className="store-timer-badge">Daily reset {secondsUntilReset > 0 ? formatDuration(secondsUntilReset) : "--:--:--"}</span>
                </div>
            </div>

            {isTokenExpired && activeAccount && (
                <div className="alert alert-danger p-4 mb-4 text-center rounded-3 bg-opacity-10 border-danger d-flex flex-column align-items-center justify-content-center">
                    <h4 className="mb-2 text-danger">⚠ Riot Session Expired</h4>
                    <p className="text-muted small max-w-lg mb-0">
                        The session tokens for <strong>{activeAccount.gameName}#{activeAccount.tagLine}</strong> have expired.
                        Riot Games requires re-authentication every few hours. Open the account menu in the top bar to reconnect.
                    </p>
                </div>
            )}

            {storefrontError && !isTokenExpired && (
                <div className="alert alert-warning mb-4">{storefrontError}</div>
            )}

            <div className="mb-5">
                <div className="section-row">
                    <div>
                        <div className="tactical-kicker">// DAILY DROP</div>
                        <h3 className="mb-0 section-title">Today&apos;s Offers</h3>
                    </div>
                    <span className="section-meta">4 skins — refreshes daily</span>
                </div>
                {isLoadingStorefront && !storefront ? (
                    <div className="text-center py-5">
                        <div className="spinner-border text-danger" style={{ width: "2.5rem", height: "2.5rem" }} />
                    </div>
                ) : dailyOffers.length > 0 ? (
                    <div className="store-grid">
                        {dailyOffers.map(o => <OfferCard key={o.uuid} offer={o} />)}
                    </div>
                ) : !isLoadingStorefront && !isTokenExpired && (
                    <p className="text-muted small">No daily offers found. Make sure you are logged in.</p>
                )}
            </div>

            {resolvedBundle && resolvedBundle.items.length > 0 && !isTokenExpired && (
                <div className="mb-5 storefront-bundle-card">
                    <button type="button" className="storefront-bundle-toggle" onClick={() => setBundleOpen(v => !v)}>
                        {resolvedBundle.banner && (
                            <div className="storefront-bundle-banner">
                                <Image src={resolvedBundle.banner} alt={resolvedBundle.name} fill unoptimized style={{ objectFit: "contain", objectPosition: "center" }} />
                                <div className="storefront-bundle-banner-overlay" />
                            </div>
                        )}
                        <div className="storefront-bundle-header-content">
                            <div className="storefront-bundle-left">
                                <div className="storefront-bundle-label">FEATURED BUNDLE</div>
                                <div className="storefront-bundle-name">{resolvedBundle.name}</div>
                                {bundleSeconds > 0 && (
                                    <div className="storefront-bundle-timer">Ends in {formatDuration(bundleSeconds)}</div>
                                )}
                            </div>
                            <div className="storefront-bundle-right">
                                <div className="storefront-bundle-price">
                                    <Image src={VP_ICON} alt="VP" width={18} height={18} unoptimized className="currency-icon" />
                                    {resolvedBundle.totalDisc.toLocaleString()}
                                </div>
                                {resolvedBundle.totalBase > resolvedBundle.totalDisc && (
                                    <div className="storefront-bundle-orig-price">{resolvedBundle.totalBase.toLocaleString()}</div>
                                )}
                                <div className={`storefront-bundle-chevron${bundleOpen ? " open" : ""}`}>⌄</div>
                            </div>
                        </div>
                    </button>
                    {bundleOpen && (
                        <div className="storefront-bundle-items-panel">
                            <div className="store-grid">
                                {resolvedBundle.items.map(o => <OfferCard key={o.uuid} offer={o} />)}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {nightMarket.length > 0 && !isTokenExpired && (
                <div className="mb-5 night-market-container p-3">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <div className="tactical-kicker">// NIGHT MARKET</div>
                            <h3 className="night-market-title mb-0">Discounted Offers</h3>
                        </div>
                        {nightMarketSeconds > 0 && (
                            <span className="night-market-timer">{nightMarket.length} offers active — ends in {formatDuration(nightMarketSeconds)}</span>
                        )}
                    </div>
                    <div className="store-grid">
                        {nightMarket.map(o => <OfferCard key={o.uuid} offer={o} />)}
                    </div>
                </div>
            )}

            {accessories.length > 0 && !isTokenExpired && (
                <div className="mb-5">
                    <div className="section-row">
                        <div>
                            <div className="tactical-kicker">// ACCESSORIES</div>
                            <h3 className="mb-0 section-title">Buddies — Sprays — Cards</h3>
                        </div>
                    </div>
                    <div className="accessory-grid">
                        {accessories.map(item => (
                            <div className="accessory-card clip-tactical-sm" key={item.uuid}>
                                {item.image && <Image src={item.image} alt={item.name} width={54} height={54} unoptimized className="accessory-icon" />}
                                <div className="accessory-copy">
                                    <span>{item.kind}</span>
                                    <strong>{item.name}</strong>
                                </div>
                                <div className="accessory-price">{item.priceValue.toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
