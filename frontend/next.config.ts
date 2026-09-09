import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
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
