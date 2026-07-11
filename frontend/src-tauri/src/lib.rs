use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
fn write_discord_frame(
    pipe: &mut std::fs::File,
    opcode: u32,
    payload: &serde_json::Value,
) -> std::io::Result<()> {
    use std::io::Write;
    let body = serde_json::to_vec(payload)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    pipe.write_all(&opcode.to_le_bytes())?;
    pipe.write_all(&(body.len() as u32).to_le_bytes())?;
    pipe.write_all(&body)?;
    pipe.flush()
}

#[cfg(target_os = "windows")]
fn read_discord_frame(pipe: &mut std::fs::File) -> std::io::Result<(u32, serde_json::Value)> {
    use std::io::Read;
    let mut header = [0_u8; 8];
    pipe.read_exact(&mut header)?;
    let opcode = u32::from_le_bytes(header[0..4].try_into().unwrap());
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
    if length > 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Discord IPC frame is too large",
        ));
    }
    let mut body = vec![0_u8; length];
    pipe.read_exact(&mut body)?;
    let payload = serde_json::from_slice(&body)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    Ok((opcode, payload))
}

#[cfg(target_os = "windows")]
#[derive(Clone, serde::Deserialize)]
struct DiscordActivity {
    details: String,
    state: String,
}

#[cfg(target_os = "windows")]
fn discord_activity_payload(activity: &DiscordActivity, started_at: u64) -> serde_json::Value {
    serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": {
            "pid": std::process::id(),
            "activity": {
                "details": activity.details,
                "state": activity.state,
                "timestamps": { "start": started_at },
                "assets": { "large_image": "logo", "large_text": "VantaVault - VALORANT companion" },
                "buttons": [
                    { "label": "VantaVault Info", "url": "https://github.com/akawazak/valo-project" }
                ]
            }
        },
        "nonce": uuid::Uuid::new_v4().to_string()
    })
}

#[cfg(target_os = "windows")]
fn start_discord_presence(client_id: String) -> std::sync::mpsc::Sender<DiscordActivity> {
    let (sender, receiver) = std::sync::mpsc::channel::<DiscordActivity>();
    std::thread::spawn(move || loop {
        let mut current = DiscordActivity {
            details: "Browsing VantaVault".to_string(),
            state: "Desktop companion".to_string(),
        };
        let mut started_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        while let Ok(update) = receiver.try_recv() {
            if update.details != current.details {
                started_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
            }
            current = update;
        }
        let mut pipe = None;
        for index in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{index}");
            let Ok(candidate) = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
            else {
                continue;
            };
            pipe = Some(candidate);
            break;
        }
        let Some(mut pipe) = pipe else {
            log::debug!("Discord Rich Presence: IPC pipe not found; retrying");
            std::thread::sleep(std::time::Duration::from_secs(15));
            continue;
        };
        let handshake = serde_json::json!({"v": 1, "client_id": client_id});
        if let Err(error) = write_discord_frame(&mut pipe, 0, &handshake) {
            log::warn!("Discord Rich Presence handshake write failed: {error}");
            continue;
        }
        match read_discord_frame(&mut pipe) {
            Ok((1, payload))
                if payload.get("evt").and_then(|value| value.as_str()) == Some("READY") => {}
            Ok((opcode, payload)) => {
                log::warn!("Discord Rich Presence handshake rejected (opcode {opcode}): {payload}");
                continue;
            }
            Err(error) => {
                log::warn!("Discord Rich Presence handshake read failed: {error}");
                continue;
            }
        }
        if let Err(error) = write_discord_frame(
            &mut pipe,
            1,
            &discord_activity_payload(&current, started_at),
        ) {
            log::warn!("Discord Rich Presence initial activity failed: {error}");
            continue;
        }
        if let Ok((opcode, payload)) = read_discord_frame(&mut pipe) {
            if opcode == 2 || payload.get("evt").and_then(|value| value.as_str()) == Some("ERROR") {
                log::warn!("Discord Rich Presence activity rejected: {payload}");
                continue;
            }
        }
        log::info!("Discord Rich Presence connected");
        loop {
            match receiver.recv_timeout(std::time::Duration::from_secs(60)) {
                Ok(update) => {
                    if update.details != current.details {
                        started_at = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs();
                    }
                    current = update;
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            }
            if let Err(error) = write_discord_frame(
                &mut pipe,
                1,
                &discord_activity_payload(&current, started_at),
            ) {
                log::warn!("Discord Rich Presence update failed: {error}");
                break;
            }
            if let Ok((opcode, payload)) = read_discord_frame(&mut pipe) {
                if opcode == 2
                    || payload.get("evt").and_then(|value| value.as_str()) == Some("ERROR")
                {
                    log::warn!("Discord Rich Presence update rejected: {payload}");
                    break;
                }
            }
        }
    });
    sender
}

