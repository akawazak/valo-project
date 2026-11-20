use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::SystemTime;

fn build_android_backend(project_dir: &Path) {
    let target = std::env::var("TARGET").unwrap_or_default();
    let (go_arch, android_abi, clang_name) = match target.as_str() {
        "aarch64-linux-android" => ("arm64", "arm64-v8a", "aarch64-linux-android24-clang.cmd"),
        "armv7-linux-androideabi" => ("arm", "armeabi-v7a", "armv7a-linux-androideabi24-clang.cmd"),
        "i686-linux-android" => ("386", "x86", "i686-linux-android24-clang.cmd"),
        "x86_64-linux-android" => ("amd64", "x86_64", "x86_64-linux-android24-clang.cmd"),
        other => panic!("unsupported Android Rust target: {other}"),
    };
    let ndk_home = std::env::var("NDK_HOME").expect("NDK_HOME is required for Android builds");
    let clang = Path::new(&ndk_home)
        .join("toolchains")
        .join("llvm")
        .join("prebuilt")
        .join("windows-x86_64")
        .join("bin")
        .join(clang_name);
    let backend_dir = project_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("backend");
    watch_backend_sources(&backend_dir);
    let go_cache_dir = backend_dir.join(".gocache-android");
    fs::create_dir_all(&go_cache_dir).expect("failed to create Android Go build cache");
    let library_dir = project_dir
        .join("binaries")
        .join("android")
        .join(android_abi);
    fs::create_dir_all(&library_dir).expect("failed to create Android backend library directory");
    let library_path = library_dir.join("libvalovault_backend.so");

    println!("cargo:warning=Compiling embedded Go backend for {android_abi}...");
    let status = Command::new("go")
        .args([
            "build",
            "-buildvcs=false",
            "-trimpath",
            "-buildmode=c-shared",
            "-o",
            library_path.to_str().unwrap(),
            ".",
        ])
        .env("GOOS", "android")
        .env("GOARCH", go_arch)
        .env("CGO_ENABLED", "1")
        .env("CC", clang)
        .env("GOCACHE", &go_cache_dir)
        .current_dir(&backend_dir)
        .status()
        .expect("failed to start the Android Go backend build");
    if !status.success() {
        panic!("failed to compile the embedded Android Go backend");
    }

    let jni_dir = project_dir
        .join("gen")
        .join("android")
        .join("app")
        .join("src")
        .join("main")
        .join("jniLibs")
        .join(android_abi);
    fs::create_dir_all(&jni_dir).expect("failed to create Android JNI library directory");
    fs::copy(&library_path, jni_dir.join("libvalovault_backend.so"))
        .expect("failed to stage the Android Go backend library");
    println!("cargo:rustc-link-search=native={}", library_dir.display());
    println!("cargo:rustc-link-lib=dylib=valovault_backend");
}

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

// vrfkit (Apache-2.0) reads VALORANT .vrf replays for the round replay
// player. It ships as a second sidecar, built once from a pinned commit.
const VRFKIT_GIT: &str = "https://github.com/SunkenInTime/vrfkit";
const VRFKIT_REV: &str = "4dfdd2137808b5a0cc6c35d7d0e178ec421b4110";
const VRFKIT_PATCH_FILENAME: &str = "patches/vrfkit-13.10.patch";

fn ensure_replay_parser(project_dir: &Path, target_dir: &Path) {
    println!("cargo:rerun-if-env-changed=VANTAVAULT_VRFKIT_EXE");
    println!("cargo:rerun-if-changed={VRFKIT_PATCH_FILENAME}");
    let binary_path = target_dir.join("vrfkit-x86_64-pc-windows-msvc.exe");
    let stamp_path = target_dir.join("vrfkit.rev");
    let revision = format!("{VRFKIT_REV}+13.10.1");
    let current = binary_path.exists()
        && fs::read_to_string(&stamp_path).is_ok_and(|rev| rev.trim() == revision);
    if current {
        return;
    }
    if let Ok(prebuilt) = std::env::var("VANTAVAULT_VRFKIT_EXE") {
        fs::copy(&prebuilt, &binary_path).expect("failed to copy VANTAVAULT_VRFKIT_EXE");
        fs::write(&stamp_path, revision).expect("failed to record the replay parser revision");
        return;
    }

    println!("cargo:warning=Building the replay parser (vrfkit) once; this takes a few minutes...");
    let install_root = project_dir.join("target").join("vrfkit");
    let source = install_root.join("source").join(&revision);
    if !source.join(".git").is_dir() {
        fs::create_dir_all(source.parent().unwrap())
            .expect("failed to prepare replay parser directory");
        let status = Command::new("git")
            .args(["clone", "--no-checkout", VRFKIT_GIT])
            .arg(&source)
            .status()
            .expect("failed to start git clone for vrfkit");
        assert!(status.success(), "failed to fetch vrfkit");
    }
    let status = Command::new("git")
        .args(["checkout", "--detach", VRFKIT_REV])
        .current_dir(&source)
        .status()
        .expect("failed to select the pinned vrfkit source");
    assert!(status.success(), "failed to check out vrfkit");
    let patch = project_dir.join(VRFKIT_PATCH_FILENAME);
    let already_patched = Command::new("git")
        .args(["apply", "--reverse", "--check"])
        .arg(&patch)
        .current_dir(&source)
        .output()
        .is_ok_and(|output| output.status.success());
    if !already_patched {
        let status = Command::new("git")
            .arg("apply")
            .arg(&patch)
            .current_dir(&source)
            .status()
            .expect("failed to apply the vrfkit compatibility update");
        assert!(status.success(), "failed to patch vrfkit for 13.10");
    }
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let mut command = Command::new(cargo);
    command.args([
        "install",
        "--path",
        source.join("crates").join("vrfkit").to_str().unwrap(),
        "--locked",
        "--force",
        "--root",
        install_root.to_str().unwrap(),
    ]);
    // A nested cargo must not inherit this build's target or flags.
    for (name, _) in std::env::vars() {
        if (name.starts_with("CARGO_") && name != "CARGO_HOME")
            || name == "RUSTFLAGS"
            || name == "TARGET"
        {
            command.env_remove(name);
        }
    }
    command.env("RUSTFLAGS", "-C target-feature=+crt-static");
    let status = command.status();
    if status.is_err() || !status.unwrap().success() {
        panic!("failed to build the replay parser (vrfkit)");
    }
    fs::copy(install_root.join("bin").join("vrfkit.exe"), &binary_path)
        .expect("failed to place the replay parser sidecar");
    fs::write(&stamp_path, revision).expect("failed to record the replay parser revision");
}

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "android" {
        build_android_backend(Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()));
        tauri_build::build();
        return;
    }
    if target_os == "ios" {
        println!("cargo:rerun-if-env-changed=CARGO_CFG_TARGET_OS");
        tauri_build::build();
        return;
    }

    let project_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_dir = Path::new(&project_dir);
    let parent = project_dir.parent().unwrap();
    let backend_dir = parent.parent().unwrap().join("backend");
    let backend_last_changed = watch_backend_sources(&backend_dir);
    let go_cache_dir = backend_dir.join(".gocache");
    let _ = std::fs::create_dir_all(&go_cache_dir);

    let target_dir = project_dir.join("binaries");
    let _ = std::fs::create_dir_all(&target_dir);

    let binary_name = if target_os == "windows" {
        "valovault-backend-x86_64-pc-windows-msvc.exe"
    } else {
        "valovault-backend-x86_64-unknown-linux-gnu"
    };

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

    if target_os == "windows" {
        ensure_replay_parser(project_dir, &target_dir);
    }

    tauri_build::build()
}
