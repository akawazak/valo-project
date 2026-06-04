"use client";

import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { RiotAccount } from '@/lib/types';
import { setLaunchAtStartup } from '@/services/autostart';

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
    launchAtStartup?: boolean;
    onLaunchAtStartupChange?: (enabled: boolean) => void;
    isBackendOnline?: boolean;
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
    launchAtStartup = false,
    onLaunchAtStartupChange,
    isBackendOnline = true,
}: AppTopbarProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateReady, setUpdateReady] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;

        const checkForUpdates = async () => {
            try {
                const version = await getVersion();
                if (!cancelled) setAppVersion(version);

                const update = await check();
                if (!update || cancelled) return;

                setUpdateAvailable(true);
                setIsUpdating(true);
                await update.downloadAndInstall();
                if (!cancelled) {
                    setUpdateReady(true);
                    setUpdateAvailable(false);
                }
            } catch {
                // Updater unavailable in dev or before first signed release.
            } finally {
                if (!cancelled) setIsUpdating(false);
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
            setUpdateReady(true);
            setUpdateAvailable(false);
        } catch (err) {
            console.error("Update failed:", err);
        } finally {
            setIsUpdating(false);
        }
    };

    useEffect(() => {
        if (!menuOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (dropdownRef.current?.contains(target)) {
                return;
            }
            if (target.closest(".acc-delete-modal") || target.closest(".acc-delete-modal-overlay")) {
                return;
            }
            setMenuOpen(false);
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
    };

    return (
        <header className="app-topbar">
            {!isBackendOnline && (
                <div className="backend-offline-banner" role="status">
                    Local client offline — run <code>go run .</code> in the backend folder, then restart the app.
                </div>
            )}
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
                    <label className="topbar-switch" title="Apply the preset linked to your agent when agent select starts">
                        <span>Auto agent</span>
                        <input
                            type="checkbox"
                            checked={autoSelectAgent || false}
                            onChange={(e) => onToggleAutoAgent(e.target.checked)}
                        />
                    </label>

                    {onLaunchAtStartupChange && (
                        <label className="topbar-switch" title="Start ValoVault when you sign in to Windows (opt-in)">
                            <span>Launch at login</span>
                            <input
                                type="checkbox"
                                checked={launchAtStartup}
                                onChange={async (e) => {
                                    const next = e.target.checked;
                                    try {
                                        await setLaunchAtStartup(next);
                                        onLaunchAtStartupChange(next);
                                    } catch {
                                        onLaunchAtStartupChange(false);
                                    }
                                }}
                            />
                        </label>
                    )}

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

                    {updateReady && (
                        <span className="topbar-update-ready" title="Update installed and will apply after restarting the app">
                            Update ready
                        </span>
                    )}

                    <button onClick={onToggleTheme} className="theme-toggle-btn" title="Toggle theme">
                        {theme === 'dark' ? '☀' : '☾'}
                    </button>
                </div>
            </div>
        </header>
    );
}