fn configured_discord_client_id(config_dir: &std::path::Path) -> Option<String> {
    std::env::var("VANTAVAULT_DISCORD_CLIENT_ID")
        .ok()
        .or_else(|| std::fs::read_to_string(config_dir.join("discord_client_id.txt")).ok())
        .or_else(|| Some("1523476232501727354".to_string()))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
}

struct AppState {
    child: Mutex<Option<CommandChild>>,
    #[cfg(target_os = "windows")]
    backend_pid: Mutex<Option<u32>>,
    backend_token: String,
    #[cfg(target_os = "windows")]
    discord_sender: Mutex<Option<std::sync::mpsc::Sender<DiscordActivity>>>,
    /// Per-window-label mutex map. Each label (`riot_login_<session_id>`)
    /// gets its own `Arc<Mutex<()>>` so concurrent calls to
    /// `open_login_window` with the SAME label queue up instead of
    /// racing — preventing the "label already exists" crash and the
    /// cookie loss that happens when two windows try to read the same
    /// SQLite file simultaneously.
    window_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

#[tauri::command]
fn get_backend_token(state: State<'_, AppState>) -> String {
    state.backend_token.clone()
}

#[tauri::command]
fn is_portable() -> bool {
    std::env::var("VANTAVAULT_PORTABLE").ok().as_deref() == Some("1")
}

#[derive(Clone, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PortableUpdateState {
    #[serde(default)]
    status: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    checked_at: Option<u64>,
    #[serde(default)]
    pending_path: Option<String>,
    #[serde(default)]
    apply_on_exit: bool,
}

fn portable_update_state_path() -> Result<PathBuf, String> {
    let state_dir = std::env::var("VANTAVAULT_PORTABLE_STATE_DIR")
        .map_err(|_| "This portable session does not have an update location.".to_string())?;
    let state_dir = PathBuf::from(state_dir);
    std::fs::create_dir_all(&state_dir)
        .map_err(|error| format!("Could not prepare portable updates: {error}"))?;
    Ok(state_dir.join("update-state.json"))
}

fn read_portable_update_state() -> Result<PortableUpdateState, String> {
    let path = portable_update_state_path()?;
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Could not read portable update status: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PortableUpdateState::default())
        }
        Err(error) => Err(format!("Could not read portable update status: {error}")),
    }
}

fn write_portable_update_state(state: &PortableUpdateState) -> Result<(), String> {
    let path = portable_update_state_path()?;
    let bytes = serde_json::to_vec(state)
        .map_err(|error| format!("Could not save portable update status: {error}"))?;
    std::fs::write(path, bytes)
        .map_err(|error| format!("Could not save portable update status: {error}"))
}

#[tauri::command]
fn portable_update_status() -> Result<PortableUpdateState, String> {
    if !is_portable() {
        return Err("Portable updates are only available in the portable build.".to_string());
    }
    read_portable_update_state()
}

#[tauri::command]
fn portable_start_update() -> Result<(), String> {
    if !is_portable() {
        return Err("Portable updates are only available in the portable build.".to_string());
    }

    let current = read_portable_update_state()?;
    if matches!(current.status.as_str(), "checking" | "downloading") {
        return Ok(());
    }

    write_portable_update_state(&PortableUpdateState {
        status: "checking".to_string(),
        checked_at: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        ),
        ..Default::default()
    })?;

    let launcher_path = std::env::var("VANTAVAULT_PORTABLE_LAUNCHER_PATH").map_err(|_| {
        "The portable launcher is unavailable. Please reopen VantaVault from its portable EXE."
            .to_string()
    })?;
    ProcessCommand::new(launcher_path)
        .arg("--download-update")
        .spawn()
        .map_err(|error| format!("Could not start the portable update: {error}"))?;
    Ok(())
}

