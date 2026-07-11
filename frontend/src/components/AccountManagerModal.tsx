"use client";

import { useEffect, useRef, useState } from "react";
import { accountRequiresManualRepair, RiotAccount } from "@/lib/types";
import { buildAuthDebugSnapshot } from "@/lib/authDebug";

function relativeTime(timestamp?: number) {
    if (!timestamp) return "never";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function renewalFailureText(account: RiotAccount) {
    if (!account.lastRefreshError) return "";
    if (account.lastRefreshErrorCode === "cookies_expired") {
        return "Cookie renewal failed. Repair will retry the saved Riot browser session.";
    }
    return account.lastRefreshError;
}

interface AccountManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    accounts: RiotAccount[];
    activeAccount: RiotAccount | null;
    onSwitchAccount: (acc: RiotAccount) => void;
    onRequestDeleteAccount: (puuid: string) => void;
    onAddAccount: () => void;
    onRefreshAccount: (acc: RiotAccount, visible?: boolean, allowPopup?: boolean) => Promise<boolean>;
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
    const [refreshResults, setRefreshResults] = useState<Record<string, "success" | "failed">>({});
    const [isBulkRefreshing, setIsBulkRefreshing] = useState(false);
    const [bulkProgressCurrent, setBulkProgressCurrent] = useState(0);
    const [bulkProgressTotal, setBulkProgressTotal] = useState(0);
    const [bulkCurrentAccount, setBulkCurrentAccount] = useState("");
    const [bulkSummary, setBulkSummary] = useState("");
    const [displayOrder, setDisplayOrder] = useState<string[]>([]);
    const [authDebugCopied, setAuthDebugCopied] = useState(false);
    const bulkCancelRef = useRef(false);
    const accountsListRef = useRef<HTMLDivElement>(null);
    const refreshTimeoutMs = 30_000;
    const bulkAttemptIntervalMs = 2_000;

    useEffect(() => {
        if (isOpen) return;
        bulkCancelRef.current = true;
        accounts.forEach(onCancelRefresh);
        setRefreshingPuuids({});
        setRefreshResults({});
        setIsBulkRefreshing(false);
        setBulkProgressCurrent(0);
        setBulkProgressTotal(0);
        setBulkCurrentAccount("");
        setBulkSummary("");
    }, [accounts, isOpen, onCancelRefresh]);

    useEffect(() => {
        if (!isOpen) {
            setDisplayOrder([]);
            return;
        }
        setDisplayOrder((current) => {
            const existing = new Set(accounts.map((account) => account.puuid));
            const preserved = current.filter((puuid) => existing.has(puuid));
            const preservedSet = new Set(preserved);
            const newAccounts = accounts.filter((account) => !preservedSet.has(account.puuid));
            const additions = [
                ...newAccounts.filter((account) => account.favorite),
                ...newAccounts.filter((account) => !account.favorite),
            ].map((account) => account.puuid);
            return [...preserved, ...additions];
        });
    }, [accounts, isOpen]);

    // Opening a long account list should always reveal the account currently
    // driving the app, without changing the user's saved favorite ordering.
    useEffect(() => {
        if (!isOpen || !activeAccount?.puuid) return;
        const frame = window.requestAnimationFrame(() => {
            accountsListRef.current
                ?.querySelector<HTMLElement>('[data-active-account-row="true"]')
                ?.scrollIntoView({ block: "center", behavior: "auto" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeAccount?.puuid, displayOrder.length, isOpen]);

    if (!isOpen) return null;

    const isAccountTokenExpired = (acc: RiotAccount) => {
        if (!acc.expiresAt) return true;
        return Date.now() >= acc.expiresAt;
    };
    const renewableAccounts = accounts.filter(
        (account) => isAccountTokenExpired(account) || Boolean(account.lastRefreshError),
    );

    const refreshWithTimeout = async (acc: RiotAccount, allowPopup: boolean) => {
        let timeoutId = 0;
        try {
            return await Promise.race([
                onRefreshAccount(acc, false, allowPopup),
                new Promise<boolean>((resolve) => {
                    timeoutId = window.setTimeout(() => {
                        onCancelRefresh(acc);
                        resolve(false);
                    }, refreshTimeoutMs);
                }),
            ]);
        } finally {
            window.clearTimeout(timeoutId);
        }
    };

    const handleRefreshAccount = async (e: React.MouseEvent, acc: RiotAccount) => {
        e.stopPropagation();
        setRefreshResults((prev) => {
            const next = { ...prev };
            delete next[acc.puuid];
            return next;
        });
        setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: true }));
        try {
            const refreshed = await refreshWithTimeout(acc, true);
            setRefreshResults((prev) => ({ ...prev, [acc.puuid]: refreshed ? "success" : "failed" }));
        } catch (err) {
            console.error("Refresh account error:", err);
            setRefreshResults((prev) => ({ ...prev, [acc.puuid]: "failed" }));
        } finally {
            setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
        }
    };

    const handleRefreshAllAccounts = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isBulkRefreshing || renewableAccounts.length === 0) return;
        bulkCancelRef.current = false;
        setBulkSummary("");
        setIsBulkRefreshing(true);
        setBulkProgressTotal(renewableAccounts.length);
        setBulkProgressCurrent(0);
        setBulkCurrentAccount("");
        let renewed = 0;
        let failed = 0;

        for (let i = 0; i < renewableAccounts.length; i++) {
            if (bulkCancelRef.current) break;
            const acc = renewableAccounts[i];
            const attemptStartedAt = Date.now();
            setBulkProgressCurrent(i + 1);
            setBulkCurrentAccount(`${acc.gameName}#${acc.tagLine}`);
            setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: true }));
            try {
                const refreshed = await refreshWithTimeout(acc, true);
                if (refreshed) renewed += 1;
                else failed += 1;
                setRefreshResults((prev) => ({ ...prev, [acc.puuid]: refreshed ? "success" : "failed" }));
            } catch (err) {
                failed += 1;
                console.error(`Failed to refresh token for ${acc.gameName}:`, err);
                setRefreshResults((prev) => ({ ...prev, [acc.puuid]: "failed" }));
            } finally {
                setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
            }
            if (!bulkCancelRef.current && i < renewableAccounts.length - 1) {
                const remainingInterval = bulkAttemptIntervalMs - (Date.now() - attemptStartedAt);
                if (remainingInterval > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, remainingInterval));
                }
            }
        }
        setIsBulkRefreshing(false);
        setBulkCurrentAccount("");
        const checked = renewed + failed;
        const remaining = Math.max(0, renewableAccounts.length - checked);
        setBulkSummary(
            bulkCancelRef.current
                ? `Stopped at ${checked}/${renewableAccounts.length} · ${renewed} renewed · ${failed} not renewed · ${remaining} remaining`
                : `${renewed} renewed · ${failed} not renewed`,
        );
    };

    const handleCancelRefreshAll = (e: React.MouseEvent) => {
        e.stopPropagation();
        bulkCancelRef.current = true;
        for (const acc of accounts) {
            if (refreshingPuuids[acc.puuid]) onCancelRefresh(acc);
        }
    };

    const handleCopyAuthDebug = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const snapshot = buildAuthDebugSnapshot(accounts, activeAccount);
        try {
            await navigator.clipboard.writeText(snapshot);
            setAuthDebugCopied(true);
            window.setTimeout(() => setAuthDebugCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy auth debug snapshot:", err);
        }
    };

    // Keep rows stable while this popup is open. Favorites are persisted
    // immediately, then appear pinned the next time the popup opens.
    const accountByPuuid = new Map(accounts.map((account) => [account.puuid, account]));
    const effectiveOrder = displayOrder.length > 0 ? displayOrder : [
        ...accounts.filter((account) => account.favorite),
        ...accounts.filter((account) => !account.favorite),
    ].map((account) => account.puuid);
    const sortedAccounts = effectiveOrder
        .map((puuid) => accountByPuuid.get(puuid))
        .filter((account): account is RiotAccount => Boolean(account));
    const expiredCount = renewableAccounts.length;
    const readyCount = Math.max(0, accounts.length - expiredCount);

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-container account-manager-modal" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close accounts">
                    &times;
                </button>

                <div className="account-manager-header">
                    <div>
                        <div className="tactical-kicker">// PROFILE & ACCOUNTS</div>
                        <h2 className="account-manager-title">Account Manager</h2>
                    </div>
                    <div className="account-manager-summary">
                        <span><strong>{accounts.length}</strong> connected</span>
                        <span><strong>{readyCount}</strong> ready</span>
                        <span><strong>{expiredCount}</strong> need renewal</span>
                    </div>
                </div>

                <div className="account-manager-body">
                    <div className="account-manager-actions-row">
                        <button
                            type="button"
                            className={`btn-tactical btn-tactical-secondary btn-tactical-sm ${
                                isBulkRefreshing ? "refreshing" : ""
                            }`}
                            onClick={handleRefreshAllAccounts}
                            disabled={isBulkRefreshing || renewableAccounts.length === 0}
                        >
                            {isBulkRefreshing
                                ? `Refreshing (${bulkProgressCurrent}/${bulkProgressTotal})`
                                : renewableAccounts.length
                                    ? `↻ Renew Access (${renewableAccounts.length})`
                                    : "All access current"}
                        </button>
                        {isBulkRefreshing && (
                            <button
                                type="button"
                                className="btn-tactical btn-tactical-danger btn-tactical-sm"
                                onClick={handleCancelRefreshAll}
                            >
                                Cancel refresh
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
                            Add Account
                        </button>
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-secondary btn-tactical-sm"
                            onClick={handleCopyAuthDebug}
                            title="Copies a sanitized auth snapshot without tokens or cookies"
                        >
                            {authDebugCopied ? "Copied debug" : "Copy Auth Debug"}
                        </button>
                    </div>

                    <p className="settings-renew-help">
                        Renews accounts whose access has expired, one at a time. Retry uses the saved Riot browser session when cookie renewal fails.
                    </p>

                    {isBulkRefreshing && (
                        <div className="settings-bulk-running" role="status" aria-live="polite">
                            <span>Checking {bulkCurrentAccount || "saved session"}</span>
                            <span>{bulkProgressCurrent}/{bulkProgressTotal}</span>
                            <div
                                className="settings-bulk-progress"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={bulkProgressTotal}
                                aria-valuenow={bulkProgressCurrent}
                            >
                                <div
                                    className="settings-bulk-progress-fill"
                                    style={{ width: `${(bulkProgressCurrent / bulkProgressTotal) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}
                    {bulkSummary && !isBulkRefreshing && (
                        <div className="settings-bulk-summary" role="status" aria-live="polite">{bulkSummary}</div>
                    )}

                    {accounts.length > 0 ? (
                        <div className="settings-accounts-list" ref={accountsListRef}>
                            {sortedAccounts.map((acc) => {
                                const isExpired = isAccountTokenExpired(acc);
                                const isActive = activeAccount?.puuid === acc.puuid;
                                const isFav = !!acc.favorite;
                                const isRefreshing = !!refreshingPuuids[acc.puuid];
                                const needsRepair = accountRequiresManualRepair(acc) ||
                                    acc.lastRefreshErrorCode === "cookies_expired" ||
                                    acc.lastRefreshErrorCode === "account_mismatch";
                                const failureText = renewalFailureText(acc);

                                return (
                                    <div
                                        key={acc.puuid}
                                        data-active-account-row={isActive ? "true" : undefined}
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
                                            <div className="settings-account-copy">
                                                <div className="settings-account-topline">
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
                                                        {refreshResults[acc.puuid] === "success" ? (
                                                            <span className="status-pill active-pill">Refreshed</span>
                                                        ) : refreshResults[acc.puuid] === "failed" ? (
                                                            <span className="status-pill expired-pill">Renewal failed</span>
                                                        ) : isExpired ? (
                                                            <span className="status-pill expired-pill">
                                                                {acc.sessionId || acc.ssid ? "Renewal due" : "Sign-in required"}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="settings-account-health">
                                                    <span>{acc.sessionId ? "Riot browser session saved" : acc.ssid ? "Cookie session saved" : "Manual sign-in required"} · renewed {relativeTime(acc.lastRenewedAt)}</span>
                                                    {failureText && (
                                                        <strong title={failureText}>{failureText}</strong>
                                                    )}
                                                </div>
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
                                                    title={needsRepair ? "Repair Riot session" : acc.lastRefreshError ? "Retry renewal" : "Renew access"}
                                                >
                                                    {needsRepair ? "Repair" : acc.lastRefreshError ? "Retry" : "Renew"}
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
