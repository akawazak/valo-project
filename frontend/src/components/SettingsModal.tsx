"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiotAccount } from "@/lib/types";
import { clearMatchCache, getStorageStatus, type StorageStatus } from "@/services/settings";
import { exportBackup, exportDiagnostics, importBackup } from "@/services/recovery";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    
    // Settings state
    autoSelectAgent: boolean;
    onToggleAutoAgent: (v: boolean) => void;
    useLocalSso: boolean;
    onToggleLocalSso: (v: boolean) => void;
    autoSyncMatches: boolean;
    onToggleAutoSyncMatches: (v: boolean) => void;
    matchRetentionDays: 0 | 30 | 90 | 180 | 365;
    onMatchRetentionDaysChange: (v: 0 | 30 | 90 | 180 | 365) => void;
    showOfflineFriends: boolean;
    onShowOfflineFriendsChange: (v: boolean) => void;
    showLiveMatch: boolean;
    onShowLiveMatchChange: (v: boolean) => void;
    showPartyWidget: boolean;
    onShowPartyWidgetChange: (v: boolean) => void;
    launchAtStartup: boolean;
    onLaunchAtStartupChange: (v: boolean) => void;
    theme: string;
    accentTheme: string;
    onToggleTheme: () => void;
    onAccentThemeChange: (accent: 'valorant' | 'aqua' | 'violet' | 'gold') => void;
    
    // Client health & active info
    isLocalClientActive: boolean;
    activeAccount: RiotAccount | null;

    // Updater state
    appVersion: string;
    updateAvailable: boolean;
    updateVersion: string | null;
    isCheckingUpdate: boolean;
    lastUpdateCheck: number | null;
    updateCheckError: string | null;
    isUpdating: boolean;
    updateReady: boolean;
    onInstallUpdate: () => void;
    onRestartForUpdate: () => void;
    onCheckForUpdates: () => void;
}

