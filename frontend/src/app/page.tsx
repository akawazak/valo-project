"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import ArsenalView from '@/features/arsenal/ArsenalView';
import PresetList from '@/features/presets/PresetList';
import PresetNameModal from '@/components/PresetNameModal';
import ErrorModal from '@/components/ErrorModal';
import Toast from '@/components/Toast';
import ConfirmationModal from '@/components/ConfirmationModal';
import { getPlayerLoadoutData, getPresets, getProfileOverview, reportAppError } from '@/services/api';
import { getSettings, saveSettings, type Settings } from '@/services/settings';
import { LocalClientError } from '@/lib/errors';
import { Preset, LoadoutItemV1, RiotAccount } from '@/lib/types';

const DISCORD_QUEUE_LABELS: Record<string, string> = {
    competitive: "Competitive",
    unrated: "Unrated",
    swiftplay: "Swiftplay",
    spikerush: "Spike Rush",
    deathmatch: "Deathmatch",
    teamdeathmatch: "Team Deathmatch",
    hurm: "Team Deathmatch",
    escalation: "Escalation",
    ggteam: "Escalation",
    onefa: "Replication",
    premier: "Premier",
    custom: "Custom Game",
};

function discordQueueLabel(queueId: string) {
    const key = queueId.trim().toLowerCase();
    if (!key) return "VALORANT";
    return DISCORD_QUEUE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}
import { useData } from '@/context/DataContext';
import { usePresets, NamingMode, defaultPreset } from '@/hooks/usePresets';
import { GameLoadoutMeta } from '@/lib/effectivePreset';
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

type DiscordMatchPhase = {
    phase: string;
    queueId: string;
    mapName: string;
    agentName: string;
    timeLeft: number;
    partySize: number;
    allyCount: number;
    enemyCount: number;
};

