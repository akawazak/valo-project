import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import ProfileLoading, { ProgressionLoading } from "./ProfileLoading";

it("keeps rank pending when matches finish first, then exposes recovery on failure", () => {
    const props = { gameName: "Player", overviewReady: false, matchesReady: true, onRetry: () => undefined };
    const pending = renderToStaticMarkup(createElement(ProfileLoading, props));
    expect(pending).toContain("Loading profile data…");
    expect(pending).not.toContain("Preparing player artwork…");
    expect(pending).toContain('data-state="complete"');
    expect(pending).toMatch(/aria-current="step"[^>]*>[\s\S]*?Profile data/);
    const failed = renderToStaticMarkup(createElement(ProfileLoading, { ...props, error: "Connection unavailable" }));
    expect(failed).toContain("Connection unavailable");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain('aria-busy="true"');
    expect(failed).not.toContain('aria-current="step"');
});

it("uses the card scan in XP center with progression copy and without profile-only stages", () => {
    const markup = renderToStaticMarkup(createElement(ProgressionLoading, { gameName: "Player", cardArt: "/card.png" }));
    expect(markup).toContain('src="/card.png"');
    expect(markup).toContain("profileLoadScanHead");
    expect(markup).toContain("Loading current missions and contracts…");
    expect(markup).not.toContain("Opening player profile");
    expect(markup).not.toContain("Profile data");
    expect(markup).not.toContain("Matches");
});

it("moves the active stage with real readiness and clears it once everything is ready", () => {
    const props = { gameName: "Player", overviewReady: true, matchesReady: false, artReady: true, onRetry: () => undefined };
    const pending = renderToStaticMarkup(createElement(ProfileLoading, props));
    expect(pending).toContain("Loading recent matches…");
    expect(pending).toMatch(/aria-current="step"[^>]*>[\s\S]*?Matches/);
    expect(pending.match(/aria-current="step"/g)).toHaveLength(1);
    const ready = renderToStaticMarkup(createElement(ProfileLoading, { ...props, matchesReady: true }));
    expect(ready).toContain("Opening profile…");
    expect(ready).not.toContain('aria-current="step"');
});
