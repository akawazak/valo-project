export interface Agent {
    uuid: string;
    displayName: string;
    displayIcon: string;
    isBaseContent: boolean;
}

export interface RiotAccount {
    puuid: string;
    accessToken: string;
    entitlementsToken: string;
    expiresAt?: number;
    region: string;
    gameName: string;
    tagLine: string;
}

export interface IdentityV1 {
    playerCardId: string;
    playerTitleId: string;
}

export interface SpraySlot {
    equipSlotId: string;
    sprayId: string;
}

export interface Preset {
    uuid: string;
    parentUuid?: string;
    disabled?: boolean;
    name: string;
    loadout: Record<string, LoadoutItemV1>; // {[weaponId]: LoadoutItem}
    agents?: string[];
    identity?: IdentityV1;
    sprays?: SpraySlot[];
}

export function isVariant(p: Preset | undefined | null) {
    return p?.parentUuid ? true : false;
}

export interface LoadoutItemV1 {
    skinId: string;
    skinLevelId: string;
    chromaId: string;
    charmID?: string;
    charmLevelID?: string;
}

export interface Weapon {
    uuid: string;
    defaultSkinUuid: string;
    displayName: string;
    displayIcon: string;
    category: string;
    skins: Skin[];
}

export interface GunBuddy {
    uuid: string;
    displayName: string;
    amount: number;
    levels: GunBuddyLevel[];
}

export interface Skin {
    uuid: string;
    displayName: string;
    displayIcon: string;
    contentTierUuid: string;
    levels: SkinLevel[];
    chromas: Chroma[];
}

export interface SkinLevel {
    uuid: string;
    displayName: string;
    displayIcon: string;
}

export interface GunBuddyLevel {
    uuid: string;
    displayIcon: string;
}

export interface Chroma {
    uuid: string;
    displayName: string;
    displayIcon: string;
    fullRender: string;
    swatch: string;
}

export interface OwnedSkinsResponse {
    LevelIds: string[];
    ChromaIds: string[];
}

export interface OwnedBuddy {
    LevelId: string
    Amount: number
}

export interface OwnedGunBuddiesResponse {
    Buddies: OwnedBuddy[];
}

export interface OwnedAgentsResponse {
    AgentIds: string[];
}

export interface ContentTier {
    uuid: string;
    displayName: string;
    rank: number;
    displayIcon: string;
    highlightColor?: string;
}

export interface StorefrontReward {
    ItemTypeID: string;
    ItemID: string;
    Quantity: number;
}

export interface StorefrontOffer {
    OfferID: string;
    IsDirectPurchase?: boolean;
    Cost?: Record<string, number>;
    Rewards?: StorefrontReward[];
}

export interface AccessoryStoreOffer {
    Offer: StorefrontOffer;
    ContractID?: string;
}

export interface StorefrontBonusOffer {
    BonusOfferID?: string;
    Offer: StorefrontOffer;
    DiscountPercent?: number;
    DiscountCosts?: Record<string, number>;
}

export interface StorefrontBundleItem {
    Item: StorefrontReward;
    BasePrice: number;
    DiscountedPrice?: number;
}

export interface StorefrontFeaturedBundle {
    Bundle?: { Items?: StorefrontBundleItem[]; DataAssetID?: string; DurationRemainingInSeconds?: number };
    Bundles?: Array<{ Items?: StorefrontBundleItem[]; DurationRemainingInSeconds?: number; DataAssetID?: string }>;
}

export interface BundleInfo {
    uuid: string;
    displayName: string;
    displayIcon: string;
    displayIcon2: string;
    description: string;
}

export interface StorefrontResponse {
    SkinsPanelLayout?: {
        SingleItemOffers?: string[];
        SingleItemStoreOffers?: StorefrontOffer[];
        SingleItemOffersRemainingDurationInSeconds?: number;
    };
    BonusStore?: {
        BonusStoreOffers?: StorefrontBonusOffer[];
        BonusStoreRemainingDurationInSeconds?: number;
    };
    FeaturedBundle?: StorefrontFeaturedBundle;
    AccessoryStore?: {
        AccessoryStoreOffers?: AccessoryStoreOffer[];
        StorefrontID?: string;
    };
}

export interface SprayAsset {
    uuid: string;
    displayName: string;
    displayIcon: string;
    fullIcon?: string;
    fullTransparentIcon?: string;
}

export interface PlayerCardAsset {
    uuid: string;
    displayName: string;
    displayIcon: string;
    smallArt: string;
    wideArt: string;
    largeArt: string;
}

export interface PlayerTitleAsset {
    uuid: string;
    displayName: string;
    titleText: string;
    isHiddenIfNotOwned: boolean;
}
