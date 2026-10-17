import { accountRequiresManualRepair, isLockfileAccount, type RiotAccount } from "./types";

const SIGN_IN_CODES = ["missing_cookies", "login_required", "cookies_expired", "account_mismatch"];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Warn this long before Riot's login cookie ends. */
export const LOGIN_WARNING_MS = 3 * DAY_MS;

/** Riot has ended this saved login; only a fresh sign-in brings it back. */
export function accountNeedsSignIn(account: RiotAccount) {
    if (isLockfileAccount(account)) return false;
    return accountRequiresManualRepair(account) || SIGN_IN_CODES.includes(account.lastRefreshErrorCode || "");
}

/** Days until Riot's login cookie ends, when Riot told us and it is within the warning window. */
export function loginEndsInDays(account: RiotAccount, now = Date.now()): number | null {
    if (isLockfileAccount(account) || !account.sessionExpiresAt) return null;
    const left = account.sessionExpiresAt - now;
    if (left > LOGIN_WARNING_MS) return null;
    return Math.max(0, Math.ceil(left / DAY_MS));
}

/** Saved accounts that need you: a new sign-in, or a login that is about to end. */
export function accountsNeedingAttention(accounts: RiotAccount[], now = Date.now()) {
    const signIn = accounts.filter(accountNeedsSignIn);
    const endingSoon = accounts.filter((a) => !accountNeedsSignIn(a) && loginEndsInDays(a, now) !== null);
    return { signIn, endingSoon, total: signIn.length + endingSoon.length };
}
