#![windows_subsystem = "windows"]

#[cfg(all(target_env = "msvc", not(target_feature = "crt-static")))]
compile_error!("the VantaVault portable launcher must be built with -C target-feature=+crt-static");

use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const APP: &[u8] = include_bytes!(env!("VV_APP_EXE"));
const BACKEND: &[u8] = include_bytes!(env!("VV_BACKEND_EXE"));
const VERSION: &str = env!("VV_VERSION");
const BACKEND_TRIPLE_NAME: &str = "valovault-backend-x86_64-pc-windows-msvc.exe";
const DEFAULT_PORTABLE_UPDATE_ENDPOINT: &str =
    "https://github.com/akawazak/valo-project/releases/latest/download/latest-portable.json";
const DEFAULT_UPDATE_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDI2MEM3MzBGRDhFM0E1QwpSV1JjT283OU1NZGdBb1NFNEFES2MvU1dVY3E2UFlrTmhCTmlLM3hLV0xIaVlSL0tzSjBUMzVqQwo=";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateState {
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
    active_path: Option<String>,
    #[serde(default)]
    apply_on_exit: bool,
    /// Download progress, 0-100, while the status is "downloading".
    #[serde(default)]
    progress: Option<u8>,
}

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    url: String,
    sha256: String,
    signature: String,
    manifest_signature: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn portable_root() -> Result<PathBuf, String> {
    let local_app_data = env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA is unavailable on this Windows account.".to_string())?;
    let root = PathBuf::from(local_app_data)
        .join("VantaVault")
        .join("portable");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn update_state_path() -> Result<PathBuf, String> {
    Ok(portable_root()?.join("update-state.json"))
}

fn read_update_state() -> Result<UpdateState, String> {
    let path = update_state_path()?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("Could not read portable update status: {error}")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(UpdateState::default()),
        Err(error) => Err(format!("Could not read portable update status: {error}")),
    }
}

fn write_raw_update_state(state: &UpdateState) -> Result<(), String> {
    let path = update_state_path()?;
    let bytes = serde_json::to_vec(state).map_err(|error| error.to_string())?;
    // Write a sibling file and swap it in, so the app never reads a half-written state.
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, bytes)
        .and_then(|_| fs::rename(&temporary, &path))
        .map_err(|error| format!("Could not save portable update status: {error}"))
}

/// Saves a status change while keeping which updated copy is active. Losing it would make the
/// original EXE start its own older version on the next launch and offer the same update again.
fn write_update_state(state: &UpdateState) -> Result<(), String> {
    let mut next = state.clone();
    if next.active_path.is_none() {
        next.active_path = read_update_state()
            .ok()
            .and_then(|current| current.active_path);
    }
    write_raw_update_state(&next)
}

fn set_failed_state(error: &str) {
    let _ = write_update_state(&UpdateState {
        status: "failed".to_string(),
        message: Some(error.to_string()),
        checked_at: Some(now_ms()),
        ..Default::default()
    });
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if !matches!(fs::read(path), Ok(existing) if existing == bytes) {
        fs::write(path, bytes)?;
    }
    Ok(())
}

fn parse_version(version: &str) -> Result<Version, String> {
    Version::parse(version.trim().trim_start_matches('v'))
        .map_err(|error| format!("Invalid portable update version '{version}': {error}"))
}

fn update_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // The portable EXE is about 45 MB; leave room for slow connections.
        .timeout(Duration::from_secs(20 * 60))
        .user_agent(format!("VantaVault-Portable/{VERSION}"))
        .build()
        .map_err(|error| format!("Could not create the portable update client: {error}"))
}

fn portable_update_endpoint() -> String {
    std::env::var("VANTAVAULT_PORTABLE_UPDATE_ENDPOINT")
        .unwrap_or_else(|_| DEFAULT_PORTABLE_UPDATE_ENDPOINT.to_string())
}

