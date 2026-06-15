use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct AppState {
    child: Mutex<Option<CommandChild>>,
}

// ---------------------------------------------------------------------------
// Startup cleanup — only removes old *temporary* session directories
// (session_<timestamp>_<random>) while leaving stable PUUID-based sessions
// (session_<uuid>) untouched.  This avoids the race condition where an
// active account's cookie directory was deleted mid-use.
// ---------------------------------------------------------------------------
fn cleanup_stale_sessions(config_dir: &std::path::Path) {
    let sessions_dir = config_dir.join("sessions");
    if !sessions_dir.exists() {
        return;
    }

    for entry in std::fs::read_dir(&sessions_dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("session_") || !entry.path().is_dir() {
            continue;
        }
        // Temp sessions look like: session_<digits>_<alphanum>
        let after_prefix = &name["session_".len()..];
        if let Some(underscore_pos) = after_prefix.find('_') {
            let timestamp_part = &after_prefix[..underscore_pos];
            if timestamp_part.chars().all(|c| c.is_ascii_digit()) && !timestamp_part.is_empty() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn open_login_window(
    app_handle: tauri::AppHandle,
    auth_url: String,
    session_id: Option<String>,
    visible: Option<bool>,
) -> Result<(), String> {
    let window_label = format!(
        "riot_login_{}",
        session_id.as_deref().unwrap_or("default")
    );

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
    let cookie_capture_config_dir = config_dir.clone();
    let cookie_capture_session_id = session_id.clone().unwrap_or_else(|| "default".to_string());

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
    .additional_browser_args("--disable-features=BlockThirdPartyCookies")
    .on_navigation(move |url: &url::Url| {
        let host = url.host_str().unwrap_or("");
        let path = url.path();
        if host == "localhost" || host == "127.0.0.1" && path == "/redirect" {
            let redirect_url_str = url.as_str().to_string();
            let _ = cloned_handle.emit("riot-login-redirect", redirect_url_str);

            // Spawn background thread to read cookies from the WebView2 DB
            let cookie_handle = cloned_handle.clone();
            let cookie_config_dir = cookie_capture_config_dir.clone();
            let cookie_session_id = cookie_capture_session_id.clone();
            std::thread::spawn(move || {
                match read_session_cookies_with_wait(&cookie_config_dir, &cookie_session_id, 15000)
                {
                    Ok(Some(cookie_str)) => {
                        let _ = cookie_handle.emit("riot-login-cookies", cookie_str);
                    }
                    Ok(None) => {
                        let _ = cookie_handle.emit("riot-login-cookies-missing", cookie_session_id);
                    }
                    Err(err) => {
                        let _ = cookie_handle.emit("riot-login-cookies-error", err);
                    }
                }
            });

            // Navigate the popup to a neutral Riot URL to force cookie commit.
            if let Some(window) = cloned_handle.get_webview_window(&window_label) {
                let _ = window.eval("window.location.href = 'https://www.riotgames.com/';");
            }
            false
        } else {
            true
        }
    })
    .build()
    .map_err(|e| e.to_string())?;

    let cloned_handle_for_close = app_handle.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = cloned_handle_for_close.emit("riot-login-closed", ());
        }
    });

    Ok(())
}

#[tauri::command]
async fn show_login_window(app_handle: tauri::AppHandle, session_id: Option<String>) -> Result<(), String> {
    let window_label = format!("riot_login_{}", session_id.as_deref().unwrap_or("default"));
    if let Some(window) = app_handle.get_webview_window(&window_label) {
        let _ = window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_login_window(app_handle: tauri::AppHandle, session_id: Option<String>) -> Result<(), String> {
    let window_label = format!("riot_login_{}", session_id.as_deref().unwrap_or("default"));
    if let Some(window) = app_handle.get_webview_window(&window_label) {
        let _ = window.close().map_err(|e| e.to_string())?;
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

#[tauri::command]
async fn persist_login_session(
    app_handle: tauri::AppHandle,
    from_session_id: String,
    to_session_id: String,
) -> Result<(), String> {
    if from_session_id == to_session_id {
        return Ok(());
    }

    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    let sessions_dir = config_dir.join("sessions");
    let source = sessions_dir.join(&from_session_id);
    let target = sessions_dir.join(&to_session_id);

    if !source.exists() {
        return Err(format!(
            "Login session '{}' does not exist",
            from_session_id
        ));
    }

    if target.exists() {
        remove_dir_all_with_retry(&target)
            .map_err(|e| format!("Failed to replace existing login session: {}", e))?;
    }

    copy_dir_recursive_with_retry(&source, &target)
        .map_err(|e| format!("Failed to persist login session: {}", e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

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
            if cookie_db.exists() {
                if let Ok(_) = std::fs::copy(&cookie_db, &temp_path) {
                    let result = read_cookies_from_db(&temp_path, &session_dir);
                    let _ = std::fs::remove_file(&temp_path);
                    if let Ok(Some(ref cookie_str)) = result {
                        if cookie_str.contains("ssid=") {
                            return result;
                        }
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

fn remove_dir_all_with_retry(path: &std::path::Path) -> std::io::Result<()> {
    let mut last_error = None;

    for attempt in 0..20 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => {
                last_error = Some(err);
                if attempt < 19 {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::Other, "failed to remove directory")
    }))
}

fn copy_dir_recursive_with_retry(
    source: &std::path::Path,
    target: &std::path::Path,
) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive_with_retry(&source_path, &target_path)?;
        } else {
            copy_file_with_retry(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn copy_file_with_retry(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    let mut last_error = None;

    for attempt in 0..20 {
        match std::fs::copy(source, target) {
            Ok(_) => return Ok(()),
            Err(err) => {
                last_error = Some(err);
                if attempt < 19 {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "failed to copy file")))
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

#[cfg(test)]
mod tests {
    use super::strip_chromium_host_key_hash;
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

    let mut input = CRYPT_INTEGER_BLOB {
        cbData: payload.len() as u32,
        pbData: payload.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };

    unsafe {
        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
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
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            child: Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            open_login_window,
            show_login_window,
            close_login_window,
            get_ssid_cookie,
            persist_login_session,
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
            }

            if !cfg!(dev) {
                let state = app.state::<AppState>();
                let sidecar_command = app.shell().sidecar("valovault-backend").unwrap();
                let (_rx, child) = sidecar_command.spawn().expect("Failed to spawn sidecar");
                *state.child.lock().unwrap() = Some(child);
            }

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if !cfg!(dev) {
            if let RunEvent::ExitRequested { .. } = &event {
                let state: State<AppState> = app_handle.state();
                if let Some(child) = state.child.lock().unwrap().take() {
                    child.kill().expect("Failed to kill sidecar");
                };
            }
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
