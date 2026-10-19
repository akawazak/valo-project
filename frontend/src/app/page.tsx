"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import ArsenalView from '@/features/arsenal/ArsenalView';
import LoadoutRestore from '@/features/arsenal/LoadoutRestore';
import PresetList from '@/features/presets/PresetList';
import PresetNameModal from '@/components/PresetNameModal';
import ErrorModal from '@/components/ErrorModal';
import Toast from '@/components/Toast';
import ConfirmationModal from '@/components/ConfirmationModal';
import { captureAccountRequest, getPlayerLoadoutData, getPresets, getProfileOverview, reportAppError } from '@/services/api';
import { getSettings, saveSettings, type Settings } from '@/services/settings';
import { AppRequestError, LocalClientError } from '@/lib/errors';
import { Preset, LoadoutItemV1, RiotAccount } from '@/lib/types';
import { getStoredAccounts, saveStoredAccounts } from '@/lib/accountStorage';
import { configureUiSounds, playUiSound } from '@/lib/uiSounds';
import { isAndroidRuntime } from '@/lib/platform';
import { queueLabel, useQueues } from '@/lib/gameMeta';

import { useData } from '@/context/DataContext';
import SessionEndToast, { OPEN_RECAP_FLAG } from '@/features/session/SessionEndToast';
import { usePresets, NamingMode, defaultPreset } from '@/hooks/usePresets';
import { buildPresetApplyRequest, GameLoadoutMeta } from '@/lib/effectivePreset';
import { useLoadout } from '@/hooks/useLoadout';
import RiotLoginCard from '@/components/RiotLoginCard';
import StorePanels from '@/features/dashboard/StorePanels';
import ProfilePanel from '@/features/profile/ProfilePanel';
import { useTheme } from '@/context/ThemeContext';
import { exportPreset } from '@/lib/presetShare';
import AppTopbar from '@/components/AppTopbar';
import ImportPresetModal from '@/components/ImportPresetModal';
import AccountManagerModal from '@/components/AccountManagerModal';
import LocalAccountChooser from '@/components/LocalAccountChooser';
import SettingsModal from '@/components/SettingsModal';
import LiveMatchOverlay from '@/features/livematch/LiveMatchOverlay';
import LivePartyStatus from '@/features/party/LivePartyStatus';
import ReleaseNotesModal, { type ReleaseNotes } from '@/components/ReleaseNotesModal';
import UpdateButton, { type UpdatePhase } from '@/components/UpdateButton';
import { parseReleaseNotes } from '@/lib/releaseNotes.mjs';
import NotificationCenter from '@/features/notifications/NotificationCenter';
import { publishAppNotification, useAppNotifications } from '@/lib/appNotifications';
import { useWishlistWatcher } from '@/hooks/useWishlistWatcher';
import { getDesktopNotificationsEnabled, setDesktopNotificationsEnabled } from '@/services/desktopNotify';
import { getTraySettings, setTraySettings, type TraySettings } from '@/services/tray';
import type { AppTab } from '@/lib/appTabs';
import MobileApp from '@/mobile/MobileAppV2';
import { sendUsagePing } from '@/lib/usagePing';

// Built from .github/release-notes/v{version}.md (see next.config.ts); null when this version has no notes.
const CURRENT_RELEASE: ReleaseNotes | null = JSON.parse(process.env.VANTAVAULT_RELEASE_NOTES || "null");

const RELEASE_NOTES_STORAGE_KEY = "vantavault:last-seen-release:v2";

const EMPTY_ACCOUNT_DATA: {
    owner: string;
    presets: Preset[];
    playerLoadout: Record<string, LoadoutItemV1>;
    gameMeta: GameLoadoutMeta;
    loadoutAvailable: boolean;
    loadoutError: string;
} = { owner: "", presets: [], playerLoadout: {}, gameMeta: { sprays: [], flexes: [], expressions: [] }, loadoutAvailable: false, loadoutError: "" };

type DiscordMatchPhase = {
    phase: string;
    matchId: string;
    queueId: string;
    mapName: string;
    mapImage: string;
    agentName: string;
    agentImage: string;
    timeLeft: number;
    partySize: number;
    allyCount: number;
    enemyCount: number;
    allyScore: number;
    enemyScore: number;
    scoreAvailable: boolean;
};

type PortableUpdateState = {
    status: string;
    version?: string | null;
    message?: string | null;
    checkedAt?: number | null;
    progress?: number | null;
};

export default function Home() {
    const [android, setAndroid] = useState<boolean | null>(null);

    useEffect(() => {
        setAndroid(isAndroidRuntime());
        const ping = window.setTimeout(sendUsagePing, 15000);
        return () => window.clearTimeout(ping);
    }, []);

    if (android === null) {
        return (
            <div className="loading-screen" role="status" aria-label="Opening VantaVault">
                <div className="loading-brand">
                    <img src="/brand-mark.svg" alt="" width="42" height="42" />
                    <span>VANTA<strong>VAULT</strong></span>
                </div>
            </div>
        );
    }

    return android ? <MobileApp /> : <HomeApp />;
}

