import type { ProfileMatchDetails } from "@/services/api";
import type { AgentMeta } from "./profileShared";

// Nominal PC radii in world units (100 units per metre). Cyber Cage's
// horizontal cylinder radius is listed in the official VALORANT Wiki.
export const abilityCoverageRadii = new Map([
    ["Dark Cover", 410],
    ["Sky Smoke", 415],
    ["Ruse", 400],
    ["Cloudburst", 335],
    ["Cyber Cage", 372],
    ["Incendiary", 450],
]);

// Nominal replay footprints in world units where we have a measured game radius.
// A radius from the recording takes precedence. Terrain and elevation are not reconstructed.
export const replayCoverageRadii = new Map([
    ...abilityCoverageRadii,
    ["Hot Hands", 450],
    ["Nanoswarm", 450],
    ["Snake Bite", 450],
    ["Waveform", 472],
    ["Cove", 460],
    ["Mosh Pit", 620],
    ["Orbital Strike", 900],
    ["Razorvine", 625],
    ["Recon Bolt", 3000],
    ["Saturate", 600],
    ["Seize", 658],
]);
export function replayAbilityIcon(name: string, subject: string | undefined, players: ProfileMatchDetails["players"], agents: Record<string, AgentMeta>) {
    const owner = players.find(player => player.subject.toLowerCase() === subject?.toLowerCase());
    const agent = owner ? agents[owner.characterId.toLowerCase()] : undefined;
    const abilities = agent ? Object.values(agent.abilities ?? {}) : Object.values(agents).flatMap(entry => Object.values(entry.abilities ?? {}));
    return abilities.find(ability => ability.name.toLowerCase() === name.toLowerCase())?.icon;
}
