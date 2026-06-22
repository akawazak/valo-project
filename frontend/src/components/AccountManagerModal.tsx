"use client";

import { useState } from "react";
import { RiotAccount } from "@/lib/types";

interface AccountManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    accounts: RiotAccount[];
    activeAccount: RiotAccount | null;
    onSwitchAccount: (acc: RiotAccount) => void;
    onRequestDeleteAccount: (puuid: string) => void;
    onAddAccount: () => void;
    onRefreshAccount: (acc: RiotAccount, visible?: boolean) => Promise<boolean>;
    onCancelRefresh: (acc: RiotAccount) => void;
    onToggleFavorite: (puuid: string) => void;
}

export default function AccountManagerModal({
    isOpen,
    onClose,
    accounts,
    activeAccount,
    onSwitchAccount,
    onRequestDeleteAccount,
    onAddAccount,
    onRefreshAccount,
    onCancelRefresh,
    onToggleFavorite,
}: AccountManagerModalProps) {
    const [refreshingPuuids, setRefreshingPuuids] = useState<Record<string, boolean>>({});
    const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);
    const [bulkProgressCurrent, setBulkProgressCurrent] = useState(0);
    const [bulkProgressTotal, setBulkProgressTotal] = useState(0);
    const refreshTimeoutMs = 30_000;

    if (!isOpen) return null;

    const isAccountTokenExpired = (acc: RiotAccount) => {
        if (!acc.expiresAt) return true;
        return Date.now() >= acc.expiresAt;
    };

    const handleRefreshAccount = async (e: React.MouseEvent, acc: RiotAccount) => {
        e.stopPropagation();
        setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: true }));
        try {
            await Promise.race([
                onRefreshAccount(acc, false),
                new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), refreshTimeoutMs)),
            ]);
        } catch (err) {
            console.error("Refresh account error:", err);
        } finally {
            setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
        }
    };

    const handleRefreshAllAccounts = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const expiredAccounts = accounts.filter(isAccountTokenExpired);
        if (isBulkRefreshing || expiredAccounts.length === 0) return;
        setIsBulkRefreshing(true);
        setBulkProgressTotal(expiredAccounts.length);
        setBulkProgressCurrent(0);

        for (let i = 0; i < expiredAccounts.length; i++) {
            const acc = expiredAccounts[i];
            setBulkProgressCurrent(i + 1);
            setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: true }));
            try {
                await Promise.race([
                    onRefreshAccount(acc, false),
                    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), refreshTimeoutMs)),
                ]);
            } catch (err) {
                console.error(`Failed to refresh token for ${acc.gameName}:`, err);
            } finally {
                setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
            }
        }
        setIsBulkRefreshing(false);
    };

    // Sort accounts: favorites first
    const sortedAccounts = [
        ...accounts.filter((a) => a.favorite),
        ...accounts.filter((a) => !a.favorite),
    ];

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-container account-manager-modal" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close accounts">
                    &times;
                </button>

                <div className="account-manager-header">
                    <div className="tactical-kicker">// PROFILE & ACCOUNTS</div>
                    <h2 className="account-manager-title">Account Manager</h2>
                </div>

                <div className="account-manager-body">
                    <div className="account-manager-actions-row">
                        {accounts.length > 0 && accounts.filter(isAccountTokenExpired).length > 0 && (
                            <button
                                type="button"
                                className={`btn-tactical btn-tactical-secondary btn-tactical-sm ${
                                    isBulkRefreshing ? "refreshing" : ""
                                }`}
                                onClick={handleRefreshAllAccounts}
                                disabled={isBulkRefreshing}
                            >
                                {isBulkRefreshing ? (
                                    <>
                                        <span>Refreshing ({bulkProgressCurrent}/{bulkProgressTotal})</span>
                                        <span className="spinner-border spinner-border-sm ms-2" style={{ width: "12px", height: "12px" }} />
                                    </>
                                ) : (
                                    `↻ Refresh Expired (${accounts.filter(isAccountTokenExpired).length})`
                                )}
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-danger btn-tactical-sm"
                            onClick={() => {
                                onAddAccount();
                                onClose();
                            }}
                        >
                            + Add Account
                        </button>
                    </div>

                    {isBulkRefreshing && (
                        <div className="settings-bulk-progress mb-3">
                            <div
                                className="settings-bulk-progress-fill"
                                style={{ width: `${(bulkProgressCurrent / bulkProgressTotal) * 100}%` }}
                            />
                        </div>
                    )}

                    {accounts.length > 0 ? (
                        <div className="settings-accounts-list">
                            {sortedAccounts.map((acc) => {
                                const isExpired = isAccountTokenExpired(acc);
                                const isActive = activeAccount?.puuid === acc.puuid;
                                const isFav = !!acc.favorite;
                                const isRefreshing = !!refreshingPuuids[acc.puuid];

                                return (
                                    <div
                                        key={acc.puuid}
                                        className={`settings-account-card ${isActive ? "active" : ""} ${
                                            isExpired ? "expired" : ""
                                        }`}
                                    >
                                        <div className="settings-account-details">
                                            <button
                                                type="button"
                                                className={`settings-account-fav-btn ${isFav ? "is-fav" : ""}`}
                                                onClick={() => onToggleFavorite(acc.puuid)}
                                                title={isFav ? "Remove from favorites" : "Add to favorites"}
                                            >
                                                {isFav ? "★" : "☆"}
                                            </button>
                                            <div
                                                className="settings-account-identity"
                                                onClick={() => {
                                                    if (!isActive) {
                                                        onSwitchAccount(acc);
                                                        onClose();
                                                    }
                                                }}
                                            >
                                                <span className="account-card-name">{acc.gameName}</span>
                                                <span className="account-card-tag">#{acc.tagLine}</span>
                                            </div>
                                            <div className="settings-account-pills">
                                                {isActive && <span className="status-pill active-pill">Active</span>}
                                                {isExpired && <span className="status-pill expired-pill">Expired</span>}
                                            </div>
                                        </div>

                                        <div className="settings-account-actions">
                                            {isRefreshing ? (
                                                <button
                                                    type="button"
                                                    className="settings-account-action-btn refresh-btn cancel-refresh-btn"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
                                                        onCancelRefresh(acc);
                                                    }}
                                                    title="Cancel refresh"
                                                >
                                                    ✕
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="settings-account-action-btn refresh-btn"
                                                    onClick={(e) => handleRefreshAccount(e, acc)}
                                                    title="Refresh session"
                                                >
                                                    ↻
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                className="settings-account-action-btn delete-btn"
                                                onClick={() => onRequestDeleteAccount(acc.puuid)}
                                                title="Remove account"
                                            >
                                                &times;
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="settings-accounts-empty">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                            </svg>
                            <p>No Riot accounts connected.</p>
                            <span className="small text-muted">Add your account to fetch loadouts, daily shop offers, and more.</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
