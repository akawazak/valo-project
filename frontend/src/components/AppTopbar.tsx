"use client";

import Image from 'next/image';
import { RiotAccount } from '@/context/DataContext';

interface AppTopbarProps {
    activeTab: 'store' | 'skins';
    onTabChange: (tab: 'store' | 'skins') => void;
    autoSelectAgent: boolean;
    onToggleAutoAgent: (v: boolean) => void;
    accounts: RiotAccount[];
    activeAccount: RiotAccount | null;
    onSwitchAccount: (acc: RiotAccount) => void;
    onRequestDeleteAccount: (puuid: string) => void;
    onAddAccount: () => void;
    theme: string;
    onToggleTheme: () => void;
}

export default function AppTopbar({
    activeTab,
    onTabChange,
    autoSelectAgent,
    onToggleAutoAgent,
    accounts,
    activeAccount,
    onSwitchAccount,
    onRequestDeleteAccount,
    onAddAccount,
    theme,
    onToggleTheme,
}: AppTopbarProps) {
    return (
        <header className="app-topbar">
            <div className="topbar-inner">
                <button type="button" className="topbar-brand" onClick={() => onTabChange('store')}>
                    <span className="brand-mark">V</span>
                    <span>VALO<span>VAULT</span></span>
                </button>

                <nav className="topbar-nav" aria-label="Primary">
                    <button
                        type="button"
                        className={activeTab === 'store' ? 'active' : ''}
                        onClick={() => onTabChange('store')}
                    >
                        Storefront
                    </button>
                    <button
                        type="button"
                        className={activeTab === 'skins' ? 'active' : ''}
                        onClick={() => onTabChange('skins')}
                    >
                        Presets
                    </button>
                </nav>

                <div className="topbar-actions">
                    <label className="topbar-switch">
                        <span>Auto agent</span>
                        <input
                            type="checkbox"
                            checked={autoSelectAgent || false}
                            onChange={(e) => onToggleAutoAgent(e.target.checked)}
                        />
                    </label>

                    <div className="account-strip">
                        {accounts.length > 0 ? accounts.map(acc => (
                            <button
                                key={acc.puuid}
                                type="button"
                                className={`account-pill${activeAccount?.puuid === acc.puuid ? ' active' : ''}`}
                                onClick={() => onSwitchAccount(acc)}
                                title={`${acc.gameName}#${acc.tagLine}`}
                            >
                                <span>{acc.gameName}</span>
                                <small>#{acc.tagLine}</small>
                                <i
                                    className="pill-remove"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Remove ${acc.gameName}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRequestDeleteAccount(acc.puuid);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onRequestDeleteAccount(acc.puuid);
                                        }
                                    }}
                                >
                                    ×
                                </i>
                            </button>
                        )) : (
                            <span className="no-account-pill">No account</span>
                        )}
                        <button type="button" className="connect-account-btn" onClick={onAddAccount}>
                            + Account
                        </button>
                    </div>

                    <button onClick={onToggleTheme} className="theme-toggle-btn" title="Toggle theme">
                        {theme === 'dark' ? '☀' : '☾'}
                    </button>
                </div>
            </div>
        </header>
    );
}