function HomeApp() {
    const queues = useQueues();
    const {
        agents,
        allAgents,
        ownedAgentIDs,
        weapons,
        loading: dataContextLoading,
        isClientHealthy,
        isBackendOnline,
        isLocalClientActive,
        localPuuid,
        accounts,
        activeAccount,
        handleSwitchAccount,
        handleDeleteAccount,
        handleAddNewAccount,
        refreshAccountToken,
        cancelAccountRefresh,
        storefrontRefreshKey,
        pendingLocalAccount,
        showLocalAccountChooser,
        handleResolveLocalAccount,
        refreshAccountsList,
        contentTiers,
        playerCards,
        ownedLevelIDs,
        ownedChromaIDs,
    } = useData();

	const { theme, accentTheme, interfaceTheme, appearance, toggleTheme, setTheme, setAccentTheme, setInterfaceTheme, setAppearance } = useTheme();

    const [initialData, setInitialData] = useState(EMPTY_ACCOUNT_DATA);
    const accountOwner = activeAccount?.puuid || "";
    const accountOwnerRef = useRef(accountOwner);
    accountOwnerRef.current = accountOwner;
    const initialRequestRef = useRef(0);
    const scopedInitialData = initialData.owner === accountOwner ? initialData : EMPTY_ACCOUNT_DATA;
    const [dataRevision, setDataRevision] = useState(0);
    const [autoSelectAgent, setAutoSelectAgent] = useState<boolean | undefined>(undefined);
    const [useLocalSso, setUseLocalSso] = useState<boolean | undefined>(undefined);
    const [autoSyncMatches, setAutoSyncMatches] = useState<boolean | undefined>(undefined);
    const [matchRetentionDays, setMatchRetentionDays] = useState<Settings["matchRetentionDays"] | undefined>(undefined);
    const [showOfflineFriends, setShowOfflineFriends] = useState<boolean | undefined>(undefined);
    const [showLiveMatch, setShowLiveMatch] = useState<boolean | undefined>(undefined);
    const [showPartyWidget, setShowPartyWidget] = useState<boolean | undefined>(undefined);
    const [showUnownedCosmetics, setShowUnownedCosmetics] = useState<boolean | undefined>(undefined);
	const [soundEnabled, setSoundEnabled] = useState<boolean | undefined>(undefined);
	const [soundVolume, setSoundVolume] = useState<number | undefined>(undefined);
    const [profileIdentity, setProfileIdentity] = useState<{ currentRank: string; currentTier: number; accountLevel: number | null }>({ currentRank: "Unranked", currentTier: 0, accountLevel: null });
    const [launchAtStartup, setLaunchAtStartupState] = useState<boolean>(false);
    const [traySettings, setTraySettingsState] = useState<TraySettings>({ startMinimized: false, closeToTray: false });
    const [desktopNotifications, setDesktopNotificationsState] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Loading your VantaVault data...');
    
    // Core Layout State
    const [activeTab, setActiveTab] = useState<AppTab>('store');
    const [discordMatchPhase, setDiscordMatchPhase] = useState<DiscordMatchPhase>({ phase: "none", matchId: "", queueId: "", mapName: "", mapImage: "", agentName: "", agentImage: "", timeLeft: 0, partySize: 0, allyCount: 0, enemyCount: 0, allyScore: 0, enemyScore: 0, scoreAvailable: false });
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true);
    const [profileTarget, setProfileTarget] = useState<{ puuid: string; gameName: string; tagLine: string } | null>(null);
    const [pendingAccountDeletes, setPendingAccountDeletes] = useState<Array<{ puuid: string; name: string; deadline: number; committing?: boolean }>>([]);
	const previousSoundPhaseRef = useRef<DiscordMatchPhase["phase"]>("none");

    const selectAppTab = useCallback((tab: AppTab) => {
        setActiveTab(tab);
        if (tab !== 'profile') setProfileTarget(null);
        setIsWorkspaceOpen(tab === 'skins');
    }, []);

    const notifications = useAppNotifications(activeAccount?.puuid);
    useWishlistWatcher(activeAccount?.puuid, !isLoading);

    useEffect(() => {
        setProfileTarget(null);
    }, [activeAccount?.puuid]);

    useEffect(() => {
        const onMatchPhase = (event: Event) => {
            const detail = (event as CustomEvent<Partial<DiscordMatchPhase>>).detail;
            const nextPhase = {
                phase: detail?.phase || "none",
                matchId: detail?.matchId || "",
                queueId: detail?.queueId || "",
                mapName: detail?.mapName || "",
                mapImage: detail?.mapImage || "",
                agentName: detail?.agentName || "",
                agentImage: detail?.agentImage || "",
                timeLeft: detail?.timeLeft || 0,
                partySize: detail?.partySize || 0,
                allyCount: detail?.allyCount || 0,
                enemyCount: detail?.enemyCount || 0,
                allyScore: detail?.allyScore || 0,
                enemyScore: detail?.enemyScore || 0,
                scoreAvailable: Boolean(detail?.scoreAvailable),
            };
			if (nextPhase.phase === "pregame" && previousSoundPhaseRef.current !== "pregame") {
				playUiSound("matchFound");
			}
			previousSoundPhaseRef.current = nextPhase.phase;
            setDiscordMatchPhase(nextPhase);
        };
        window.addEventListener("vantavault:match-phase", onMatchPhase);
        return () => window.removeEventListener("vantavault:match-phase", onMatchPhase);
    }, []);

    useEffect(() => {
        const activeAccountIsLocal = Boolean(
            activeAccount?.puuid &&
            localPuuid &&
            activeAccount.puuid.toLowerCase() === localPuuid.toLowerCase()
        );
        const enabled = Boolean(useLocalSso && isLocalClientActive && activeAccountIsLocal);
        void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("set_live_match_overlay_enabled", { enabled }))
            .catch(() => {});
    }, [activeAccount?.puuid, isLocalClientActive, localPuuid, useLocalSso]);

    useEffect(() => {
        let details = activeTab === "store" ? "Browsing Store" : activeTab === "profile" ? "Viewing Profiles" : "Building a Loadout";
        let activityState = "VantaVault desktop companion";
        const queueName = queueLabel(discordMatchPhase.queueId, queues) || "VALORANT";
        if (discordMatchPhase.phase === "pregame") {
            details = `Agent Select · ${queueName}`;
            activityState = discordMatchPhase.mapName
                ? `${discordMatchPhase.agentName || "Choosing agent"} on ${discordMatchPhase.mapName}`
                : discordMatchPhase.agentName || "Choosing agent";
        } else if (discordMatchPhase.phase === "coregame") {
            const score = discordMatchPhase.scoreAvailable
                ? ` · ${discordMatchPhase.allyScore}–${discordMatchPhase.enemyScore}`
                : "";
            details = `${queueName}${score}`;
            activityState = discordMatchPhase.agentName && discordMatchPhase.mapName
                ? `${discordMatchPhase.agentName} on ${discordMatchPhase.mapName}`
                : discordMatchPhase.mapName || discordMatchPhase.agentName || "Live match";
        }
        const inMatch = discordMatchPhase.phase === "pregame" || discordMatchPhase.phase === "coregame";
        const endAt = discordMatchPhase.phase === "pregame" && discordMatchPhase.timeLeft > 0
            ? Math.floor(Date.now() / 1000) + discordMatchPhase.timeLeft
            : null;
        void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("set_discord_presence", {
                activity: {
                    details,
                    state: activityState,
                    activityKey: inMatch ? `${discordMatchPhase.matchId || "match"}:${discordMatchPhase.phase}` : `app:${activeTab}`,
                    largeImage: inMatch ? discordMatchPhase.mapImage : "",
                    largeText: inMatch ? discordMatchPhase.mapName : "",
                    smallImage: inMatch ? discordMatchPhase.agentImage : "",
                    smallText: inMatch ? discordMatchPhase.agentName : "",
                    partyCurrent: discordMatchPhase.partySize > 1 ? discordMatchPhase.partySize : 0,
                    partyMax: discordMatchPhase.partySize > 1 ? 5 : 0,
                    endAt,
                },
            }))
            .catch(() => {});
    }, [activeTab, discordMatchPhase, queues]);
    
    // Modals
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAccountsOpen, setIsAccountsOpen] = useState(false);
    const [showAddAccount, setShowAddAccount] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [isPortable, setIsPortable] = useState(false);
    const [portableUpdate, setPortableUpdate] = useState<PortableUpdateState | null>(null);
    const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateProgress, setUpdateProgress] = useState<number | null>(null);
    const [updateNotes, setUpdateNotes] = useState<ReleaseNotes | null>(null);
    const [showUpdateNotes, setShowUpdateNotes] = useState(false);
    const [updateReady, setUpdateReady] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [lastUpdateCheck, setLastUpdateCheck] = useState<number | null>(null);
    const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
    const [showReleaseNotes, setShowReleaseNotes] = useState(false);
    const isAndroid = isAndroidRuntime();

    useEffect(() => {
        const onShortcut = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey) return;
            const key = event.key.toLowerCase();
            const commandKey = event.ctrlKey || event.metaKey;

            if (commandKey && event.shiftKey && key === 'r') {
                event.preventDefault();
                void import('@tauri-apps/plugin-process')
                    .then(({ relaunch }) => relaunch())
                    .catch(() => window.location.reload());
                return;
            }
            if (event.key === 'F5' || (commandKey && !event.shiftKey && key === 'r')) {
                event.preventDefault();
                window.location.reload();
                return;
            }
            if (commandKey && key === ',') {
                event.preventDefault();
                setIsSettingsOpen((current) => !current);
                return;
            }
            if (!commandKey || event.shiftKey) return;
            if ((event.target as Element | null)?.closest('input, textarea, select, [contenteditable="true"]')) return;
            if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;

            const tab: AppTab | null = key === '1' ? 'store' : key === '2' ? 'profile' : key === '3' ? 'skins' : null;
            if (!tab) return;
            event.preventDefault();
            selectAppTab(tab);
        };

        window.addEventListener('keydown', onShortcut);
        return () => window.removeEventListener('keydown', onShortcut);
    }, [selectAppTab]);

    const {
        showErrorModal, errorMessage, handleApplyLoadout, handleCloseErrorModal,
        showToast, toastMessage, handleCloseToast,
        setShowErrorModal, setErrorMessage, setShowToast, setToastMessage,
        handleRestoreLoadout, restorePoint, isApplying
    } = useLoadout(activeAccount);

    useEffect(() => {
        const onAppError = (event: Event) => {
            const message = (event as CustomEvent<string>).detail;
            if (!message) return;
            setToastMessage(message);
            setShowToast(true);
			playUiSound("error");
            publishAppNotification({ id: `error:${message}`, kind: "error", title: "VantaVault needs attention", body: message, action: activeTab, accountPuuid: activeAccount?.puuid });
        };
        window.addEventListener("vantavault:error", onAppError);
        return () => window.removeEventListener("vantavault:error", onAppError);
    }, [activeAccount?.puuid, activeTab, setShowToast, setToastMessage]);

    const {
        presets, selectedPreset, isEditing, editingPreset,
        showPresetNameModal, dropdownPreset, namingMode, showConfirmationModal, currentLoadout,
        handleSave, handleSavePresetName, handlePresetSelect, handlePresetDelete, handleConfirmDelete,
        handleCloseConfirmationModal, handleCancel, handleApplyComplete, handleApplyDraftComplete, handleOpenPresetNameModal, handleOpenRenameModal,
        handleDropdownVariant, handleClosePresetNameModal, handleTogglePreset,
        handleAgentAssignment, handleItemChange, handleIdentityChange, handleSpraysChange, handleFlexesChange, handleExpressionsChange,
        handleImportPresetAction, handleApplySingleComplete, refreshFromGame, gameMeta,
    } = usePresets(scopedInitialData.presets, scopedInitialData.playerLoadout, (error) => {
        if (error instanceof LocalClientError) {
            setErrorMessage(error.message);
            setShowErrorModal(true);
        } else {
            console.warn("Preset operation failed", error instanceof Error ? error.message : String(error));
            // Show what actually failed (with its VV- code) instead of a generic line.
            const code = (error as { code?: string } | null)?.code;
            const detail = error instanceof Error && error.message ? `${error.message}${code ? ` (${code})` : ""}` : "";
            setErrorMessage(`The preset operation could not be completed. Your current edit was kept.${detail ? ` ${detail}` : ""}`);
            setShowErrorModal(true);
        }
    }, scopedInitialData.gameMeta, dataRevision, activeAccount);

    const previousMatchPhaseRef = useRef<DiscordMatchPhase["phase"]>("none");
    useEffect(() => {
        const previous = previousMatchPhaseRef.current;
        const current = discordMatchPhase.phase;
        previousMatchPhaseRef.current = current;
        if (!activeAccount || previous === "none" || current !== "none") return;

        // The backend restores the pre-match snapshot after eight inactive
        // checks. Re-read it shortly afterwards so Current Loadout reflects
        // the restored game state without requiring an app restart.
        const timer = window.setTimeout(() => {
            void refreshFromGame();
        }, 10_000);
        return () => window.clearTimeout(timer);
    }, [activeAccount, discordMatchPhase.phase, refreshFromGame]);

    const [showImportModal, setShowImportModal] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [importError, setImportError] = useState('');

    useEffect(() => {
        setShowImportModal(false);
        setImportCode('');
        setImportError('');
    }, [accountOwner]);

    useEffect(() => {
        if (isAndroid) {
            setLaunchAtStartupState(false);
            return;
        }
        import('@/services/autostart').then(async ({ syncLaunchAtStartup, readLaunchAtStartupState }) => {
            await syncLaunchAtStartup().catch(() => {});
            const enabled = await readLaunchAtStartupState();
            setLaunchAtStartupState(enabled);
        });
        getTraySettings().then(setTraySettingsState).catch(() => {});
        setDesktopNotificationsState(getDesktopNotificationsEnabled());
    }, [isAndroid]);

    const changeLaunchAtStartup = useCallback(async (enabled: boolean) => {
        setLaunchAtStartupState(enabled);
        try {
            const { setLaunchAtStartup } = await import('@/services/autostart');
            await setLaunchAtStartup(enabled);
        } catch {
            setLaunchAtStartupState(!enabled);
            setToastMessage("Windows didn't accept the startup change. Try again.");
            setShowToast(true);
        }
    }, [setShowToast, setToastMessage]);

    const changeTraySettings = useCallback(async (patch: Partial<TraySettings>) => {
        const previous = traySettings;
        const next = { ...previous, ...patch };
        setTraySettingsState(next);
        try {
            await setTraySettings(next);
        } catch {
            setTraySettingsState(previous);
            setToastMessage("That setting couldn't be saved. Try again.");
            setShowToast(true);
        }
    }, [traySettings, setShowToast, setToastMessage]);

    const changeDesktopNotifications = useCallback((enabled: boolean) => {
        setDesktopNotificationsEnabled(enabled);
        setDesktopNotificationsState(enabled);
    }, []);

    useEffect(() => {
        if (!CURRENT_RELEASE || appVersion !== CURRENT_RELEASE.version) return;
        try {
            if (localStorage.getItem(RELEASE_NOTES_STORAGE_KEY) !== appVersion) setShowReleaseNotes(true);
        } catch {
            setShowReleaseNotes(true);
        }
    }, [appVersion]);

    const dismissReleaseNotes = useCallback(() => {
        try {
            if (CURRENT_RELEASE) localStorage.setItem(RELEASE_NOTES_STORAGE_KEY, CURRENT_RELEASE.version);
        } catch { /* The modal can still close when storage is unavailable. */ }
        setShowReleaseNotes(false);
    }, []);

    // The player hears about a downloaded update once per version, wherever they are in the app.
    const notifiedUpdateRef = useRef("");
    const notificationAccountRef = useRef(activeAccount?.puuid);
    useEffect(() => { notificationAccountRef.current = activeAccount?.puuid; });
    const announceUpdateReady = useCallback((version?: string | null) => {
        if (!version || notifiedUpdateRef.current === version) return;
        notifiedUpdateRef.current = version;
        publishAppNotification({
            id: `update-ready:${version}`,
            kind: "system",
            title: `VantaVault ${version} is ready`,
            body: "Restart VantaVault to finish updating. You can also do it from Settings → About.",
            accountPuuid: notificationAccountRef.current,
        });
    }, []);

    const applyPortableStatus = useCallback((next: PortableUpdateState | null) => {
        setPortableUpdate(next);
        setLastUpdateCheck(next?.checkedAt ?? null);
        setUpdateCheckError(next?.status === "failed" ? next.message || "Portable update failed." : null);
        if (next?.status === "ready") announceUpdateReady(next.version);
    }, [announceUpdateReady]);

    // Installer build: an update downloads in the background as soon as it is found.
    // Restarting installs it, so nothing replaces the app while it is in use.
    const downloadingRef = useRef(false);
    const updateReadyRef = useRef(false);
    const downloadUpdate = useCallback(async (update: Update) => {
        if (downloadingRef.current || updateReadyRef.current) return;
        downloadingRef.current = true;
        setIsUpdating(true);
        setUpdateProgress(0);
        let total = 0;
        let received = 0;
        try {
            await update.download((event) => {
                if (event.event === "Started") total = event.data.contentLength ?? 0;
                if (event.event === "Progress" && total) {
                    received += event.data.chunkLength;
                    setUpdateProgress(Math.min(99, Math.round((received * 100) / total)));
                }
            });
            updateReadyRef.current = true;
            setUpdateReady(true);
            announceUpdateReady(update.version);
        } catch (error) {
            setUpdateCheckError(error instanceof Error ? error.message : String(error || "The update download failed."));
        } finally {
            downloadingRef.current = false;
            setIsUpdating(false);
            setUpdateProgress(null);
        }
    }, [announceUpdateReady]);

    const takeInstallerCheck = useCallback((update: Update | null) => {
        setAvailableUpdate(update);
        setLastUpdateCheck(Date.now());
        setUpdateCheckError(null);
        if (update) void downloadUpdate(update);
    }, [downloadUpdate]);

    const startPortableCheck = useCallback(async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("portable_start_update");
        applyPortableStatus(await invoke<PortableUpdateState>("portable_update_status").catch(() => null));
    }, [applyPortableStatus]);

    useEffect(() => {
        let alive = true;
        let backgroundCheck = 0;
        const checkForUpdates = async () => {
            try {
                if (isAndroid) {
                    const { getVersion } = await import("@tauri-apps/api/app");
                    if (alive) setAppVersion(await getVersion());
                    return;
                }
                const [{ getVersion }, { check }, { invoke }] = await Promise.all([
                    import("@tauri-apps/api/app"),
                    import("@tauri-apps/plugin-updater"),
                    import("@tauri-apps/api/core"),
                ]);
                const version = await getVersion();
                const portable = await invoke<boolean>("is_portable").catch(() => false);
                if (!alive) return;
                setAppVersion(version);
                setIsPortable(portable);
                if (portable) {
                    const portableStatus = await invoke<PortableUpdateState>("portable_update_status").catch(() => null);
                    if (!alive) return;
                    setAvailableUpdate(null);
                    applyPortableStatus(portableStatus);
                    // Check shortly after startup, once the app has settled, so startup stays quick.
                    backgroundCheck = window.setTimeout(() => {
                        if (alive) void startPortableCheck().catch(() => undefined);
                    }, 15_000);
                    return;
                }
                const update = await check();
                if (!alive) return;
                takeInstallerCheck(update ?? null);
            } catch (error) {
                if (!alive) return;
                setAppVersion((current) => current || "dev");
                setLastUpdateCheck(Date.now());
                setUpdateCheckError(error instanceof Error ? error.message : String(error || "Update check failed."));
            }
        };
        void checkForUpdates();
        return () => {
            alive = false;
            window.clearTimeout(backgroundCheck);
        };
    }, [isAndroid, applyPortableStatus, startPortableCheck, takeInstallerCheck]);

    const checkForUpdatesNow = useCallback(async () => {
        if (isAndroid) return;
        if (isCheckingUpdate || updateReadyRef.current) return;
        setIsCheckingUpdate(true);
        setUpdateCheckError(null);
        try {
            if (isPortable) {
                await startPortableCheck();
                return;
            }
            const [{ getVersion }, { check }] = await Promise.all([
                import("@tauri-apps/api/app"),
                import("@tauri-apps/plugin-updater"),
            ]);
            setAppVersion(await getVersion());
            takeInstallerCheck((await check()) ?? null);
        } catch (error) {
            setUpdateCheckError(
                error instanceof Error ? error.message : String(error || "Update check failed.")
            );
        } finally {
            setIsCheckingUpdate(false);
        }
    }, [isAndroid, isCheckingUpdate, isPortable, startPortableCheck, takeInstallerCheck]);

    useEffect(() => {
        const status = portableUpdate?.status;
        if (!isPortable || (status !== "checking" && status !== "downloading")) return;
        let alive = true;
        const refresh = async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const next = await invoke<PortableUpdateState>("portable_update_status").catch(() => null);
            if (!alive || !next) return;
            applyPortableStatus(next);
        };
        void refresh();
        const interval = window.setInterval(() => void refresh(), 750);
        return () => {
            alive = false;
            window.clearInterval(interval);
        };
    }, [isPortable, portableUpdate?.status, applyPortableStatus]);

    // Re-check every 6 hours so a long-running app still picks up new releases.
    useEffect(() => {
        if (isAndroid) return;
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
        const handle = setInterval(() => {
            void checkForUpdatesNow();
        }, SIX_HOURS_MS);
        return () => clearInterval(handle);
    }, [checkForUpdatesNow, isAndroid]);

    // Manual retry when the background download failed.
    const installUpdate = useCallback(async () => {
        if (availableUpdate) await downloadUpdate(availableUpdate);
    }, [availableUpdate, downloadUpdate]);

    const restartForUpdate = useCallback(async () => {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            if (isPortable) {
                await invoke("portable_restart_to_update");
                return;
            }
            if (updateReadyRef.current && availableUpdate) {
                // Release the backend's file lock before the installer replaces it, then install the
                // downloaded, signature-checked update and reopen from the installed location.
                setIsUpdating(true);
                await invoke("prepare_for_update");
                await availableUpdate.install();
            }
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
        } catch (error) {
            setIsUpdating(false);
            setErrorMessage(
                error instanceof Error
                    ? `Couldn't finish the update: ${error.message}. Please close and reopen VantaVault.`
                    : "Couldn't finish the update. Please close and reopen VantaVault."
            );
            setShowErrorModal(true);
        }
    }, [availableUpdate, isPortable, setErrorMessage, setShowErrorModal]);

    // What the top-bar update button shows. Nothing while checking or up to date.
    const pendingVersion = isPortable ? portableUpdate?.version ?? "" : availableUpdate?.version ?? "";
    const updatePhase: UpdatePhase | null = isPortable
        ? portableUpdate?.status === "ready" ? "ready" : portableUpdate?.status === "downloading" ? "downloading" : null
        : updateReady ? "ready" : availableUpdate ? isUpdating ? "downloading" : "retry" : null;

    // The new version's notes, so players can see what is coming before it installs. The installer's
    // update already carries them; the portable build reads the same release from GitHub.
    useEffect(() => {
        if (!updatePhase || !/^d+.d+.d+$/.test(pendingVersion) || updateNotes?.version === pendingVersion) return;
        let alive = true;
        const load = async () => {
            let body = !isPortable ? availableUpdate?.body ?? "" : "";
            if (!body) {
                const { fetch } = await import("@tauri-apps/plugin-http");
                const response = await fetch(`https://api.github.com/repos/akawazak/valo-project/releases/tags/v${pendingVersion}`, { headers: { Accept: "application/vnd.github+json" } });
                if (!response.ok) return;
                body = String((await response.json() as { body?: unknown }).body ?? "");
            }
            if (alive && body) setUpdateNotes(parseReleaseNotes(body, pendingVersion));
        };
        void load().catch(() => undefined);
        return () => { alive = false; };
    }, [updatePhase, pendingVersion, isPortable, availableUpdate, updateNotes?.version]);

    const loadInitialData = useCallback(async () => {
        const owner = accountOwner ? { puuid: accountOwner, region: activeAccount?.region || "" } : undefined;
        const ownerId = owner?.puuid || "";
        const request = ++initialRequestRef.current;
        const isCurrent = () => request === initialRequestRef.current && accountOwnerRef.current === ownerId
            && (localStorage.getItem("riot_puuid") || "") === ownerId;
        try {
            const [fetchedPresets, settings] = await Promise.all([getPresets(owner), getSettings()]);
            if (!isCurrent()) return;
            let playerLoadout: Record<string, LoadoutItemV1> = {};
            let gameMeta: GameLoadoutMeta = { sprays: [], flexes: [], expressions: [] };
            let loadoutAvailable = false;
            let loadoutError = "";
            try {
                const full = await getPlayerLoadoutData(owner);
                if (!isCurrent()) return;
                loadoutAvailable = true;
                playerLoadout = full.loadout;
                gameMeta = {
                    sprays: full.sprays || [],
                    flexes: full.flexes || [],
                    expressions: full.expressions || [],
                    identity: full.identity,
                };
            } catch (error) {
                if (!isCurrent()) return;
                if (!(error instanceof LocalClientError) && !(error instanceof AppRequestError)) throw error;
                loadoutError = error.message;
            }
            setInitialData({ owner: ownerId, playerLoadout, presets: Array.isArray(fetchedPresets) ? fetchedPresets : [], gameMeta, loadoutAvailable, loadoutError });
            setDataRevision(r => r + 1);
            setAutoSelectAgent(settings.autoSelectAgent);
            setUseLocalSso(settings.useLocalSso);
            setAutoSyncMatches(settings.autoSyncMatches);
            setMatchRetentionDays(settings.matchRetentionDays);
            setShowOfflineFriends(settings.showOfflineFriends);
            setShowLiveMatch(settings.showLiveMatch);
            setShowPartyWidget(settings.showPartyWidget);
            setShowUnownedCosmetics(settings.showUnownedCosmetics);
			setSoundEnabled(settings.soundEnabled);
			setSoundVolume(settings.soundVolume);
			const useLegacyUI = !settings.uiSettingsSaved;
			const backendAppearance = settings.appearance || {} as Settings["appearance"];
			let effectiveAppearance = backendAppearance;
			if (useLegacyUI) {
				try {
					const localAppearance = JSON.parse(localStorage.getItem("appearance_settings") || "{}") as Partial<Settings["appearance"]>;
					effectiveAppearance = { ...backendAppearance, ...localAppearance };
				} catch { /* Keep the validated backend appearance. */ }
			}
			const effectiveTheme = useLegacyUI && localStorage.getItem("theme") === "light" ? "light" : settings.theme;
			const localAccent = localStorage.getItem("accent_theme");
			const effectiveAccent = useLegacyUI && (localAccent === "aqua" || localAccent === "violet" || localAccent === "gold") ? localAccent : settings.accentTheme;
			const localInterface = localStorage.getItem("interface_theme");
			const effectiveInterface = useLegacyUI && (localInterface === "protocol" || localInterface === "cinematic") ? localInterface : settings.interfaceTheme;
			setTheme(effectiveTheme);
			setAccentTheme(effectiveAccent);
			setInterfaceTheme(effectiveInterface);
			setAppearance(effectiveAppearance);
            prevSettingsRef.current = settings;
            localStorage.setItem("use_local_sso", settings.useLocalSso ? "true" : "false");
            setIsLoading(false);
        } catch (error) {
            if (!isCurrent()) return;
            if (error instanceof LocalClientError || error instanceof AppRequestError) {
                setInitialData({ ...EMPTY_ACCOUNT_DATA, owner: ownerId, loadoutError: error.message });
                setDataRevision(r => r + 1);
                if (error instanceof AppRequestError) {
                    console.warn("Initial account data is temporarily unavailable", { code: error.code, status: error.status });
                    reportAppError(error.message);
                }
                setIsLoading(false);
            } else {
                console.warn("Unexpected startup failure", error instanceof Error ? error.message : String(error));
                setErrorMessage("An unexpected error occurred while loading data.");
                setShowErrorModal(true);
                setIsLoading(false);
            }
        }
    }, [accountOwner, activeAccount?.region, setAccentTheme, setAppearance, setErrorMessage, setInterfaceTheme, setShowErrorModal, setTheme]);

    useEffect(() => {
        if (isBackendOnline) {
            setLoadingMessage('Loading your VantaVault data...');
            loadInitialData();
        } else {
            setIsLoading(false);
        }
        return () => { initialRequestRef.current += 1; };
    }, [isBackendOnline, isClientHealthy, storefrontRefreshKey, loadInitialData]);

    const prevSettingsRef = useRef<Settings | null>(null);

    useEffect(() => {
        if (
            autoSelectAgent === undefined ||
            useLocalSso === undefined ||
            autoSyncMatches === undefined ||
            matchRetentionDays === undefined ||
            showOfflineFriends === undefined ||
            showLiveMatch === undefined ||
            showPartyWidget === undefined ||
			showUnownedCosmetics === undefined ||
			soundEnabled === undefined ||
			soundVolume === undefined
        ) return;
		const next = { autoSelectAgent, useLocalSso, autoSyncMatches, matchRetentionDays, showOfflineFriends, showLiveMatch, showPartyWidget, showUnownedCosmetics, soundEnabled, soundVolume, theme, accentTheme, interfaceTheme, uiSettingsSaved: true, appearance };
        if (JSON.stringify(prevSettingsRef.current) === JSON.stringify(next)) return;
        void saveSettings(next).then(() => {
            prevSettingsRef.current = next;
        }).catch((error) => {
            console.warn("Failed to save settings", error instanceof Error ? error.message : String(error));
            reportAppError("Settings could not be saved. Please try again.");
        });
	}, [accentTheme, appearance, autoSelectAgent, autoSyncMatches, interfaceTheme, matchRetentionDays, showOfflineFriends, showLiveMatch, showPartyWidget, showUnownedCosmetics, soundEnabled, soundVolume, theme, useLocalSso]);

	useEffect(() => {
		if (soundEnabled === undefined || soundVolume === undefined) return;
		configureUiSounds({ enabled: soundEnabled, volume: soundVolume });
	}, [soundEnabled, soundVolume]);

    useEffect(() => {
        let alive = true;
        setProfileIdentity({ currentRank: "Unranked", currentTier: 0, accountLevel: null });
        if (!isClientHealthy || !activeAccount?.puuid) return;

        void getProfileOverview({ puuid: activeAccount.puuid, region: activeAccount.region })
            .then((overview) => {
                if (!alive) return;
                const tierName = overview.currentRank?.tierName?.trim() || "";
                const competitiveTier = overview.currentRank?.competitiveTier || 0;
                const rankLabel = competitiveTier > 0 && tierName.toLowerCase() !== "unranked"
                    ? tierName
                    : "Unranked";
                setProfileIdentity({
                    currentRank: rankLabel,
                    currentTier: competitiveTier,
                    accountLevel: overview.account?.level || null,
                });
            })
            .catch(() => {
                if (alive) setProfileIdentity({ currentRank: "Unranked", currentTier: 0, accountLevel: null });
            });

        return () => {
            alive = false;
        };
    }, [activeAccount?.puuid, activeAccount?.region, isClientHealthy]);

    const handleToggleLocalSso = (val: boolean) => {
        setUseLocalSso(val);
        localStorage.setItem("use_local_sso", val ? "true" : "false");
    };

    const handleToggleFavorite = (puuid: string) => {
        const stored = getStoredAccounts();
        const updated = stored.map((acc: RiotAccount) => {
            if (acc.puuid === puuid) {
                return { ...acc, favorite: !acc.favorite };
            }
            return acc;
        });
        void saveStoredAccounts(updated)
            .then(refreshAccountsList)
            .catch(() => reportAppError("The account preference could not be stored securely."));
    };

    const handleSkinSelect = (weaponId: string, skinId: string, levelId: string, chromaId: string) => {
        handleItemChange(weaponId, { skinId, skinLevelId: levelId, chromaId });
    };

    const handleBuddySelect = (weaponId: string, charmID: string, charmLevelID: string) => {
        handleItemChange(weaponId, { charmID, charmLevelID });
    };

    const handleSkinReset = (weaponId: string) => {
        handleItemChange(weaponId, null);
    };

    const handleApply = async () => {
        const presetToApply = editingPreset || selectedPreset;
        if (!presetToApply) return;
        const requestToApply = buildApplyRequest(presetToApply);
        const applied = await handleApplyLoadout(requestToApply, presetToApply.name);
        if (!applied) return;
        if (isEditing) handleApplyDraftComplete(presetToApply);
        else handleApplyComplete(presetToApply);
    };

    const handlePresetApply = async (preset: Preset) => {
        const requestToApply = buildApplyRequest(preset);
        const applied = await handleApplyLoadout(requestToApply, preset.name);
        if (applied) handleApplyComplete(preset);
    };

    const handleApplyWeapon = async (weaponId: string) => {
        const item = currentLoadout[weaponId];
        if (!item) return false;
        const applied = await handleApplyLoadout({ loadout: { [weaponId]: item } }, weapons.find(weapon => weapon.uuid === weaponId)?.displayName || "weapon change");
        if (applied) handleApplySingleComplete(weaponId);
        return applied;
    };

    const buildApplyRequest = (preset: Preset) => buildPresetApplyRequest(preset, presets);

    const getParent = (preset: Preset | null | undefined) => {
        if (!preset?.parentUuid) return undefined;
        return presets.find(p => p.uuid === preset.parentUuid)?.loadout;
    };

    const handleExportPreset = async (preset: Preset) => {
        const scope = captureAccountRequest(activeAccount);
        if (!scope) return;
        try {
            const code = exportPreset(preset, presets);
            await navigator.clipboard.writeText(code);
            if (!scope.isCurrent()) return;
            setToastMessage(`Copied share code for "${preset.name}" to clipboard!`);
            setShowToast(true);
			playUiSound("success");
        } catch (e) {
            if (!scope.isCurrent()) return;
            console.warn("Preset export failed", e instanceof Error ? e.message : String(e));
            setErrorMessage('The share code could not be copied. Check clipboard access and try again.');
            setShowErrorModal(true);
        }
    };

    const handleImportSubmit = async () => {
        if (!importCode.trim()) return;
        const scope = captureAccountRequest(activeAccount);
        if (!scope) return;
        try {
            const imported = await handleImportPresetAction(importCode.trim());
            if (!imported || !scope.isCurrent()) return;
            setShowImportModal(false);
            setImportCode('');
            setImportError('');
            setToastMessage('Preset imported successfully!');
            setShowToast(true);
			playUiSound("success");
        } catch (err: unknown) {
            if (!scope.isCurrent()) return;
            setImportError(err instanceof Error ? err.message : 'Invalid preset code.');
        }
    };

    const requestDeleteAccount = (puuid: string) => {
        const account = accounts.find(account => account.puuid === puuid);
        if (!account) return;
        cancelAccountRefresh(account);
        setPendingAccountDeletes(current => current.some(item => item.puuid === puuid) ? current : [
            ...current, { puuid, name: account.gameName, deadline: Date.now() + 5_000 },
        ]);
    };

    useEffect(() => {
        const timers = pendingAccountDeletes.filter(item => !item.committing).map(item => window.setTimeout(() => {
            setPendingAccountDeletes(current => current.map(entry => entry.puuid === item.puuid ? { ...entry, committing: true } : entry));
            void handleDeleteAccount(item.puuid).catch(() => {
                // DataContext reports persistence failures; the row reappears.
            }).finally(() => {
                setPendingAccountDeletes(current => current.filter(entry => entry.puuid !== item.puuid));
            });
        }, Math.max(0, item.deadline - Date.now())));
        return () => timers.forEach(window.clearTimeout);
    }, [pendingAccountDeletes, handleDeleteAccount]);

    const onSelectPresetToEdit = (preset: Preset) => {
        handlePresetSelect(preset);
        setIsWorkspaceOpen(true);
    };

    if (isLoading || dataContextLoading) {
        return (
            <div className="loading-screen">
                <main className="loading-launch" role="status" aria-live="polite" aria-busy="true">
                    <div className="loading-brand" aria-label="VantaVault">
                        <img src="/brand-mark.svg" alt="" width="42" height="42" />
                        <span>VANTA<strong>VAULT</strong></span>
                    </div>
                    <div className="loading-copy">
                        <span className="loading-kicker">Desktop companion</span>
                        <h1>Preparing your session</h1>
                        <p className="loading-text">{loadingMessage}</p>
                    </div>
                    <div className="loading-progress" aria-hidden="true">
                        <span />
                    </div>
                </main>
            </div>
        );
    }

    const activePreset = editingPreset || selectedPreset;

    return (
        <div className="app-container">
            <SessionEndToast onOpenRecap={() => {
                try { sessionStorage.setItem(OPEN_RECAP_FLAG, "1"); } catch { /* storage unavailable */ }
                setProfileTarget(null);
                setActiveTab("profile");
                window.dispatchEvent(new Event("vv:open-session-recap"));
            }} />
            <AppTopbar
                activeTab={activeTab}
                onTabChange={selectAppTab}
                activeAccount={activeAccount}
                useLocalSso={useLocalSso || false}
                isLocalClientActive={isLocalClientActive}
                isBackendOnline={isBackendOnline}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenAccounts={() => setIsAccountsOpen(true)}
                playerCardId={gameMeta.identity?.playerCardId || scopedInitialData.gameMeta.identity?.playerCardId}
                socialControl={(showPartyWidget ?? true) ? <LivePartyStatus showOfflineByDefault={showOfflineFriends ?? false} /> : null}
                updateControl={updatePhase && pendingVersion ? <UpdateButton
                    phase={updatePhase}
                    version={pendingVersion}
                    progress={isPortable ? portableUpdate?.progress ?? null : updateProgress}
                    notes={updateNotes?.version === pendingVersion ? updateNotes : null}
                    busy={!isPortable && updatePhase === "ready" && isUpdating}
                    onRestart={() => void restartForUpdate()}
                    onRetry={() => void installUpdate()}
                    onSeeAll={() => setShowUpdateNotes(true)}
                /> : null}
                notificationControl={<NotificationCenter items={notifications.items} unreadCount={notifications.unreadCount} onRead={notifications.markRead} onReadAll={notifications.markAllRead} onClear={notifications.clear} onDismiss={notifications.dismiss} onNavigate={selectAppTab} />}
            />

            <div className="app-content-wrapper">
                <main className="app-main-content" data-active-tab={activeTab}>
                    <div hidden={activeTab !== 'store'}>
                        <StorePanels key={accountOwner || "guest"} refreshKey={storefrontRefreshKey} onConnectAccount={() => setIsAccountsOpen(true)} />
                    </div>
                    {activeTab === 'skins' && restorePoint && <LoadoutRestore point={restorePoint} weapons={weapons} busy={isApplying} onRestore={async () => {
                        if (await handleRestoreLoadout()) await refreshFromGame();
                    }} />}
                    {activeTab === 'profile' ? (
                        <ProfilePanel
                            key={`${activeAccount?.puuid || "none"}:${profileTarget?.puuid || "own"}:${storefrontRefreshKey}`}
                            onConnectAccount={() => setIsAccountsOpen(true)}
                            ownPlayerCardId={gameMeta.identity?.playerCardId || scopedInitialData.gameMeta.identity?.playerCardId}
                            requestedProfile={profileTarget}
                            onRequestedProfileChange={setProfileTarget}
                            autoSyncMatches={autoSyncMatches ?? true}
                        />
                    ) : activeTab === 'skins' ? (
                        isWorkspaceOpen ? (
                            <ArsenalView
                                key={accountOwner || "guest"}
                                weapons={weapons}
                                currentLoadout={currentLoadout}
                                parent={getParent(activePreset)}
                                ownedLevelIDs={ownedLevelIDs}
                                ownedChromaIDs={ownedChromaIDs}
                                contentTiers={contentTiers}
                                onSkinSelect={handleSkinSelect}
                                onBuddySelect={handleBuddySelect}
                                onSkinReset={handleSkinReset}
                                presets={presets}
                                selectedPreset={selectedPreset}
                                defaultPreset={defaultPreset}
                                onPresetSelect={handlePresetSelect}
                                onPresetApply={handlePresetApply}
                                onPresetDelete={handlePresetDelete}
                                onPresetRename={handleOpenRenameModal}
                                onCreateVariant={handleDropdownVariant}
                                onTogglePreset={handleTogglePreset}
                                onExportPreset={handleExportPreset}
                                onImportPresetClick={() => setShowImportModal(true)}
                                onNewPreset={() => {
                                    handleOpenPresetNameModal(NamingMode.New);
                                }}
                                agents={agents}
                                allAgents={allAgents}
                                ownedAgentIds={ownedAgentIDs}
                                isEditing={isEditing}
                                editingPreset={editingPreset}
                                onSave={handleSave}
                                onCancel={handleCancel}
                                onSaveAsNew={() => handleOpenPresetNameModal(NamingMode.SaveAsNew)}
                                onApply={handleApply}
                                onApplyWeapon={handleApplyWeapon}
                                currentCardId={activePreset?.identity?.playerCardId || ""}
                                currentTitleId={activePreset?.identity?.playerTitleId || ""}
                                onSelectCard={(cardId) => handleIdentityChange(cardId, activePreset?.identity?.playerTitleId || "")}
                                onSelectTitle={(titleId) => handleIdentityChange(activePreset?.identity?.playerCardId || "", titleId)}
                                currentSprays={activePreset?.sprays}
                                onUpdateSprays={handleSpraysChange}
                                currentFlexes={activePreset?.flexes}
                                onUpdateFlexes={handleFlexesChange}
                                currentExpressions={activePreset?.expressions}
                                onUpdateExpressions={handleExpressionsChange}
                                onAgentAssignment={handleAgentAssignment}
                                gameIdentity={gameMeta.identity}
                                gameSprays={gameMeta.sprays}
                                gameFlexes={gameMeta.flexes}
                                gameExpressions={gameMeta.expressions}
                                accountName={activeAccount ? `${activeAccount.gameName}#${activeAccount.tagLine}` : ""}
                                accountLevel={gameMeta.identity?.accountLevel || profileIdentity.accountLevel || undefined}
                                accountRank={profileIdentity.currentRank}
                                accountRankTier={profileIdentity.currentTier}
                                showUnownedCosmetics={showUnownedCosmetics ?? false}
                                loadoutAvailable={scopedInitialData.loadoutAvailable}
                                loadoutError={scopedInitialData.loadoutError}
                                onRefresh={() => { void loadInitialData(); }}
                            />
                        ) : (
                            <PresetList
                                presets={presets}
                                selectedPreset={selectedPreset}
                                defaultPreset={defaultPreset}
                                agents={agents}
                                onPresetSelect={onSelectPresetToEdit}
                                onPresetDelete={handlePresetDelete}
                                onPresetRename={handleOpenRenameModal}
                                onPresetApply={handlePresetApply}
                                onCreateVariant={handleDropdownVariant}
                                onTogglePreset={handleTogglePreset}
                                onExportPreset={handleExportPreset}
                                onImportPresetClick={() => setShowImportModal(true)}
                                onNewPreset={() => handleOpenPresetNameModal(NamingMode.New)}
                                loadoutAvailable={scopedInitialData.loadoutAvailable}
                            />
                        )
                    ) : null}
                </main>
            </div>

            <PresetNameModal
                show={showPresetNameModal}
                onCloseAction={handleClosePresetNameModal}
                onSaveAction={async (name) => {
                    await handleSavePresetName(name);
                    if (!isWorkspaceOpen) setIsWorkspaceOpen(true);
                }}
                initialName={dropdownPreset?.name}
                namingMode={namingMode}
            />
            <ErrorModal show={showErrorModal} onClose={handleCloseErrorModal} message={errorMessage} />
            <Toast show={showToast} onClose={handleCloseToast} message={toastMessage} />
            <div className="account-removal-notices" aria-live="polite">
                {pendingAccountDeletes.map(item => (
                    <div className="account-removal-notice" key={item.puuid}>
                        <span>{item.committing ? `Removing ${item.name}…` : `${item.name} removed`}</span>
                        {!item.committing && <button type="button" onClick={() => setPendingAccountDeletes(current => current.filter(entry => entry.puuid !== item.puuid))}>Undo</button>}
                    </div>
                ))}
            </div>
            {showReleaseNotes && CURRENT_RELEASE && <ReleaseNotesModal notes={CURRENT_RELEASE} onClose={dismissReleaseNotes} />}
            {showUpdateNotes && updateNotes && <ReleaseNotesModal
                notes={updateNotes}
                onClose={() => setShowUpdateNotes(false)}
                footerNote={updatePhase === "ready" ? "Downloaded and verified" : "Downloading in the background"}
                actionLabel={updatePhase === "ready" ? "Restart to update" : "Keep using VantaVault"}
                onAction={updatePhase === "ready" ? () => { setShowUpdateNotes(false); void restartForUpdate(); } : undefined}
            />}
            <ConfirmationModal
                show={showConfirmationModal}
                onClose={handleCloseConfirmationModal}
                onConfirm={handleConfirmDelete}
                title="Delete Preset"
                message="Are you sure you want to delete this preset?"
            />

            {/* Modals */}
            <AccountManagerModal
                isOpen={isAccountsOpen}
                onClose={() => setIsAccountsOpen(false)}
                accounts={accounts.filter(account => !pendingAccountDeletes.some(item => item.puuid === account.puuid))}
                activeAccount={activeAccount}
                onSwitchAccount={handleSwitchAccount}
                onRequestDeleteAccount={requestDeleteAccount}
                onAddAccount={() => {
                    setIsAccountsOpen(false);
                    setShowAddAccount(true);
                }}
                onRefreshAccount={refreshAccountToken}
                onCancelRefresh={cancelAccountRefresh}
                onToggleFavorite={handleToggleFavorite}
                activePlayerCardId={gameMeta.identity?.playerCardId || initialData.gameMeta.identity?.playerCardId}
                activePlayerCardIcon={playerCards.find((card) =>
                    card.uuid.toLowerCase() === (gameMeta.identity?.playerCardId || initialData.gameMeta.identity?.playerCardId || "").toLowerCase()
                )?.displayIcon}
                playerCards={playerCards}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                autoSelectAgent={autoSelectAgent || false}
                onToggleAutoAgent={(v) => setAutoSelectAgent(v)}
                useLocalSso={useLocalSso || false}
                onToggleLocalSso={handleToggleLocalSso}
                autoSyncMatches={autoSyncMatches ?? true}
                onToggleAutoSyncMatches={setAutoSyncMatches}
                matchRetentionDays={matchRetentionDays ?? 365}
                onMatchRetentionDaysChange={setMatchRetentionDays}
                showOfflineFriends={showOfflineFriends ?? false}
                onShowOfflineFriendsChange={setShowOfflineFriends}
                showLiveMatch={showLiveMatch ?? true}
                onShowLiveMatchChange={setShowLiveMatch}
                showPartyWidget={showPartyWidget ?? true}
                onShowPartyWidgetChange={setShowPartyWidget}
                showUnownedCosmetics={showUnownedCosmetics ?? false}
                onShowUnownedCosmeticsChange={setShowUnownedCosmetics}
				soundEnabled={soundEnabled ?? true}
				onSoundEnabledChange={setSoundEnabled}
				soundVolume={soundVolume ?? 28}
				onSoundVolumeChange={setSoundVolume}
                launchAtStartup={launchAtStartup}
                onLaunchAtStartupChange={changeLaunchAtStartup}
                startMinimized={traySettings.startMinimized}
                onStartMinimizedChange={(v) => changeTraySettings({ startMinimized: v })}
                closeToTray={traySettings.closeToTray}
                onCloseToTrayChange={(v) => changeTraySettings({ closeToTray: v })}
                desktopNotifications={desktopNotifications}
                onDesktopNotificationsChange={changeDesktopNotifications}
                theme={theme}
                accentTheme={accentTheme}
                interfaceTheme={interfaceTheme}
                onToggleTheme={toggleTheme}
                onAccentThemeChange={setAccentTheme}
                onInterfaceThemeChange={setInterfaceTheme}
                isLocalClientActive={isLocalClientActive}
                activeAccount={activeAccount}
                isAndroid={isAndroid}
                appVersion={appVersion}
                isPortable={isPortable}
                updateAvailable={isPortable ? false : !!availableUpdate}
                updateVersion={isPortable ? portableUpdate?.version ?? null : availableUpdate?.version ?? null}
                isCheckingUpdate={isPortable ? portableUpdate?.status === "checking" : isCheckingUpdate}
                lastUpdateCheck={lastUpdateCheck}
                updateCheckError={updateCheckError}
                isUpdating={isPortable ? portableUpdate?.status === "checking" || portableUpdate?.status === "downloading" : isUpdating}
                updateReady={isPortable ? portableUpdate?.status === "ready" : updateReady}
                updateProgress={isPortable ? portableUpdate?.progress ?? null : updateProgress}
                onInstallUpdate={installUpdate}
                onRestartForUpdate={restartForUpdate}
                onCheckForUpdates={checkForUpdatesNow}
            />

            {showAddAccount && (
                <div className="login-modal-layer">
                    <RiotLoginCard
                        onLoginSuccess={async (acc) => {
                            setShowAddAccount(false);
                            if (!acc) return;

                            handleAddNewAccount(acc);
                        }}
                        onCancel={() => setShowAddAccount(false)}
                    />
                </div>
            )}

            <ImportPresetModal
                show={showImportModal}
                onClose={() => { setShowImportModal(false); setImportCode(''); setImportError(''); }}
                onImport={handleImportSubmit}
                importCode={importCode}
                onChangeImportCode={(v) => { setImportCode(v); setImportError(''); }}
                importError={importError}
            />

            <LocalAccountChooser
                isOpen={showLocalAccountChooser}
                pending={pendingLocalAccount}
                active={activeAccount}
                onChooseLocal={(useLocal) => handleResolveLocalAccount(useLocal)}
                onClose={() => handleResolveLocalAccount(false)}
            />

            {(showLiveMatch ?? true) && <LiveMatchOverlay />}
        </div>
    );
}
