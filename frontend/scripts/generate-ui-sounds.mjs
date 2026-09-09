import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sampleRate = 44_100;
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "public", "sounds");
mkdirSync(outputDir, { recursive: true });

function envelope(time, start, duration, attack = 0.012) {
    const local = time - start;
    if (local < 0 || local >= duration) return 0;
    if (local < attack) return local / attack;
    return Math.pow(1 - (local - attack) / (duration - attack), 2.2);
}

function tone(time, start, duration, frequency, wave = "sine", gain = 1) {
    const env = envelope(time, start, duration);
    if (!env) return 0;
    const phase = 2 * Math.PI * frequency * (time - start);
    const sample = wave === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(phase)) : Math.sin(phase);
    return sample * env * gain;
}

function shimmer(time, start, duration, low, high, gain = 1) {
    const local = time - start;
    const env = envelope(time, start, duration, 0.02);
    if (!env) return 0;
    const frequency = low + (high - low) * (local / duration);
    return Math.sin(2 * Math.PI * frequency * local) * env * gain;
}

const cues = {
    "message.wav": { duration: 0.28, render: t => tone(t, 0, 0.13, 740, "sine", 0.55) + tone(t, 0.09, 0.17, 988, "sine", 0.5) },
    "party.wav": { duration: 0.55, render: t => shimmer(t, 0, 0.3, 300, 520, 0.35) + tone(t, 0.17, 0.35, 523.25, "triangle", 0.32) + tone(t, 0.17, 0.35, 659.25, "sine", 0.28) + tone(t, 0.17, 0.35, 783.99, "sine", 0.22) },
    "match-found.wav": { duration: 0.82, render: t => tone(t, 0, 0.26, 392, "triangle", 0.48) + tone(t, 0.2, 0.28, 523.25, "triangle", 0.46) + tone(t, 0.4, 0.4, 783.99, "triangle", 0.52) + tone(t, 0.4, 0.4, 392, "sine", 0.2) },
    "wishlist.wav": { duration: 0.58, render: t => shimmer(t, 0, 0.24, 900, 1500, 0.38) + tone(t, 0.18, 0.24, 1318.51, "sine", 0.38) + tone(t, 0.31, 0.25, 1760, "sine", 0.28) },
    "success.wav": { duration: 0.38, render: t => tone(t, 0, 0.18, 587.33, "sine", 0.5) + tone(t, 0.12, 0.24, 880, "sine", 0.52) },
    "error.wav": { duration: 0.48, render: t => tone(t, 0, 0.23, 233.08, "triangle", 0.5) + tone(t, 0.18, 0.28, 155.56, "triangle", 0.52) },
};

function writeWav(filename, duration, render) {
    const count = Math.ceil(sampleRate * duration);
    const pcm = Buffer.alloc(count * 2);
    for (let i = 0; i < count; i += 1) {
        const sample = Math.max(-1, Math.min(1, render(i / sampleRate))) * 0.72;
        pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + pcm.length, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcm.length, 40);
    pcm.copy(wav, 44);
    writeFileSync(join(outputDir, filename), wav);
}

for (const [filename, cue] of Object.entries(cues)) writeWav(filename, cue.duration, cue.render);
