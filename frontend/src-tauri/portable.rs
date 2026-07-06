#![windows_subsystem = "windows"]

use std::{env, fs, io, path::Path, process::Command};

const APP: &[u8] = include_bytes!(env!("VV_APP_EXE"));
const BACKEND: &[u8] = include_bytes!(env!("VV_BACKEND_EXE"));
const BACKEND_TRIPLE_NAME: &str = "valovault-backend-x86_64-pc-windows-msvc.exe";

fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if !matches!(fs::read(path), Ok(existing) if existing == bytes) {
        fs::write(path, bytes)?;
    }
    Ok(())
}

fn run() -> io::Result<()> {
    let dir = Path::new(&env::var("LOCALAPPDATA").map_err(io::Error::other)?)
        .join("VantaVault")
        .join("portable")
        .join(env!("VV_VERSION"));
    fs::create_dir_all(&dir)?;

    let app = dir.join("VantaVault.exe");
    write_if_changed(&app, APP)?;
    write_if_changed(&dir.join("valovault-backend.exe"), BACKEND)?;
    write_if_changed(&dir.join(BACKEND_TRIPLE_NAME), BACKEND)?;
    Command::new(app).current_dir(dir).spawn()?.wait()?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        let message = format!("VantaVault portable failed to start:\n{error}");
        let _ = fs::write(env::temp_dir().join("VantaVault-portable-error.txt"), &message);
        let _ = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &format!("Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('{}','VantaVault')", message.replace('\'', "''"))])
            .spawn();
    }
}
