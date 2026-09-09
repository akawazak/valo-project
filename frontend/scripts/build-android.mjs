import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextCli, "build", "--turbopack"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-android",
  },
  shell: false,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
