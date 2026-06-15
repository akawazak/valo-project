"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import ArsenalView from '@/features/arsenal/ArsenalView';
import PresetList from '@/features/presets/PresetList';
import Footer from '@/components/Footer';
import PresetNameModal from '@/components/PresetNameModal';
import ErrorModal from '@/components/ErrorModal';
import Toast from '@/components/Toast';
import ConfirmationModal from '@/components/ConfirmationModal';
import { getPlayerLoadout, getPlayerLoadoutData, getPresets } from '@/services/api';
import { getSettings, saveSettings } from '@/services/settings';
import { LocalClientError } from '@/lib/errors';
import { Preset, LoadoutItemV1, RiotAccount } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { usePresets, NamingMode, defaultPreset } from '@/hooks/usePresets';
import { useLoadout } from '@/hooks/useLoadout';
import RiotLoginCard from '@/components/RiotLoginCard';
import StorePanels from '@/features/dashboard/StorePanels';
import RankTrackerPanel from '@/features/profile/RankTrackerPanel';
import MatchHistoryPanel from '@/features/profile/MatchHistoryPanel';
import { useTheme } from '@/context/ThemeContext';
import { exportPreset } from '@/lib/presetShare';
import AppTopbar from '@/components/AppTopbar';
import ImportPresetModal from '@/components/ImportPresetModal';
import AccountManagerModal from '@/components/AccountManagerModal';
import LocalAccountChooser from '@/components/LocalAccountChooser';
import SettingsModal from '@/components/SettingsModal';

