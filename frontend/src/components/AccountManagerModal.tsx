"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountRequiresManualRepair, isLockfileAccount, PlayerCardAsset, RiotAccount } from "@/lib/types";
import { buildAuthDebugSnapshot } from "@/lib/authDebug";
import { saveStoredAccountPlayerCard } from "@/lib/accountStorage";
import { accountOrderForOpen, reconcileOpenAccountOrder } from "@/lib/accountSelection";
import { getProfileOverview, getProfilePlayerCard } from "@/services/api";

const ACCOUNT_CARD_CACHE_KEY = "vantavault:account-card-ids:v1";

function readAccountCardCache(): Record<string, string> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(localStorage.getItem(ACCOUNT_CARD_CACHE_KEY) || "{}") as Record<string, unknown>;
        return Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
        );
    } catch {
        return {};
    }
}

function writeAccountCardCache(cards: Record<string, string>) {
    try {
        localStorage.setItem(ACCOUNT_CARD_CACHE_KEY, JSON.stringify(cards));
    } catch {
        // The in-memory cache still makes this session instant.
    }
}

function readRememberedSocialCards(): Record<string, string> {
    const cards: Record<string, string> = {};
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key?.startsWith("vantavault:social-cards:v1:")) continue;
            const parsed = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, unknown>;
            for (const [puuid, cardId] of Object.entries(parsed)) {
                if (typeof cardId === "string" && cardId) cards[puuid.toLowerCase()] = cardId;
            }
        }
    } catch {
        // A malformed old social cache must not block the account switcher.
    }
    return cards;
}

