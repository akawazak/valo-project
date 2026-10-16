import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseNotes } from "./scripts/release-notes.mjs";
import pkg from "./package.json" with { type: "json" };

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
    // The What's new popup reads the same notes file as the GitHub release, so every update brings its own.
    env: {
        VANTAVAULT_RELEASE_NOTES: JSON.stringify(loadReleaseNotes(pkg.version)),
    },
    output: 'export',
    distDir: process.env.NEXT_DIST_DIR || ".next",
    images: {
        unoptimized: true,
    },
    turbopack: {
        root: projectRoot,
    },
};

export default nextConfig;
