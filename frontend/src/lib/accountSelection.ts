import type { RiotAccount } from "@/lib/types";

export const DISMISSED_LOCAL_ACCOUNT_KEY = "vantavault:dismissed-local-account:v1";

function samePuuid(left: string | null | undefined, right: string | null | undefined) {
    return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function selectPersistedAccount(accounts: RiotAccount[], persistedPuuid: string | null) {
    return accounts.find((account) => samePuuid(account.puuid, persistedPuuid)) ?? accounts[0] ?? null;
}

export function shouldOfferLocalAccount(
    selectedPuuid: string | null,
    localPuuid: string,
    dismissedLocalPuuid: string | null,
) {
    return Boolean(
        selectedPuuid
        && !samePuuid(selectedPuuid, localPuuid)
        && !samePuuid(dismissedLocalPuuid, localPuuid),
    );
}

export function selectedAccountCanUseLocalClient(
    selectedPuuid: string | null,
    localPuuid: string,
    localClientActive: boolean,
) {
    return localClientActive && samePuuid(selectedPuuid, localPuuid);
}

export function accountOrderForOpen(accounts: RiotAccount[]) {
    return [
        ...accounts.filter((account) => account.favorite),
        ...accounts.filter((account) => !account.favorite),
    ].map((account) => account.puuid);
}

export function reconcileOpenAccountOrder(current: string[], accounts: RiotAccount[]) {
    const existing = new Set(accounts.map((account) => account.puuid));
    const preserved = current.filter((puuid) => existing.has(puuid));
    const preservedSet = new Set(preserved);
    return [
        ...preserved,
        ...accountOrderForOpen(accounts).filter((puuid) => !preservedSet.has(puuid)),
    ];
}