#[tauri::command]
fn portable_restart_to_update(app: AppHandle) -> Result<(), String> {
    if !is_portable() {
        return Err("Portable updates are only available in the portable build.".to_string());
    }

    let mut state = read_portable_update_state()?;
    if state.status != "ready" || state.pending_path.is_none() {
        return Err("There is no downloaded portable update ready to apply.".to_string());
    }
    state.apply_on_exit = true;
    write_portable_update_state(&state)?;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_discord_presence(state: State<'_, AppState>, details: String, activity_state: String) {
    if let Ok(sender) = state.discord_sender.lock() {
        if let Some(sender) = sender.as_ref() {
            let _ = sender.send(DiscordActivity {
                details,
                state: activity_state,
            });
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_discord_presence(_state: State<'_, AppState>, _details: String, _activity_state: String) {}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginRedirectPayload {
    session_id: String,
    url: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginCookiesPayload {
    session_id: String,
    cookies: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginSessionPayload {
    session_id: String,
}

impl AppState {
    fn lock_for_window(&self, label: &str) -> Arc<Mutex<()>> {
        let mut map = self.window_locks.lock().unwrap();
        map.entry(label.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn take_backend_child(&self) -> Option<CommandChild> {
        match self.child.lock() {
            Ok(mut guard) => guard.take(),
            Err(poisoned) => {
                eprintln!("sidecar child lock was poisoned during exit; recovering");
                poisoned.into_inner().take()
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn take_backend_pid(&self) -> Option<u32> {
        match self.backend_pid.lock() {
            Ok(mut guard) => guard.take(),
            Err(poisoned) => {
                eprintln!("sidecar pid lock was poisoned during exit; recovering");
                poisoned.into_inner().take()
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn kill_windows_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = ProcessCommand::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(result) if result.status.success() => {}
        Ok(result) => {
            let detail = String::from_utf8_lossy(&result.stderr);
            if !detail.contains("not found") && !detail.contains("not running") {
                eprintln!(
                    "taskkill did not fully stop backend pid {pid}: {}",
                    detail.trim()
                );
            }
        }
        Err(error) => eprintln!("failed to run taskkill for backend pid {pid}: {error}"),
    }
}

fn stop_backend_sidecar(state: &AppState) {
    #[cfg(target_os = "windows")]
    let pid = state.take_backend_pid();

    if let Some(child) = state.take_backend_child() {
        if let Err(e) = child.kill() {
            eprintln!("failed to kill sidecar on exit: {e}");
        }
    };

    #[cfg(target_os = "windows")]
    if let Some(pid) = pid {
        kill_windows_process_tree(pid);
    }
}

// ---------------------------------------------------------------------------
// Startup cleanup removes abandoned login folders while preserving claimed
// per-account WebView2 user-data folders. It runs before any WebView exists.
// ---------------------------------------------------------------------------
fn cleanup_stale_sessions(config_dir: &std::path::Path) {
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        return;
    }
    recover_session_swap_artifacts(&sessions_dir);

    for entry in std::fs::read_dir(&sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if !entry.path().is_dir() {
            continue;
        }
        if name.starts_with("account_") {
            if entry.path().join(".claimed").exists() {
                prune_session_cache(&entry.path());
            } else {
                let _ = std::fs::remove_dir_all(entry.path());
            }
            continue;
        }
        if !name.starts_with("session_") {
            continue;
        }
        // Temp sessions look like: session_<digits>_<alphanum>
        let after_prefix = &name["session_".len()..];
        if let Some(underscore_pos) = after_prefix.find('_') {
            let timestamp_part = &after_prefix[..underscore_pos];
            if timestamp_part.chars().all(|c| c.is_ascii_digit()) && !timestamp_part.is_empty() {
                let _ = std::fs::remove_dir_all(entry.path());
                continue;
            }
        }
        prune_session_cache(&entry.path());
    }
}

fn recover_session_swap_artifacts(sessions_dir: &std::path::Path) {
    for entry in std::fs::read_dir(sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".staging") {
            let _ = std::fs::remove_dir_all(entry.path());
        } else if let Some(target_name) = name.strip_suffix(".backup") {
            let target = sessions_dir.join(target_name);
            if target.exists() {
                let _ = std::fs::remove_dir_all(entry.path());
            } else {
                let _ = std::fs::rename(entry.path(), target);
            }
        }
    }
}

fn prune_session_cache(session_dir: &std::path::Path) {
    for relative in [
        "EBWebView/Default/Cache",
        "EBWebView/Default/Code Cache",
        "EBWebView/Default/GPUCache",
        "EBWebView/Default/DawnCache",
        "EBWebView/GrShaderCache",
        "EBWebView/GraphiteDawnCache",
        "EBWebView/component_crx_cache",
    ] {
        let _ = std::fs::remove_dir_all(session_dir.join(relative));
    }
}

fn session_cache_size(config_dir: &std::path::Path) -> u64 {
    let sessions_dir = config_dir.join("sessions");
    std::fs::read_dir(sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .map(|entry| {
            [
                "EBWebView/Default/Cache",
                "EBWebView/Default/Code Cache",
                "EBWebView/Default/GPUCache",
                "EBWebView/Default/DawnCache",
                "EBWebView/GrShaderCache",
                "EBWebView/GraphiteDawnCache",
                "EBWebView/component_crx_cache",
            ]
            .iter()
            .map(|relative| directory_size(&entry.path().join(relative)))
            .sum::<u64>()
        })
        .sum()
}

fn directory_size(path: &std::path::Path) -> u64 {
    if path.is_file() {
        return path.metadata().map(|meta| meta.len()).unwrap_or(0);
    }
    std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_session_cache_size(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(session_cache_size(&config_dir))
}

#[tauri::command]
fn clear_session_caches(app_handle: tauri::AppHandle) -> Result<u64, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let before = session_cache_size(&config_dir);
    let sessions_dir = config_dir.join("sessions");
    for entry in std::fs::read_dir(sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
    {
        prune_session_cache(&entry.path());
    }
    Ok(before.saturating_sub(session_cache_size(&config_dir)))
}

#[tauri::command]
async fn open_login_window(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    auth_url: String,
    session_id: Option<String>,
    visible: Option<bool>,
) -> Result<(), String> {
    let window_label = format!("riot_login_{}", session_id.as_deref().unwrap_or("default"));

    // Serialise per-label: if another caller is already opening/closing
    // the same session, wait for them. This prevents the "label already
    // exists" race and the cookie loss that happens when two windows try
    // to read the same SQLite file at the same time.
    let lock = state.lock_for_window(&window_label);
    let _guard = lock.lock().unwrap_or_else(|p| p.into_inner());

    // Close existing login window if open
    if let Some(window) = app_handle.get_webview_window(&window_label) {
        let _ = window.close();
    }
    // Tauri defers window destruction — wait so the label is freed before we
    // re-create the WebView with the same label.
    std::thread::sleep(std::time::Duration::from_millis(50));

    let cloned_handle = app_handle.clone();

    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let sessions_base = config_dir.join("sessions");

    // NOTE: No aggressive cleanup here — we only clean stale temp sessions at
    // startup (see cleanup_stale_sessions).  This prevents deletion of active
    // account cookie directories while they are in use.

    let mut session_dir = sessions_base.clone();
    if let Some(ref sid) = session_id {
        session_dir.push(sid);
    } else {
        session_dir.push("default");
    }
    let cookie_capture_session_id = session_id.clone().unwrap_or_else(|| "default".to_string());
    let redirect_started = Arc::new(AtomicBool::new(false));

    // Ensure the directory exists — WebView fails silently if it doesn't
    std::fs::create_dir_all(&session_dir)
        .map_err(|e| format!("Failed to create session directory: {}", e))?;

    let is_visible = visible.unwrap_or(true);

    let window = tauri::webview::WebviewWindowBuilder::new(
        &app_handle,
        &window_label,
        tauri::WebviewUrl::External(
            url::Url::parse(&auth_url).map_err(|e| format!("Invalid URL: {}", e))?,
        ),
    )
    .title("Riot Login")
    .inner_size(500.0, 650.0)
    .visible(is_visible)
    .data_directory(session_dir)
    // Disable third-party-cookie blocking so the Riot OAuth session cookie
    // is persisted to SQLite and can be read back via get_ssid_cookie.
    .additional_browser_args("--disable-features=BlockThirdPartyCookies --disk-cache-size=5242880")
    .on_navigation(move |url: &url::Url| {
        let host = url.host_str().unwrap_or("");
        let path = url.path();
        // NOTE: previous code was `host == "localhost" || host == "127.0.0.1" && path == "/redirect"`,
        // which parses as `host == "localhost" || (host == "127.0.0.1" && path == "/redirect")`
        // — a precedence bug that would emit the redirect event for ANY
        // localhost URL. Fixed here.
        let is_oauth_redirect = (host == "localhost" || host == "127.0.0.1") && path == "/redirect";
        if is_oauth_redirect {
            if redirect_started.swap(true, Ordering::SeqCst) {
                return false;
            }

            let redirect_url_str = url.as_str().to_string();
            let cookie_handle = cloned_handle.clone();
            let cookie_session_id = cookie_capture_session_id.clone();
            let cookie_window = cloned_handle.get_webview_window(&window_label);

            // WebView2 exposes HTTP-only cookies through its native cookie
            // manager. Read them on a worker thread (the synchronous
            // navigation callback can deadlock on Windows), emit them first,
            // and only then tell React to close the popup. The SQLite reader
            // remains the post-close fallback in DataContext.
            std::thread::spawn(move || {
                let mut cookie_str = None;
                if let Some(window) = cookie_window {
                    for _ in 0..5 {
                        cookie_str = window.cookies().ok().and_then(|cookies| {
                            build_riot_cookie_header(
                                cookies
                                    .iter()
                                    .map(|cookie| (cookie.name(), cookie.value(), cookie.domain())),
                            )
                        });
                        if cookie_str.is_some() {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }

                if let Some(cookie_str) = cookie_str {
                    let _ = cookie_handle.emit(
                        "riot-login-cookies-v2",
                        LoginCookiesPayload {
                            session_id: cookie_session_id.clone(),
                            cookies: cookie_str.clone(),
                        },
                    );
                    let _ = cookie_handle.emit("riot-login-cookies", cookie_str);
                } else {
                    let _ = cookie_handle.emit(
                        "riot-login-cookies-missing-v2",
                        LoginSessionPayload {
                            session_id: cookie_session_id.clone(),
                        },
                    );
                    let _ =
                        cookie_handle.emit("riot-login-cookies-missing", cookie_session_id.clone());
                }

                let _ = cookie_handle.emit(
                    "riot-login-redirect-v2",
                    LoginRedirectPayload {
                        session_id: cookie_session_id,
                        url: redirect_url_str.clone(),
                    },
                );
                let _ = cookie_handle.emit("riot-login-redirect", redirect_url_str);
            });

            false
        } else {
            true
        }
    })
    .build()
    .map_err(|e| e.to_string())?;

    let cloned_handle_for_close = app_handle.clone();
    let close_session_id = session_id.unwrap_or_else(|| "default".to_string());
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = cloned_handle_for_close.emit(
                "riot-login-closed-v2",
                LoginSessionPayload {
                    session_id: close_session_id.clone(),
                },
            );
            let _ = cloned_handle_for_close.emit("riot-login-closed", ());
        }
    });

    Ok(())
}

#[tauri::command]
fn claim_login_session(app_handle: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if !is_valid_account_session_id(&session_id) {
        return Err("Invalid login session ID".to_string());
    }
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let session_dir = config_dir.join("sessions").join(session_id);
    if !session_dir.is_dir() {
        return Err("Login session directory is missing".to_string());
    }
    std::fs::write(session_dir.join(".claimed"), b"")
        .map_err(|e| format!("Failed to claim login session: {e}"))
}

#[tauri::command]
fn delete_login_session(app_handle: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if !is_valid_account_session_id(&session_id) {
        return Err("Invalid login session ID".to_string());
    }
    let window_label = format!("riot_login_{session_id}");
    if app_handle.get_webview_window(&window_label).is_some() {
        return Err("Login session is still in use".to_string());
    }
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let session_dir = config_dir.join("sessions").join(session_id);
    if !session_dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(session_dir).map_err(|e| format!("Failed to delete login session: {e}"))
}

fn is_valid_account_session_id(session_id: &str) -> bool {
    session_id.starts_with("account_")
        && session_id.len() <= 128
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

#[tauri::command]
async fn show_login_window(
    app_handle: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<(), String> {
    let window_label = format!("riot_login_{}", session_id.as_deref().unwrap_or("default"));
    if let Some(window) = app_handle.get_webview_window(&window_label) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_login_window(
    app_handle: tauri::AppHandle,
    session_id: Option<String>,
) -> Result<(), String> {
    let window_label = format!("riot_login_{}", session_id.as_deref().unwrap_or("default"));
    if let Some(window) = app_handle.get_webview_window(&window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reads the WebView2 cookie database for a given session and extracts the
/// Riot `ssid` cookie value (decrypted via Windows DPAPI / AES-GCM).
/// Returns `None` if the cookie is not found or cannot be decrypted.
#[tauri::command]
async fn get_ssid_cookie(
    app_handle: tauri::AppHandle,
    session_id: String,
    wait_ms: Option<u64>,
) -> Result<Option<String>, String> {
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;

    read_session_cookies_with_wait(&config_dir, &session_id, wait_ms.unwrap_or(0))
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

fn build_riot_cookie_header<'a>(
    cookies: impl IntoIterator<Item = (&'a str, &'a str, Option<&'a str>)>,
) -> Option<String> {
    let mut cookie_map = HashMap::new();
    for (name, value, domain) in cookies {
        let is_riot_cookie = domain
            .map(|domain| domain.to_ascii_lowercase().ends_with("riotgames.com"))
            .unwrap_or(false);
        if is_riot_cookie && !name.is_empty() && !value.is_empty() {
            cookie_map.insert(name, value);
        }
    }

    if !cookie_map.contains_key("ssid") {
        return None;
    }

    Some(
        cookie_map
            .into_iter()
            .map(|(name, value)| format!("{}={}", name, value))
            .collect::<Vec<_>>()
            .join("; "),
    )
}

/// Polls the WebView2 cookie database until the `ssid` cookie is found or
/// the timeout expires.
fn read_session_cookies_with_wait(
    config_dir: &std::path::Path,
    session_id: &str,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    let session_dir = config_dir.join("sessions").join(session_id);
    let cookie_db = session_dir
        .join("EBWebView")
        .join("Default")
        .join("Network")
        .join("Cookies");

    let timeout = std::time::Duration::from_millis(timeout_ms);
    let start = std::time::Instant::now();
    let temp_path = config_dir
        .join("sessions")
        .join(format!("{}_cookies_tmp", session_id));

    loop {
        if cookie_db.exists() {
            match std::fs::copy(&cookie_db, &temp_path) {
                Ok(_) => {
                    let result = read_cookies_from_db(&temp_path, &session_dir);
                    let _ = std::fs::remove_file(&temp_path);

                    if let Ok(Some(ref cookie_str)) = result {
                        if cookie_str.contains("ssid=") {
                            return result;
                        }
                    }
                }
                Err(_) => {
                    // likely locked by WebView2; keep polling until timeout
                }
            }
        }

        if timeout_ms == 0 || start.elapsed() >= timeout {
            // Attempt one final read before giving up
            if cookie_db.exists() && std::fs::copy(&cookie_db, &temp_path).is_ok() {
                let result = read_cookies_from_db(&temp_path, &session_dir);
                let _ = std::fs::remove_file(&temp_path);
                if let Ok(Some(ref cookie_str)) = result {
                    if cookie_str.contains("ssid=") {
                        return result;
                    }
                }
            }
            return Ok(None);
        }

        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn read_cookies_from_db(
    db_path: &std::path::Path,
    session_dir: &std::path::Path,
) -> Result<Option<String>, String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open cookie DB: {}", e))?;

    #[cfg(target_os = "windows")]
    let cookie_key = load_chromium_cookie_key(session_dir).ok();
    #[cfg(not(target_os = "windows"))]
    let cookie_key: Option<Vec<u8>> = {
        let _ = session_dir;
        None
    };

    // Query for all cookies on riotgames.com sorted by creation time so
    // duplicates are overwritten by the newest
    let mut stmt = conn
        .prepare(
            "SELECT host_key, name, value, encrypted_value FROM cookies \
             WHERE host_key LIKE '%riotgames.com' \
             ORDER BY creation_utc ASC",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut cookie_map = std::collections::HashMap::new();
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("Failed to execute query: {}", e))?;

    while let Some(row) = rows
        .next()
        .map_err(|e| format!("Failed to fetch next row: {}", e))?
    {
        let host_key: String = row.get(0).unwrap_or_default();
        let name: String = row.get(1).unwrap_or_default();
        let value: String = row.get(2).unwrap_or_default();
        let encrypted: Vec<u8> = row.get(3).unwrap_or_default();

        let mut cookie_value = value;
        if cookie_value.is_empty() && !encrypted.is_empty() {
            #[cfg(target_os = "windows")]
            {
                if encrypted.starts_with(b"v10") || encrypted.starts_with(b"v11") {
                    // AES-256-GCM encrypted cookie (Chromium 80+)
                    if let Some(ref key) = cookie_key {
                        match aes_gcm_decrypt_cookie(&encrypted, key) {
                            Ok(decrypted) => {
                                match chromium_cookie_plaintext_to_string(&host_key, decrypted) {
                                    Ok(decrypted_str) => {
                                        cookie_value = decrypted_str;
                                    }
                                    Err(err) => {
                                        eprintln!(
                                            "Decoded cookie '{}' but value is not text: {}",
                                            name, err
                                        );
                                    }
                                }
                            }
                            Err(err) => {
                                eprintln!("AES-GCM decrypt failed for cookie '{}' : {}", name, err);
                            }
                        }
                    } else {
                        eprintln!(
                            "Missing Chromium cookie key for encrypted cookie '{}'",
                            name
                        );
                    }
                } else {
                    // Legacy DPAPI-encrypted cookie
                    match dpapi_decrypt(&encrypted) {
                        Ok(decrypted) => {
                            match chromium_cookie_plaintext_to_string(&host_key, decrypted) {
                                Ok(decrypted_str) => {
                                    cookie_value = decrypted_str;
                                }
                                Err(err) => {
                                    eprintln!(
                                        "DPAPI decoded cookie '{}' but value is not text: {}",
                                        name, err
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            eprintln!("DPAPI decrypt failed for cookie '{}' : {}", name, err);
                        }
                    }
                }
            }
        }

        if !name.is_empty() && !cookie_value.is_empty() {
            cookie_map.insert(name, cookie_value);
        }
    }

    if cookie_map.is_empty() {
        Ok(None)
    } else {
        let cookies: Vec<String> = cookie_map
            .into_iter()
            .map(|(name, value)| format!("{}={}", name, value))
            .collect();
        Ok(Some(cookies.join("; ")))
    }
}

// ---------------------------------------------------------------------------
// Cookie decryption — Chromium AES-256-GCM + Windows DPAPI
// ---------------------------------------------------------------------------

/// Loads the AES-256 key from the WebView2 `Local State` file.  The key
/// is stored base64-encoded inside `os_crypt.encrypted_key` and itself is
/// DPAPI-encrypted (with a "DPAPI" prefix that must be stripped first).
#[cfg(target_os = "windows")]
fn load_chromium_cookie_key(session_dir: &std::path::Path) -> Result<Vec<u8>, String> {
    use base64::Engine;

    let local_state_path = session_dir.join("EBWebView").join("Local State");
    let raw = std::fs::read_to_string(&local_state_path)
        .map_err(|e| format!("Failed to read Local State: {}", e))?;
    let json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse Local State: {}", e))?;
    let encrypted_key = json
        .get("os_crypt")
        .and_then(|v| v.get("encrypted_key"))
        .and_then(|v| v.as_str())
        .ok_or("Local State missing os_crypt.encrypted_key")?;
    let mut key_bytes = base64::engine::general_purpose::STANDARD
        .decode(encrypted_key)
        .map_err(|e| format!("Failed to decode encrypted key: {}", e))?;

    // Strip the "DPAPI" prefix added by Chromium
    if key_bytes.starts_with(b"DPAPI") {
        key_bytes.drain(..5);
    }

    dpapi_decrypt(&key_bytes)
}

#[cfg(not(target_os = "windows"))]
fn load_chromium_cookie_key(_session_dir: &std::path::Path) -> Result<Vec<u8>, String> {
    Err("Chromium cookie key loading is only implemented on Windows".to_string())
}

/// Decrypts a v10/v11 AES-256-GCM-encrypted cookie value.
/// Layout: "v10" | nonce (12 bytes) | ciphertext+tag
#[cfg(target_os = "windows")]
fn aes_gcm_decrypt_cookie(encrypted: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };

    // 3 (prefix) + 12 (nonce) + 16 (tag) = 31 minimum
    if encrypted.len() <= 3 + 12 + 16 {
        return Err("Encrypted cookie is too short".to_string());
    }

    let nonce = Nonce::from_slice(&encrypted[3..15]);
    let ciphertext_and_tag = &encrypted[15..];
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| format!("Invalid AES key: {}", e))?;
    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag)
        .map_err(|e| format!("AES-GCM decrypt failed: {}", e))?;

    Ok(plaintext)
}

fn chromium_cookie_plaintext_to_string(
    host_key: &str,
    plaintext: Vec<u8>,
) -> Result<String, String> {
    let value_bytes = strip_chromium_host_key_hash(host_key, &plaintext);
    String::from_utf8(value_bytes.to_vec())
        .map_err(|e| format!("Cookie value was not UTF-8: {}", e))
}

fn strip_chromium_host_key_hash<'a>(host_key: &str, plaintext: &'a [u8]) -> &'a [u8] {
    if plaintext.len() < 32 || host_key.is_empty() {
        return plaintext;
    }

    use sha2::{Digest, Sha256};

    let expected = Sha256::digest(host_key.as_bytes());
    if plaintext[..32] == expected[..] {
        &plaintext[32..]
    } else {
        plaintext
    }
}

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::{
        build_riot_cookie_header, cleanup_stale_sessions, is_valid_account_session_id,
        prune_session_cache, recover_session_swap_artifacts, session_cache_size,
        strip_chromium_host_key_hash,
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn strips_chromium_cookie_host_key_hash_prefix() {
        let host_key = ".riotgames.com";
        let cookie_value = b"ssid=abc123";
        let mut plaintext = Sha256::digest(host_key.as_bytes()).to_vec();
        plaintext.extend_from_slice(cookie_value);

        assert_eq!(
            strip_chromium_host_key_hash(host_key, &plaintext),
            cookie_value
        );
    }

    #[test]
    fn leaves_plain_cookie_values_unchanged() {
        let cookie_value = b"ssid=abc123";

        assert_eq!(
            strip_chromium_host_key_hash(".riotgames.com", cookie_value),
            cookie_value
        );
    }

    #[test]
    fn builds_riot_cookie_header_only_when_ssid_is_present() {
        let cookies = [
            ("ssid", "session-token", Some(".riotgames.com")),
            ("clid", "client-id", Some("auth.riotgames.com")),
            ("ignored", "value", Some("example.com")),
        ];

        let header = build_riot_cookie_header(cookies).unwrap();

        assert!(header.contains("ssid=session-token"));
        assert!(header.contains("clid=client-id"));
        assert!(!header.contains("ignored=value"));
        assert!(
            build_riot_cookie_header([("clid", "client-id", Some(".riotgames.com"))]).is_none()
        );
    }

    #[test]
    fn prunes_webview_cache_without_removing_cookies() {
        let root =
            std::env::temp_dir().join(format!("valovault-cache-test-{}", std::process::id()));
        let session = root.join("sessions/session_account");
        let cache = session.join("EBWebView/Default/Cache");
        let cookies = session.join("EBWebView/Default/Network/Cookies");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::create_dir_all(cookies.parent().unwrap()).unwrap();
        std::fs::write(cache.join("data"), b"cache").unwrap();
        std::fs::write(&cookies, b"cookies").unwrap();

        assert_eq!(session_cache_size(&root), 5);
        prune_session_cache(&session);

        assert!(!cache.exists());
        assert!(cookies.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn startup_cleanup_keeps_claimed_account_sessions_only() {
        let root = std::env::temp_dir().join(format!(
            "valovault-claimed-session-test-{}",
            std::process::id()
        ));
        let claimed = root.join("sessions/account_claimed");
        let abandoned = root.join("sessions/account_abandoned");
        let legacy = root.join("sessions/session_existing");
        std::fs::create_dir_all(&claimed).unwrap();
        std::fs::create_dir_all(&abandoned).unwrap();
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(claimed.join(".claimed"), b"").unwrap();

        cleanup_stale_sessions(&root);

        assert!(claimed.exists());
        assert!(!abandoned.exists());
        assert!(legacy.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn accepts_only_bounded_account_session_ids() {
        assert!(is_valid_account_session_id(
            "account_01234567-89ab-cdef-0123-456789abcdef"
        ));
        assert!(!is_valid_account_session_id("../account_escape"));
        assert!(!is_valid_account_session_id("session_legacy"));
        assert!(!is_valid_account_session_id(&format!(
            "account_{}",
            "a".repeat(121)
        )));
    }

    #[test]
    fn recovers_interrupted_session_swap() {
        let root =
            std::env::temp_dir().join(format!("valovault-recovery-test-{}", std::process::id()));
        let backup = root.join("session_account.backup");
        let staging = root.join("session_account.staging");
        std::fs::create_dir_all(&backup).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(backup.join("cookie"), b"old").unwrap();

        recover_session_swap_artifacts(&root);

        assert_eq!(
            std::fs::read(root.join("session_account/cookie")).unwrap(),
            b"old"
        );
        assert!(!backup.exists());
        assert!(!staging.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}

/// Decrypts data using the Windows DPAPI (CryptUnprotectData).
/// Handles the optional "v10"/"v11" prefix that Chromium sometimes adds to
/// DPAPI blobs.
#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    if data.is_empty() {
        return Err("Empty encrypted data".to_string());
    }

    // Chrome/Edge/WebView2 sometimes prefix DPAPI blobs with a version
    // header like "v10" or "v11".  If present, skip the 3-byte prefix.
    let payload: &[u8] = if data.len() > 3
        && data[0] == b'v'
        && data[1] == b'1'
        && (data[2] == b'0' || data[2] == b'1')
    {
        &data[3..]
    } else {
        data
    };

    if payload.is_empty() {
        return Err("Empty encrypted payload after stripping prefix".to_string());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: payload.len() as u32,
        pbData: payload.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
            .map_err(|e| format!("DPAPI decryption failed: {}", e))?;
    }

    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };

    // Free the buffer allocated by CryptUnprotectData
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(hmem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    unsafe {
        let _ = LocalFree(output.pbData as _);
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// Main application entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            child: Mutex::new(None),
            #[cfg(target_os = "windows")]
            backend_pid: Mutex::new(None),
            backend_token,
            #[cfg(target_os = "windows")]
            discord_sender: Mutex::new(None),
            window_locks: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            get_session_cache_size,
            clear_session_caches,
            open_login_window,
            show_login_window,
            close_login_window,
            claim_login_session,
            delete_login_session,
            get_ssid_cookie,
            get_backend_token,
            is_portable,
            portable_update_status,
            portable_start_update,
            portable_restart_to_update,
            set_discord_presence,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Safe cleanup: only remove stale temp session dirs at startup
            if let Ok(config_dir) = app.handle().path().app_config_dir() {
                cleanup_stale_sessions(&config_dir);
                #[cfg(target_os = "windows")]
                if let Some(client_id) = configured_discord_client_id(&config_dir) {
                    let sender = start_discord_presence(client_id);
                    if let Ok(mut slot) = app.state::<AppState>().discord_sender.lock() {
                        *slot = Some(sender);
                    }
                } else {
                    log::warn!("Discord Rich Presence is disabled: configure VANTAVAULT_DISCORD_CLIENT_ID or discord_client_id.txt");
                }
            }

            let state = app.state::<AppState>();
            let sidecar_command = app
                .shell()
                .sidecar("valovault-backend")
                .unwrap()
                .env("VANTAVAULT_API_KEY", &state.backend_token);
            let (_rx, child) = sidecar_command
                .spawn()
                .expect("Failed to spawn backend sidecar");
            #[cfg(target_os = "windows")]
            let backend_pid = child.pid();
            *state.child.lock().unwrap() = Some(child);
            #[cfg(target_os = "windows")]
            {
                *state.backend_pid.lock().unwrap() = Some(backend_pid);
            }

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = &event {
            let state: State<AppState> = app_handle.state();
            stop_backend_sidecar(&state);
        }

        if let RunEvent::WindowEvent {
            event: WindowEvent::Resized(_),
            ..
        } = &event
        {
            if let Some(window) = app_handle.get_webview_window("main") {
                if let Ok(true) = window.is_minimized() {
                    let _ = window.hide();
                }
            }
        }
    });
}
