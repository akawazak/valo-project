import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
    getAccountXP: vi.fn(), getAgentStats: vi.fn(), getFrequentTeammates: vi.fn(), getMapStats: vi.fn(),
    getPlayedQueues: vi.fn(), getProfileOverview: vi.fn(), getProfileSeasonSummary: vi.fn(),
    getProfileSyncStatus: vi.fn(), getRRHistory: vi.fn(),
}));
vi.mock("../../services/api", () => api);
import { isProfileSyncReady, loadProfileSnapshot } from "./profileSnapshot";

beforeEach(() => {
    Object.values(api).forEach(mock => mock.mockReset().mockResolvedValue({}));
    api.getProfileOverview.mockResolvedValue({ currentSeasonId: "season", seasonSummary: { matches: 3 } });
    api.getProfileSeasonSummary.mockResolvedValue({ summary: { matches: 4 } });
});

it("keeps another player's snapshot pending until rank history resolves, using that player's scope", async () => {
    const scope = { puuid: "other-player", region: "eu" };
    let releaseRank!: (value: object) => void;
    api.getRRHistory.mockReturnValue(new Promise(resolve => { releaseRank = resolve; }));
    let ready = false;
    const onIdentity = vi.fn();
    const snapshot = loadProfileSnapshot(scope, "", "competitive", false, false, onIdentity).then(data => { ready = true; return data; });
    await vi.waitFor(() => expect(api.getRRHistory).toHaveBeenCalledWith("season", scope));
    expect(ready).toBe(false);
    expect(onIdentity).toHaveBeenCalledWith(expect.objectContaining({ currentSeasonId: "season" }));
    expect(api.getAccountXP).not.toHaveBeenCalled();
    expect(api.getProfileOverview).toHaveBeenCalledWith(scope, false);
    expect(api.getProfileSeasonSummary).toHaveBeenCalledWith("competitive", scope, "season");
    releaseRank({ snapshots: [] });
    expect((await snapshot).seasonSummary).toEqual({ matches: 4 });
});

it("waits for own-account XP and settles unavailable optional sections without trapping the loader", async () => {
    let releaseXP!: (value: object) => void;
    api.getAccountXP.mockReturnValue(new Promise(resolve => { releaseXP = resolve; }));
    api.getRRHistory.mockRejectedValue(new Error("Unavailable"));
    api.getProfileSeasonSummary.mockRejectedValue(new Error("Unavailable"));
    let ready = false;
    const pending = loadProfileSnapshot({ puuid: "own-player", region: "eu" }, "", "competitive", true, true).then(data => { ready = true; return data; });
    await vi.waitFor(() => expect(api.getAccountXP).toHaveBeenCalled());
    expect(ready).toBe(false);
    releaseXP({ Progress: { Level: 40, XP: 100 } });
    const result = await pending;
    expect(result.seasonSummary).toEqual({ matches: 3 });
    expect(result.rrHistory).toBeNull();
    expect(result.unavailable).toContain("rank history");
});

it("propagates a missing other-player overview to the retry state", async () => {
    api.getProfileOverview.mockRejectedValue(new Error("Profile not found"));
    await expect(loadProfileSnapshot({ puuid: "missing", region: "eu" }, "", "competitive", false, false)).rejects.toThrow("Profile not found");
});

it("does not reveal another player's cached rank while the live overview is pending", async () => {
    const scope = { puuid: "other-player", region: "eu" };
    let releaseOverview!: (value: object) => void;
    api.getProfileOverview.mockReturnValue(new Promise(resolve => { releaseOverview = resolve; }));
    let ready = false;
    const pending = loadProfileSnapshot(scope, "", "competitive", false, false).then(data => { ready = true; return data; });
    await vi.waitFor(() => expect(api.getProfileOverview).toHaveBeenCalledWith(scope, false));
    expect(ready).toBe(false);
    releaseOverview({ currentSeasonId: "season", currentRank: { competitiveTier: 18 }, seasonSummary: { matches: 4 } });
    expect((await pending).overview.currentRank.competitiveTier).toBe(18);
});

it("returns a retry error when Riot reports rank failure instead of treating it as unranked", async () => {
    api.getProfileOverview.mockResolvedValue({ currentSeasonId: "season", rankError: "MMR request failed" });
    await expect(loadProfileSnapshot({ puuid: "other", region: "eu" }, "", "competitive", true, false)).rejects.toThrow("Couldn't load player rank");
});

it("keeps the overlay while backfill runs even after profile/rank requests finish", () => {
    expect(isProfileSyncReady("other", "other", false, { inFlight: true }, "")).toBe(false);
    expect(isProfileSyncReady("other", "other", false, { inFlight: false }, "")).toBe(true);
    expect(isProfileSyncReady("next-player", "other", false, { inFlight: false }, "")).toBe(false);
    expect(isProfileSyncReady("other", "other", false, { inFlight: false }, "Sync failed")).toBe(false);
});
