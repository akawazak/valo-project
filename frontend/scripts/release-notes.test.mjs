import { describe, expect, it } from "vitest";
import { loadReleaseNotes, parseReleaseNotes } from "./release-notes.mjs";

describe("release notes", () => {
    it("reads the summary, highlights and lists, and skips download sections", () => {
        const notes = parseReleaseNotes([
            "## VantaVault v1.2.3", "", "One line summary.", "",
            "### Highlights", "- **Compare, face to face** (compare): Cards side by side.", "- **No art** : Plain card.",
            "### Added", "- A **bold** thing with `code`.",
            "### Fixed", "- A fix.",
            "### Download", "- **Windows Portable:** `x.exe`",
        ].join("\r\n"), "1.2.3");
        expect(notes.summary).toBe("One line summary.");
        expect(notes.highlights).toEqual([
            { title: "Compare, face to face", text: "Cards side by side.", preview: "compare" },
            { title: "No art", text: "Plain card." },
        ]);
        expect(notes.added).toEqual(["A bold thing with code."]);
        expect(notes.improved).toEqual([]);
        expect(notes.fixed).toEqual(["A fix."]);
    });

    it("loads past releases without highlights and returns null for a missing file", () => {
        const old = loadReleaseNotes("0.5.29");
        expect(old?.highlights).toEqual([]);
        expect(old?.fixed.length).toBeGreaterThan(0);
        expect(loadReleaseNotes("0.0.0")).toBeNull();
    });
});
