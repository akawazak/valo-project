"use client";

import { useState, useEffect, useCallback } from 'react';
import WeaponGrid from '@/features/gun-skins/WeaponGrid';
import PresetList from '@/features/presets/PresetList';
import AgentAssigner from '@/features/agents/AgentAssigner';
import Footer from '@/components/Footer';
import PresetNameModal from '@/components/PresetNameModal';
import ErrorModal from '@/components/ErrorModal';
import Toast from '@/components/Toast';
import ConfirmationModal from '@/components/ConfirmationModal';
import { getPlayerLoadout, getPresets } from '@/services/api';
import { getSettings, saveSettings } from '@/services/settings';
import { LocalClientError } from '@/lib/errors';
import { Preset, LoadoutItemV1 } from '@/lib/types';
import { useData } from '@/context/DataContext';
import { usePresets, NamingMode, defaultPreset } from '@/hooks/usePresets';
import { useLoadout } from '@/hooks/useLoadout';
import RiotLoginCard from '@/components/RiotLoginCard';
import StorePanels from '@/features/dashboard/StorePanels';
import { useTheme } from '@/context/ThemeContext';
import IdentitySelector from '@/features/identity/IdentitySelector';
import SpraySelector from '@/features/sprays/SpraySelector';
import { exportPreset } from '@/lib/presetShare';
import AppTopbar from '@/components/AppTopbar';
import ImportPresetModal from '@/components/ImportPresetModal';
import AccountDeleteModal from '@/components/AccountDeleteModal';

const SKIP_DELETE_CONFIRM_KEY = 'valovault_skip_acc_delete_confirm';

