import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MOBILE_PREFERENCES, loadMobilePreferences, saveMobilePreferences } from "./mobilePreferences";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

describe("mobile preferences", () => {
  it("uses a conventional complete default layout", () => {
    expect(loadMobilePreferences()).toEqual(DEFAULT_MOBILE_PREFERENCES);
  });

  it("repairs missing and invalid sections without allowing live status to be hidden", () => {
    localStorage.setItem("vv-mobile-preferences:v1", JSON.stringify({
      homeOrder: ["store", "unknown"],
      hiddenHomeSections: ["presence", "progress", "bad"],
    }));
    expect(loadMobilePreferences()).toEqual({
      homeOrder: ["store", "presence", "progress"],
      hiddenHomeSections: ["progress"],
    });
  });

  it("persists a reordered layout", () => {
    const next = { homeOrder: ["presence", "store", "progress"] as const, hiddenHomeSections: ["store"] as const };
    saveMobilePreferences({ homeOrder: [...next.homeOrder], hiddenHomeSections: [...next.hiddenHomeSections] });
    expect(loadMobilePreferences()).toEqual(next);
  });
});
