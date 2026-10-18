/** Tray behaviour, stored by the desktop shell so it applies before the window loads. */
export interface TraySettings {
    startMinimized: boolean;
    closeToTray: boolean;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getTraySettings(): Promise<TraySettings> {
    if (!isTauri()) return { startMinimized: false, closeToTray: false };
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TraySettings>("get_tray_settings");
}

export async function setTraySettings(settings: TraySettings): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_tray_settings", { settings });
}
