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

#[tauri::command]
async fn open_login_window(
    app_handle: tauri::AppHandle,
    auth_url: String,
    session_id: Option<String>,
    visible: Option<bool>,
) -> Result<(), String> {
    let label = "riot_login";
    
    // Close existing login window if open
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.close();
    }
    
    let cloned_handle = app_handle.clone();
    
    let config_dir = app_handle.path().app_config_dir().map_err(|e| e.to_string())?;
    let mut session_dir = config_dir.clone();
    session_dir.push("sessions");
    if let Some(ref sid) = session_id {
        session_dir.push(sid);
    } else {
        session_dir.push("default");
    }
    
    let is_visible = visible.unwrap_or(true);
    
    let window = tauri::webview::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::External(url::Url::parse(&auth_url).map_err(|e| format!("Invalid URL: {}", e))?),
    )
    .title("Riot Sign In")
    .inner_size(600.0, 800.0)
    .resizable(true)
    .visible(is_visible)
    .data_directory(session_dir)
    .on_navigation(move |url| {
        let host = url.host_str().unwrap_or("");
        let path = url.path();
        if (host == "localhost" || host == "127.0.0.1") && path == "/redirect" {
            let redirect_url_str = url.as_str().to_string();
            let _ = cloned_handle.emit("riot-login-redirect", redirect_url_str);
            
            let label_cloned = label.to_string();
            let app_handle_inner = cloned_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(window) = app_handle_inner.get_webview_window(&label_cloned) {
                    let _ = window.close();
                }
            });
            
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
async fn show_login_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("riot_login") {
        let _ = window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn is_portable() -> Result<bool, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir_str = exe_path.to_string_lossy().to_lowercase();
    let is_p = !(exe_dir_str.contains("appdata\\local\\programs") || exe_dir_str.contains("program files"));
    Ok(is_p)
}

#[tauri::command]
async fn install_portable_update(app_handle: tauri::AppHandle, version: String) -> Result<(), String> {
    let download_url = format!(
        "https://github.com/akawazak/valo-project/releases/download/v{}/ValoVault-portable.zip",
        version
    );

    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or("Cannot get executable directory")?.to_path_buf();
    
    // Create temporary directory
    let cache_dir = app_handle.path().app_cache_dir().map_err(|e| e.to_string())?;
    let temp_dir = cache_dir.join(format!("update_{}", version));
    if temp_dir.exists() {
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    
    let zip_file_path = temp_dir.join("update.zip");
    let extracted_dir = temp_dir.join("extracted");
    std::fs::create_dir_all(&extracted_dir).map_err(|e| e.to_string())?;

    // Use PowerShell to download
    let download_script = format!(
        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '{}' -OutFile '{}'",
        download_url,
        zip_file_path.to_string_lossy()
    );
    let output_download = std::process::Command::new("powershell")
        .args(&["-NoProfile", "-Command", &download_script])
        .output()
        .map_err(|e| format!("Failed to download update: {}", e))?;
    
    if !output_download.status.success() {
        return Err(format!(
            "Download failed: {}",
            String::from_utf8_lossy(&output_download.stderr)
        ));
    }

    // Use PowerShell to extract
    let extract_script = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        zip_file_path.to_string_lossy(),
        extracted_dir.to_string_lossy()
    );
    let output_extract = std::process::Command::new("powershell")
        .args(&["-NoProfile", "-Command", &extract_script])
        .output()
        .map_err(|e| format!("Failed to extract update: {}", e))?;

    if !output_extract.status.success() {
        return Err(format!(
            "Extraction failed: {}",
            String::from_utf8_lossy(&output_extract.stderr)
        ));
    }

    // Create the update.bat script in the temp directory
    let bat_content = format!(
        r#"@echo off
title ValoVault Update
echo Waiting for ValoVault to close...
timeout /t 2 /nobreak > nul
:loop
tasklist /nh /fi "imagename eq ValoVault.exe" | find /i "ValoVault.exe" > nul
if %errorlevel% == 0 (
    timeout /t 1 /nobreak > nul
    goto loop
)
echo Applying update...
xcopy "{}\*" "{}\" /y /e /s /i
echo Relaunching ValoVault...
start "" "{}\ValoVault.exe"
exit
"#,
        extracted_dir.to_string_lossy(),
        exe_dir.to_string_lossy(),
        exe_dir.to_string_lossy()
    );

    let bat_path = temp_dir.join("update.bat");
    std::fs::write(&bat_path, bat_content).map_err(|e| e.to_string())?;

    // Spawn the batch script
    std::process::Command::new("cmd.exe")
        .args(&["/c", "start", "", &bat_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("Failed to run update script: {}", e))?;

    // Exit the app immediately
    std::process::exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            child: Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            open_login_window,
            show_login_window,
            is_portable,
            install_portable_update
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(cache_dir) = handle.path().app_cache_dir() {
                    if let Ok(entries) = std::fs::read_dir(cache_dir) {
                        for entry in entries.filter_map(Result::ok) {
                            if let Some(name) = entry.file_name().to_str() {
                                if name.starts_with("update_") {
                                    let _ = std::fs::remove_dir_all(entry.path());
                                }
                            }
                        }
                    }
                }
            });
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
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
