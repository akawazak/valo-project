import { describe, expect, it } from "vitest";
import type { RiotAccount } from "@/lib/types";
import {
    accountOrderForOpen,
    reconcileOpenAccountOrder,
    selectPersistedAccount,
    selectedAccountCanUseLocalClient,
    shouldOfferLocalAccount,
} from "./accountSelection";

const account = (puuid: string): RiotAccount => ({
    puuid,
    accessToken: "",
    entitlementsToken: "",
    region: "eu",
    gameName: puuid,
    tagLine: "TEST",
});

describe("account selection", () => {
    it("keeps the explicitly persisted account instead of preferring the local Riot account", () => {
        const remote = account("remote-account");
        const local = account("local-account");
        expect(selectPersistedAccount([local, remote], remote.puuid)).toBe(remote);
    });

    it("offers a different local account once and respects dismissal after refresh", () => {
        expect(shouldOfferLocalAccount("remote-account", "local-account", null)).toBe(true);
        expect(shouldOfferLocalAccount("remote-account", "local-account", "LOCAL-ACCOUNT")).toBe(false);
    });

    it("only uses the local Riot client for the selected account", () => {
        expect(selectedAccountCanUseLocalClient("remote-account", "local-account", true)).toBe(false);
        expect(selectedAccountCanUseLocalClient("LOCAL-ACCOUNT", "local-account", true)).toBe(true);
        expect(selectedAccountCanUseLocalClient("local-account", "local-account", false)).toBe(false);
    });

    it("keeps rows fixed while open and applies favorite sorting on the next open", () => {
        const first = account("first");
        const second = account("second");
        const third = account("third");
        const openOrder = accountOrderForOpen([first, second, third]);
        const starredWhileOpen = [first, { ...second, favorite: true }, third];

        expect(reconcileOpenAccountOrder(openOrder, starredWhileOpen)).toEqual(["first", "second", "third"]);
        expect(accountOrderForOpen(starredWhileOpen)).toEqual(["second", "first", "third"]);
    });

    it("does not move the selected account ahead of the saved account order", () => {
        const first = account("first");
        const second = account("second");
        const third = account("third");

        expect(accountOrderForOpen([first, second, third])).toEqual(["first", "second", "third"]);
        // Selecting `third` is intentionally absent from the ordering input:
        // current-account state changes the row marker, never its position.
        expect(reconcileOpenAccountOrder(["first", "second", "third"], [first, second, third])).toEqual([
            "first",
            "second",
            "third",
        ]);
    });
});
