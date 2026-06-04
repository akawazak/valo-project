"use client";

type AppSidebarProps = {
    activeTab: 'skins' | 'store';
    onTabChange: (tab: 'skins' | 'store') => void;
};

const NAV = [
    { id: 'skins' as const, label: 'Loadouts', icon: '⬡' },
    { id: 'store' as const, label: 'Storefront', icon: '◈' },
];

export default function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
    return (
        <nav className="app-sidebar" aria-label="Main navigation">
            {NAV.map(item => (
                <button
                    key={item.id}
                    type="button"
                    className={`app-sidebar-item${activeTab === item.id ? ' is-active' : ''}`}
                    onClick={() => onTabChange(item.id)}
                    title={item.label}
                >
                    <span className="app-sidebar-icon" aria-hidden>{item.icon}</span>
                    <span className="app-sidebar-label">{item.label}</span>
                </button>
            ))}
        </nav>
    );
}
