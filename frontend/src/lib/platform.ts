export function isAndroidRuntime(): boolean {
    if (typeof navigator === "undefined") return false;
    if (/\bAndroid\b/i.test(navigator.userAgent)) return true;
    // Keeps the Android surface testable in a desktop browser without changing
    // the normal Windows route. The real APK still uses the Android user agent.
    return typeof window !== "undefined"
        && process.env.NODE_ENV !== "production"
        && new URLSearchParams(window.location.search).get("mobilePreview") === "1";
}
