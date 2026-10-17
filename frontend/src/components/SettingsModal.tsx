"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiotAccount } from "@/lib/types";
import { clearMatchCache, getStorageStatus, type StorageStatus } from "@/services/settings";
import { exportBackup, exportDiagnostics, importBackup } from "@/services/recovery";
import { useTheme, type InterfaceTheme } from "@/context/ThemeContext";
import { playUiSound, UI_SOUND_LABELS, type UiSound } from "@/lib/uiSounds";

const RIOT_WALLPAPERS = [
    { id: 'evolution', name: 'Evolution', url: '/themes/evolution.jpg' },
    { id: 'china-launch', name: 'China Launch', url: '/themes/china-launch.jpg' },
    { id: 'omen-outlaw', name: 'Omen & Outlaw', url: '/themes/omen-outlaw.jpg' },
    { id: 'cypher-reborn', name: 'Cypher Reborn', url: '/themes/cypher-reborn.jpg' },
    { id: 'deadlock', name: 'Deadlock', url: '/themes/deadlock.jpg' },
    { id: 'viper', name: 'Viper', url: '/themes/viper.jpg' },
    { id: 'harbor', name: 'Harbor', url: '/themes/harbor.jpg' },
    { id: 'gekko', name: 'Gekko', url: '/themes/gekko.jpg' },
] as const;

const GITHUB_REPOSITORY_URL = "https://github.com/akawazak/valo-project";
const GITHUB_RELEASE_URL = `${GITHUB_REPOSITORY_URL}/releases/latest`;
const DISCORD_INVITE_URL = "https://discord.gg/gxGQwWyECE";
const SOUND_PREVIEW_CUES = Object.keys(UI_SOUND_LABELS) as UiSound[];

