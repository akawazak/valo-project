import type { ReleaseNotes } from "@/components/ReleaseNotesModal";

/** Turns a release-notes markdown file (the same text as the GitHub release) into What's new data. */
export function parseReleaseNotes(markdown: string, version: string): ReleaseNotes;
