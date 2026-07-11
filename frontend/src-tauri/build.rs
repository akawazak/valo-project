use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::SystemTime;

fn watch_backend_sources(directory: &Path) -> Option<SystemTime> {
    let Ok(entries) = fs::read_dir(directory) else {
        return None;
    };

    let mut newest_change: Option<SystemTime> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().is_some_and(|name| name == ".gocache") {
            continue;
        }
        if path.is_dir() {
            if let Some(change) = watch_backend_sources(&path) {
                newest_change = Some(newest_change.map_or(change, |current| current.max(change)));
            }
            continue;
        }
        if matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("go" | "mod" | "sum")
        ) {
            println!("cargo:rerun-if-changed={}", path.display());
            if let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) {
                newest_change =
                    Some(newest_change.map_or(modified, |current| current.max(modified)));
            }
        }
    }

    newest_change
}

fn main() {
    let project_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_dir = Path::new(&project_dir);
    let parent = project_dir.parent().unwrap();
    let backend_dir = parent.parent().unwrap().join("backend");
    let backend_last_changed = watch_backend_sources(&backend_dir);
    let go_cache_dir = backend_dir.join(".gocache");
    let _ = std::fs::create_dir_all(&go_cache_dir);

    let target_dir = project_dir.join("binaries");
    let _ = std::fs::create_dir_all(&target_dir);

    #[cfg(target_os = "windows")]
    let binary_name = "valovault-backend-x86_64-pc-windows-msvc.exe";

    #[cfg(not(target_os = "windows"))]
    let binary_name = "valovault-backend-x86_64-unknown-linux-gnu";

    let binary_path = target_dir.join(binary_name);
    let sidecar_is_current = fs::metadata(&binary_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .is_some_and(|built_at| match backend_last_changed {
            Some(changed_at) => built_at >= changed_at,
            None => true,
        });

    if !sidecar_is_current {
        let temp_binary_path = target_dir.join(format!("{binary_name}.tmp"));
        let _ = fs::remove_file(&temp_binary_path);

        println!("cargo:warning=Compiling Go backend sidecar...");
        let status = Command::new("go")
            .args([
                "build",
                "-buildvcs=false",
                "-o",
                temp_binary_path.to_str().unwrap(),
                ".",
            ])
            .env("GOCACHE", &go_cache_dir)
            .current_dir(&backend_dir)
            .status();

        if status.is_err() || !status.unwrap().success() {
            panic!("failed to compile Go backend sidecar");
        }
        let _ = fs::remove_file(&binary_path);
        fs::rename(&temp_binary_path, &binary_path).expect("failed to replace Go backend sidecar");
    }

    tauri_build::build()
}
