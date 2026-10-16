import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREVIEWS = new Set(["insights", "compare", "badges"]);
const LISTS = { added: "added", improved: "improved", fixed: "fixed" };

const plain = (text) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();

/**
 * Turns a canonical release-notes file (.github/release-notes/vX.md, the same text as the GitHub release)
 * into the in-app "What's new" popup. Optional "### Highlights" bullets read `- **Title** (preview): text`.
 */
export function parseReleaseNotes(markdown, version) {
    const notes = { version, title: "What’s new", summary: "", highlights: [], added: [], improved: [], fixed: [] };
    const summary = [];
    let section = "";
    for (const raw of markdown.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("## ")) continue;
        if (line.startsWith("### ")) { section = line.slice(4).trim().toLowerCase(); continue; }
        if (!section) { if (line) summary.push(plain(line)); continue; }
        if (!line.startsWith("- ")) continue;
        const item = line.slice(2);
        if (section === "highlights") {
            const match = item.match(/^\*\*(.+?)\*\*\s*(?:\((\w+)\))?\s*[:—-]\s*(.+)$/);
            if (!match) continue;
            const [, title, preview, text] = match;
            notes.highlights.push({ title: plain(title), text: plain(text), ...(PREVIEWS.has(preview) ? { preview } : {}) });
        } else if (LISTS[section]) {
            notes[LISTS[section]].push(plain(item));
        }
    }
    notes.summary = summary.join(" ");
    return notes;
}

/** Notes for the version in package.json, or null when that release has no notes file yet. */
export function loadReleaseNotes(version) {
    try {
        return parseReleaseNotes(readFileSync(join(repoRoot, ".github", "release-notes", `v${version}.md`), "utf8"), version);
    } catch {
        return null;
    }
}
