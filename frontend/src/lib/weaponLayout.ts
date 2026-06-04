import { Weapon } from '@/lib/types';

export type LoadoutSection = {
    label: string;
    categories: string[];
};

export type LoadoutColumn = {
    sections: LoadoutSection[];
};

/** Valorant in-game collection screen column layout. */
export const LOADOUT_COLUMNS: LoadoutColumn[] = [
    {
        sections: [{ label: 'SIDEARMS', categories: ['EEquippableCategory::Sidearm'] }],
    },
    {
        sections: [
            { label: 'SMGS', categories: ['EEquippableCategory::SMG'] },
            { label: 'SHOTGUNS', categories: ['EEquippableCategory::Shotgun'] },
        ],
    },
    {
        sections: [
            { label: 'RIFLES', categories: ['EEquippableCategory::Rifle'] },
            { label: 'MELEE', categories: ['EEquippableCategory::Melee'] },
        ],
    },
    {
        sections: [
            { label: 'SNIPER RIFLES', categories: ['EEquippableCategory::Sniper'] },
            { label: 'MACHINE GUNS', categories: ['EEquippableCategory::Heavy'] },
        ],
    },
];

const WEAPON_SORT_ORDER: Record<string, string[]> = {
    'EEquippableCategory::Sidearm': ['Classic', 'Shorty', 'Frenzy', 'Ghost', 'Bandit', 'Sheriff'],
    'EEquippableCategory::SMG': ['Stinger', 'Spectre'],
    'EEquippableCategory::Shotgun': ['Bucky', 'Judge'],
    'EEquippableCategory::Rifle': ['Bulldog', 'Guardian', 'Phantom', 'Vandal'],
    'EEquippableCategory::Sniper': ['Marshal', 'Outlaw', 'Operator'],
    'EEquippableCategory::Heavy': ['Ares', 'Odin'],
    'EEquippableCategory::Melee': ['Melee'],
};

function sortWeaponsInCategory(weapons: Weapon[], category: string): Weapon[] {
    const order = WEAPON_SORT_ORDER[category];
    if (!order) return weapons;

    const rank = new Map(order.map((name, index) => [name, index]));
    return [...weapons].sort((a, b) => {
        const ai = rank.get(a.displayName) ?? 999;
        const bi = rank.get(b.displayName) ?? 999;
        if (ai !== bi) return ai - bi;
        return a.displayName.localeCompare(b.displayName);
    });
}

export function buildValorantLoadoutColumns(allWeapons: Weapon[]) {
    const byCategory = new Map<string, Weapon[]>();

    for (const weapon of allWeapons) {
        const list = byCategory.get(weapon.category) ?? [];
        list.push(weapon);
        byCategory.set(weapon.category, list);
    }

    for (const [category, list] of byCategory.entries()) {
        byCategory.set(category, sortWeaponsInCategory(list, category));
    }

    return LOADOUT_COLUMNS.map((column) => ({
        sections: column.sections.map((section) => ({
            label: section.label,
            weapons: section.categories.flatMap((category) => byCategory.get(category) ?? []),
        })),
    }));
}
