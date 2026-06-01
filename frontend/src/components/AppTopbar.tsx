"use client";

import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
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

function accountLabel(acc: RiotAccount) {
    return `${acc.gameName}#${acc.tagLine}`;
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
    const [menuOpen, setMenuOpen] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;

        const checkForUpdates = async () => {
            try {
                const version = await getVersion();
                if (!cancelled) setAppVersion(version);

                const update = await check();
                if (!cancelled) setUpdateAvailable(Boolean(update));
            } catch {
                // Updater unavailable in dev or before first signed release.
            }
        };

        checkForUpdates();
        return () => { cancelled = true; };
    }, []);

    const handleInstallUpdate = async () => {
        setIsUpdating(true);
        try {
            const update = await check();
            if (!update) return;
            await update.downloadAndInstall();
        } catch (err) {
            console.error("Update failed:", err);
        } finally {
            setIsUpdating(false);
        }
    };

    useEffect(() => {
        if (!menuOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (!dropdownRef.current?.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMenuOpen(false);
        };

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [menuOpen]);

    const handleSelectAccount = (acc: RiotAccount) => {
        onSwitchAccount(acc);
        setMenuOpen(false);
    };

    const handleAddAccount = () => {
        onAddAccount();
        setMenuOpen(false);
    };

    const handleRemoveAccount = (puuid: string) => {
        onRequestDeleteAccount(puuid);
        setMenuOpen(false);
    };

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

                    <div className="account-dropdown" ref={dropdownRef}>
                        <button
                            type="button"
                            className={`account-dropdown-trigger${menuOpen ? " open" : ""}${activeAccount ? " has-account" : ""}`}
                            onClick={() => setMenuOpen((open) => !open)}
                            aria-haspopup="listbox"
                            aria-expanded={menuOpen}
                        >
                            <span className="account-dropdown-label">
                                {activeAccount ? accountLabel(activeAccount) : "No account"}
                            </span>
                            <span className="account-dropdown-chevron" aria-hidden="true">▾</span>
                        </button>

                        {menuOpen && (
                            <div className="account-dropdown-menu" role="listbox" aria-label="Riot accounts">
                                {accounts.length > 0 ? (
                                    accounts.map((acc) => (
                                        <div
                                            key={acc.puuid}
                                            className={`account-dropdown-item${activeAccount?.puuid === acc.puuid ? " active" : ""}`}
                                            role="option"
                                            aria-selected={activeAccount?.puuid === acc.puuid}
                                        >
                                            <button
                                                type="button"
                                                className="account-dropdown-select"
                                                onClick={() => handleSelectAccount(acc)}
                                                title={accountLabel(acc)}
                                            >
                                                <span>{acc.gameName}</span>
                                                <small>#{acc.tagLine}</small>
                                            </button>
                                            <button
                                                type="button"
                                                className="account-dropdown-remove"
                                                aria-label={`Remove ${acc.gameName}`}
                                                onClick={() => handleRemoveAccount(acc.puuid)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="account-dropdown-empty">No accounts connected</div>
                                )}
                                <button type="button" className="account-dropdown-add" onClick={handleAddAccount}>
                                    + Add account
                                </button>
                            </div>
                        )}
                    </div>

                    {appVersion && (
                        <span className="topbar-version" title="Installed version">{appVersion}</span>
                    )}

                    {updateAvailable && (
                        <button
                            type="button"
                            className="topbar-update-btn"
                            onClick={handleInstallUpdate}
                            disabled={isUpdating}
                            title="Download and install update"
                        >
                            {isUpdating ? "Updating…" : "Update"}
                        </button>
                    )}

                    <button onClick={onToggleTheme} className="theme-toggle-btn" title="Toggle theme">
                        {theme === 'dark' ? '☀' : '☾'}
                    </button>
                </div>
            </div>
        </header>
    );
}
