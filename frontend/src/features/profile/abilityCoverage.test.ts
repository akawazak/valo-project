import { describe, expect, it } from "vitest";
import type { ProfileMatchDetails } from "@/services/api";
import type { AgentMeta } from "./profileShared";
import { replayAbilityIcon } from "./abilityCoverage";

const players = [{ subject: "PLAYER", characterId: "SKYE" }] as ProfileMatchDetails["players"];
const agents: Record<string, AgentMeta> = {
    skye: { name: "Skye", icon: "", role: "Initiator", roleIcon: "", abilities: { ability1: { name: "Guiding Light", icon: "/skye-flash.png" } } },
    killjoy: { name: "Killjoy", icon: "", role: "Sentinel", roleIcon: "", abilities: { ability1: { name: "Turret", icon: "/killjoy-turret.png" } } },
};

describe("recorded ability artwork", () => {
    it("resolves the recorded owner's ability with case-insensitive IDs", () => {
        expect(replayAbilityIcon("guiding light", "player", players, agents)).toBe("/skye-flash.png");
        expect(replayAbilityIcon("Turret", "player", players, agents)).toBeUndefined();
    });

    it("uses the catalog when the replay has no known owner and leaves unknown abilities unlabeled", () => {
        expect(replayAbilityIcon("Turret", undefined, players, agents)).toBe("/killjoy-turret.png");
        expect(replayAbilityIcon("Unknown ability", undefined, players, agents)).toBeUndefined();
    });
});
