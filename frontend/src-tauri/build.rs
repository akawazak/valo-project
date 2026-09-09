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

    tauri_build::build()
}
