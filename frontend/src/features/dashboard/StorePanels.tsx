"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import SkinVideoPlayer from "@/components/SkinVideoPlayer";
import {
    AccessoryStoreOffer, BundleInfo, ContentTier, StorefrontBonusOffer, StorefrontBundleItem,
    StorefrontOffer, StorefrontResponse, Weapon, SprayAsset, PlayerCardAsset, GunBuddy, Skin,
} from "@/lib/types";
import { getStorefront, getWallet } from "@/services/api";
import { useData } from "@/context/DataContext";

const VP_ID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
const RP_ID = "e59aa87c-4cbf-517a-5983-6e81511be9b7";

const VP_ICON = "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const RP_ICON = "https://media.valorant-api.com/currencies/e59aa87c-4cbf-517a-5983-6e81511be9b7/displayicon.png";
const BUNDLE_ROTATION_MS = 8000;

function readableStorefrontError(message: string) {
    if (/BAD_CLAIMS|validating\/decoding RSO Access Token/i.test(message)) {
        return "This Riot session needs to be renewed before the store can load.";
    }
    return message.replace(/^an error occurred:?\s*/i, "").replace(/^an error occured:?\s*/i, "").trim();
}

type StoreOfferCard = {
    uuid: string;
    wishlistId: string;
    name: string;
    weaponName: string;
    image: string;
    tierName: string;
    tierIcon?: string;
    tierColor?: string;
    priceValue: number;
    basePrice?: number;
    included?: boolean;
    discount?: number;
    isOwned?: boolean;
    nightMarket?: boolean;
    skin?: Skin;
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
                wishlistId: target,
                name: skin.displayName,
                weaponName: weapon.displayName,
                image: skin.chromas?.[0]?.fullRender || skin.displayIcon || "",
                tierName: tier?.displayName || "Select Edition",
                tierIcon: tier?.displayIcon,
                tierColor: tier?.highlightColor,
                priceValue,
                discount,
                isOwned: skin.levels.some(l => ownedLevelIDs.includes(l.uuid.toLowerCase())),
                skin,
            };
        }
    }
    return null;
}

