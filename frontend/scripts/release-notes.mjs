import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseReleaseNotes } from "../src/lib/releaseNotes.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export { parseReleaseNotes };

/** Notes for the version in package.json, or null when that release has no notes file yet. */
export function loadReleaseNotes(version) {
    try {
        return parseReleaseNotes(readFileSync(join(repoRoot, ".github", "release-notes", `v${version}.md`), "utf8"), version);
    } catch {
        return null;
    }
}
