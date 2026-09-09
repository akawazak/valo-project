export type UiSound = "message" | "party" | "matchFound" | "wishlist" | "success" | "error";

type SoundPreferences = { enabled: boolean; volume: number };

let preferences: SoundPreferences = { enabled: true, volume: 28 };
const lastPlayed = new Map<UiSound, number>();
const players = new Map<UiSound, HTMLAudioElement>();

const SOURCES: Record<UiSound, string> = {
    message: "/sounds/message.wav",
    party: "/sounds/party.wav",
    matchFound: "/sounds/match-found.wav",
    wishlist: "/sounds/wishlist.wav",
    success: "/sounds/success.wav",
    error: "/sounds/error.wav",
};

export const UI_SOUND_LABELS: Record<UiSound, string> = {
    message: "Message",
    party: "Party detected",
    matchFound: "Match found",
    wishlist: "Wishlist item",
    success: "Success",
    error: "Error",
};

export function configureUiSounds(next: Partial<SoundPreferences>) {
    preferences = {
        enabled: next.enabled ?? preferences.enabled,
        volume: Math.min(100, Math.max(0, next.volume ?? preferences.volume)),
    };
    for (const cue of Object.keys(SOURCES) as UiSound[]) playerFor(cue);
}

function playerFor(cue: UiSound) {
    if (typeof window === "undefined") return null;
    let player = players.get(cue);
    if (!player) {
        player = new Audio(SOURCES[cue]);
        player.preload = "auto";
        players.set(cue, player);
    }
    return player;
}

export function playUiSound(cue: UiSound, options?: { force?: boolean }) {
    if ((!preferences.enabled && !options?.force) || preferences.volume <= 0) return;
    const now = Date.now();
    if (!options?.force && now - (lastPlayed.get(cue) || 0) < 300) return;
    lastPlayed.set(cue, now);

    const player = playerFor(cue);
    if (!player) return;
    player.pause();
    player.currentTime = 0;
    player.volume = Math.min(1, 0.72 * (preferences.volume / 100));
    void player.play().catch(() => undefined);
}