fn update_public_key() -> &'static str {
    option_env!("VV_UPDATE_PUBLIC_KEY").unwrap_or(DEFAULT_UPDATE_PUBLIC_KEY)
}

fn verify_update(bytes: &[u8], encoded_signature: &str) -> Result<(), String> {
    let public_key_text = STANDARD
        .decode(update_public_key())
        .map_err(|error| format!("Could not read the VantaVault update key: {error}"))?;
    let public_key_text = std::str::from_utf8(&public_key_text)
        .map_err(|_| "The VantaVault update key is invalid.".to_string())?;
    let public_key = PublicKey::decode(public_key_text)
        .map_err(|error| format!("Could not read the VantaVault update key: {error}"))?;
    let signature_text = STANDARD
        .decode(encoded_signature.trim())
        .map_err(|error| format!("Could not read the portable update signature: {error}"))?;
    let signature_text = std::str::from_utf8(&signature_text)
        .map_err(|_| "The portable update signature is invalid.".to_string())?;
    let signature = Signature::decode(signature_text)
        .map_err(|error| format!("Could not read the portable update signature: {error}"))?;
    public_key.verify(bytes, &signature, true).map_err(|_| {
        "The downloaded portable update could not be verified and was discarded.".to_string()
    })
}

fn update_manifest_payload(manifest: &UpdateManifest) -> Vec<u8> {
    format!(
        "VantaVault portable update v1\nversion={}\nurl={}\nsha256={}\n",
        manifest.version, manifest.url, manifest.sha256
    )
    .into_bytes()
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn download_update() -> Result<(), String> {
    write_update_state(&UpdateState {
        status: "checking".to_string(),
        checked_at: Some(now_ms()),
        ..Default::default()
    })?;

    let client = update_client()?;
    let manifest = client
        .get(portable_update_endpoint())
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("Could not check for a portable update: {error}"))?
        .json::<UpdateManifest>()
        .map_err(|error| format!("The portable update information was invalid: {error}"))?;
    verify_update(
        &update_manifest_payload(&manifest),
        &manifest.manifest_signature,
    )?;

    let current_version = parse_version(VERSION)?;
    let latest_version = parse_version(&manifest.version)?;
    if latest_version <= current_version {
        return write_update_state(&UpdateState {
            status: "up-to-date".to_string(),
            checked_at: Some(now_ms()),
            ..Default::default()
        });
    }

    write_update_state(&UpdateState {
        status: "downloading".to_string(),
        version: Some(manifest.version.clone()),
        checked_at: Some(now_ms()),
        ..Default::default()
    })?;

    let download_error =
        |error: String| format!("Could not download VantaVault {latest_version}: {error}");
    let mut response = client
        .get(&manifest.url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| download_error(error.to_string()))?;
    let total = response.content_length().unwrap_or(0);
    let mut bytes = Vec::with_capacity(total as usize);
    let mut chunk = vec![0u8; 256 * 1024];
    let mut reported: Option<u8> = None;
    loop {
        let read = response
            .read(&mut chunk)
            .map_err(|error| download_error(error.to_string()))?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(percent) = (bytes.len() as u64 * 100).checked_div(total) {
            let percent = percent.min(99) as u8;
            // Report in 5% steps so the state file is not rewritten for every chunk.
            if reported.is_none_or(|last| percent >= last + 5) {
                reported = Some(percent);
                let _ = write_update_state(&UpdateState {
                    status: "downloading".to_string(),
                    version: Some(manifest.version.clone()),
                    checked_at: Some(now_ms()),
                    progress: Some(percent),
                    ..Default::default()
                });
            }
        }
    }
    if sha256_hex(&bytes) != manifest.sha256.to_ascii_lowercase() {
        return Err(
            "The downloaded portable update did not match the signed manifest.".to_string(),
        );
    }
    verify_update(&bytes, &manifest.signature)?;

    let update_dir = portable_root()?.join("updates");
    fs::create_dir_all(&update_dir)
        .map_err(|error| format!("Could not prepare the portable update: {error}"))?;
    let destination = update_dir.join(format!("VantaVault-portable-{}.exe", manifest.version));
    let temporary = destination.with_extension("exe.part");
    fs::File::create(&temporary)
        .and_then(|mut file| file.write_all(&bytes).and_then(|_| file.sync_all()))
        .map_err(|error| format!("Could not save the portable update: {error}"))?;
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Could not replace the portable update: {error}"))?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Could not finish the portable update: {error}"))?;

    write_update_state(&UpdateState {
        status: "ready".to_string(),
        version: Some(manifest.version),
        checked_at: Some(now_ms()),
        pending_path: Some(destination.to_string_lossy().to_string()),
        apply_on_exit: false,
        ..Default::default()
    })
}

