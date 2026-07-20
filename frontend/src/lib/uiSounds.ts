export type UiSound = "message" | "matchFound" | "success" | "error";

type SoundPreferences = { enabled: boolean; volume: number };

let preferences: SoundPreferences = { enabled: true, volume: 28 };
let audioContext: AudioContext | null = null;
const lastPlayed = new Map<UiSound, number>();

export function configureUiSounds(next: Partial<SoundPreferences>) {
    preferences = {
        enabled: next.enabled ?? preferences.enabled,
        volume: Math.min(100, Math.max(0, next.volume ?? preferences.volume)),
    };
}

function context() {
    if (typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return null;
    audioContext ??= new AudioContextClass();
    return audioContext;
}

const CUES: Record<UiSound, Array<{ at: number; frequency: number; duration: number; type: OscillatorType }>> = {
    message: [
        { at: 0, frequency: 660, duration: 0.075, type: "sine" },
        { at: 0.085, frequency: 880, duration: 0.11, type: "sine" },
    ],
    matchFound: [
        { at: 0, frequency: 392, duration: 0.11, type: "triangle" },
        { at: 0.12, frequency: 523.25, duration: 0.11, type: "triangle" },
        { at: 0.24, frequency: 783.99, duration: 0.18, type: "triangle" },
    ],
    success: [
        { at: 0, frequency: 587.33, duration: 0.08, type: "sine" },
        { at: 0.09, frequency: 783.99, duration: 0.13, type: "sine" },
    ],
    error: [
        { at: 0, frequency: 220, duration: 0.12, type: "triangle" },
        { at: 0.11, frequency: 164.81, duration: 0.16, type: "triangle" },
    ],
};

export function playUiSound(cue: UiSound, options?: { force?: boolean }) {
    if ((!preferences.enabled && !options?.force) || preferences.volume <= 0) return;
    const now = Date.now();
    if (!options?.force && now - (lastPlayed.get(cue) || 0) < 300) return;
    lastPlayed.set(cue, now);

    const audio = context();
    if (!audio) return;
    void audio.resume().then(() => {
        const start = audio.currentTime + 0.012;
        const level = 0.13 * (preferences.volume / 100);
        for (const note of CUES[cue]) {
            const oscillator = audio.createOscillator();
            const gain = audio.createGain();
            const noteStart = start + note.at;
            oscillator.type = note.type;
            oscillator.frequency.setValueAtTime(note.frequency, noteStart);
            gain.gain.setValueAtTime(0.0001, noteStart);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), noteStart + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + note.duration);
            oscillator.connect(gain).connect(audio.destination);
            oscillator.start(noteStart);
            oscillator.stop(noteStart + note.duration + 0.025);
        }
    }).catch(() => undefined);
}