function relativeTime(timestamp?: number) {
    if (!timestamp) return "never";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
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
    activePlayerCardId?: string;
    activePlayerCardIcon?: string;
    playerCards: PlayerCardAsset[];
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
    activePlayerCardId,
    activePlayerCardIcon,
    playerCards,
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
    const [query, setQuery] = useState("");
    const [view, setView] = useState<"switch" | "manage">("switch");
    const [accountCardIds, setAccountCardIds] = useState<Record<string, string>>(readAccountCardCache);
    const accountCardIdsRef = useRef(accountCardIds);
    const cardLookupAttemptedRef = useRef(new Set<string>());
    const currentAccountRowRef = useRef<HTMLDivElement>(null);
    const refreshTimeoutMs = 30_000;
    const bulkAttemptIntervalMs = 2_000;

    const playerCardById = useMemo(
        () => new Map(playerCards.map((card) => [card.uuid.toLowerCase(), card])),
        [playerCards],
    );

    const rememberResolvedCard = useCallback((puuid: string, cardId: string) => {
        if (!cardId) return;
        setAccountCardIds((current) => {
            if (current[puuid] === cardId) return current;
            const next = { ...current, [puuid]: cardId };
            accountCardIdsRef.current = next;
            writeAccountCardCache(next);
            return next;
        });
        void saveStoredAccountPlayerCard(puuid, cardId).catch(() => undefined);
    }, []);

    useEffect(() => {
        const puuid = activeAccount?.puuid.toLowerCase();
        if (!puuid || !activePlayerCardId) return;
        setAccountCardIds((current) => {
            if (current[puuid] === activePlayerCardId) return current;
            const next = { ...current, [puuid]: activePlayerCardId };
            accountCardIdsRef.current = next;
            writeAccountCardCache(next);
            return next;
        });
        void saveStoredAccountPlayerCard(puuid, activePlayerCardId).catch(() => undefined);
    }, [activeAccount?.puuid, activePlayerCardId]);

    useEffect(() => {
        if (!isOpen) return;
        const attemptedLookups = cardLookupAttemptedRef.current;
        const socialCards = readRememberedSocialCards();
        const knownCards = { ...accountCardIdsRef.current };
        for (const account of accounts) {
            const puuid = account.puuid.toLowerCase();
            const cardId = account.playerCardId || socialCards[puuid];
            if (cardId) knownCards[puuid] = cardId;
        }
        setAccountCardIds((current) => {
            const next = { ...current, ...knownCards };
            if (JSON.stringify(next) === JSON.stringify(current)) return current;
            accountCardIdsRef.current = next;
            writeAccountCardCache(next);
            return next;
        });
        for (const [puuid, cardId] of Object.entries(knownCards)) {
            void saveStoredAccountPlayerCard(puuid, cardId).catch(() => undefined);
        }

        const unresolved = accounts.filter((account) => {
            const puuid = account.puuid.toLowerCase();
            return !knownCards[puuid] && !attemptedLookups.has(puuid);
        }).sort((left, right) => Number(right.puuid === activeAccount?.puuid) - Number(left.puuid === activeAccount?.puuid));
        if (unresolved.length === 0) return;
        unresolved.forEach((account) => attemptedLookups.add(account.puuid.toLowerCase()));
        let cancelled = false;

        const rememberCard = (puuid: string, cardId: string) => {
            if (!cardId || cancelled) return;
            rememberResolvedCard(puuid, cardId);
        };

        void (async () => {
            const cachedResults = await Promise.allSettled(unresolved.map(async (account) => {
                const overview = await getProfileOverview({ puuid: account.puuid, region: account.region }, true);
                return [account.puuid.toLowerCase(), overview.playerCardId || ""] as const;
            }));
            if (cancelled) return;

            const stillMissing: RiotAccount[] = [];
            cachedResults.forEach((result, index) => {
                const account = unresolved[index];
                if (result.status === "fulfilled" && result.value[1]) {
                    rememberCard(result.value[0], result.value[1]);
                } else if (account) {
                    stillMissing.push(account);
                }
            });

            // This is the same target-loadout lookup already used by Social for
            // missing friend avatars. Keep it sequential and lightly throttled
            // because old installs may need a one-time backfill for many accounts.
            let consecutiveFailures = 0;
            for (const account of stillMissing) {
                if (cancelled) return;
                const cardId = await getProfilePlayerCard(account.puuid, account.region);
                rememberCard(account.puuid.toLowerCase(), cardId);
                consecutiveFailures = cardId ? 0 : consecutiveFailures + 1;
                if (consecutiveFailures >= 2) return;
                if (!cancelled) await new Promise((resolve) => window.setTimeout(resolve, 400));
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [accounts, activeAccount?.puuid, isOpen, rememberResolvedCard]);

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
        setQuery("");
        setView("switch");
        cardLookupAttemptedRef.current.clear();
    }, [accounts, isOpen, onCancelRefresh]);

    useEffect(() => {
        if (!isOpen) {
            setDisplayOrder([]);
            return;
        }
        setDisplayOrder((current) => reconcileOpenAccountOrder(current, accounts));
    }, [accounts, isOpen]);

    useEffect(() => {
        if (!isOpen || !activeAccount?.puuid) return;
        const frame = window.requestAnimationFrame(() => {
            currentAccountRowRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeAccount?.puuid, isOpen, view]);

    if (!isOpen) return null;

    const isAccountTokenExpired = (acc: RiotAccount) => {
        if (isLockfileAccount(acc)) return false;
        if (!acc.expiresAt) return true;
        return Date.now() >= acc.expiresAt;
    };
    const renewableAccounts = accounts.filter(
        (account) => !isLockfileAccount(account) && (isAccountTokenExpired(account) || Boolean(account.lastRefreshError)),
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
            if (refreshed) {
                const cardId = await getProfilePlayerCard(acc.puuid, acc.region);
                rememberResolvedCard(acc.puuid.toLowerCase(), cardId);
            }
            setRefreshResults((prev) => ({ ...prev, [acc.puuid]: refreshed ? "success" : "failed" }));
        } catch {
            console.warn("Riot account renewal failed.");
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
                if (refreshed) {
                    const cardId = await getProfilePlayerCard(acc.puuid, acc.region);
                    rememberResolvedCard(acc.puuid.toLowerCase(), cardId);
                }
                if (refreshed) renewed += 1;
                else failed += 1;
                setRefreshResults((prev) => ({ ...prev, [acc.puuid]: refreshed ? "success" : "failed" }));
            } catch {
                failed += 1;
                console.warn("Riot account renewal failed.");
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
        } catch {
            console.warn("Failed to copy the authentication diagnostic summary.");
        }
    };

    // Keep rows stable while this popup is open. Favorites are persisted
    // immediately, then appear pinned the next time the popup opens.
    const accountByPuuid = new Map(accounts.map((account) => [account.puuid, account]));
    const effectiveOrder = displayOrder.length > 0 ? displayOrder : accountOrderForOpen(accounts);
    const orderedAccounts = effectiveOrder
        .map((puuid) => accountByPuuid.get(puuid))
        .filter((account): account is RiotAccount => Boolean(account));
    const normalizedQuery = query.trim().toLowerCase();
    const visibleAccounts = normalizedQuery
        ? orderedAccounts.filter((account) => `${account.gameName}#${account.tagLine}`.toLowerCase().includes(normalizedQuery))
        : orderedAccounts;

    if (view === "switch") {
        return (
            <div className="settings-modal-overlay" onClick={onClose}>
                <section
                    className="account-switcher-modal"
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="account-switcher-title"
                >
                    <header className="account-switcher-header">
                        <div className="account-switcher-heading">
                            <img src="/brand-mark.svg" alt="" />
                            <div>
                                <h2 id="account-switcher-title">Switch account</h2>
                                <p>{accounts.length} saved accounts</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Close accounts">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                        </button>
                    </header>

                    <label className="account-switcher-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="11" cy="11" r="6.5" />
                            <path d="m16 16 4 4" />
                        </svg>
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Find an account"
                            aria-label="Find an account"
                        />
                    </label>

                    <div className="account-switcher-list">
                        {visibleAccounts.length > 0 ? visibleAccounts.map((account) => {
                            const isActive = account.puuid === activeAccount?.puuid;
                            const isLocal = isLockfileAccount(account);
                            const isExpired = isAccountTokenExpired(account);
                            const needsSignIn = accountRequiresManualRepair(account) || [
                                "cookies_expired",
                                "account_mismatch",
                                "missing_cookies",
                                "login_required",
                            ].includes(account.lastRefreshErrorCode || "");
                            const stateLabel = isActive
                                ? "Current"
                                : isLocal
                                    ? "Riot Client"
                                    : needsSignIn
                                        ? "Sign-in required"
                                        : isExpired
                                            ? "Session expired"
                                            : "Ready";
                            const stateTone = isActive || isLocal || (!isExpired && !needsSignIn)
                                ? "ready"
                                : needsSignIn
                                    ? "repair"
                                    : "expired";
                            const cachedCardId = (account.playerCardId || accountCardIds[account.puuid.toLowerCase()])?.toLowerCase() || "";
                            const cachedCard = cachedCardId ? playerCardById.get(cachedCardId) : undefined;
                            const accountCardIcon = isActive && activePlayerCardIcon
                                ? activePlayerCardIcon
                                : cachedCard?.displayIcon || cachedCard?.smallArt || "";

                            return (
                                <div
                                    key={account.puuid}
                                    ref={isActive ? currentAccountRowRef : undefined}
                                    className={`account-switcher-row ${isActive ? "current" : ""}`}
                                >
                                    <button
                                        type="button"
                                        className="account-switcher-select"
                                        disabled={isActive}
                                        onClick={() => {
                                            onSwitchAccount(account);
                                            onClose();
                                        }}
                                    >
                                        <span className={`account-switcher-avatar ${accountCardIcon ? "has-image" : ""}`}>
                                            {accountCardIcon ? (
                                                <img src={accountCardIcon} alt="" />
                                            ) : (
                                                <span>{account.gameName.trim().charAt(0).toUpperCase() || "V"}</span>
                                            )}
                                        </span>
                                        <span className="account-switcher-identity">
                                            <strong>{account.gameName}<small>#{account.tagLine}</small></strong>
                                            <span><i data-tone={stateTone} />{stateLabel}</span>
                                        </span>
                                        <span className="account-switcher-mark" aria-hidden="true">
                                            {isActive ? (
                                                <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
                                            )}
                                        </span>
                                    </button>
                                    <div className="account-switcher-row-actions">
                                        <button
                                            type="button"
                                            className={`account-switcher-favorite ${account.favorite ? "is-favorite" : ""}`}
                                            onClick={() => onToggleFavorite(account.puuid)}
                                            aria-label={`${account.favorite ? "Unstar" : "Star"} ${account.gameName}#${account.tagLine}`}
                                            title={account.favorite ? "Remove from favorites" : "Add to favorites"}
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            className="account-switcher-remove"
                                            onClick={() => onRequestDeleteAccount(account.puuid)}
                                            aria-label={`Remove ${account.gameName}#${account.tagLine}`}
                                            title="Remove account"
                                        >
                                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                                <path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        }) : (
                            <div className="account-switcher-empty">
                                {accounts.length > 0 ? "No matching accounts" : "No saved accounts yet"}
                            </div>
                        )}
                    </div>

                    <footer className="account-switcher-footer">
                        <button
                            type="button"
                            className="account-switcher-manage"
                            onClick={() => {
                                setQuery("");
                                setView("manage");
                            }}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                                <circle cx="16" cy="7" r="2" />
                                <circle cx="8" cy="17" r="2" />
                            </svg>
                            Manage accounts
                        </button>
                        <button
                            type="button"
                            className="account-switcher-add"
                            onClick={() => {
                                onAddAccount();
                                onClose();
                            }}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            Add account
                        </button>
                    </footer>
                </section>
            </div>
        );
    }

    return (
        <div className="settings-modal-overlay" onClick={onClose}>
            <div className="settings-modal-container account-manager-modal" onClick={(e) => e.stopPropagation()}>
                <button className="settings-modal-close" onClick={onClose} aria-label="Close accounts">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>

                <div className="account-manager-header">
                    <div className="account-manager-heading">
                        <img src="/brand-mark.svg" alt="" />
                        <div>
                            <button
                                type="button"
                                className="account-manager-back"
                                onClick={() => {
                                    setQuery("");
                                    setView("switch");
                                }}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
                                Switch accounts
                            </button>
                            <h2 className="account-manager-title">Manage accounts</h2>
                            <p>{accounts.length} saved accounts</p>
                        </div>
                    </div>
                </div>

                <div className="account-manager-body">
                    <div className="account-manager-actions-row">
                        <label className="account-manager-search">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="11" cy="11" r="6.5" />
                                <path d="m16 16 4 4" />
                            </svg>
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search accounts"
                                aria-label="Search accounts"
                            />
                        </label>
                        <button
                            type="button"
                            className="account-manager-add-button"
                            onClick={() => {
                                onAddAccount();
                                onClose();
                            }}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                            Add account
                        </button>
                    </div>

                    {renewableAccounts.length > 0 && <div className="account-manager-renew-row">
                        <span>{renewableAccounts.length} expired {renewableAccounts.length === 1 ? "session" : "sessions"}</span>
                        {isBulkRefreshing ? (
                            <button type="button" onClick={handleCancelRefreshAll}>Stop</button>
                        ) : (
                            <button type="button" onClick={handleRefreshAllAccounts}>Renew all</button>
                        )}
                    </div>}

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
                        visibleAccounts.length > 0 ? <div className="settings-accounts-list">
                            {visibleAccounts.map((acc) => {
                                const isExpired = isAccountTokenExpired(acc);
                                const isLocalSession = isLockfileAccount(acc);
                                const isActive = activeAccount?.puuid === acc.puuid;
                                const isFav = !!acc.favorite;
                                const isRefreshing = !!refreshingPuuids[acc.puuid];
                                const needsRepair = accountRequiresManualRepair(acc) ||
                                    acc.lastRefreshErrorCode === "cookies_expired" ||
                                    acc.lastRefreshErrorCode === "account_mismatch";
                                const requiresSignIn = needsRepair || ["missing_cookies", "login_required"].includes(acc.lastRefreshErrorCode || "");
                                const needsRenewalAction = isExpired || Boolean(acc.lastRefreshError) || refreshResults[acc.puuid] === "failed";
                                const secondaryText = isLocalSession
                                    ? "Available while Riot Client is open"
                                    : refreshResults[acc.puuid] === "success"
                                        ? "Ready · renewed just now"
                                    : isActive
                                        ? `Current account · renewed ${relativeTime(acc.lastRenewedAt)}`
                                        : refreshResults[acc.puuid] === "failed"
                                            ? "Renewal failed"
                                        : requiresSignIn
                                            ? "Sign-in required"
                                            : acc.lastRefreshError
                                                ? "Renewal failed"
                                                : isExpired
                                                    ? `Session expired · renewed ${relativeTime(acc.lastRenewedAt)}`
                                                    : `Ready · renewed ${relativeTime(acc.lastRenewedAt)}`;

                                return (
                                    <div
                                        key={acc.puuid}
                                        ref={isActive ? currentAccountRowRef : undefined}
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
                                            <button
                                                type="button"
                                                className="settings-account-main"
                                                disabled={isActive}
                                                onClick={() => {
                                                    if (!isActive) {
                                                        onSwitchAccount(acc);
                                                        onClose();
                                                    }
                                                }}
                                            >
                                                <span className="settings-account-identity">
                                                        <span className="account-card-name">{acc.gameName}</span>
                                                        <span className="account-card-tag">#{acc.tagLine}</span>
                                                </span>
                                                <span className={`settings-account-health ${requiresSignIn ? "needs-sign-in" : ""}`}>{secondaryText}</span>
                                            </button>
                                        </div>

                                        <div className="settings-account-actions">
                                            {isLocalSession ? null : isRefreshing ? (
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
                                            ) : needsRenewalAction ? (
                                                <button
                                                    type="button"
                                                    className="settings-account-action-btn refresh-btn"
                                                    onClick={(e) => handleRefreshAccount(e, acc)}
                                                    title={needsRepair ? "Repair Riot session" : acc.lastRefreshError ? "Retry renewal" : "Renew access"}
                                                >
                                                    {requiresSignIn ? "Sign in" : acc.lastRefreshError ? "Retry" : "Renew"}
                                                </button>
                                            ) : null}
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
                        </div> : <div className="settings-accounts-empty account-search-empty">
                            <p>No matching accounts.</p>
                            <button type="button" className="compact-dialog-button secondary" onClick={() => setQuery("")}>Clear search</button>
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

                    <div className="account-manager-footer">
                        <button
                            type="button"
                            onClick={handleCopyAuthDebug}
                            title="Copy a sanitized account diagnostic without tokens or cookies"
                        >
                            {authDebugCopied ? "Copied" : "Copy diagnostics"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
