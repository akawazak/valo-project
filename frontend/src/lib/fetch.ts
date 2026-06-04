/**
 * Fetch shim — uses Tauri's plugin-http when running inside the Tauri
 * WebView, and falls back to the native browser fetch for local dev at
 * http://localhost:3000.
 */

let _tauriFetch: typeof fetch | null = null;

async function getTauriFetch(): Promise<typeof fetch | null> {
    if (_tauriFetch !== null) return _tauriFetch;
    try {
        // Only succeeds inside the Tauri runtime
        const mod = await import('@tauri-apps/plugin-http');
        _tauriFetch = mod.fetch as typeof fetch;
        return _tauriFetch;
    } catch {
        _tauriFetch = null;
        return null;
    }
}

export async function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const tauriFetch = await getTauriFetch();
    if (tauriFetch) {
        return tauriFetch(input as Parameters<typeof tauriFetch>[0], init as Parameters<typeof tauriFetch>[1]);
    }
    return fetch(input, init);
}
