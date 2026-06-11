"use client";

import { useState } from 'react';
import { useData } from '@/context/DataContext';
import { Weapon, LoadoutItemV1, Skin } from '@/lib/types';
import WeaponCard from './WeaponCard';
import SkinList from './SkinList';
import LevelAndChromaSelector from './LevelAndChromaSelector';
import GunBuddySelectionModal from './GunBuddySelectionModal';

type WeaponGridProps = {
    onSkinSelectAction: (weaponId: string, skinId: string, levelId: string, chromaId: string) => void;
    onBuddySelectAction: (weaponId: string, charmID: string, charmLevelID: string) => void;
    onSkinResetAction: (weaponId: string) => void;
    currentLoadout: Record<string, LoadoutItemV1>;
    parent: Record<string, LoadoutItemV1> | undefined;
}

export default function WeaponGrid({ onSkinSelectAction, onBuddySelectAction, onSkinResetAction, currentLoadout, parent }: WeaponGridProps) {
    const { weapons, ownedLevelIDs, ownedChromaIDs, loading } = useData();
    const [selectedWeapon, setSelectedWeapon] = useState<Weapon | null>(null);
    const [showSkinListModal, setShowSkinListModal] = useState(false);
    const [selectedSkin, setSelectedSkin] = useState<Skin | null>(null);
    const [showLevelAndChromaModal, setShowLevelAndChromaModal] = useState(false);
    const [showBuddyModal, setShowBuddyModal] = useState(false);
    const [selectedWeaponForBuddy, setSelectedWeaponForBuddy] = useState<Weapon | null>(null);

    const handleWeaponClick = (weapon: Weapon) => {
        setSelectedWeapon(weapon);
        setShowSkinListModal(true);
    };



    const handleResetSkinClick = (weapon: Weapon) => {
        onSkinResetAction(weapon.uuid);
    }

    const handleCloseBuddyModal = () => {
        setShowBuddyModal(false);
        setSelectedWeaponForBuddy(null);
    };

    const handleBuddySelect = (charmID: string, charmLevelID: string) => {
        if (selectedWeaponForBuddy) {
            onBuddySelectAction(selectedWeaponForBuddy.uuid, charmID, charmLevelID);
        }
        handleCloseBuddyModal();
    };

    const handleCloseSkinListModal = () => {
        setShowSkinListModal(false);
    };

    const handleSkinSelectInList = (skin: Skin) => {
        setSelectedSkin(skin);
        setShowSkinListModal(false);
        setShowLevelAndChromaModal(true);
    };

    const handleCloseLevelAndChromaModal = () => {
        setShowLevelAndChromaModal(false);
    };

    const handleLevelAndChromaSelect = (skinId: string, levelId: string, chromaId: string) => {
        onSkinSelectAction(selectedWeapon!.uuid, skinId, levelId, chromaId);
        setShowLevelAndChromaModal(false);
    };

    if (loading) {
        return <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'center', padding: '2rem' }}>Loading game data…</div>;
    }

    return (
        <div className="weapon-grid-wrap">
            <div className="weapon-grid">
                {weapons.map((weapon) => (
                    <WeaponCard
                        key={weapon.uuid}
                        weapon={weapon}
                        onClick={() => handleWeaponClick(weapon)}
                        onHandleResetSkinClick={() => handleResetSkinClick(weapon)}
                        selectedItem={currentLoadout[weapon.uuid]}
                        parentItem={parent ? parent[weapon.uuid] : undefined}
                    />
                ))}
            </div>

            {selectedWeapon && (
                <SkinList
                    weapon={selectedWeapon}
                    ownedLevelIDs={ownedLevelIDs}
                    ownedChromaIDs={ownedChromaIDs}
                    onSkinSelect={handleSkinSelectInList}
                    show={showSkinListModal}
                    onClose={handleCloseSkinListModal}
                />
            )}

            {selectedSkin && (
                <LevelAndChromaSelector
                    skin={selectedSkin}
                    ownedLevelIDs={ownedLevelIDs}
                    ownedChromaIDs={ownedChromaIDs}
                    onSelect={handleLevelAndChromaSelect}
                    show={showLevelAndChromaModal}
                    onClose={handleCloseLevelAndChromaModal}
                />
            )}

            {showBuddyModal && selectedWeaponForBuddy && (
                <GunBuddySelectionModal
                    onSelect={handleBuddySelect}
                    onClose={handleCloseBuddyModal}
                    weaponName={selectedWeaponForBuddy.displayName}
                    currentLoadout={currentLoadout}
                />
            )}
        </div>
    );
}