export default function Home() {
    const {
        agents,
        loading: dataContextLoading,
        isClientHealthy,
        accounts,
        activeAccount,
        handleSwitchAccount,
        handleDeleteAccount,
        handleAddNewAccount,
        refreshAccountToken,
        storefrontRefreshKey,
    } = useData();

    const { theme, toggleTheme } = useTheme();

    const [initialData, setInitialData] = useState<{ presets: Preset[], playerLoadout: Record<string, LoadoutItemV1> }>({ presets: [], playerLoadout: {} });
    const [autoSelectAgent, setAutoSelectAgent] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingMessage, setLoadingMessage] = useState('Loading application data...');
    const [activeTab, setActiveTab] = useState<'skins' | 'store'>('skins');
    const [showAddAccount, setShowAddAccount] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
    const [dontAskAgain, setDontAskAgain] = useState(false);

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
        handleImportPresetAction,
    } = usePresets(initialData.presets, initialData.playerLoadout, (error) => {
        if (error instanceof LocalClientError) {
            setErrorMessage(error.message);
            setShowErrorModal(true);
        } else {
            console.error(error);
        }
    });

    const [showImportModal, setShowImportModal] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [importError, setImportError] = useState('');

    useEffect(() => {
        setSkipDeleteConfirm(localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === '1');
    }, []);

    const loadInitialData = useCallback(async () => {
        try {
            setIsLoading(true);
            const [fetchedPresets, settings] = await Promise.all([getPresets(), getSettings()]);
            let playerLoadout: Record<string, LoadoutItemV1> = {};
            try {
                playerLoadout = await getPlayerLoadout();
            } catch (error) {
                if (!(error instanceof LocalClientError)) throw error;
            }
            setInitialData({ playerLoadout, presets: Array.isArray(fetchedPresets) ? fetchedPresets : [] });
            setAutoSelectAgent(settings.autoSelectAgent);
            setIsLoading(false);
        } catch (error) {
            if (error instanceof LocalClientError) {
                setInitialData({ playerLoadout: {}, presets: [] });
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

    useEffect(() => {
        if (autoSelectAgent !== undefined) {
            saveSettings({ autoSelectAgent });
        }
    }, [autoSelectAgent]);

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
        if (skipDeleteConfirm) {
            handleDeleteAccount(puuid);
        } else {
            setDeleteTarget(puuid);
            setDontAskAgain(false);
            setShowDeleteModal(true);
        }
    };

    const confirmDeleteAccount = () => {
        if (dontAskAgain) {
            localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, '1');
            setSkipDeleteConfirm(true);
        }
        setShowDeleteModal(false);
        if (deleteTarget) handleDeleteAccount(deleteTarget);
        setDeleteTarget(null);
    };

    const cancelDeleteAccount = () => {
        setShowDeleteModal(false);
        setDeleteTarget(null);
    };

    if (!isClientHealthy) {
        return (
            <RiotLoginCard
                onLoginSuccess={(acc) => { if (acc) handleAddNewAccount(acc); }}
            />
        );
    }

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
    const showAgentAssigner = showPresetExtras && !activePreset?.parentUuid;

    return (
        <div className="app-container">
            <AppTopbar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                autoSelectAgent={autoSelectAgent}
                onToggleAutoAgent={(v) => setAutoSelectAgent(v)}
                accounts={accounts}
                activeAccount={activeAccount}
                onSwitchAccount={handleSwitchAccount}
                onRequestDeleteAccount={requestDeleteAccount}
                onAddAccount={() => setShowAddAccount(true)}
                onRefreshAccount={refreshAccountToken}
                theme={theme}
                onToggleTheme={toggleTheme}
            />

            <div className="app-content-wrapper">
                <main className="app-main-content">
                    {activeTab === 'store' ? (
                        <StorePanels refreshKey={storefrontRefreshKey} onConnectAccount={() => setShowAddAccount(true)} />
                    ) : (
                        <div className="row h-100 m-0">
                            <div className="col-md-8 mb-3 scrollable-col pe-md-3">
                                <div className="preset-panel mb-3">
                                    <div className="section-row mb-3" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.75rem' }}>
                                        <div>
                                            <div className="tactical-kicker">// ARSENAL</div>
                                            <h2 className="tactical-title mb-0" style={{ fontSize: '1.4rem' }}>Weapon Skins</h2>
                                        </div>
                                    </div>
                                    <p className="text-muted small mb-3">Select a weapon to see available skins.</p>
                                    <WeaponGrid
                                        onSkinSelectAction={handleSkinSelect}
                                        onBuddySelectAction={handleBuddySelect}
                                        currentLoadout={currentLoadout}
                                        onSkinResetAction={handleSkinReset}
                                        parent={getParent(activePreset)}
                                    />
                                </div>

                                {showAgentAssigner && (
                                    <AgentAssigner
                                        agents={agents}
                                        selectedPreset={activePreset}
                                        assignedAgents={activePreset.agents || []}
                                        onAssignmentChange={handleAgentAssignment}
                                    />
                                )}

                                {showPresetExtras && (
                                    <>
                                        <IdentitySelector
                                            currentCardId={activePreset.identity?.playerCardId || ''}
                                            currentTitleId={activePreset.identity?.playerTitleId || ''}
                                            onSelectCard={(cardId) => handleIdentityChange(cardId, activePreset.identity?.playerTitleId || '')}
                                            onSelectTitle={(titleId) => handleIdentityChange(activePreset.identity?.playerCardId || '', titleId)}
                                        />
                                        <SpraySelector
                                            currentSprays={activePreset.sprays || []}
                                            onUpdateSprays={handleSpraysChange}
                                        />
                                    </>
                                )}
                            </div>

                            <div className="col-md-4 scrollable-col ps-md-3">
                                <div className="preset-panel">
                                    <div className="d-flex justify-content-between align-items-center mb-3">
                                        <div>
                                            <div className="tactical-kicker">// LOADOUTS</div>
                                            <h2 className="tactical-title mb-0" style={{ fontSize: '1.2rem' }}>Presets</h2>
                                        </div>
                                        <button
                                            className="btn-tactical btn-tactical-danger"
                                            onClick={() => handleOpenPresetNameModal(NamingMode.New)}
                                        >
                                            + New
                                        </button>
                                    </div>
                                    <PresetList
                                        presets={presets}
                                        onPresetSelect={handlePresetSelect}
                                        selectedPreset={selectedPreset}
                                        defaultPreset={defaultPreset}
                                        onPresetApply={handlePresetApply}
                                        onPresetDelete={handlePresetDelete}
                                        onPresetRename={handleOpenRenameModal}
                                        onCreateVariant={handleDropdownVariant}
                                        onTogglePreset={handleTogglePreset}
                                        agents={agents}
                                        onExportPreset={handleExportPreset}
                                        onImportPresetClick={() => setShowImportModal(true)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {activeTab === 'skins' && isEditing && (
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
                onSaveAction={handleSavePresetName}
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

            {showAddAccount && (
                <div className="login-modal-layer">
                    <RiotLoginCard
                        onLoginSuccess={(acc) => {
                            setShowAddAccount(false);
                            if (acc) handleAddNewAccount(acc);
                        }}
                        onCancel={() => setShowAddAccount(false)}
                    />
                </div>
            )}

            <AccountDeleteModal
                show={showDeleteModal}
                onCancel={cancelDeleteAccount}
                onConfirm={confirmDeleteAccount}
                dontAskAgain={dontAskAgain}
                onToggleDontAskAgain={(v) => setDontAskAgain(v)}
            />

            <ImportPresetModal
                show={showImportModal}
                onClose={() => { setShowImportModal(false); setImportCode(''); setImportError(''); }}
                onImport={handleImportSubmit}
                importCode={importCode}
                onChangeImportCode={(v) => { setImportCode(v); setImportError(''); }}
                importError={importError}
            />
        </div>
    );
}
