use std::process::Command;
use std::path::Path;

fn main() {
    let project_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_dir = Path::new(&project_dir);
    let parent = project_dir.parent().unwrap();
    let backend_dir = parent.parent().unwrap().join("backend");
    
    let target_dir = project_dir.join("binaries");
    let _ = std::fs::create_dir_all(&target_dir);
    
    #[cfg(target_os = "windows")]
    let binary_name = "valovault-backend-x86_64-pc-windows-msvc.exe";
    
    #[cfg(not(target_os = "windows"))]
    let binary_name = "valovault-backend-x86_64-unknown-linux-gnu";
    
    let binary_path = target_dir.join(binary_name);
    
    if !binary_path.exists() {
        println!("cargo:warning=Compiling Go backend sidecar...");
        let status = Command::new("go")
            .args(&["build", "-o", binary_path.to_str().unwrap(), "."])
            .current_dir(&backend_dir)
            .status();
            
        if status.is_err() || !status.unwrap().success() {
            println!("cargo:warning=Failed to compile Go backend, writing dummy file");
            let _ = std::fs::write(&binary_path, b"dummy");
        }
    }
    
    tauri_build::build()
}
