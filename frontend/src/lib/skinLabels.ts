const LEVEL_ITEM_LABELS: Record<string, string> = {
    VFX: "VFX",
    Animation: "Animation",
    Finisher: "Finisher",
    KillCounter: "Kill counter",
    KillBanner: "Kill banner",
    KillEffect: "Kill effect",
    Transformation: "Transformation",
    AttackerDefenderSwap: "Attacker / defender",
    InspectAndKill: "Inspect and kill",
    SoundEffects: "Sound",
    Randomizer: "Randomizer",
    TopFrag: "Top frag",
    HeartbeatAndMapSensor: "Heartbeat sensor",
    FishAnimation: "Fish animation",
    SongShuffle: "Song shuffle",
    Voiceover: "Voiceover",
};

/** Name of a skin upgrade level from valorant-api's levelItem ("Base" for level 1). */
export function levelLabel(levelItem?: string | null) {
    const key = levelItem?.split("::").pop() || "";
    return key ? LEVEL_ITEM_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2") : "Base";
}

/** Short variant name, e.g. "Oni Vandal Level 4 (Variant 1 Kumo)" -> "Kumo". */
export function chromaLabel(name: string, index: number) {
    if (index === 0) return "Base";
    return name.match(/\(([^)]*)\)/)?.[1]?.replace(/^Variant\s*\d+\s*/i, "").trim() || `Variant ${index + 1}`;
}