function formatRelativeTime(timestamp: number | null): string {
    if (timestamp === null) return "never";
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

export default function SettingsModal({
    isOpen,
    onClose,
    autoSelectAgent,
    onToggleAutoAgent,
    useLocalSso,
    onToggleLocalSso,
    autoSyncMatches,
    onToggleAutoSyncMatches,
    matchRetentionDays,
    onMatchRetentionDaysChange,
    showOfflineFriends,
    onShowOfflineFriendsChange,
    showLiveMatch,
    onShowLiveMatchChange,
    showPartyWidget,
    onShowPartyWidgetChange,
    launchAtStartup,
    onLaunchAtStartupChange,
    theme,
    accentTheme,
    onToggleTheme,
    onAccentThemeChange,
    isLocalClientActive,
    activeAccount,
    appVersion,
    updateAvailable,
    updateVersion,
    isCheckingUpdate,
    lastUpdateCheck,
    updateCheckError,
    isUpdating,
    updateReady,
    onInstallUpdate,
    onRestartForUpdate,
    onCheckForUpdates,
}: SettingsModalProps) {
    const [storage, setStorage] = useState<StorageStatus | null>(null);
    const [sessionCacheBytes, setSessionCacheBytes] = useState(0);
    const [storageBusy, setStorageBusy] = useState(false);
    const [storageMessage, setStorageMessage] = useState("");
    const [recoveryBusy, setRecoveryBusy] = useState(false);
    const [recoveryMessage, setRecoveryMessage] = useState("");
    const backupInputRef = useRef<HTMLInputElement>(null);

    const refreshStorage = useCallback(async () => {
        const [status, sessionBytes] = await Promise.all([
            getStorageStatus(),
            import("@tauri-apps/api/core")
                .then(({ invoke }) => invoke<number>("get_session_cache_size"))
                .catch(() => 0),
        ]);
        setStorage(status);
        setSessionCacheBytes(sessionBytes);
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        void refreshStorage().catch((error) => setStorageMessage(error instanceof Error ? error.message : String(error)));
    }, [isOpen, refreshStorage]);

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
                                            <button
                                                type="button"
                                                className="settings-update-now-btn"
                                                onClick={onRestartForUpdate}
                                            >
                                                Restart now
                                            </button>
                                        ) : updateAvailable ? (
                                            <button
                                                type="button"
                                                className="settings-update-now-btn"
                                                onClick={onInstallUpdate}
                                                disabled={isUpdating}
                                            >
                                                {isUpdating ? "Updating..." : `Update to v${updateVersion || "?"}`}
                                            </button>
                                        ) : (
                                            <span className="settings-update-status clean">Up to date</span>
                                        )}
                                        <span className="settings-update-lastcheck">
                                            Last check: {formatRelativeTime(lastUpdateCheck)}
                                        </span>
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
                                    <div className="settings-item-desc">Start VantaVault automatically when you sign in to Windows.</div>
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

                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Accent Style</div>
                                    <div className="settings-item-desc">Change the app accent so the interface is not locked to Valorant red.</div>
                                </div>
                                <div className="settings-item-control">
                                    <div className="accent-select-group" aria-label="Accent style">
                                        {[
                                            { id: 'valorant', label: 'Red' },
                                            { id: 'aqua', label: 'Aqua' },
                                            { id: 'violet', label: 'Violet' },
                                            { id: 'gold', label: 'Gold' },
                                        ].map((accent) => (
                                            <button
                                                key={accent.id}
                                                type="button"
                                                className={`accent-select-btn accent-select-btn--${accent.id}${accentTheme === accent.id ? ' active' : ''}`}
                                                onClick={() => onAccentThemeChange(accent.id as 'valorant' | 'aqua' | 'violet' | 'gold')}
                                                aria-pressed={accentTheme === accent.id}
                                            >
                                                <span className="accent-select-swatch" aria-hidden="true" />
                                                <span>{accent.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Updates</div>
                                    <div className="settings-item-desc">
                                        {isCheckingUpdate
                                            ? "Contacting the update server..."
                                            : updateReady
                                            ? "An update is ready — restart VantaVault to apply it."
                                            : updateAvailable
                                            ? `Version ${updateVersion || "?"} is available for download.`
                                            : updateCheckError
                                            ? `Couldn't reach the update server: ${updateCheckError}`
                                            : "Manually check for new releases. VantaVault also checks automatically every 6 hours."}
                                        <span className="settings-update-lastcheck settings-update-lastcheck--inline">
                                            Last check: {formatRelativeTime(lastUpdateCheck)}
                                        </span>
                                    </div>
                                </div>
                                <div className="settings-item-control">
                                    {updateReady ? (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn"
                                            onClick={onRestartForUpdate}
                                        >
                                            Restart now
                                        </button>
                                    ) : updateAvailable ? (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn"
                                            onClick={onInstallUpdate}
                                            disabled={isUpdating}
                                        >
                                            {isUpdating ? "Updating..." : `Download v${updateVersion || "?"}`}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn"
                                            onClick={onCheckForUpdates}
                                            disabled={isCheckingUpdate}
                                        >
                                            {isCheckingUpdate ? "Checking..." : "Check for Updates"}
                                        </button>
                                    )}
                                </div>
                            </div>

                        </div>

                        <h3 className="settings-pane-title settings-pane-subtitle">Profile & Presence</h3>
                        <div className="settings-list">
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Automatic Match Sync</div>
                                    <div className="settings-item-desc">Download missing match details when a profile is opened. Turn this off to reduce Riot requests and disk usage.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input aria-label="Automatic Match Sync" type="checkbox" checked={autoSyncMatches} onChange={(e) => onToggleAutoSyncMatches(e.target.checked)} />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Offline Friends</div>
                                    <div className="settings-item-desc">Open the offline section by default in Party & Friends.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input aria-label="Offline Friends" type="checkbox" checked={showOfflineFriends} onChange={(e) => onShowOfflineFriendsChange(e.target.checked)} />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Live Match Overlay</div>
                                    <div className="settings-item-desc">Show player, score, party, profile, and loadout details during a match.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input aria-label="Live Match Overlay" type="checkbox" checked={showLiveMatch} onChange={(e) => onShowLiveMatchChange(e.target.checked)} />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Party & Friends Widget</div>
                                    <div className="settings-item-desc">Show live presence and party status in the app corner.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input aria-label="Party & Friends Widget" type="checkbox" checked={showPartyWidget} onChange={(e) => onShowPartyWidgetChange(e.target.checked)} />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>
                        </div>

                        <h3 className="settings-pane-title settings-pane-subtitle">Data & Recovery</h3>
                        <div className="settings-list">
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Backup Current Account</div>
                                    <div className="settings-item-desc">Export this account&apos;s presets and app preferences. Login tokens and cookies are never included.</div>
                                </div>
                                <div className="settings-item-control settings-storage-actions">
                                    <button
                                        type="button"
                                        className="settings-update-now-btn"
                                        disabled={recoveryBusy}
                                        onClick={async () => {
                                            setRecoveryBusy(true);
                                            setRecoveryMessage("");
                                            try {
                                                await exportBackup();
                                                setRecoveryMessage("Backup downloaded.");
                                            } catch (error) {
                                                setRecoveryMessage(error instanceof Error ? error.message : String(error));
                                            } finally {
                                                setRecoveryBusy(false);
                                            }
                                        }}
                                    >
                                        Export Backup
                                    </button>
                                    <button type="button" className="btn-tactical-ghost" disabled={recoveryBusy} onClick={() => backupInputRef.current?.click()}>
                                        Import Backup
                                    </button>
                                    <input
                                        ref={backupInputRef}
                                        type="file"
                                        accept="application/json,.json"
                                        hidden
                                        onChange={async (event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = "";
                                            if (!file || !window.confirm("Replace the current account's presets and app preferences with this backup?")) return;
                                            setRecoveryBusy(true);
                                            setRecoveryMessage("");
                                            try {
                                                await importBackup(file);
                                                window.location.reload();
                                            } catch (error) {
                                                setRecoveryMessage(error instanceof Error ? error.message : String(error));
                                                setRecoveryBusy(false);
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Diagnostics</div>
                                    <div className="settings-item-desc">Download app, backend, storage, and preference status without account names or Riot credentials.</div>
                                </div>
                                <div className="settings-item-control">
                                    <button
                                        type="button"
                                        className="btn-tactical-ghost"
                                        disabled={recoveryBusy}
                                        onClick={async () => {
                                            setRecoveryBusy(true);
                                            setRecoveryMessage("");
                                            try {
                                                await exportDiagnostics(appVersion);
                                                setRecoveryMessage("Diagnostics downloaded.");
                                            } catch (error) {
                                                setRecoveryMessage(error instanceof Error ? error.message : String(error));
                                            } finally {
                                                setRecoveryBusy(false);
                                            }
                                        }}
                                    >
                                        Download Diagnostics
                                    </button>
                                </div>
                            </div>
                            {recoveryMessage && <div className="settings-storage-message">{recoveryMessage}</div>}
                        </div>

                        <h3 className="settings-pane-title settings-pane-subtitle">Storage</h3>
                        <div className="settings-list">
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Match Retention</div>
                                    <div className="settings-item-desc">Keep rank snapshots, but remove older detailed scoreboards and derived agent/map stats.</div>
                                </div>
                                <div className="settings-item-control">
                                    <select
                                        aria-label="Match Retention"
                                        className="settings-select"
                                        value={matchRetentionDays}
                                        onChange={(event) => onMatchRetentionDaysChange(Number(event.target.value) as 0 | 30 | 90 | 180 | 365)}
                                    >
                                        <option value={30}>30 days</option>
                                        <option value={90}>90 days</option>
                                        <option value={180}>180 days</option>
                                        <option value={365}>1 year</option>
                                        <option value={0}>Keep everything</option>
                                    </select>
                                </div>
                            </div>
                            <div className="settings-storage-summary">
                                <div><span>Match cache</span><strong>{storage ? formatBytes(storage.matchCacheBytes) : "Loading…"}</strong><small>{storage?.cachedMatches ?? 0} matches</small></div>
                                <div><span>Login image cache</span><strong>{formatBytes(sessionCacheBytes)}</strong><small>Cookies are never removed</small></div>
                                <div><span>Logs</span><strong>{storage ? formatBytes(storage.logBytes) : "Loading…"}</strong><small>Automatically kept for 7 days</small></div>
                            </div>
                            <div className="settings-storage-actions">
                                <button
                                    type="button"
                                    className="settings-update-now-btn"
                                    disabled={storageBusy || !storage?.cachedMatches}
                                    onClick={async () => {
                                        if (!window.confirm("Clear cached match details and derived stats? Rank snapshots and connected accounts will be kept.")) return;
                                        setStorageBusy(true);
                                        setStorageMessage("");
                                        try {
                                            setStorage(await clearMatchCache());
                                            setStorageMessage("Match cache cleared.");
                                        } catch (error) {
                                            setStorageMessage(error instanceof Error ? error.message : String(error));
                                        } finally {
                                            setStorageBusy(false);
                                        }
                                    }}
                                >
                                    Clear Match Cache
                                </button>
                                <button
                                    type="button"
                                    className="settings-update-now-btn"
                                    disabled={storageBusy || sessionCacheBytes === 0}
                                    onClick={async () => {
                                        setStorageBusy(true);
                                        setStorageMessage("");
                                        try {
                                            const { invoke } = await import("@tauri-apps/api/core");
                                            const freed = await invoke<number>("clear_session_caches");
                                            setSessionCacheBytes(0);
                                            setStorageMessage(`Freed ${formatBytes(freed)}. Riot login cookies were kept.`);
                                        } catch (error) {
                                            setStorageMessage(error instanceof Error ? error.message : String(error));
                                        } finally {
                                            setStorageBusy(false);
                                        }
                                    }}
                                >
                                    Clear Image Cache
                                </button>
                                <button type="button" className="btn-tactical-ghost" disabled={storageBusy} onClick={() => void refreshStorage()}>
                                    Refresh Usage
                                </button>
                            </div>
                            {storageMessage && <div className="settings-storage-message">{storageMessage}</div>}
                        </div>

                        {/* Connection Mode */}
                        <div className="connection-mode-card">
                            <div className="connection-mode-header">
                                <div>
                                    <div className="settings-item-label" style={{ marginBottom: '2px' }}>Connection Mode</div>
                                    <div className="settings-item-desc">Choose how VantaVault authenticates with Riot.</div>
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
