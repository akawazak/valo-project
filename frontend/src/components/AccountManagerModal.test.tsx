import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RiotAccount } from "../lib/types";

vi.mock("@/lib/types", () => import("../lib/types"));
vi.mock("@/lib/accountHealth", () => import("../lib/accountHealth"));
vi.mock("@/lib/accountSelection", () => import("../lib/accountSelection"));
vi.mock("@/lib/accountStorage", () => ({ saveStoredAccountPlayerCard: vi.fn() }));
vi.mock("@/lib/authDebug", () => ({ buildAuthDebugSnapshot: vi.fn() }));
vi.mock("@/services/api", () => ({ getProfileOverview: vi.fn(), getProfilePlayerCard: vi.fn() }));
import AccountManagerModal from "./AccountManagerModal";

const account: RiotAccount = {
    puuid: "saved-account", gameName: "Demo", tagLine: "TEST", region: "eu",
    authSource: "oauth", sessionId: "saved-session", accessToken: "", entitlementsToken: "",
    lastRenewedAt: Date.now(), expiresAt: Date.now() + 60 * 60 * 1000,
};

function bulkButton(accounts: RiotAccount[]) {
    const html = renderToStaticMarkup(createElement(AccountManagerModal, {
        isOpen: true, accounts, activeAccount: accounts[0] ?? null, playerCards: [],
        onClose: vi.fn(), onSwitchAccount: vi.fn(), onRequestDeleteAccount: vi.fn(),
        onAddAccount: vi.fn(), onRefreshAccount: vi.fn(async () => true),
        onCancelRefresh: vi.fn(), onToggleFavorite: vi.fn(),
    }));
    const button = html.match(/<button[^>]*class="account-switcher-manage"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(button).toBeDefined();
    return button!;
}

describe("manual bulk renewal", () => {
    it("enables Renew all even when the saved session was renewed just now", () => {
        const button = bulkButton([account]);
        expect(button).toContain("Renew all");
        expect(button).not.toContain("disabled");
        expect(button).not.toContain("All renewed");
    });

    it("keeps manual renewal available alongside accounts needing a fresh sign-in", () => {
        const button = bulkButton([account, { ...account, puuid: "signed-out", lastRefreshErrorCode: "login_required" }]);
        expect(button).toContain("Renew 1 saved accounts");
        expect(button).not.toContain("disabled");
    });

    it("explains when only signed-out or local-client accounts remain", () => {
        const button = bulkButton([
            { ...account, lastRefreshErrorCode: "login_required" },
            { ...account, puuid: "local", authSource: "lockfile" },
        ]);
        expect(button).toContain("disabled");
        expect(button).toContain("No accounts to renew");
        expect(button).toContain("fresh login");
    });
});
