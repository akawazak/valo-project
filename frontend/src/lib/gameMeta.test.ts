import { describe, expect, it, vi } from "vitest";

vi.mock("../services/api", () => ({ fetchCachedPublicJson: vi.fn() }));
import { apiColor, matchModeLabel, parseCompetitiveTiers, parseGameModes, parseQueues, queueLabel, weaponCategoryKey } from "./gameMeta";

const modes = parseGameModes([
    { displayName: "Standard", assetPath: "ShooterGame/Content/GameModes/Bomb/BombGameMode_PrimaryAsset" },
    { displayName: "Retake", assetPath: "ShooterGame/Content/GameModes/FortCollins/FortCollins_PrimaryAsset" },
    { displayName: "Skirmish", assetPath: "ShooterGame/Content/GameModes/Skirmish/Skirmish_PrimaryAsset" },
    { displayName: "Skirmish: Ascension", assetPath: "ShooterGame/Content/GameModes/SkirmishAscension/Asc_PrimaryAsset" },
    { displayName: "Swiftplay", assetPath: "ShooterGame/Content/GameModes/_Development/Swiftplay_EndOfRoundCredits/Swift_PrimaryAsset" },
]);

describe("matchModeLabel", () => {
    it("names new modes from the API instead of a fixed list", () => {
        expect(matchModeLabel(modes, "retake", "/Game/GameModes/FortCollins/FortCollins_GameMode.FortCollins_GameMode_C")).toBe("Retake");
        expect(matchModeLabel(modes, "skirmish", "/Game/GameModes/Skirmish/Skirmish_GameMode.Skirmish_GameMode_C")).toBe("Skirmish");
    });

    it("prefers the most specific folder", () => {
        expect(matchModeLabel(modes, "x", "/Game/GameModes/SkirmishAscension/A.A_C")).toBe("Skirmish: Ascension");
        expect(matchModeLabel(modes, "", "/Game/GameModes/_Development/Swiftplay_EndOfRoundCredits/S.S_C")).toBe("Swiftplay");
    });

    it("uses the queue id for queues sharing the standard mode", () => {
        expect(matchModeLabel(modes, "competitive", "/Game/GameModes/Bomb/BombGameMode.BombGameMode_C")).toBe("Competitive");
        expect(matchModeLabel(modes, "premier", "/Game/GameModes/Bomb/BombGameMode.BombGameMode_C")).toBe("Premier");
    });

    it("falls back when metadata is unavailable", () => {
        expect(matchModeLabel([], "unrated", "")).toBe("Unrated");
        expect(matchModeLabel([], "", "")).toBe("Custom");
    });
});

describe("parseCompetitiveTiers", () => {
    it("reads names and colors from the latest tier set", () => {
        const tiers = parseCompetitiveTiers([
            { tiers: [{ tier: 16, tierName: "OLD" }] },
            { tiers: [{ tier: 16, tierName: "PLATINUM 2", divisionName: "PLATINUM", color: "59a9b6ff" }, { tier: 1 }] },
        ]);
        expect(tiers.get(16)).toMatchObject({ name: "Platinum 2", division: "Platinum", color: "#59a9b6" });
        expect(tiers.has(1)).toBe(false);
    });
});

describe("helpers", () => {
    it("parses API colors and weapon categories", () => {
        expect(apiColor("ffd761ff")).toBe("#ffd761");
        expect(apiColor("nope")).toBe("");
        expect(weaponCategoryKey("EEquippableCategory::Rifle")).toBe("rifle");
        expect(weaponCategoryKey(undefined)).toBe("");
    });
});

describe("queues", () => {
    const queues = parseQueues([
        { queueId: "skirmish2v2", dropdownText: "Skirmish: 2v2" },
        { queueId: "fortcollins", dropdownText: "Retake" },
        { queueId: "competitive", dropdownText: "Competitive" },
        { queueId: "" , dropdownText: "Ignored" },
    ]);

    it("labels Riot queue ids from the API", () => {
        expect(queueLabel("skirmish2v2", queues)).toBe("Skirmish: 2v2");
        expect(queueLabel("FortCollins", queues)).toBe("Retake");
        expect(queueLabel("somethingnew", queues)).toBe("Somethingnew");
        expect(queueLabel("", queues)).toBe("");
        expect(queues.size).toBe(3);
    });

    it("prefers the queue name over the game mode for match labels", () => {
        expect(matchModeLabel(modes, "skirmish2v2", "/Game/GameModes/Skirmish/S.S_C", queues)).toBe("Skirmish: 2v2");
        expect(matchModeLabel(modes, "unknownqueue", "/Game/GameModes/Skirmish/S.S_C", queues)).toBe("Skirmish");
    });
});
