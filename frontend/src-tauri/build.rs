use std::path::Path;
use std::process::Command;

fn main() {
    let project_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_dir = Path::new(&project_dir);
    let parent = project_dir.parent().unwrap();
    let backend_dir = parent.parent().unwrap().join("backend");
    println!("cargo:rerun-if-changed={}", backend_dir.display());
    let go_cache_dir = backend_dir.join(".gocache");
    let _ = std::fs::create_dir_all(&go_cache_dir);

    let target_dir = project_dir.join("binaries");
    let _ = std::fs::create_dir_all(&target_dir);

    #[cfg(target_os = "windows")]
    let binary_name = "valovault-backend-x86_64-pc-windows-msvc.exe";

    #[cfg(not(target_os = "windows"))]
    let binary_name = "valovault-backend-x86_64-unknown-linux-gnu";

    let binary_path = target_dir.join(binary_name);
    let temp_binary_path = target_dir.join(format!("{binary_name}.tmp"));
    let _ = std::fs::remove_file(&temp_binary_path);

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
    let _ = std::fs::remove_file(&binary_path);
    std::fs::rename(&temp_binary_path, &binary_path).expect("failed to replace Go backend sidecar");

    tauri_build::build()
}
