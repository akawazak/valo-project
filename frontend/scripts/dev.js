const { spawn } = require("child_process");
const path = require("path");
const nextBin = require.resolve("next/dist/bin/next");

console.log("[ValoVault Launcher] Starting Next.js dev server...");
console.log("[ValoVault Launcher] Tauri owns the Go backend sidecar.");

const frontend = spawn(process.execPath, [nextBin, "dev", "--turbopack"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
});

const cleanup = () => {
    try {
        frontend.kill("SIGINT");
    } catch {}
};

process.on("SIGINT", () => {
    cleanup();
    process.exit();
});
process.on("SIGTERM", () => {
    cleanup();
    process.exit();
});

frontend.on("exit", (code) => {
    console.log(`[ValoVault Launcher] Next.js frontend exited with code ${code}`);
    process.exit(code ?? 0);
});
