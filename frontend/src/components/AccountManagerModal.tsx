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
    const bulkRunRef = useRef(0);
    const [query, setQuery] = useState("");
    const [accountFilter, setAccountFilter] = useState<"all" | "starred" | "attention">("all");
    const [accountCardIds, setAccountCardIds] = useState<Record<string, string>>(readAccountCardCache);
    const accountCardIdsRef = useRef(accountCardIds);
    const cardLookupAttemptedRef = useRef(new Set<string>());
    const currentAccountRowRef = useRef<HTMLDivElement>(null);
    const accountListRef = useRef<HTMLDivElement>(null);
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
        bulkRunRef.current += 1;
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
        setAccountFilter("all");
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
            currentAccountRowRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeAccount?.puuid, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        return () => { previousFocus?.focus(); };
    }, [isOpen]);

    useEffect(() => {
        if (accountListRef.current) accountListRef.current.scrollTop = 0;
    }, [accountFilter, query]);

    if (!isOpen) return null;

    const handleDialogKeys = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };

    const isAccountTokenExpired = (acc: RiotAccount) => {
        if (isLockfileAccount(acc)) return false;
        if (!acc.expiresAt) return true;
        return Date.now() >= acc.expiresAt;
    };
    const renewableAccounts = accounts.filter((account) => !isLockfileAccount(account));
    const attentionAccounts = new Set(renewableAccounts.filter((account) => isAccountTokenExpired(account) || Boolean(account.lastRefreshError) || accountRequiresManualRepair(account)).map((account) => account.puuid));
    const attentionCount = attentionAccounts.size;
    const renewalBusy = isBulkRefreshing || Object.values(refreshingPuuids).some(Boolean);

    const refreshWithTimeout = async (acc: RiotAccount, allowPopup: boolean) => {
        if (allowPopup) return onRefreshAccount(acc, false, true);
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
        if (renewalBusy || renewableAccounts.length === 0) return;
        const run = ++bulkRunRef.current;
        bulkCancelRef.current = false;
        setBulkSummary("");
        setIsBulkRefreshing(true);
        setBulkProgressTotal(renewableAccounts.length);
        setBulkProgressCurrent(0);
        setBulkCurrentAccount("");
        let renewed = 0;
        let failed = 0;

        for (let i = 0; i < renewableAccounts.length; i++) {
            if (run !== bulkRunRef.current) return;
            if (bulkCancelRef.current) break;
            const acc = renewableAccounts[i];
            const attemptStartedAt = Date.now();
            setBulkProgressCurrent(i + 1);
            setBulkCurrentAccount(`${acc.gameName}#${acc.tagLine}`);
            setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: true }));
            try {
                const refreshed = await refreshWithTimeout(acc, false);
                if (run !== bulkRunRef.current) return;
                if (refreshed) renewed += 1;
                else failed += 1;
                setRefreshResults((prev) => ({ ...prev, [acc.puuid]: refreshed ? "success" : "failed" }));
            } catch {
                if (run !== bulkRunRef.current) return;
                failed += 1;
                console.warn("Riot account renewal failed.");
                setRefreshResults((prev) => ({ ...prev, [acc.puuid]: "failed" }));
            } finally {
                if (run === bulkRunRef.current) setRefreshingPuuids((prev) => ({ ...prev, [acc.puuid]: false }));
            }
            if (!bulkCancelRef.current && i < renewableAccounts.length - 1) {
                const remainingInterval = bulkAttemptIntervalMs - (Date.now() - attemptStartedAt);
                if (remainingInterval > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, remainingInterval));
                }
            }
        }
        if (run !== bulkRunRef.current) return;
        setIsBulkRefreshing(false);
        setBulkCurrentAccount("");
        const checked = renewed + failed;
        const remaining = Math.max(0, renewableAccounts.length - checked);
        setBulkSummary(
            bulkCancelRef.current
                ? `Stopped at ${checked}/${renewableAccounts.length} · ${renewed} renewed · ${failed} not renewed · ${remaining} remaining`
                : `${renewed} renewed · ${failed} need attention${failed ? " — use Sign in or Retry on those accounts" : ""}`,
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
    const visibleAccounts = orderedAccounts.filter((account) =>
        (accountFilter === "all" || (accountFilter === "starred" ? account.favorite : attentionAccounts.has(account.puuid)))
        && `${account.gameName}#${account.tagLine}`.toLowerCase().includes(normalizedQuery),
    );

    return (
            <div className="settings-modal-overlay account-switcher-overlay" onClick={onClose}>
                <section
                    className="account-switcher-modal"
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="account-switcher-title"
                    onKeyDown={handleDialogKeys}
                >
                    <header className="account-switcher-header">
                        <div className="account-switcher-heading">
                            <div>
                                <h2 id="account-switcher-title">Accounts <span>{accounts.length}</span></h2>
                                <p>Switch accounts and keep your sessions ready.</p>
                            </div>
                        </div>
                        <button type="button" className="account-switcher-add" onClick={() => { onAddAccount(); onClose(); }}>
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                            Add account
                        </button>
                        <button type="button" className="account-switcher-close" onClick={onClose} aria-label="Close accounts">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                        </button>
                    </header>

                    <div className="account-switcher-toolbar">
                    <div className="account-switcher-filters" role="group" aria-label="Filter accounts">
                        <button type="button" aria-pressed={accountFilter === "all"} onClick={() => setAccountFilter("all")}>All accounts</button>
                        <button type="button" aria-pressed={accountFilter === "starred"} onClick={() => setAccountFilter("starred")}>Starred <span>{accounts.filter((account) => account.favorite).length}</span></button>
                        <button type="button" aria-pressed={accountFilter === "attention"} onClick={() => setAccountFilter("attention")}>Needs attention <span>{attentionCount}</span></button>
                    </div>
                    <label className="account-switcher-search">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="11" cy="11" r="6.5" />
                            <path d="m16 16 4 4" />
                        </svg>
                        <input
                            type="search"
                            autoFocus
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Find an account"
                            aria-label="Find an account"
                        />
                    </label>
                    </div>

                    {!isBulkRefreshing && Object.values(refreshingPuuids).some(Boolean) && (
                        <p className="account-switcher-renewal-hint" role="status">
                            Complete sign-in and any two-factor verification in the Riot window. You have up to five minutes; use Stop to cancel.
                        </p>
                    )}

                    <div className="account-switcher-list" ref={accountListRef}>
                        {visibleAccounts.length > 0 ? visibleAccounts.map((account) => {
                            const isActive = account.puuid === activeAccount?.puuid;
                            const isLocal = isLockfileAccount(account);
                            const isExpired = isAccountTokenExpired(account);
                            const needsRepair = accountRequiresManualRepair(account) || [
                                "cookies_expired",
                                "account_mismatch",
                            ].includes(account.lastRefreshErrorCode || "");
                            const needsSignIn = needsRepair || [
                                "missing_cookies",
                                "login_required",
                            ].includes(account.lastRefreshErrorCode || "");
                            const isRefreshing = !!refreshingPuuids[account.puuid];
                            const renewalFailed = Boolean(account.lastRefreshError) || refreshResults[account.puuid] === "failed";
                            const needsRenewalAction = isExpired || renewalFailed || isRefreshing;
                            const accountHealth = isRefreshing ? "Renewing…" : isLocal
                                    ? "Local session"
                                    : refreshResults[account.puuid] === "success"
                                        ? "Renewed just now"
                                    : needsSignIn
                                        ? "Sign-in required"
                                        : renewalFailed
                                            ? "Renewal failed"
                                        : isExpired
                                            ? "Session expired"
                                            : "Ready";
                            const stateTone = isRefreshing ? "pending" : needsSignIn || renewalFailed ? "repair" : isExpired ? "expired" : "ready";
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
                                        disabled={isActive || renewalBusy}
                                        aria-label={isActive ? `Current account: ${account.gameName}#${account.tagLine}` : `Switch to ${account.gameName}#${account.tagLine}`}
                                        onClick={() => {
                                            onSwitchAccount(account);
                                            onClose();
                                        }}
                                    >
                                        <span className={`account-switcher-avatar ${accountCardIcon ? "has-image" : ""}`}>
                                            {accountCardIcon ? (
                                                <img src={accountCardIcon} alt="" />
                                            ) : (
                                                <span>{account.gameName.match(/\d+$/)?.[0].slice(-4) || account.gameName.trim().slice(0, 2).toUpperCase() || "V"}</span>
                                            )}
                                        </span>
                                        <span className="account-switcher-identity">
                                            <strong title={`${account.gameName}#${account.tagLine}`}>{account.gameName}<small>#{account.tagLine}</small></strong>
                                            <span>{account.region.toUpperCase()}{isActive && <span className="account-switcher-current-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg>Current account</span>}</span>
                                        </span>
                                        <span className="account-switcher-health" data-tone={stateTone}><i />{accountHealth}</span>
                                        <span className="account-switcher-mark" aria-hidden="true">
                                            {!isActive && <svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5" /></svg>}
                                        </span>
                                    </button>
                                    <div className="account-switcher-row-actions">
                                        {!isLocal && needsRenewalAction ? (
                                            <button
                                                type="button"
                                                className="account-switcher-renew"
                                                data-action={isRefreshing ? "stop" : needsSignIn ? "sign-in" : "renew"}
                                                onClick={(event) => {
                                                    if (isRefreshing) {
                                                        event.stopPropagation();
                                                        setRefreshingPuuids((current) => ({ ...current, [account.puuid]: false }));
                                                        onCancelRefresh(account);
                                                        return;
                                                    }
                                                    void handleRefreshAccount(event, account);
                                                }}
                                                disabled={!isRefreshing && renewalBusy}
                                                title={isRefreshing ? "Stop renewal" : needsSignIn ? "Sign in again" : "Renew account"}
                                                aria-label={`${isRefreshing ? "Stop renewing" : needsSignIn ? "Sign in to" : "Renew"} ${account.gameName}#${account.tagLine}`}
                                            >
                                                <svg viewBox="0 0 24 24" aria-hidden="true">{isRefreshing ? <path d="M7 7h10v10H7z" /> : needsSignIn ? <path d="M14 4h5v16h-5M3 12h11m-4-4 4 4-4 4" /> : <path d="M20 6v5h-5M4 18v-5h5M18.5 10a7 7 0 0 0-12-3L4 11M5.5 14a7 7 0 0 0 12 3l2.5-4" />}</svg>
                                                {isRefreshing ? "Stop" : needsSignIn ? "Sign in" : "Renew"}
                                            </button>
                                        ) : <span />}
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
                                            disabled={renewalBusy}
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
                                <strong>{accounts.length > 0 ? "No matching accounts" : "Your accounts will appear here"}</strong>
                                <span>{accounts.length > 0 ? "Try another name or choose a different filter." : "Add a Riot account to get started."}</span>
                            </div>
                        )}
                    </div>

                    {isBulkRefreshing && (
                        <div className="account-switcher-progress" role="status" aria-live="polite">
                            <span>Renewing {bulkCurrentAccount || "saved account"}</span>
                            <strong>{bulkProgressCurrent}/{bulkProgressTotal}</strong>
                            <i style={{ width: `${bulkProgressTotal ? (bulkProgressCurrent / bulkProgressTotal) * 100 : 0}%` }} />
                        </div>
                    )}
                    {bulkSummary && !isBulkRefreshing && (
                        <div className="account-switcher-summary" role="status" aria-live="polite">{bulkSummary}</div>
                    )}

                    <footer className="account-switcher-footer">
                        <button
                            type="button"
                            className="account-switcher-manage"
                            onClick={isBulkRefreshing ? handleCancelRefreshAll : handleRefreshAllAccounts}
                            disabled={!isBulkRefreshing && (renewalBusy || !renewableAccounts.length)}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M18.5 10a7 7 0 0 0-12-3L4 11M5.5 14a7 7 0 0 0 12 3l2.5-4" /></svg>
                            {isBulkRefreshing ? "Stop renewal" : "Renew all accounts"}
                        </button>
                        <span className="account-switcher-count">{visibleAccounts.length} of {accounts.length} accounts</span>
                        <button
                            type="button"
                            className="account-switcher-diagnostics"
                            onClick={handleCopyAuthDebug}
                            title="Copy a sanitized account diagnostic without tokens or cookies"
                            aria-label={authDebugCopied ? "Account diagnostics copied" : "Copy account diagnostics"}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                {authDebugCopied
                                    ? <path d="m5 12 4.5 4.5L19 7" />
                                    : <path d="M9 5h10v14H9zM5 9v10h10M11 5V3h6v2" />}
                            </svg>
                        </button>
                    </footer>
                </section>
            </div>
        );
}