fn is_current_launcher(path: &Path) -> bool {
    let Ok(current) = env::current_exe() else {
        return false;
    };
    current == path
        || matches!(
            (fs::canonicalize(&current), fs::canonicalize(path)),
            (Ok(current), Ok(candidate)) if current == candidate
        )
}

/// True when the recorded update is newer than this EXE. Opening a newer portable EXE that was
/// downloaded by hand must not hand over to an older updated copy.
fn is_newer_than_self(version: Option<&str>) -> bool {
    match (version.map(parse_version), parse_version(VERSION)) {
        (Some(Ok(update)), Ok(current)) => update > current,
        _ => false,
    }
}

fn start_active_portable(path: &Path, state: &UpdateState) -> Result<(), String> {
    let active_state = UpdateState {
        status: "applied".to_string(),
        version: state.version.clone(),
        checked_at: state.checked_at,
        active_path: Some(path.to_string_lossy().to_string()),
        ..Default::default()
    };
    write_update_state(&active_state)?;

    if let Err(error) = Command::new(path).arg("--updated").spawn() {
        let error = format!("Could not start the portable update: {error}");
        set_failed_state(&error);
        return Err(error);
    }
    Ok(())
}

fn launch_active_update() -> Result<bool, String> {
    let state = read_update_state()?;
    let Some(path) = state.active_path.as_deref().map(PathBuf::from) else {
        return Ok(false);
    };
    if is_current_launcher(&path) {
        return Ok(false);
    }
    if !path.is_file() || !is_newer_than_self(state.version.as_deref()) {
        // The updated copy is gone, or this EXE is the same or newer: run this one and forget the old copy.
        let _ = write_raw_update_state(&UpdateState {
            checked_at: state.checked_at,
            ..Default::default()
        });
        return Ok(false);
    }

    start_active_portable(&path, &state)?;
    Ok(true)
}

fn launch_pending_update(require_restart_request: bool) -> Result<bool, String> {
    let state = read_update_state()?;
    if state.status != "ready" || (require_restart_request && !state.apply_on_exit) {
        return Ok(false);
    }
    let Some(path) = state.pending_path.as_deref().map(PathBuf::from) else {
        return Ok(false);
    };
    if !path.is_file() {
        set_failed_state("The downloaded portable update could not be found. Please check again.");
        return Ok(false);
    }
    if !is_newer_than_self(state.version.as_deref()) {
        let _ = write_update_state(&UpdateState {
            status: "up-to-date".to_string(),
            checked_at: Some(now_ms()),
            ..Default::default()
        });
        return Ok(false);
    }

    start_active_portable(&path, &state)?;
    Ok(true)
}

