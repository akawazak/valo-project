import { describe, expect, it } from 'vitest';
import type { RiotAccount } from './types';
import { accountNeedsSignIn, accountsNeedingAttention, loginEndsInDays } from './accountHealth';

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