const SETTINGS_SECTIONS = [
    { id: "general", label: "General", description: "Startup and cosmetic browsing", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" },
    { id: "appearance", label: "Appearance", description: "Theme, wallpaper, and accent", icon: "M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1 2.6 1.5 1.5 0 0 1-1 2.4H12Z M7.5 11.5h.01 M10.5 7.5h.01 M15.5 8.5h.01" },
    { id: "match", label: "Match & social", description: "Sync, friends, and live match", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M22 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8" },
    { id: "data", label: "Data", description: "Backups, retention, and storage", icon: "M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Z M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
    { id: "connection", label: "Connection", description: "Choose how Riot signs in", icon: "M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 0 1 0 10h-2 M8 12h8" },
    { id: "about", label: "About", description: "Updates and community", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 16v-4 M12 8h.01" },
] as const;

type SettingsSection = typeof SETTINGS_SECTIONS[number]["id"];

function openExternal(url: string) {
    void import("@tauri-apps/plugin-shell")
        .then(({ open }) => open(url))
        .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

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
    showUnownedCosmetics: boolean;
    onShowUnownedCosmeticsChange: (v: boolean) => void;
	soundEnabled: boolean;
	onSoundEnabledChange: (v: boolean) => void;
	soundVolume: number;
	onSoundVolumeChange: (v: number) => void;
    launchAtStartup: boolean;
    onLaunchAtStartupChange: (v: boolean) => void;
    theme: string;
    accentTheme: string;
    interfaceTheme: InterfaceTheme;
    onToggleTheme: () => void;
    onAccentThemeChange: (accent: 'valorant' | 'aqua' | 'violet' | 'gold') => void;
    onInterfaceThemeChange: (theme: InterfaceTheme) => void;
    
    // Client health & active info
    isLocalClientActive: boolean;
    activeAccount: RiotAccount | null;
    isAndroid: boolean;

    // Updater state
    appVersion: string;
    isPortable: boolean;
    updateAvailable: boolean;
    updateVersion: string | null;
    isCheckingUpdate: boolean;
    lastUpdateCheck: number | null;
    updateCheckError: string | null;
    isUpdating: boolean;
    updateReady: boolean;
    /** Download progress, 0-100, while an update downloads in the background. */
    updateProgress?: number | null;
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
    showUnownedCosmetics,
    onShowUnownedCosmeticsChange,
	soundEnabled,
	onSoundEnabledChange,
	soundVolume,
	onSoundVolumeChange,
    launchAtStartup,
    onLaunchAtStartupChange,
    theme,
    accentTheme,
    interfaceTheme,
    onToggleTheme,
    onAccentThemeChange,
    onInterfaceThemeChange,
    isLocalClientActive,
    activeAccount,
    isAndroid,
    appVersion,
    isPortable,
    updateAvailable,
    updateVersion,
    isCheckingUpdate,
    lastUpdateCheck,
    updateCheckError,
    isUpdating,
    updateReady,
    updateProgress = null,
    onInstallUpdate,
    onRestartForUpdate,
    onCheckForUpdates,
}: SettingsModalProps) {
    const { appearance, setAppearance, resetAppearance } = useTheme();
    const [storage, setStorage] = useState<StorageStatus | null>(null);
    const [sessionCacheBytes, setSessionCacheBytes] = useState(0);
    const [storageBusy, setStorageBusy] = useState(false);
    const [storageMessage, setStorageMessage] = useState("");
    const [recoveryBusy, setRecoveryBusy] = useState(false);
    const [recoveryMessage, setRecoveryMessage] = useState("");
    const [secureStorageFailed, setSecureStorageFailed] = useState(false);
    const [projectLinkCopied, setProjectLinkCopied] = useState(false);
    const [activeSection, setActiveSection] = useState<SettingsSection>("general");
	const [soundPreviewCue, setSoundPreviewCue] = useState<UiSound>("message");
    const backupInputRef = useRef<HTMLInputElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const wallpaperPreloadRef = useRef<HTMLImageElement[]>([]);
    const activeSectionCopy = SETTINGS_SECTIONS.find((section) => section.id === activeSection)!;
    const panelBleed = Math.round(Math.min(100, Math.max(0, ((100 - appearance.panelOpacity) / 55) * 100)));
    const panelBleedLabel = panelBleed < 34 ? "Subtle" : panelBleed < 67 ? "Balanced" : "Strong";

    useEffect(() => {
        wallpaperPreloadRef.current = RIOT_WALLPAPERS.map((item) => {
            const image = new window.Image();
            image.decoding = "async";
            image.src = item.url;
            return image;
        });

        return () => {
            wallpaperPreloadRef.current = [];
        };
    }, []);

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
        setSecureStorageFailed(localStorage.getItem("riot_secure_storage_error") === "1");
        void refreshStorage().catch((error) => setStorageMessage(error instanceof Error ? error.message : String(error)));
    }, [isOpen, refreshStorage]);

    useEffect(() => {
        if (!isOpen) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-container single-pane" data-slot="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close settings">
                    &times;
                </button>

                <div className="settings-modal-sidebar">
                    <div className="settings-sidebar-header">
                        <Image src="/brand-mark.svg" alt="" width={34} height={34} />
                        <div>
                            <h2 className="settings-sidebar-title">Settings</h2>
                            <span>VantaVault preferences</span>
                        </div>
                    </div>

                    <nav className="settings-section-nav" aria-label="Settings categories">
                        {SETTINGS_SECTIONS.map((section) => (
                            <button
                                key={section.id}
                                type="button"
                                className={activeSection === section.id ? "active" : ""}
                                onClick={() => {
                                    setActiveSection(section.id);
                                    if (contentRef.current) contentRef.current.scrollTop = 0;
                                }}
                                aria-current={activeSection === section.id ? "page" : undefined}
                            >
                                <i aria-hidden="true"><svg viewBox="0 0 24 24"><path d={section.icon} /></svg></i>
                                <strong>{section.label}</strong>
                                <span>{section.description}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="settings-sidebar-footer">
                        <button
                            type="button"
                            className="settings-version-card"
                            onClick={() => {
                                setActiveSection("about");
                                if (contentRef.current) contentRef.current.scrollTop = 0;
                            }}
                        >
                            <span>VantaVault {appVersion || "Desktop"}</span>
                            <small>{updateReady ? "Restart to finish updating" : updateAvailable ? `Version ${updateVersion} available` : "Open source desktop companion"}</small>
                        </button>
                    </div>
                </div>

                <div ref={contentRef} className="settings-modal-content">
                    <div className="settings-tab-pane">
                        <header className="settings-pane-header">
                            <h3>{activeSectionCopy.label}</h3>
                            <p>{activeSectionCopy.description}</p>
                        </header>

                        <div className="settings-list">
                            <div className="settings-item" hidden={activeSection !== "general" || isAndroid}>
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

                            <div className="settings-item" hidden={activeSection !== "general" || isAndroid}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Launch at Login</div>
                                    <div className="settings-item-desc">Start VantaVault when you sign in to Windows. This also keeps your saved accounts signed in, since Riot ends logins that go a few days without renewing.</div>
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

                            <div className="settings-item" hidden={activeSection !== "general"}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Show Locked Cosmetics</div>
                                    <div className="settings-item-desc">Include player cards, titles, sprays, and flexes that are not confirmed on this account.</div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input
                                            type="checkbox"
                                            checked={showUnownedCosmetics}
                                            onChange={(e) => onShowUnownedCosmeticsChange(e.target.checked)}
                                        />
                                        <span className="switch-slider" />
                                    </label>
                                </div>
                            </div>

							<div className="settings-item settings-item--stacked" hidden={activeSection !== "general"}>
								<div className="settings-sound-heading">
									<div className="settings-item-info">
										<div className="settings-item-label">Interface Sounds</div>
										<div className="settings-item-desc">Subtle cues for messages, match found, and important results. Navigation stays silent.</div>
									</div>
									<div className="settings-item-control">
										<label className="switch-control">
											<input aria-label="Interface Sounds" type="checkbox" checked={soundEnabled} onChange={(event) => onSoundEnabledChange(event.target.checked)} />
											<span className="switch-slider" />
										</label>
									</div>
								</div>
								<div className="settings-sound-controls">
									<AppearanceRange label="Sound volume" hint="Kept intentionally below system volume." value={soundVolume} min={0} max={100} onChange={onSoundVolumeChange} />
									<select className="settings-select" aria-label="Sound cue to preview" value={soundPreviewCue} onChange={(event) => setSoundPreviewCue(event.target.value as UiSound)}>
										{SOUND_PREVIEW_CUES.map((cue) => <option key={cue} value={cue}>{UI_SOUND_LABELS[cue]}</option>)}
									</select>
									<button type="button" className="settings-update-now-btn" onClick={() => playUiSound(soundPreviewCue, { force: true })}>Preview</button>
								</div>
							</div>

                            <div className="settings-item settings-item--stacked" hidden={activeSection !== "general"}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Keyboard Shortcuts</div>
                                    <div className="settings-item-desc">Recovery and navigation while VantaVault is focused.</div>
                                </div>
                                <div className="settings-shortcut-list" data-slot="keyboard-shortcuts">
                                    <div><span>Reload interface</span><span><kbd>F5</kbd><kbd>Ctrl + R</kbd></span></div>
                                    <div><span>Restart app and backend</span><kbd>Ctrl + Shift + R</kbd></div>
                                    <div><span>Open Settings</span><kbd>Ctrl + ,</kbd></div>
                                    <div><span>Store / Profile / Presets</span><span><kbd>Ctrl + 1</kbd><kbd>Ctrl + 2</kbd><kbd>Ctrl + 3</kbd></span></div>
                                    <div><span>Close Settings</span><kbd>Esc</kbd></div>
                                </div>
                            </div>

                            <div className="settings-item" hidden={activeSection !== "appearance"}>
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

                            <div className="settings-item" hidden={activeSection !== "appearance"}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Interface Theme</div>
                                    <div className="settings-item-desc">Change the atmosphere, surfaces, and background art without moving your UI.</div>
                                </div>
                                <div className="settings-item-control settings-item-control--wide">
                                    <div className="appearance-theme-gallery" aria-label="Interface theme and wallpaper">
                                        {[
                                            { id: 'default', label: 'Tactical', detail: 'Original clean UI' },
                                            { id: 'protocol', label: 'Protocol', detail: 'Cyan glass & grid' },
                                            { id: 'cinematic', label: 'Cinematic', detail: 'Official Riot key art' },
                                        ].map((option) => (
                                            <button
                                                key={option.id}
                                                type="button"
                                                className={`appearance-theme-tile appearance-theme-tile--${option.id}${interfaceTheme === option.id && !appearance.backgroundId ? ' active' : ''}`}
                                                onClick={() => onInterfaceThemeChange(option.id as InterfaceTheme)}
                                                aria-pressed={interfaceTheme === option.id && !appearance.backgroundId}
                                            >
                                                <span className="appearance-theme-preview" aria-hidden="true" />
                                                <strong>{option.label}</strong>
                                            </button>
                                        ))}
                                        {RIOT_WALLPAPERS.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className={`appearance-theme-tile${appearance.backgroundId === item.id ? ' active' : ''}`}
                                                onClick={() => setAppearance({ backgroundId: item.id, backgroundUrl: item.url, backgroundName: item.name })}
                                                aria-pressed={appearance.backgroundId === item.id}
                                            >
                                                <img src={item.url} alt="" loading="eager" decoding="async" />
                                                <strong>{item.name}</strong>
                                            </button>
                                        ))}
                                    </div>
                                    <div className="appearance-customizer">
                                        <div className="appearance-toolbar">
                                            <strong>{appearance.backgroundName || 'Interface controls'}</strong>
                                            {appearance.backgroundId && <button type="button" className="settings-update-now-btn" onClick={resetAppearance}>Clear wallpaper</button>}
                                        </div>
                                        <div className="appearance-sliders">
                                            <AppearanceRange label="Wallpaper visibility" hint="How strongly the artwork appears behind the app." value={appearance.strength} min={10} max={80} onChange={(strength) => setAppearance({ strength })} />
                                            <AppearanceRange label="Wallpaper blur" hint="Softens the artwork without blurring the interface." value={appearance.blur} min={0} max={18} suffix="px" onChange={(blur) => setAppearance({ blur })} />
                                            <AppearanceRange label="Wallpaper color" hint="Lower is muted; higher is more vivid." value={appearance.saturation} min={30} max={140} onChange={(saturation) => setAppearance({ saturation })} />
                                            <AppearanceRange label="Wallpaper through cards" hint="Left keeps cards solid; right reveals more artwork." value={panelBleed} valueLabel={panelBleedLabel} min={0} max={100} onChange={(bleed) => setAppearance({ panelOpacity: Math.round(100 - bleed * 0.55) })} />
                                        </div>
                                        <div className="appearance-position" aria-label="Background position">
                                            {(['left', 'center', 'right'] as const).map((position) => (
                                                <button key={position} type="button" className={appearance.position === position ? 'active' : ''} onClick={() => setAppearance({ position })}>{position}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="settings-item" hidden={activeSection !== "appearance"}>
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

                            <div className="settings-item" hidden={activeSection !== "about" || isAndroid}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Updates</div>
                                    <div className="settings-item-desc">
                                        {isCheckingUpdate
                                            ? "Checking for updates..."
                                            : isUpdating
                                            ? `Downloading version ${updateVersion || "?"} in the background. You can keep using VantaVault.`
                                            : updateReady
                                            ? `Version ${updateVersion || "?"} is downloaded and verified. Restart VantaVault to finish updating.`
                                            : updateAvailable
                                            ? `Version ${updateVersion || "?"} is available. The download didn't finish, so try again.`
                                            : updateCheckError
                                            ? updateCheckError
                                            : `${lastUpdateCheck ? "You're on the latest version. " : ""}Updates download by themselves and install when you restart${isPortable ? ", no setup needed" : ""}.`}
                                        <span className="settings-update-lastcheck settings-update-lastcheck--inline">
                                            Last check: {formatRelativeTime(lastUpdateCheck)}
                                        </span>
                                    </div>
                                </div>
                                <div className="settings-item-control">
                                    {updateReady ? (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn is-primary"
                                            onClick={onRestartForUpdate}
                                            disabled={isUpdating}
                                        >
                                            {isUpdating ? "Restarting..." : "Restart to update"}
                                        </button>
                                    ) : isUpdating && !isCheckingUpdate ? (
                                        <button type="button" className="settings-update-now-btn" disabled>
                                            {updateProgress !== null ? `Downloading ${updateProgress}%` : "Downloading..."}
                                        </button>
                                    ) : updateAvailable ? (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn is-primary"
                                            onClick={onInstallUpdate}
                                        >
                                            Retry download
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="settings-update-now-btn"
                                            onClick={onCheckForUpdates}
                                            disabled={isCheckingUpdate}
                                        >
                                            {isCheckingUpdate ? "Checking..." : updateCheckError ? "Try again" : "Check for updates"}
                                        </button>
                                    )}
                                </div>
                            </div>

                        </div>

                        <div className="settings-list" hidden={activeSection !== "match"}>
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
                            <div className="settings-item" hidden={isAndroid}>
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Live Match Overlay</div>
                                    <div className="settings-item-desc">
                                        {useLocalSso && isLocalClientActive
                                            ? "Show the centered app during your local VALORANT match. Alt+T toggles it while the game is focused."
                                            : "Available only in local lockfile mode while VALORANT is running on this PC."}
                                    </div>
                                </div>
                                <div className="settings-item-control">
                                    <label className="switch-control">
                                        <input aria-label="Live Match Overlay" type="checkbox" checked={showLiveMatch} disabled={!useLocalSso || !isLocalClientActive} onChange={(e) => onShowLiveMatchChange(e.target.checked)} />
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

                        <div className="settings-list" hidden={activeSection !== "data"}>
                            <div className="settings-item">
                                <div className="settings-item-info">
                                    <div className="settings-item-label">Backup Current Account</div>
                                    <div className="settings-item-desc">Export this account&apos;s presets and app preferences. Login tokens and cookies are never included.</div>
                                </div>
                                <div className="settings-item-control settings-storage-actions">
                                    <button
                                        type="button"
                                        className="settings-update-now-btn is-primary"
                                        disabled={recoveryBusy}
                                        onClick={async () => {
                                            setRecoveryBusy(true);
                                            setRecoveryMessage("");
                                            try {
                                                if (await exportBackup()) setRecoveryMessage("Backup downloaded.");
                                                else setRecoveryMessage("Account changed. Export again for the selected account.");
                                            } catch (error) {
                                                setRecoveryMessage(error instanceof Error ? error.message : String(error));
                                            } finally {
                                                setRecoveryBusy(false);
                                            }
                                        }}
                                    >
                                        Export backup
                                    </button>
                                    <button type="button" className="btn-tactical-ghost" disabled={recoveryBusy} onClick={() => backupInputRef.current?.click()}>
                                        Import backup
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
                                                if (await importBackup(file)) window.location.reload();
                                                else {
                                                    setRecoveryMessage("Account changed. Select the account you want to restore and try again.");
                                                    setRecoveryBusy(false);
                                                }
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
                                        Download diagnostics
                                    </button>
                                </div>
                            </div>
                            {recoveryMessage && <div className="settings-storage-message">{recoveryMessage}</div>}
                        </div>

                        <div className="settings-list" hidden={activeSection !== "data"}>
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
                                    className="settings-update-now-btn is-danger"
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
                                    Clear match cache
                                </button>
                                <button
                                    type="button"
                                    className="settings-update-now-btn is-danger"
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
                                    Clear image cache
                                </button>
                                <button type="button" className="btn-tactical-ghost" disabled={storageBusy} onClick={() => void refreshStorage()}>
                                    Refresh usage
                                </button>
                            </div>
                            {storageMessage && <div className="settings-storage-message">{storageMessage}</div>}
                        </div>

                        {/* Connection Mode */}
                        <div className="connection-mode-card" hidden={activeSection !== "connection"}>
                            <div className="connection-mode-header">
                                <div>
                                    <div className="settings-item-label" style={{ marginBottom: '2px' }}>Connection Mode</div>
                                    <div className="settings-item-desc">
                                        {isAndroid ? "Android uses remote Riot accounts; local PC detection stays in the Windows app." : "Choose how VantaVault authenticates with Riot."}
                                    </div>
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
                                {!isAndroid && <button
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
                                </button>}
                            </div>

                            {!isAndroid && useLocalSso && (
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
                            {secureStorageFailed && (
                                <div className="connection-security-warning" role="status">
                                    {isAndroid
                                        ? "Secure Android account storage is unavailable. This session remains memory-only and will need to be reconnected after restarting."
                                        : "Riot credentials could not be saved to Windows Credential Manager. This session still works, but reconnect the account after restarting VantaVault."}
                                </div>
                            )}
                        </div>

                        <section className="settings-about-card" hidden={activeSection !== "about"}>
                            <div className="settings-about-brand">
                                <Image src="/brand-mark.svg" alt="" width={52} height={52} />
                                <div>
                                    <strong>VantaVault</strong>
                                    <span>Version {appVersion || "unknown"}</span>
                                </div>
                            </div>
                            <p>Open-source VALORANT loadouts, profiles, match review, and live-match context in one desktop app.</p>
                            <div className="settings-about-actions">
                                <button type="button" className="btn-tactical btn-tactical-accent" onClick={() => openExternal(GITHUB_RELEASE_URL)}>
                                    Download latest
                                </button>
                                <button type="button" className="btn-tactical" onClick={() => openExternal(GITHUB_REPOSITORY_URL)}>
                                    View on GitHub
                                </button>
                                <button type="button" className="btn-tactical" onClick={() => {
                                    void navigator.clipboard.writeText(GITHUB_REPOSITORY_URL)
                                        .then(() => {
                                            setProjectLinkCopied(true);
                                            window.setTimeout(() => setProjectLinkCopied(false), 1800);
                                        })
                                        .catch(() => openExternal(GITHUB_REPOSITORY_URL));
                                }}>
                                    {projectLinkCopied ? "Link copied" : "Copy project link"}
                                </button>
                                <button type="button" className="btn-tactical" onClick={() => openExternal(DISCORD_INVITE_URL)}>
                                    Join Discord
                                </button>
                            </div>
                            <small>VantaVault is not endorsed by Riot Games. Riot Games and VALORANT are trademarks of Riot Games, Inc.</small>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AppearanceRange({ label, hint, value, valueLabel, min, max, suffix = '%', onChange }: { label: string; hint?: string; value: number; valueLabel?: string; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <label className="appearance-range">
            <span>{label}<strong>{valueLabel || `${value}${suffix}`}</strong></span>
            <input type="range" min={min} max={max} value={value} aria-label={label} aria-valuetext={valueLabel || `${value}${suffix}`} onChange={(event) => onChange(Number(event.target.value))} />
            {hint && <small>{hint}</small>}
        </label>
    );
}