function findBundleOffer(
    itemId: string, weapons: Weapon[], tierMap: Record<string, ContentTier>,
    priceValue: number, ownedLevelIDs: string[],
    sprayMap: Record<string, SprayAsset>, playerCardMap: Record<string, PlayerCardAsset>,
    buddyMap: Record<string, GunBuddy>, discount?: number
): StoreOfferCard | null {
    const skinOffer = findSkinOffer(itemId, weapons, tierMap, priceValue, ownedLevelIDs, discount);
    if (skinOffer) return skinOffer;

    const target = itemId.toLowerCase();
    const spray = sprayMap[target];
    if (spray) {
        return {
            uuid: `${itemId}-${discount ?? 0}`,
            wishlistId: target,
            name: spray.displayName,
            weaponName: "Spray",
            image: spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon || "",
            tierName: "Accessory",
            priceValue,
            discount,
            isOwned: false,
        };
    }

    const card = playerCardMap[target];
    if (card) {
        return {
            uuid: `${itemId}-${discount ?? 0}`,
            wishlistId: target,
            name: card.displayName,
            weaponName: "Player Card",
            image: card.largeArt || card.smallArt || card.displayIcon || card.wideArt || "",
            tierName: "Accessory",
            priceValue,
            discount,
            isOwned: false,
        };
    }

    const buddy = buddyMap[target];
    if (buddy) {
        return {
            uuid: `${itemId}-${discount ?? 0}`,
            wishlistId: target,
            name: buddy.displayName,
            weaponName: "Gun Buddy",
            image: buddy.levels[0]?.displayIcon || "",
            tierName: "Accessory",
            priceValue,
            discount,
            isOwned: false,
        };
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
    sprays: Record<string, SprayAsset>,
    cards: Record<string, PlayerCardAsset>,
    buddies: Record<string, GunBuddy>
): AccessoryOfferCard | null {
    const rewardId = offer.Rewards?.[0]?.ItemID || offer.OfferID;
    const rewardKey = rewardId.toLowerCase();
    const spray = sprays[rewardKey];
    if (spray) {
        return { uuid: rewardId, name: spray.displayName, kind: "Spray", image: spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon || "", priceValue: firstCost(offer.Cost) };
    }
    const card = cards[rewardKey];
    if (card) {
        return { uuid: rewardId, name: card.displayName, kind: "Card", image: card.displayIcon || card.smallArt || card.wideArt || "", priceValue: firstCost(offer.Cost) };
    }
    const buddy = buddies[rewardKey];
    if (buddy) {
        return { uuid: rewardId, name: buddy.displayName, kind: "Buddy", image: buddy.levels[0]?.displayIcon || "", priceValue: firstCost(offer.Cost) };
    }
    return null;
}

function OfferCard({ offer, wished, onToggleWishlist, onOpen }: { offer: StoreOfferCard; wished: boolean; onToggleWishlist: (offer: StoreOfferCard) => void; onOpen: (offer: StoreOfferCard) => void }) {
    const tc = offer.tierColor || "ffffff";
    const categoryClass = offer.weaponName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return (
        <div
            className={`store-card store-card--${categoryClass}${offer.isOwned ? " owned" : ""}${offer.nightMarket ? " night-market-offer" : ""}`}
            style={{
                "--tier-color-border": hexToRgba(tc, 0.25),
                "--tier-color-hover-border": hexToRgba(tc, 0.6),
                "--tier-bg-gradient": `linear-gradient(180deg, ${hexToRgba(tc, 0.06)} 0%, rgba(18,22,30,0.9) 100%)`,
                "--tier-color-raw": hexToRgba(tc, 1),
            } as React.CSSProperties}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(offer)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(offer); }}
        >
            {offer.nightMarket && <div className="night-market-ribbon">Night Market</div>}
            <button
                type="button"
                className={`store-card-wishlist${wished ? " active" : ""}`}
                onClick={(event) => { event.stopPropagation(); onToggleWishlist(offer); }}
                aria-label={wished ? `Remove ${offer.name} from wishlist` : `Add ${offer.name} to wishlist`}
                aria-pressed={wished}
                title={wished ? "Remove from wishlist" : "Add to wishlist"}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.2 13A5.2 5.2 0 0 1 11.6 5.7l.4.4.4-.4A5.2 5.2 0 0 1 19.8 13L12 20.5Z" /></svg>
            </button>
            <div className="store-card-header">
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
                {offer.included ? (
                    <div className="store-card-price-group">
                        <div className="store-card-price-pill included">Included</div>
                        {offer.basePrice != null && offer.basePrice > 0 && (
                            <div className="store-card-base-price">
                                <Image src={VP_ICON} alt="VP" width={12} height={12} unoptimized className="currency-icon" />
                                {offer.basePrice.toLocaleString()}
                            </div>
                        )}
                    </div>
                ) : offer.discount != null && offer.discount > 0 ? (
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

function StoreItemPreviewModal({ offer, wished, vpBalance, onToggleWishlist, onClose }: { offer: StoreOfferCard; wished: boolean; vpBalance: number; onToggleWishlist: (offer: StoreOfferCard) => void; onClose: () => void }) {
    const chromas = offer.skin?.chromas || [];
    const levels = offer.skin?.levels || [];
    const [selectedChromaId, setSelectedChromaId] = useState(chromas[0]?.uuid || "");
    const [selectedLevelId, setSelectedLevelId] = useState(levels[0]?.uuid || "");
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const selectedChroma = chromas.find((chroma) => chroma.uuid === selectedChromaId) || chromas[0];
    const selectedLevel = levels.find((level) => level.uuid === selectedLevelId) || levels[0];
    const selectedChromaIndex = chromas.findIndex((chroma) => chroma.uuid === selectedChroma?.uuid);
    const previewVideoUrl = selectedChromaIndex > 0
        ? selectedChroma?.streamedVideo || selectedLevel?.streamedVideo || ""
        : selectedLevel?.streamedVideo || selectedChroma?.streamedVideo || "";
    const previewImage = selectedChroma?.fullRender || selectedChroma?.displayIcon || offer.image;
    return createPortal(
        <div className="store-preview-backdrop" role="presentation" onMouseDown={onClose}>
            <section className="store-preview-modal" role="dialog" aria-modal="true" aria-label={`${offer.name} preview`} onMouseDown={(event) => event.stopPropagation()}>
                <button type="button" className="store-preview-close" onClick={onClose} aria-label="Close preview">×</button>
                <div className={`store-preview-visual${isVideoPlaying ? " is-video" : ""}`}>
                    {isVideoPlaying && previewVideoUrl ? (
                        <SkinVideoPlayer
                            key={previewVideoUrl}
                            className="store-preview-inline-player"
                            videoUrl={previewVideoUrl}
                            posterUrl={previewImage || undefined}
                        />
                    ) : previewImage ? (
                        <Image src={previewImage} alt={`${offer.name}${selectedChromaIndex > 0 ? ` variant ${selectedChromaIndex + 1}` : ""}`} width={900} height={480} unoptimized />
                    ) : (
                        <div className="store-card-no-image">No preview available</div>
                    )}
                    <div className="store-preview-inspect-rail">
                        {previewVideoUrl && <button type="button" className="store-preview-mode-button" onClick={() => setIsVideoPlaying((playing) => !playing)} aria-label={isVideoPlaying ? "Return to weapon view" : `Play ${offer.name} preview`}><i aria-hidden="true">{isVideoPlaying ? "×" : "▶"}</i>{isVideoPlaying ? "Weapon" : "Preview"}</button>}
                        {levels.length > 1 && <div className="store-preview-level-switcher" aria-label="Upgrade level"><span>Level</span>{levels.map((level, index) => <button type="button" key={level.uuid} className={selectedLevel?.uuid === level.uuid ? "active" : ""} onClick={() => setSelectedLevelId(level.uuid)} aria-label={`Show level ${index + 1}`} aria-pressed={selectedLevel?.uuid === level.uuid}>{index + 1}</button>)}</div>}
                    </div>
                </div>
                <div className="store-preview-details">
                    <h2>{offer.name}</h2>
                    <p>{offer.weaponName}</p>
                    <div className="store-preview-actions">
                        <div className="store-card-price-pill"><Image src={VP_ICON} alt="VP" width={15} height={15} unoptimized />{offer.priceValue.toLocaleString()}</div>
                        <button type="button" className={`store-preview-wishlist${wished ? " active" : ""}`} onClick={() => onToggleWishlist(offer)}>{wished ? "♥ Wishlisted" : "♡ Add to wishlist"}</button>
                    </div>
                    {offer.priceValue > 0 && (
                        <div className={`store-preview-balance${vpBalance >= offer.priceValue ? " can-afford" : " short"}`}>
                            {vpBalance >= offer.priceValue ? `Affordable — ${Math.max(0, vpBalance - offer.priceValue).toLocaleString()} VP remaining` : `${(offer.priceValue - vpBalance).toLocaleString()} VP needed`}
                        </div>
                    )}
                    {chromas.length > 1 && (
                        <div className="store-preview-section">
                            <strong>Variants</strong>
                            <div className="store-preview-chromas">
                                {chromas.map((chroma, index) => (
                                    <button type="button" key={chroma.uuid} className={selectedChroma?.uuid === chroma.uuid ? "active" : ""} onClick={() => setSelectedChromaId(chroma.uuid)} title={index === 0 ? "Default" : `Variant ${index + 1}`} aria-label={index === 0 ? "Show default variant" : `Show variant ${index + 1}`}>
                                        {chroma.fullRender || chroma.displayIcon || chroma.swatch
                                            ? <Image className="full-render" src={chroma.fullRender || chroma.displayIcon || chroma.swatch} alt="" width={112} height={54} unoptimized />
                                            : <span className="store-preview-chroma-fallback" aria-hidden="true">{index + 1}</span>}
                                        {chroma.streamedVideo ? <span className="store-preview-chroma-video" aria-hidden="true">▶</span> : null}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>
        </div>,
        document.body,
    );
}

interface StorePanelsProps {
    refreshKey?: number;
    onConnectAccount?: () => void;
}

export default function StorePanels({ refreshKey = 0, onConnectAccount }: StorePanelsProps) {
    const { weapons, contentTiers, bundles, ownedLevelIDs, sprays, playerCards, activeAccount, isTokenExpired, setIsTokenExpired, allBuddies } = useData();
    const [storefront, setStorefront] = useState<StorefrontResponse | null>(null);
    const [wallet, setWallet] = useState<Record<string, number> | null>(null);
    const [storefrontError, setStorefrontError] = useState("");
    const [isLoadingStorefront, setIsLoadingStorefront] = useState(false);
    const [secondsUntilReset, setSecondsUntilReset] = useState(0);
    const [storeResetAt, setStoreResetAt] = useState(0);
    const [bundleSeconds, setBundleSeconds] = useState<Record<string, number>>({});
    const [nightMarketSeconds, setNightMarketSeconds] = useState(0);
    const [openBundles, setOpenBundles] = useState<Record<string, boolean>>({});
    const [activeBundleIndex, setActiveBundleIndex] = useState(0);
    const [previewOffer, setPreviewOffer] = useState<StoreOfferCard | null>(null);
    const [wishlist, setWishlist] = useState<Record<string, string>>({});

    const didAutoRefreshAtZeroRef = useRef(false);
    const wishlistStorageKey = `vantavault:wishlist:${activeAccount?.puuid || "guest"}`;

    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(wishlistStorageKey);
            setWishlist(saved ? JSON.parse(saved) as Record<string, string> : {});
        } catch {
            setWishlist({});
        }
    }, [wishlistStorageKey]);

    const toggleWishlist = useCallback((offer: StoreOfferCard) => {
        setWishlist(current => {
            const next = { ...current };
            if (next[offer.wishlistId]) delete next[offer.wishlistId];
            else {
                next[offer.wishlistId] = offer.name;
                if (typeof Notification !== "undefined" && Notification.permission === "default") {
                    void Notification.requestPermission();
                }
            }
            window.localStorage.setItem(wishlistStorageKey, JSON.stringify(next));
            return next;
        });
    }, [wishlistStorageKey]);

    const tierMap = useMemo(() =>
        contentTiers.reduce<Record<string, ContentTier>>((acc, t) => {
            acc[t.uuid] = t;
            return acc;
        }, {}),
        [contentTiers]
    );

    const sprayMap = useMemo(() =>
        sprays.reduce<Record<string, SprayAsset>>((acc, spray) => {
            acc[spray.uuid.toLowerCase()] = spray;
            return acc;
        }, {}),
        [sprays]
    );

    const playerCardMap = useMemo(() =>
        playerCards.reduce<Record<string, PlayerCardAsset>>((acc, card) => {
            acc[card.uuid.toLowerCase()] = card;
            return acc;
        }, {}),
        [playerCards]
    );

    const buddyMap = useMemo(() =>
        allBuddies.reduce<Record<string, GunBuddy>>((acc, buddy) => {
            acc[buddy.uuid.toLowerCase()] = buddy;
            for (const level of buddy.levels) {
                acc[level.uuid.toLowerCase()] = buddy;
            }
            return acc;
        }, {}),
        [allBuddies]
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
                const dailyRemaining = sf.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 0;
                setSecondsUntilReset(dailyRemaining);
                setStoreResetAt(Date.now() + dailyRemaining * 1000);
                didAutoRefreshAtZeroRef.current = false;
                const rawBundles = sf.FeaturedBundle?.Bundles?.length
                    ? sf.FeaturedBundle.Bundles
                    : sf.FeaturedBundle?.Bundle ? [sf.FeaturedBundle.Bundle] : [];
                setBundleSeconds(Object.fromEntries(rawBundles.map((bundle, index) => {
                    const aliases = bundle as typeof bundle & { ID?: string; id?: string; dataAssetID?: string };
                    const key = aliases.DataAssetID || aliases.ID || aliases.id || aliases.dataAssetID || `bundle-${index}`;
                    return [key, bundle.DurationRemainingInSeconds || 0];
                })));
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
        refreshStorefront();
    }, [refreshKey, refreshStorefront]);

    useEffect(() => {
        const t = window.setInterval(() => {
            setSecondsUntilReset(s => Math.max(0, s - 1));
            setBundleSeconds(current => Object.fromEntries(
                Object.entries(current).map(([key, seconds]) => [key, Math.max(0, seconds - 1)])
            ));
            setNightMarketSeconds(s => Math.max(0, s - 1));
        }, 1000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        if (secondsUntilReset > 0) {
            didAutoRefreshAtZeroRef.current = false;
            return;
        }
        if (!activeAccount || isLoadingStorefront || !storefront || didAutoRefreshAtZeroRef.current) return;
        didAutoRefreshAtZeroRef.current = true;
        refreshStorefront();
    }, [activeAccount, isLoadingStorefront, refreshStorefront, secondsUntilReset, storefront]);

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
            .filter((o): o is StoreOfferCard => o !== null)
            .map(o => ({ ...o, nightMarket: true })),
        [storefront, weapons, tierMap, ownedLevelIDs]
    );

    const accessories = useMemo(() =>
        (storefront?.AccessoryStore?.AccessoryStoreOffers ?? [])
            .map((entry: AccessoryStoreOffer) =>
                accessoryFromOffer(entry.Offer, sprayMap, playerCardMap, buddyMap))
            .filter((item): item is AccessoryOfferCard => item !== null),
        [storefront, sprayMap, playerCardMap, buddyMap]
    );

    const resolvedBundles = useMemo(() => {
        const rawBundles = storefront?.FeaturedBundle?.Bundles?.length
            ? storefront.FeaturedBundle.Bundles
            : storefront?.FeaturedBundle?.Bundle ? [storefront.FeaturedBundle.Bundle] : [];
        return rawBundles.map((rawBundle, index) => {
            if (!rawBundle.Items?.length) return null;
            const aliases = rawBundle as typeof rawBundle & { ID?: string; id?: string; dataAssetID?: string };
            const rawId = aliases.DataAssetID || aliases.ID || aliases.id || aliases.dataAssetID;
            const key = rawId || `bundle-${index}`;
            const assetId = rawId?.toLowerCase();
            const meta: BundleInfo | undefined = assetId ? bundles.find(bundle => bundle.uuid.toLowerCase() === assetId) : undefined;
            const items = rawBundle.Items.map((item: StorefrontBundleItem) => {
                const priceValue = item.DiscountedPrice ?? item.BasePrice;
                const card = findBundleOffer(item.Item.ItemID, weapons, tierMap, priceValue, ownedLevelIDs, sprayMap, playerCardMap, buddyMap);
                return {
                    ...(card ?? {
                        uuid: item.Item.ItemID,
                        wishlistId: item.Item.ItemID.toLowerCase(),
                        name: "Bundle Item",
                        weaponName: "Cosmetic",
                        image: "",
                        tierName: "Bundle",
                        isOwned: false,
                    }),
                    uuid: `${key}-${item.Item.ItemID}`,
                    wishlistId: card?.wishlistId || item.Item.ItemID.toLowerCase(),
                    priceValue,
                    basePrice: item.BasePrice,
                    included: priceValue === 0 && item.BasePrice > 0,
                } satisfies StoreOfferCard;
            });
            const totalBase = rawBundle.Items.reduce((sum, item) => sum + item.BasePrice, 0);
            const totalDisc = rawBundle.Items.reduce((sum, item) => sum + (item.DiscountedPrice ?? item.BasePrice), 0);
            return {
                key,
                name: meta?.displayName || `Featured Bundle${rawBundles.length > 1 ? ` ${index + 1}` : ""}`,
                description: meta?.description ?? "",
                banner: meta?.displayIcon2 || meta?.displayIcon || "",
                items,
                totalBase,
                totalDisc,
            };
        }).filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null);
    }, [storefront, weapons, tierMap, ownedLevelIDs, bundles, sprayMap, playerCardMap, buddyMap]);

    useEffect(() => {
        setActiveBundleIndex(current => resolvedBundles.length ? Math.min(current, resolvedBundles.length - 1) : 0);
    }, [resolvedBundles.length]);

    useEffect(() => {
        if (resolvedBundles.length < 2) return;
        const timer = window.setTimeout(() => {
            setOpenBundles({});
            setActiveBundleIndex((activeBundleIndex + 1) % resolvedBundles.length);
        }, BUNDLE_ROTATION_MS);
        return () => window.clearTimeout(timer);
    }, [activeBundleIndex, resolvedBundles.length]);

    const activeBundle = resolvedBundles[activeBundleIndex] ?? null;
    const selectBundle = useCallback((index: number) => {
        if (!resolvedBundles.length) return;
        setOpenBundles({});
        setActiveBundleIndex((index + resolvedBundles.length) % resolvedBundles.length);
    }, [resolvedBundles.length]);

    useEffect(() => {
        if (!storefront || !Object.keys(wishlist).length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const visibleOffers = [...dailyOffers, ...nightMarket];
        const matches = visibleOffers.filter(offer => wishlist[offer.wishlistId]);
        if (!matches.length) return;
        const signature = matches.map(offer => offer.wishlistId).sort().join(",");
        const noticeKey = `${wishlistStorageKey}:notified:${signature}:${Math.round(storeResetAt / 60_000)}`;
        if (window.sessionStorage.getItem(noticeKey)) return;
        window.sessionStorage.setItem(noticeKey, "1");
        new Notification("Wishlist item available", { body: matches.map(offer => offer.name).join(", ") });
    }, [dailyOffers, nightMarket, storeResetAt, storefront, wishlist, wishlistStorageKey]);

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
                    <h2 className="mb-0 tactical-title">Store</h2>
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
                <div className="alert alert-danger p-4 mb-4 text-center rounded-3 bg-opacity-10 border-danger d-flex flex-column align-items-center justify-content-center gap-3">
                    <div className="d-flex flex-column align-items-center">
                        <h4 className="mb-2 text-danger">⚠ Store Access Needs Renewal</h4>
                        <p className="text-muted small max-w-lg mb-0">
                            The one-hour access token for <strong>{activeAccount.gameName}#{activeAccount.tagLine}</strong> expired
                            and could not be renewed from its stored Riot session. Reconnect only this account to restore store access.
                        </p>
                    </div>
                    {onConnectAccount && (
                        <button type="button" className="btn-tactical btn-tactical-danger" onClick={onConnectAccount}>
                            Renew Account
                        </button>
                    )}
                </div>
            )}

            {storefrontError && !isTokenExpired && (
                <div className="alert alert-warning mb-4">{readableStorefrontError(storefrontError)}</div>
            )}

            <div className="mb-5">
                {isLoadingStorefront && !storefront ? (
                    <div className="text-center py-5">
                        <div className="spinner-border text-danger" style={{ width: "2.5rem", height: "2.5rem" }} />
                    </div>
                ) : dailyOffers.length > 0 ? (
                    <div className="store-grid">
                        {dailyOffers.map(o => <OfferCard key={o.uuid} offer={o} wished={Boolean(wishlist[o.wishlistId])} onToggleWishlist={toggleWishlist} onOpen={setPreviewOffer} />)}
                    </div>
                ) : !isLoadingStorefront && !isTokenExpired && !storefrontError && (
                    <p className="text-muted small">No daily offers found. Make sure you are logged in.</p>
                )}
            </div>

            {activeBundle && !isTokenExpired && (
                <section
                    className="storefront-bundle-carousel"
                    aria-label="Featured bundles"
                >
                {(() => {
                    const bundle = activeBundle;
                    const bundleOpen = Boolean(openBundles[bundle.key]);
                    return <div className="storefront-bundle-card" key={bundle.key}>
                    <button type="button" className="storefront-bundle-toggle" onClick={() => setOpenBundles(current => ({ ...current, [bundle.key]: !current[bundle.key] }))}>
                        {bundle.banner && (
                            <div className="storefront-bundle-banner">
                                <Image src={bundle.banner} alt={bundle.name} fill unoptimized style={{ objectFit: "contain", objectPosition: "center" }} />
                                <div className="storefront-bundle-banner-overlay" />
                            </div>
                        )}
                        <div className="storefront-bundle-header-content">
                            <div className="storefront-bundle-left">
                                <div className="storefront-bundle-label">FEATURED BUNDLE</div>
                                <div className="storefront-bundle-name">{bundle.name}</div>
                                {bundle.description && (
                                    <div className="storefront-bundle-description">{bundle.description}</div>
                                )}
                                {(bundleSeconds[bundle.key] ?? 0) > 0 && (
                                    <div className="storefront-bundle-timer">Ends in {formatDuration(bundleSeconds[bundle.key])}</div>
                                )}
                            </div>
                            <div className="storefront-bundle-right">
                                <div className="storefront-bundle-price">
                                    <Image src={VP_ICON} alt="VP" width={18} height={18} unoptimized className="currency-icon" />
                                    {bundle.totalDisc.toLocaleString()}
                                </div>
                                {bundle.totalBase > bundle.totalDisc && (
                                    <div className="storefront-bundle-orig-price">{bundle.totalBase.toLocaleString()}</div>
                                )}
                                <div className={`storefront-bundle-chevron${bundleOpen ? " open" : ""}`}>⌄</div>
                            </div>
                        </div>
                    </button>
                    {bundleOpen && (
                        <div className="storefront-bundle-items-panel">
                            <div className="store-bundle-row">
                                {bundle.items.map(o => <OfferCard key={o.uuid} offer={o} wished={Boolean(wishlist[o.wishlistId])} onToggleWishlist={toggleWishlist} onOpen={setPreviewOffer} />)}
                            </div>
                        </div>
                    )}
                </div>;
                })()}
                {resolvedBundles.length > 1 && (
                    <div className="storefront-carousel-controls">
                        <button type="button" className="storefront-carousel-arrow" onClick={() => selectBundle(activeBundleIndex - 1)} aria-label="Previous bundle">
                            <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>
                        </button>
                        <div className="storefront-carousel-dots" role="tablist" aria-label="Choose featured bundle">
                            {resolvedBundles.map((bundle, index) => (
                                <button type="button" key={bundle.key} className={`storefront-carousel-dot${index === activeBundleIndex ? " active" : ""}`} onClick={() => selectBundle(index)} aria-label={`Show ${bundle.name}`} aria-selected={index === activeBundleIndex} role="tab"><span /></button>
                            ))}
                        </div>
                        <span className="storefront-carousel-count">{activeBundleIndex + 1} / {resolvedBundles.length}</span>
                        <button type="button" className="storefront-carousel-arrow" onClick={() => selectBundle(activeBundleIndex + 1)} aria-label="Next bundle">
                            <svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                    </div>
                )}
                </section>
            )}

            {nightMarket.length > 0 && !isTokenExpired && (
                <div className="mb-5 night-market-container p-3">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <h3 className="night-market-title mb-0">Night Market</h3>
                        </div>
                        {nightMarketSeconds > 0 && (
                            <span className="night-market-timer">{nightMarket.length} offers active — ends in {formatDuration(nightMarketSeconds)}</span>
                        )}
                    </div>
                    <div className="store-grid">
                        {nightMarket.map(o => <OfferCard key={o.uuid} offer={o} wished={Boolean(wishlist[o.wishlistId])} onToggleWishlist={toggleWishlist} onOpen={setPreviewOffer} />)}
                    </div>
                </div>
            )}

            {accessories.length > 0 && !isTokenExpired && (
                <div className="mb-5">
                    <div className="section-row">
                        <div>
                            <h3 className="mb-0 section-title">Accessories</h3>
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
            {previewOffer && typeof document !== "undefined" && (
                <StoreItemPreviewModal
                    key={previewOffer.uuid}
                    offer={previewOffer}
                    wished={Boolean(wishlist[previewOffer.wishlistId])}
                    vpBalance={vpBalance}
                    onToggleWishlist={toggleWishlist}
                    onClose={() => setPreviewOffer(null)}
                />
            )}
        </div>
    );
}
