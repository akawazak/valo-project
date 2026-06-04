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
async fn open_login_window(app_handle: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    let label = "riot_login";
    
    // Close existing login window if open
    if let Some(window) = app_handle.get_webview_window(label) {
        let _ = window.close();
    }
    
    let cloned_handle = app_handle.clone();
    
    tauri::webview::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::External(url::Url::parse(&auth_url).map_err(|e| format!("Invalid URL: {}", e))?),
    )
    .title("Riot Sign In")
    .inner_size(600.0, 800.0)
    .resizable(true)
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
    
    Ok(())
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
        .invoke_handler(tauri::generate_handler![open_login_window])
        .setup(|app| {
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
