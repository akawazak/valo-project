import { describe, expect, it } from 'vitest';
import type { RiotAccount } from './types';
import { accountNeedsRenewal, accountNeedsSignIn, accountsNeedingAttention, loginEndsInDays } from './accountHealth';

const DAY = 24 * 60 * 60 * 1000;
const acc = (over: Partial<RiotAccount> = {}): RiotAccount => ({
    puuid: `p-${Math.random()}`, gameName: 'Demo', tagLine: 'DEMO', region: 'eu', authSource: 'oauth',
    accessToken: 'a', entitlementsToken: 'e', ssid: 'ssid=x', sessionId: 's', ...over,
});

describe('account health', () => {
    it('flags logins Riot has ended', () => {
        expect(accountNeedsSignIn(acc({ lastRefreshErrorCode: 'login_required' }))).toBe(true);
        expect(accountNeedsSignIn(acc({ lastRefreshErrorCode: 'temporary' }))).toBe(false);
        expect(accountNeedsSignIn(acc())).toBe(false);
    });

    it('warns only inside the last three days, and only when Riot gave a date', () => {
        const now = 1_000 * DAY;
        expect(loginEndsInDays(acc({ sessionExpiresAt: now + 2.2 * DAY }), now)).toBe(3);
        expect(loginEndsInDays(acc({ sessionExpiresAt: now + 10 * DAY }), now)).toBeNull();
        expect(loginEndsInDays(acc(), now)).toBeNull();
    });

    it('counts accounts that need attention once each', () => {
        const now = 1_000 * DAY;
        const result = accountsNeedingAttention([
            acc({ lastRefreshErrorCode: 'login_required', sessionExpiresAt: now + DAY }),
            acc({ sessionExpiresAt: now + DAY }),
            acc(),
        ], now);
        expect(result).toMatchObject({ total: 2 });
        expect(result.signIn).toHaveLength(1);
        expect(result.endingSoon).toHaveLength(1);
    });
});

describe("accountNeedsRenewal", () => {
    const now = Date.UTC(2026, 9, 18, 12);
    const base = { puuid: "p", gameName: "g", tagLine: "t", region: "eu", accessToken: "", entitlementsToken: "", sessionId: "s", expiresAt: now - 1 } as RiotAccount;
    it("skips accounts renewed in the last 6 hours, even with an expired access token", () => {
        expect(accountNeedsRenewal({ ...base, lastRenewedAt: now - 60 * 60 * 1000 }, now)).toBe(false);
    });
    it("renews accounts that are 6 hours old, failed last time, or end soon", () => {
        expect(accountNeedsRenewal({ ...base, lastRenewedAt: now - 7 * 60 * 60 * 1000 }, now)).toBe(true);
        expect(accountNeedsRenewal({ ...base, lastRenewedAt: now, lastRefreshError: "Network" }, now)).toBe(true);
        expect(accountNeedsRenewal({ ...base, lastRenewedAt: now, sessionExpiresAt: now + 24 * 60 * 60 * 1000 }, now)).toBe(true);
    });
    it("leaves signed-out accounts to Sign in", () => {
        expect(accountNeedsRenewal({ ...base, lastRefreshErrorCode: "login_required", lastRefreshError: "x" }, now)).toBe(false);
    });
});
