export type HomeSectionId = "presence" | "progress" | "store";

export type MobilePreferences = {
  homeOrder: HomeSectionId[];
  hiddenHomeSections: HomeSectionId[];
};

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  homeOrder: ["presence", "progress", "store"],
  hiddenHomeSections: [],
};

const KEY = "vv-mobile-preferences:v1";

export function loadMobilePreferences(): MobilePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<MobilePreferences> | null;
    const known = new Set<HomeSectionId>(DEFAULT_MOBILE_PREFERENCES.homeOrder);
    const supplied = (raw?.homeOrder || []).filter((item): item is HomeSectionId => known.has(item as HomeSectionId));
    const homeOrder = [...supplied, ...DEFAULT_MOBILE_PREFERENCES.homeOrder.filter((item) => !supplied.includes(item))];
    const hiddenHomeSections = (raw?.hiddenHomeSections || []).filter((item): item is HomeSectionId => item !== "presence" && known.has(item as HomeSectionId));
    return { homeOrder, hiddenHomeSections };
  } catch {
    return DEFAULT_MOBILE_PREFERENCES;
  }
}

export function saveMobilePreferences(value: MobilePreferences) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
