"use client";

import { RiotAccount } from "@/lib/types";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    
    // Settings state
    autoSelectAgent: boolean;
    onToggleAutoAgent: (v: boolean) => void;
    useLocalSso: boolean;
    onToggleLocalSso: (v: boolean) => void;
    launchAtStartup: boolean;
    onLaunchAtStartupChange: (v: boolean) => void;
    theme: string;
    onToggleTheme: () => void;
    
    // Client health & active info
    isLocalClientActive: boolean;
    activeAccount: RiotAccount | null;

    // Updater state
    appVersion: string;
    updateAvailable: boolean;
    isUpdating: boolean;
    updateReady: boolean;
    onInstallUpdate: () => void;
}

export default function SettingsModal({
    isOpen,
    onClose,
    autoSelectAgent,
    onToggleAutoAgent,
    useLocalSso,
    onToggleLocalSso,
    launchAtStartup,
    onLaunchAtStartupChange,
    theme,
    onToggleTheme,
    isLocalClientActive,
    activeAccount,
    appVersion,
    updateAvailable,
    isUpdating,
    updateReady,
    onInstallUpdate,
}: SettingsModalProps) {
    if (!isOpen) return null;

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-container single-pane" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close settings">
                    &times;
                </button>

                <div className="settings-modal-sidebar">
                    <div className="settings-sidebar-header">
                        <div className="tactical-kicker">// SYSTEM CONFIG</div>
                        <h2 className="settings-sidebar-title">Settings</h2>
                    </div>

                    <div className="settings-sidebar-footer">
                        {appVersion && (
                            <div className="settings-version-info">
                                <span>Version {appVersion}</span>
                                {updateReady ? (
                                    <span className="settings-update-status ready">Update ready to apply</span>
                                ) : updateAvailable ? (
                                    <button
                                        type="button"
                                        className="settings-update-now-btn"
                                        onClick={onInstallUpdate}
                                        disabled={isUpdating}
                                    >
                                        {isUpdating ? "Updating..." : "Update Available"}
                                    </button>
                                ) : (
                                    <span className="settings-update-status clean">Up to date</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="settings-modal-content">
                    <div className="settings-tab-pane">
                        <h3 className="settings-pane-title">General Settings</h3>

                        <div className="settings-list">
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Auto Agent Select</div>
                                    <div className="settings-item-desc">Automatically apply your agent-linked preset when a match is found.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input
                                            type="checkbox"
                                            checked={autoSelectAgent}
                                            onChange={(e) => onToggleAutoAgent(e.target.checked)}
                                        />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>

                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Launch at Login</div>
                                    <div className="settings-item-desc">Start ValoVault automatically when you sign in to Windows.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input
                                            type="checkbox"
                                            checked={launchAtStartup}
                                            onChange={(e) => onLaunchAtStartupChange(e.target.checked)}
                                        />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>

                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Visual Theme</div>
                                    <div className="settings-item-desc">Switch between light and dark themes.</div>
                                </div>
                                <div className="settings-item-control">
                                    <div className="theme-select-group">
                                        <button
                                            type="button"
                                            className={`theme-select-btn ${theme === 'light' ? 'active' : ''}`}
                                            onClick={() => theme !== 'light' && onToggleTheme()}
                                        >
                                            ☀ Light
                                        </button>
                                        <button
                                            type="button"
                                            className={`theme-select-btn ${theme === 'dark' ? 'active' : ''}`}
                                            onClick={() => theme !== 'dark' && onToggleTheme()}
                                        >
                                            ☾ Dark
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* Connection Mode */}
                        <div className="connection-mode-card">
                            <div className="connection-mode-header">
                                <div>
                                    <div className="settings-item-label" style={{ marginBottom: '2px' }}>Connection Mode</div>
                                    <div className="settings-item-desc">Choose how ValoVault authenticates with Riot.</div>
                                </div>
                                <div className={`conn-live-dot ${useLocalSso ? (isLocalClientActive ? 'dot-green' : 'dot-amber') : 'dot-blue'}`} />
                            </div>

                            <div className="connection-mode-picker">
                                <button
                                    type="button"
                                    id="conn-mode-remote"
                                    className={`conn-mode-option ${!useLocalSso ? 'active' : ''}`}
                                    onClick={() => onToggleLocalSso(false)}
                                >
                                    <span className="conn-mode-icon">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                            <circle cx="9" cy="7" r="4" />
                                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                        </svg>
                                    </span>
                                    <span className="conn-mode-label">Remote Accounts</span>
                                    <span className="conn-mode-desc">Login via Riot SSO</span>
                                </button>
                                <button
                                    type="button"
                                    id="conn-mode-local"
                                    className={`conn-mode-option ${useLocalSso ? 'active' : ''}`}
                                    onClick={() => onToggleLocalSso(true)}
                                >
                                    <span className="conn-mode-icon">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" />
                                        </svg>
                                    </span>
                                    <span className="conn-mode-label">Local Client</span>
                                    <span className="conn-mode-desc">Auto-detect Valorant</span>
                                </button>
                            </div>

                            {useLocalSso && (
                                <div className={`connection-status-row ${isLocalClientActive ? 'status-online' : 'status-offline'}`}>
                                    <span className="status-indicator-dot" />
                                    <span className="status-text">
                                        {isLocalClientActive
                                            ? `Connected · ${activeAccount ? `${activeAccount.gameName}#${activeAccount.tagLine}` : 'Local Account'}`
                                            : 'Waiting for Valorant to launch…'
                                        }
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