/// Removes files left by earlier versions: their unpacked app folders and old downloaded EXEs.
/// Anything still in use simply fails to delete and is tried again next launch.
fn remove_old_versions() {
    let Ok(root) = portable_root() else { return };
    if let Ok(entries) = fs::read_dir(&root) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name != VERSION && entry.path().is_dir() && Version::parse(&name).is_ok() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
    let keep = read_update_state().ok();
    let keep: Vec<PathBuf> = keep
        .iter()
        .flat_map(|state| [state.active_path.clone(), state.pending_path.clone()])
        .flatten()
        .map(PathBuf::from)
        .collect();
    if let Ok(entries) = fs::read_dir(root.join("updates")) {
        for entry in entries.flatten() {
            let path = entry.path();
            // A .part file belongs to a download that may still be running.
            let downloading = path.extension().is_some_and(|ext| ext == "part");
            if !downloading && !is_current_launcher(&path) && !keep.iter().any(|kept| kept == &path)
            {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn run_app() -> Result<(), String> {
    if launch_active_update()? {
        return Ok(());
    }
    if launch_pending_update(false)? {
        return Ok(());
    }

    remove_old_versions();
    let dir = portable_root()?.join(VERSION);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let app = dir.join("VantaVault.exe");
    write_if_changed(&app, APP).map_err(|error| error.to_string())?;
    write_if_changed(&dir.join("valovault-backend.exe"), BACKEND)
        .map_err(|error| error.to_string())?;
    write_if_changed(&dir.join(BACKEND_TRIPLE_NAME), BACKEND).map_err(|error| error.to_string())?;

    let launcher_path = env::current_exe().map_err(|error| error.to_string())?;
    Command::new(app)
        .current_dir(&dir)
        .env("VANTAVAULT_PORTABLE", "1")
        .env("VANTAVAULT_PORTABLE_LAUNCHER_PATH", launcher_path)
        .env("VANTAVAULT_PORTABLE_STATE_DIR", portable_root()?)
        .spawn()
        .map_err(|error| error.to_string())?
        .wait()
        .map_err(|error| error.to_string())?;

    // A restart is user-initiated from the app after the signed file is ready.
    // A normal close leaves the update queued for the next launch instead.
    let _ = launch_pending_update(true)?;
    Ok(())
}

fn show_error(error: &str) {
    let message = format!("VantaVault portable failed to start:\n{error}");
    let _ = fs::write(
        env::temp_dir().join("VantaVault-portable-error.txt"),
        &message,
    );
    let _ = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('{}','VantaVault')",
                message.replace('\'', "''")
            ),
        ])
        .spawn();
}

fn main() {
    if env::args().nth(1).as_deref() == Some("--download-update") {
        if let Err(error) = download_update() {
            set_failed_state(&error);
        }
        return;
    }

    if let Err(error) = run_app() {
        show_error(&error);
    }
}

#[cfg(test)]
mod tests {
    use super::{is_newer_than_self, sha256_hex, update_manifest_payload, UpdateManifest, VERSION};

    fn manifest(version: &str) -> UpdateManifest {
        UpdateManifest {
            version: version.to_string(),
            url: "https://example.invalid/VantaVault-portable.exe".to_string(),
            sha256: sha256_hex(b"signed artifact"),
            signature: "artifact-signature".to_string(),
            manifest_signature: "manifest-signature".to_string(),
        }
    }

    #[test]
    fn signed_payload_binds_version_url_and_digest() {
        let original = update_manifest_payload(&manifest("1.0.0"));
        let mut changed = manifest("999.0.0");
        assert_ne!(original, update_manifest_payload(&changed));
        changed.version = "1.0.0".to_string();
        changed.url = "https://attacker.invalid/old.exe".to_string();
        assert_ne!(original, update_manifest_payload(&changed));
        changed.url = "https://example.invalid/VantaVault-portable.exe".to_string();
        changed.sha256 = sha256_hex(b"different artifact");
        assert_ne!(original, update_manifest_payload(&changed));
    }

    #[test]
    fn only_hands_over_to_a_newer_copy() {
        let current = semver::Version::parse(VERSION).unwrap();
        let newer =
            semver::Version::new(current.major, current.minor, current.patch + 1).to_string();
        assert!(is_newer_than_self(Some(&newer)));
        assert!(!is_newer_than_self(Some(VERSION)));
        assert!(!is_newer_than_self(Some("0.0.1")));
        assert!(!is_newer_than_self(None));
        assert!(!is_newer_than_self(Some("not a version")));
    }
}
