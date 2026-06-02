import Image from 'next/image';
import { useData } from '@/context/DataContext';
import { LoadoutItemV1, Weapon } from '@/lib/types';

type WeaponCardProps = {
    weapon: Weapon;
    onClick: () => void;
    onEditClick: () => void;
    onBuddyEditClick: () => void;
    onHandleResetSkinClick: () => void;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    selectedItem: LoadoutItemV1;
    parentItem: LoadoutItemV1 | undefined;
};

export default function WeaponCard({ weapon, onClick, onEditClick, onBuddyEditClick, onHandleResetSkinClick, ownedLevelIDs, ownedChromaIDs, selectedItem, parentItem }: WeaponCardProps) {
    let item: LoadoutItemV1;
    if (selectedItem) {
        item = selectedItem;
    } else {
        item = parentItem!;
    }

    if (!item) {
        const defaultSkin = weapon.skins.find(w => w.uuid === weapon.defaultSkinUuid)!;
        item = { skinId: defaultSkin.uuid, chromaId: defaultSkin.chromas[0].uuid, skinLevelId: defaultSkin.levels[0].uuid };
    }

    const skin = weapon.skins.find(w => w.uuid === item.skinId)!;
    const isDefaultSkin = skin.uuid === weapon.defaultSkinUuid;
    const ownedLevels = skin.levels.filter(level => ownedLevelIDs.includes(level.uuid));
    const ownedChromas = skin.chromas.filter(chroma => ownedChromaIDs.includes(chroma.uuid));
    const canEdit = !isDefaultSkin && !(ownedLevels.length === 1 && ownedChromas.length === 0);

    const chroma = skin.chromas.find(c => c.uuid === item.chromaId)!;
    const level = skin.levels.find(l => l.uuid === item.skinLevelId)!;

    const displayIcon = chroma.fullRender;
    let displayName = chroma.displayName || level.displayName || skin.displayName;
    if (skin.chromas.indexOf(chroma) === 0) {
        displayName = level.displayName || skin.displayName;
    }

    const { ownedBuddies } = useData();
    const buddy = ownedBuddies.find(b => b.levels[0].uuid === item.charmLevelID);

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onEditClick();
    };
    const handleBuddyEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onBuddyEditClick();
    };
    const handleResetSkinClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onHandleResetSkinClick();
    };

    return (
        <div
            className={`weapon-card card-hover${selectedItem ? '' : ' dimmed'}`}
            onClick={onClick}
            title={displayName}
            style={{ cursor: 'pointer' }}
        >
            <div className="weapon-card-body">
                {weapon.category !== 'EEquippableCategory::Melee' && (
                    <button
                        className="weapon-card-buddy-btn"
                        onClick={handleBuddyEditClick}
                        title="Select Buddy"
                    >
                        {buddy ? (
                            <Image src={buddy.levels[0].displayIcon} alt={buddy.displayName} width={22} height={22} style={{ objectFit: 'contain' }} unoptimized />
                        ) : (
                            '🔗'
                        )}
                    </button>
                )}
                {selectedItem && parentItem && (
                    <button
                        className="weapon-card-reset-btn"
                        onClick={handleResetSkinClick}
                        title="Reset to parent"
                    >
                        ⟲
                    </button>
                )}
                <Image
                    src={displayIcon}
                    alt={displayName}
                    width={100}
                    height={70}
                    style={{ objectFit: 'contain', maxWidth: '100%', height: 'auto' }}
                    unoptimized
                />
            </div>
            <div className="weapon-card-footer">
                <span className="weapon-card-name">{displayName}</span>
                {canEdit && (
                    <button className="weapon-card-edit-btn" onClick={handleEditClick} title="Edit">
                        Edit
                    </button>
                )}
            </div>
        </div>
    );
}
