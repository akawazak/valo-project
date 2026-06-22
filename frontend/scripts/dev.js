const { spawn } = require('child_process');
const path = require('path');

console.log('[ValoVault Launcher] Starting Go backend...');
const backendDir = path.resolve(__dirname, '../../backend');

// Spawn Go backend
const backend = spawn('go', ['run', '.'], {
    cwd: backendDir,
    stdio: 'inherit',
    shell: true
});

console.log('[ValoVault Launcher] Starting Next.js dev server...');

// Spawn Next.js dev server
const frontend = spawn('npx', ['next', 'dev', '--turbopack'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    shell: true
});

// Cleanup process helper to kill spawned children
const cleanup = () => {
    console.log('[ValoVault Launcher] Cleaning up processes...');
    try {
        backend.kill('SIGINT');
    } catch (e) {}
    try {
        frontend.kill('SIGINT');
    } catch (e) {}
    process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

backend.on('exit', (code) => {
    console.log(`[ValoVault Launcher] Go Backend exited with code ${code}`);
    cleanup();
});

frontend.on('exit', (code) => {
    console.log(`[ValoVault Launcher] Next.js frontend exited with code ${code}`);
    cleanup();
});
