"use client";

import WeaponGrid from '@/features/gun-skins/WeaponGrid';
import { LoadoutItemV1 } from '@/lib/types';

type PresetInventoryBuilderProps = {
    currentLoadout: Record<string, LoadoutItemV1>;
    parentLoadout?: Record<string, LoadoutItemV1>;
    onSkinSelect: (weaponId: string, skinId: string, levelId: string, chromaId: string) => void;
    onBuddySelect: (weaponId: string, charmID: string, charmLevelID: string) => void;
    onSkinReset: (weaponId: string) => void;
};

export default function PresetInventoryBuilder({
    currentLoadout,
    parentLoadout,
    onSkinSelect,
    onBuddySelect,
    onSkinReset,
}: PresetInventoryBuilderProps) {
    return (
        <div className="inventory-builder inventory-builder--weapons-only">
            <WeaponGrid
                onSkinSelectAction={onSkinSelect}
                onBuddySelectAction={onBuddySelect}
                currentLoadout={currentLoadout}
                onSkinResetAction={onSkinReset}
                parent={parentLoadout}
            />
        </div>
    );
}
