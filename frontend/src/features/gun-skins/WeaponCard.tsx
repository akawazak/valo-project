import { useData } from '@/context/DataContext';
import { LoadoutItemV1, Weapon } from '@/lib/types';
import { CONTENT_TIERS, TIER_COLORS } from "@/lib/contentTiers";

type WeaponCardProps = {
    weapon: Weapon;
    onClick: () => void;
    onHandleResetSkinClick: () => void;
    selectedItem: LoadoutItemV1;
    parentItem: LoadoutItemV1 | undefined;
    isOverride?: boolean;
    selectionLabel?: string;
};


export default function WeaponCard({
    weapon,
    onClick,
    onHandleResetSkinClick,
    selectedItem,
    parentItem,
    isOverride = false,
    selectionLabel = "Selected",
}: WeaponCardProps) {
    const { ownedBuddies } = useData();

    let item: LoadoutItemV1;
    if (selectedItem) {
        item = selectedItem;
    } else if (parentItem) {
        item = parentItem;
    } else {
        const defaultSkin = weapon.skins.find(w => w.uuid === weapon.defaultSkinUuid);
        if (defaultSkin) {
            item = {
                skinId: defaultSkin.uuid,
                chromaId: defaultSkin.chromas[0]?.uuid || "",
                skinLevelId: defaultSkin.levels[0]?.uuid || "",
            };
        } else {
            item = { skinId: "", chromaId: "", skinLevelId: "" };
        }
    }

    if (!item) {
        const defaultSkin = weapon.skins.find(w => w.uuid === weapon.defaultSkinUuid)!;
        item = { skinId: defaultSkin.uuid, chromaId: defaultSkin.chromas[0].uuid, skinLevelId: defaultSkin.levels[0].uuid };
    }

    const skin = weapon.skins.find(w => w.uuid === item.skinId);
    const safeSkin = skin || weapon.skins.find(w => w.uuid === weapon.defaultSkinUuid) || weapon.skins[0];
    if (!safeSkin) {
        return null;
    }
    const firstChroma = safeSkin.chromas?.[0] || { uuid: "", displayName: "", fullRender: "" };
    const firstLevel = safeSkin.levels?.[0] || { uuid: "", displayName: "", displayIcon: "" };
    const chroma = safeSkin.chromas?.find(c => c.uuid === item.chromaId) || firstChroma;
    const level = safeSkin.levels?.find(l => l.uuid === item.skinLevelId) || firstLevel;

    const displayIcon = chroma?.fullRender || safeSkin.displayIcon || weapon.displayIcon || "";
    let displayName = chroma?.displayName || level?.displayName || safeSkin.displayName || weapon.displayName;
    if (safeSkin.chromas && safeSkin.chromas.indexOf(chroma) === 0) {
        displayName = level?.displayName || safeSkin.displayName || weapon.displayName;
    }

    const tierColor = TIER_COLORS[safeSkin.contentTierUuid] || "#6b7280";
    const edition = CONTENT_TIERS[safeSkin.contentTierUuid];

    const buddy = ownedBuddies.find(b => b.levels[0]?.uuid === item.charmLevelID);

    const handleResetSkinClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onHandleResetSkinClick();
    };

    const isEquipped = !!selectedItem;
    const wName = weapon.displayName.toLowerCase();

    // Determine specific card class
    let cardClass = "valorant-weapon-card";
    if (["classic", "shorty", "frenzy", "ghost", "sheriff"].includes(wName)) cardClass += " valorant-weapon-card--sidearm";
    if (["stinger", "spectre"].includes(wName)) cardClass += " valorant-weapon-card--smg";
    if (["bucky", "judge"].includes(wName)) cardClass += " valorant-weapon-card--shotgun";
    if (["phantom", "vandal", "guardian", "bulldog"].includes(wName)) cardClass += " valorant-weapon-card--rifle";
    if (["operator", "outlaw", "marshal"].includes(wName)) cardClass += " valorant-weapon-card--sniper";
    if (["odin", "ares"].includes(wName)) cardClass += " valorant-weapon-card--heavy";
    if (wName === "melee" || wName === "tactical knife") cardClass += " valorant-weapon-card--melee";
    if (isEquipped) cardClass += " is-active";
    if (edition) cardClass += " has-edition";

    const cardStyle = { cursor: 'pointer', '--tier-color': tierColor } as React.CSSProperties;

    return (
        <div className={cardClass} title={displayName} style={cardStyle}>
            <button type="button" className="valorant-weapon-card-body" onClick={onClick} aria-label={`Customize ${weapon.displayName}: ${displayName}`}>
                {/* Content Tier Bar */}
                <div className="valorant-weapon-card-tier" style={{ backgroundColor: tierColor }} />
                {edition && <img className="valorant-weapon-card-edition" src={edition.icon} alt={edition.name} title={`${edition.name} Edition`} />}

                <div className="valorant-weapon-card-media">
                    {displayIcon ? (
                        <img
                            src={displayIcon}
                            alt={displayName}
                            className="valorant-weapon-card-image"
                        />
                    ) : (
                        <div className="valorant-weapon-card-image" style={{ width: '60%', height: '60%', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }} />
                    )}
                </div>

                <div className="valorant-weapon-card-footer">
                    <div>
                        <div className="valorant-weapon-card-name">{weapon.displayName}</div>
                        <div className="valorant-weapon-card-skin">{displayName}</div>
                    </div>
                </div>

            </button>
                <div className="valorant-weapon-card-actions">
                    {/* Buddy Display Bubble */}
                    {weapon.category !== 'EEquippableCategory::Melee' && buddy && (
                        <div
                            className="weapon-card-buddy-btn"
                            title={`Buddy: ${buddy.displayName}`}
                            style={{ pointerEvents: 'none' }}
                        >
                            <img src={buddy.levels[0].displayIcon} alt={buddy.displayName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </div>
                    )}

                    {/* Equipped indicator badge */}
                    {isEquipped && (
                        <div className="weapon-card-equipped-badge" aria-label={selectionLabel} title={selectionLabel} style={{ pointerEvents: 'none' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                    )}

                    {/* Reset custom skin option */}
                    {isOverride && parentItem && (
                        <button type="button" className="weapon-card-reset-btn" onClick={handleResetSkinClick} aria-label={`Reset ${weapon.displayName} to parent preset`} title="Reset to parent preset loadout">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                                <path d="M3 3v5h5"></path>
                            </svg>
                        </button>
                    )}
                </div>
        </div>
    );
}