export default function Home() {
    const {
        agents,
        weapons,
        loading: dataContextLoading,
        isClientHealthy,
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

    const { theme, toggleTheme } = useTheme();

    const [initialData, setInitialData] = useState<{ presets: Preset[], playerLoadout: Record<string, LoadoutItemV1>, gameMeta: { sprays: any[], identity?: any } }>({ presets: [], playerLoadout: {}, gameMeta: { sprays: [] } });
    const [dataRevision, setDataRevision] = useState(0);
    const [autoSelectAgent, setAutoSelectAgent] = useState<boolean | undefined>(undefined);
    const [useLocalSso, setUseLocalSso] = useState<boolean | undefined>(undefined);
    const [launchAtStartup, setLaunchAtStartupState] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Loading application data...');
    
    // Core Layout State
    const [activeTab, setActiveTab] = useState<'skins' | 'store' | 'rank' | 'matches'>('rank');
    const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(true);
    
    // Modals
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isAccountsOpen, setIsAccountsOpen] = useState(false);
    const [showAddAccount, setShowAddAccount] = useState(false);

    const {
        showErrorModal, errorMessage, handleApplyLoadout, handleCloseErrorModal,
        showToast, toastMessage, handleCloseToast,
        setShowErrorModal, setErrorMessage, setShowToast, setToastMessage
    } = useLoadout();

    const {
        presets, selectedPreset, isEditing, editingPreset, originalPreset,
        showPresetNameModal, dropdownPreset, namingMode, showConfirmationModal, currentLoadout,
        handleSave, handleSavePresetName, handlePresetSelect, handlePresetDelete, handleConfirmDelete,
        handleCloseConfirmationModal, handleCancel, handleOpenPresetNameModal, handleOpenRenameModal,
        handleDropdownVariant, handleVariant, handleClosePresetNameModal, handleTogglePreset,
        handleAgentAssignment, handleItemChange, handleIdentityChange, handleSpraysChange,
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

    const loadInitialData = useCallback(async () => {
        try {
            setIsLoading(true);
            const [fetchedPresets, settings] = await Promise.all([getPresets(), getSettings()]);
            let playerLoadout: Record<string, LoadoutItemV1> = {};
            let gameMeta: { sprays: any[], identity?: any } = { sprays: [] };
            try {
                const full = await getPlayerLoadoutData();
                playerLoadout = full.loadout;
                gameMeta = { sprays: full.sprays || [], identity: full.identity };
            } catch (error) {
                if (!(error instanceof LocalClientError)) throw error;
            }
            setInitialData({ playerLoadout, presets: Array.isArray(fetchedPresets) ? fetchedPresets : [], gameMeta });
            setDataRevision(r => r + 1);
            setAutoSelectAgent(settings.autoSelectAgent);
            setUseLocalSso(settings.useLocalSso);
            prevSettingsRef.current = settings;
            localStorage.setItem("use_local_sso", settings.useLocalSso ? "true" : "false");
            setIsLoading(false);
        } catch (error) {
            if (error instanceof LocalClientError) {
                setInitialData({ playerLoadout: {}, presets: [], gameMeta: { sprays: [] } });
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
    }, [isClientHealthy, loadInitialData]);

    const prevSettingsRef = useRef<{ autoSelectAgent: boolean; useLocalSso: boolean } | null>(null);

    useEffect(() => {
        if (autoSelectAgent !== undefined && useLocalSso !== undefined) {
            const prev = prevSettingsRef.current;
            if (!prev || prev.autoSelectAgent !== autoSelectAgent || prev.useLocalSso !== useLocalSso) {
                saveSettings({ autoSelectAgent, useLocalSso });
                prevSettingsRef.current = { autoSelectAgent, useLocalSso };
            }
        }
    }, [autoSelectAgent, useLocalSso]);

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
        await handleApplyLoadout(requestToApply, presetToApply.name);
        if (isEditing) handleCancel();
    };

    const handlePresetApply = (preset: Preset) => {
        const requestToApply = buildApplyRequest(preset);
        handleApplyLoadout(requestToApply, preset.name);
    };

    const buildApplyRequest = (preset: Preset) => {
        const loadoutToApply = { ...preset.loadout };
        let identity = preset.identity;
        let sprays = preset.sprays;
        if (preset.parentUuid) {
            const parent = presets.find(p => p.uuid === preset.parentUuid);
            if (parent) {
                for (const [gun, item] of Object.entries(parent.loadout)) {
                    if (!loadoutToApply[gun]) loadoutToApply[gun] = item;
                }
                if (!identity) identity = parent.identity;
                if (!sprays || sprays.length === 0) sprays = parent.sprays;
            }
        }
        return { loadout: loadoutToApply, identity, sprays };
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
                    if (tab === 'store' || tab === 'rank' || tab === 'matches') setIsWorkspaceOpen(false);
                    if (tab === 'skins') setIsWorkspaceOpen(true);
                }}
                activeAccount={activeAccount}
                useLocalSso={useLocalSso || false}
                isLocalClientActive={isClientHealthy}
                isBackendOnline={true}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenAccounts={() => setIsAccountsOpen(true)}
            />

            <div className="app-content-wrapper">
                <main className="app-main-content">
                    {activeTab === 'store' ? (
                        <StorePanels refreshKey={storefrontRefreshKey} onConnectAccount={() => setIsAccountsOpen(true)} />
                    ) : activeTab === 'rank' ? (
                        <RankTrackerPanel onConnectAccount={() => setIsAccountsOpen(true)} />
                    ) : activeTab === 'matches' ? (
                        <MatchHistoryPanel onConnectAccount={() => setIsAccountsOpen(true)} />
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
                                onVariant={handleVariant}
                                currentCardId={activePreset?.identity?.playerCardId || ""}
                                currentTitleId={activePreset?.identity?.playerTitleId || ""}
                                onSelectCard={(cardId) => handleIdentityChange(cardId, activePreset?.identity?.playerTitleId || "")}
                                onSelectTitle={(titleId) => handleIdentityChange(activePreset?.identity?.playerCardId || "", titleId)}
                                currentSprays={activePreset?.sprays}
                                onUpdateSprays={handleSpraysChange}
                                showPresetExtras={showPresetExtras || false}
                                onAgentAssignment={handleAgentAssignment}
                                gameIdentity={gameMeta.identity}
                                gameSprays={gameMeta.sprays}
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

            {activeTab === 'skins' && isWorkspaceOpen && isEditing && (
                <Footer
                    onSaveAction={handleSave}
                    onCancelAction={handleCancel}
                    onSaveAsNewAction={() => handleOpenPresetNameModal(NamingMode.SaveAsNew)}
                    onApplyAction={handleApply}
                    onVariantAction={handleVariant}
                    isVariant={!!originalPreset?.parentUuid}
                    isDefaultPreset={originalPreset?.uuid === defaultPreset.uuid}
                />
            )}

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
                launchAtStartup={launchAtStartup}
                onLaunchAtStartupChange={(v) => setLaunchAtStartupState(v)}
                theme={theme}
                onToggleTheme={toggleTheme}
                isLocalClientActive={isClientHealthy}
                activeAccount={activeAccount}
                appVersion="1.0.0"
                updateAvailable={false}
                isUpdating={false}
                updateReady={false}
                onInstallUpdate={() => {}}
            />

            {showAddAccount && (
                <div className="login-modal-layer">
                    <RiotLoginCard
                        onLoginSuccess={async (acc) => {
                            setShowAddAccount(false);
                            if (!acc) return;

                            const stableAcc = {
                                ...acc,
                                sessionId: `session_${acc.puuid}`,
                            };
                            handleAddNewAccount(stableAcc);

                            if (!stableAcc.ssid) {
                                await refreshAccountToken(stableAcc, true);
                            }
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
        </div>
    );
}