export default function Home() {
    const {
        agents,
        weapons,
        loading: dataContextLoading,
        isClientHealthy,
        isBackendOnline,
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
        ownedLevelIDs,
        ownedChromaIDs,
    } = useData();

    const { theme, accentTheme, interfaceTheme, toggleTheme, setAccentTheme, setInterfaceTheme } = useTheme();

    const [initialData, setInitialData] = useState<{ presets: Preset[], playerLoadout: Record<string, LoadoutItemV1>, gameMeta: GameLoadoutMeta }>({ presets: [], playerLoadout: {}, gameMeta: { sprays: [], flexes: [], expressions: [] } });
    const [dataRevision, setDataRevision] = useState(0);
    const [autoSelectAgent, setAutoSelectAgent] = useState<boolean | undefined>(undefined);
    const [useLocalSso, setUseLocalSso] = useState<boolean | undefined>(undefined);
    const [autoSyncMatches, setAutoSyncMatches] = useState<boolean | undefined>(undefined);
    const [matchRetentionDays, setMatchRetentionDays] = useState<Settings["matchRetentionDays"] | undefined>(undefined);
    const [showOfflineFriends, setShowOfflineFriends] = useState<boolean | undefined>(undefined);
    const [showLiveMatch, setShowLiveMatch] = useState<boolean | undefined>(undefined);
    const [showPartyWidget, setShowPartyWidget] = useState<boolean | undefined>(undefined);
    const [showUnownedCosmetics, setShowUnownedCosmetics] = useState<boolean | undefined>(undefined);
    const [profileIdentity, setProfileIdentity] = useState<{ currentRank: string; currentTier: number; accountLevel: number | null }>({ currentRank: "Unranked", currentTier: 0, accountLevel: null });
    const [launchAtStartup, setLaunchAtStartupState] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Loading application data...');
    
    // Core Layout State
    const [activeTab, setActiveTab] = useState<'skins' | 'store' | 'profile'>('store');
    const [discordMatchPhase, setDiscordMatchPhase] = useState<DiscordMatchPhase>({ phase: "none", queueId: "", mapName: "", agentName: "", timeLeft: 0, partySize: 0, allyCount: 0, enemyCount: 0 });
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true);
    const [profileTarget, setProfileTarget] = useState<{ puuid: string; gameName: string; tagLine: string } | null>(null);

    useEffect(() => {
        setProfileTarget(null);
    }, [activeAccount?.puuid]);

    useEffect(() => {
        const onMatchPhase = (event: Event) => {
            const detail = (event as CustomEvent<Partial<DiscordMatchPhase>>).detail;
            setDiscordMatchPhase({
                phase: detail?.phase || "none",
                queueId: detail?.queueId || "",
                mapName: detail?.mapName || "",
                agentName: detail?.agentName || "",
                timeLeft: detail?.timeLeft || 0,
                partySize: detail?.partySize || 0,
                allyCount: detail?.allyCount || 0,
                enemyCount: detail?.enemyCount || 0,
            });
        };
        window.addEventListener("vantavault:match-phase", onMatchPhase);
        return () => window.removeEventListener("vantavault:match-phase", onMatchPhase);
    }, []);

    useEffect(() => {
        let details = activeTab === "store" ? "Browsing Store" : activeTab === "profile" ? "Viewing Profiles" : "Building a Loadout";
        let activityState = "VantaVault desktop companion";
        const queueName = discordQueueLabel(discordMatchPhase.queueId);
        const partyText = discordMatchPhase.partySize > 1 ? `${discordMatchPhase.partySize}-stack` : "";
        const lobbyText = discordMatchPhase.allyCount > 0 && discordMatchPhase.enemyCount > 0
            ? `${discordMatchPhase.allyCount}v${discordMatchPhase.enemyCount}`
            : "";
        if (discordMatchPhase.phase === "pregame") {
            details = discordMatchPhase.agentName ? `Agent Select — ${discordMatchPhase.agentName}` : "Agent Select";
            activityState = [queueName, discordMatchPhase.mapName, discordMatchPhase.timeLeft > 0 ? `${discordMatchPhase.timeLeft}s left` : ""].filter(Boolean).join(" • ");
        } else if (discordMatchPhase.phase === "coregame") {
            details = discordMatchPhase.agentName ? `In Match — ${discordMatchPhase.agentName}` : "In Match";
            activityState = discordMatchPhase.mapName ? `${queueName} on ${discordMatchPhase.mapName}` : queueName;
        }
        if (discordMatchPhase.phase === "pregame") {
            details = `Agent Select - ${queueName}`;
            activityState = [
                discordMatchPhase.agentName || "Choosing agent",
                discordMatchPhase.mapName,
                discordMatchPhase.timeLeft > 0 ? `${discordMatchPhase.timeLeft}s left` : "",
                partyText,
            ].filter(Boolean).join(" - ");
        } else if (discordMatchPhase.phase === "coregame") {
            details = `Playing ${queueName}`;
            activityState = [
                discordMatchPhase.agentName && discordMatchPhase.mapName
                    ? `${discordMatchPhase.agentName} on ${discordMatchPhase.mapName}`
                    : discordMatchPhase.mapName || discordMatchPhase.agentName || "Live match",
                lobbyText,
                partyText,
            ].filter(Boolean).join(" - ");
        }
        void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("set_discord_presence", { details, activityState }))
            .catch(() => {});
    }, [activeTab, discordMatchPhase]);
    
    // Modals
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAccountsOpen, setIsAccountsOpen] = useState(false);
    const [showAddAccount, setShowAddAccount] = useState(false);
    const [appVersion, setAppVersion] = useState("");
    const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateReady, setUpdateReady] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [lastUpdateCheck, setLastUpdateCheck] = useState<number | null>(null);
    const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);

    const {
        showErrorModal, errorMessage, handleApplyLoadout, handleCloseErrorModal,
        showToast, toastMessage, handleCloseToast,
        setShowErrorModal, setErrorMessage, setShowToast, setToastMessage
    } = useLoadout();

    useEffect(() => {
        const onAppError = (event: Event) => {
            const message = (event as CustomEvent<string>).detail;
            if (!message) return;
            setToastMessage(message);
            setShowToast(true);
        };
        window.addEventListener("vantavault:error", onAppError);
        return () => window.removeEventListener("vantavault:error", onAppError);
    }, [setShowToast, setToastMessage]);

    const {
        presets, selectedPreset, isEditing, editingPreset,
        showPresetNameModal, dropdownPreset, namingMode, showConfirmationModal, currentLoadout,
        handleSave, handleSavePresetName, handlePresetSelect, handlePresetDelete, handleConfirmDelete,
        handleCloseConfirmationModal, handleCancel, handleApplyComplete, handleOpenPresetNameModal, handleOpenRenameModal,
        handleDropdownVariant, handleClosePresetNameModal, handleTogglePreset,
        handleAgentAssignment, handleItemChange, handleIdentityChange, handleSpraysChange, handleFlexesChange,
        handleImportPresetAction, gameMeta,
    } = usePresets(initialData.presets, initialData.playerLoadout, (error) => {
        if (error instanceof LocalClientError) {
            setErrorMessage(error.message);
            setShowErrorModal(true);
        } else {
            console.error(error);
        }
    }, initialData.gameMeta, dataRevision);

    const [showImportModal, setShowImportModal] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [importError, setImportError] = useState('');

    useEffect(() => {
        import('@/services/autostart').then(async ({ syncLaunchAtStartup, readLaunchAtStartupState }) => {
            await syncLaunchAtStartup().catch(() => {});
            const enabled = await readLaunchAtStartupState();
            setLaunchAtStartupState(enabled);
        });
    }, []);

    useEffect(() => {
        let alive = true;
        const checkForUpdates = async () => {
            try {
                const [{ getVersion }, { check }] = await Promise.all([
                    import("@tauri-apps/api/app"),
                    import("@tauri-apps/plugin-updater"),
                ]);
                const version = await getVersion();
                if (!alive) return;
                setAppVersion(version);
                const update = await check();
                if (!alive) return;
                setAvailableUpdate(update ?? null);
                setLastUpdateCheck(Date.now());
                setUpdateCheckError(null);
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
        };
    }, []);

    const checkForUpdatesNow = useCallback(async () => {
        if (isCheckingUpdate) return;
        setIsCheckingUpdate(true);
        setUpdateCheckError(null);
        try {
            const [{ getVersion }, { check }] = await Promise.all([
                import("@tauri-apps/api/app"),
                import("@tauri-apps/plugin-updater"),
            ]);
            const version = await getVersion();
            setAppVersion(version);
            const update = await check();
            setAvailableUpdate(update ?? null);
            setLastUpdateCheck(Date.now());
            setUpdateCheckError(null);
        } catch (error) {
            setUpdateCheckError(
                error instanceof Error ? error.message : String(error || "Update check failed.")
            );
        } finally {
            setIsCheckingUpdate(false);
        }
    }, [isCheckingUpdate]);

    // Background periodic re-check every 6 hours so users get notified
    // even if they leave the app running for days.
    useEffect(() => {
        const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
        const handle = setInterval(() => {
            void checkForUpdatesNow();
        }, SIX_HOURS_MS);
        return () => clearInterval(handle);
    }, [checkForUpdatesNow]);

    const installUpdate = useCallback(async () => {
        if (!availableUpdate || isUpdating) return;
        setIsUpdating(true);
        try {
            await availableUpdate.downloadAndInstall();
            setUpdateReady(true);
            setAvailableUpdate(null);
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error || "Update failed."));
            setShowErrorModal(true);
        } finally {
            setIsUpdating(false);
        }
    }, [availableUpdate, isUpdating, setErrorMessage, setShowErrorModal]);

    const restartForUpdate = useCallback(async () => {
        try {
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
        } catch (error) {
            setErrorMessage(
                error instanceof Error
                    ? `Couldn't relaunch the app: ${error.message}. Please close and reopen VantaVault manually.`
                    : "Couldn't relaunch the app. Please close and reopen VantaVault manually."
            );
            setShowErrorModal(true);
        }
    }, [setErrorMessage, setShowErrorModal]);

    const loadInitialData = useCallback(async () => {
        try {
            const [fetchedPresets, settings] = await Promise.all([getPresets(), getSettings()]);
            let playerLoadout: Record<string, LoadoutItemV1> = {};
            let gameMeta: GameLoadoutMeta = { sprays: [], flexes: [], expressions: [] };
            try {
                const full = await getPlayerLoadoutData();
                playerLoadout = full.loadout;
                gameMeta = {
                    sprays: full.sprays || [],
                    flexes: full.flexes || [],
                    expressions: full.expressions || [],
                    identity: full.identity,
                };
            } catch (error) {
                if (!(error instanceof LocalClientError)) throw error;
            }
            setInitialData({ playerLoadout, presets: Array.isArray(fetchedPresets) ? fetchedPresets : [], gameMeta });
            setDataRevision(r => r + 1);
            setAutoSelectAgent(settings.autoSelectAgent);
            setUseLocalSso(settings.useLocalSso);
            setAutoSyncMatches(settings.autoSyncMatches);
            setMatchRetentionDays(settings.matchRetentionDays);
            setShowOfflineFriends(settings.showOfflineFriends);
            setShowLiveMatch(settings.showLiveMatch);
            setShowPartyWidget(settings.showPartyWidget);
            setShowUnownedCosmetics(settings.showUnownedCosmetics);
            prevSettingsRef.current = settings;
            localStorage.setItem("use_local_sso", settings.useLocalSso ? "true" : "false");
            setIsLoading(false);
        } catch (error) {
            if (error instanceof LocalClientError) {
                setInitialData({ playerLoadout: {}, presets: [], gameMeta: { sprays: [], flexes: [], expressions: [] } });
                setIsLoading(false);
            } else {
                console.error(error);
                setErrorMessage("An unexpected error occurred while loading data.");
                setShowErrorModal(true);
                setIsLoading(false);
            }
        }
    }, [setErrorMessage, setShowErrorModal]);

    useEffect(() => {
        if (isClientHealthy) {
            setLoadingMessage('Loading application data...');
            loadInitialData();
        } else {
            setIsLoading(false);
        }
    }, [activeAccount?.puuid, isClientHealthy, loadInitialData]);

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
            showUnownedCosmetics === undefined
        ) return;
        const next = { autoSelectAgent, useLocalSso, autoSyncMatches, matchRetentionDays, showOfflineFriends, showLiveMatch, showPartyWidget, showUnownedCosmetics };
        if (JSON.stringify(prevSettingsRef.current) === JSON.stringify(next)) return;
        void saveSettings(next).then(() => {
            prevSettingsRef.current = next;
        }).catch((error) => {
            console.error("Failed to save settings:", error);
            reportAppError("Settings could not be saved. Please try again.");
        });
    }, [autoSelectAgent, autoSyncMatches, matchRetentionDays, showOfflineFriends, showLiveMatch, showPartyWidget, showUnownedCosmetics, useLocalSso]);

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
        const stored = JSON.parse(localStorage.getItem("riot_accounts") || "[]");
        const updated = stored.map((acc: RiotAccount) => {
            if (acc.puuid === puuid) {
                return { ...acc, favorite: !acc.favorite };
            }
            return acc;
        });
        localStorage.setItem("riot_accounts", JSON.stringify(updated));
        import('@/services/api').then(({ savePersistedAccounts }) => {
            void savePersistedAccounts(updated);
        });
        refreshAccountsList();
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
        if (isEditing && editingPreset && editingPreset.uuid !== defaultPreset.uuid) {
            await handleSave();
        }
        const requestToApply = buildApplyRequest(presetToApply);
        const applied = await handleApplyLoadout(requestToApply, presetToApply.name);
        if (applied && isEditing) handleApplyComplete(presetToApply);
    };

    const handlePresetApply = (preset: Preset) => {
        const requestToApply = buildApplyRequest(preset);
        handleApplyLoadout(requestToApply, preset.name);
    };

    const buildApplyRequest = (preset: Preset) => {
        const loadoutToApply = { ...preset.loadout };
        let identity = preset.identity;
        let sprays = preset.sprays;
        let flexes = preset.flexes;
        let expressions = preset.expressions;
        if (preset.parentUuid) {
            const parent = presets.find(p => p.uuid === preset.parentUuid);
            if (parent) {
                for (const [gun, item] of Object.entries(parent.loadout)) {
                    if (!loadoutToApply[gun]) loadoutToApply[gun] = item;
                }
                if (!identity) identity = parent.identity;
                if (!sprays || sprays.length === 0) sprays = parent.sprays;
                if (!flexes || flexes.length === 0) flexes = parent.flexes;
                if (!expressions || expressions.length === 0) expressions = parent.expressions;
            }
        }
        return { loadout: loadoutToApply, identity, sprays, flexes, expressions };
    };

    const getParent = (preset: Preset | null | undefined) => {
        if (!preset?.parentUuid) return undefined;
        return presets.find(p => p.uuid === preset.parentUuid)?.loadout;
    };

    const handleExportPreset = (preset: Preset) => {
        try {
            const code = exportPreset(preset);
            navigator.clipboard.writeText(code);
            setToastMessage(`Copied share code for "${preset.name}" to clipboard!`);
            setShowToast(true);
        } catch (e) {
            console.error(e);
            alert('Failed to copy share code.');
        }
    };

    const handleImportSubmit = async () => {
        if (!importCode.trim()) return;
        try {
            await handleImportPresetAction(importCode.trim());
            setShowImportModal(false);
            setImportCode('');
            setImportError('');
            setToastMessage('Preset imported successfully!');
            setShowToast(true);
        } catch (err: unknown) {
            setImportError(err instanceof Error ? err.message : 'Invalid preset code.');
        }
    };

    const requestDeleteAccount = (puuid: string) => {
        handleDeleteAccount(puuid); // Account delete without prompt since we removed the prompt earlier
    };

    const onSelectPresetToEdit = (preset: Preset) => {
        handlePresetSelect(preset);
        setIsWorkspaceOpen(true);
    };

    if (isLoading || dataContextLoading) {
        return (
            <div className="d-flex flex-column justify-content-center align-items-center vh-100 bg-dark text-white">
                <div className="spinner-border text-danger" role="status" style={{ width: '3rem', height: '3rem' }}>
                    <span className="visually-hidden">Loading...</span>
                </div>
                <p className="mt-3 text-muted">{loadingMessage}</p>
            </div>
        );
    }

    const activePreset = editingPreset || selectedPreset;
    const isDefaultPreset = activePreset?.uuid === defaultPreset.uuid;
    const showPresetExtras = activePreset && !isDefaultPreset;

    return (
        <div className="app-container">
            <AppTopbar
                activeTab={activeTab}
                onTabChange={(tab) => {
                    setActiveTab(tab);
                    if (tab !== 'profile') setProfileTarget(null);
                    if (tab === 'store' || tab === 'profile') setIsWorkspaceOpen(false);
                    if (tab === 'skins') setIsWorkspaceOpen(true);
                }}
                activeAccount={activeAccount}
                useLocalSso={useLocalSso || false}
                isLocalClientActive={isClientHealthy}
                isBackendOnline={isBackendOnline}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenAccounts={() => setIsAccountsOpen(true)}
                playerCardId={gameMeta.identity?.playerCardId || initialData.gameMeta.identity?.playerCardId}
            />

            <div className="app-content-wrapper">
                <main className="app-main-content">
                    {activeTab === 'store' ? (
                        <StorePanels refreshKey={storefrontRefreshKey} onConnectAccount={() => setIsAccountsOpen(true)} />
                    ) : activeTab === 'profile' ? (
                        <ProfilePanel
                            key={`${activeAccount?.puuid || "none"}:${profileTarget?.puuid || "own"}:${storefrontRefreshKey}`}
                            onConnectAccount={() => setIsAccountsOpen(true)}
                            ownPlayerCardId={gameMeta.identity?.playerCardId || initialData.gameMeta.identity?.playerCardId}
                            requestedProfile={profileTarget}
                            onRequestedProfileChange={setProfileTarget}
                            autoSyncMatches={autoSyncMatches ?? true}
                        />
                    ) : (
                        isWorkspaceOpen ? (
                            <ArsenalView
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
                                isEditing={isEditing}
                                editingPreset={editingPreset}
                                onSave={handleSave}
                                onCancel={handleCancel}
                                onSaveAsNew={() => handleOpenPresetNameModal(NamingMode.SaveAsNew)}
                                onApply={handleApply}
                                currentCardId={activePreset?.identity?.playerCardId || ""}
                                currentTitleId={activePreset?.identity?.playerTitleId || ""}
                                onSelectCard={(cardId) => handleIdentityChange(cardId, activePreset?.identity?.playerTitleId || "")}
                                onSelectTitle={(titleId) => handleIdentityChange(activePreset?.identity?.playerCardId || "", titleId)}
                                currentSprays={activePreset?.sprays}
                                onUpdateSprays={handleSpraysChange}
                                currentFlexes={activePreset?.flexes}
                                onUpdateFlexes={handleFlexesChange}
                                showPresetExtras={showPresetExtras || false}
                                onAgentAssignment={handleAgentAssignment}
                                gameIdentity={gameMeta.identity}
                                gameSprays={gameMeta.sprays}
                                gameFlexes={gameMeta.flexes}
                                accountName={activeAccount ? `${activeAccount.gameName}#${activeAccount.tagLine}` : ""}
                                accountLevel={gameMeta.identity?.accountLevel || profileIdentity.accountLevel || undefined}
                                accountRank={profileIdentity.currentRank}
                                accountRankTier={profileIdentity.currentTier}
                                showUnownedCosmetics={showUnownedCosmetics ?? false}
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
                            />
                        )
                    )}
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
                accounts={accounts}
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
                launchAtStartup={launchAtStartup}
                onLaunchAtStartupChange={(v) => setLaunchAtStartupState(v)}
                theme={theme}
                accentTheme={accentTheme}
                interfaceTheme={interfaceTheme}
                onToggleTheme={toggleTheme}
                onAccentThemeChange={setAccentTheme}
                onInterfaceThemeChange={setInterfaceTheme}
                isLocalClientActive={isClientHealthy}
                activeAccount={activeAccount}
                appVersion={appVersion}
                updateAvailable={!!availableUpdate}
                updateVersion={availableUpdate?.version ?? null}
                isCheckingUpdate={isCheckingUpdate}
                lastUpdateCheck={lastUpdateCheck}
                updateCheckError={updateCheckError}
                isUpdating={isUpdating}
                updateReady={updateReady}
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
            {(showPartyWidget ?? true) && <LivePartyStatus showOfflineByDefault={showOfflineFriends ?? false} />}
        </div>
    );
}
