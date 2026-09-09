# Release signing

VantaVault uses two separate kinds of signatures:

- Tauri updater signatures prove that an update manifest and artifact came from this project.
- Platform signatures establish the publisher identity shown by Windows and Android. They require private certificates that must never be committed.

## Android

The generated Gradle project reads `frontend/src-tauri/gen/android/keystore.properties` when it exists. Local debug builds do not require it. A production APK/AAB must use:

```properties
keyAlias=upload
keyPassword=<secret>
storePassword=<secret>
storeFile=C:\absolute\path\to\upload-keystore.jks
```

The manual `android signed release` workflow performs this process and uploads a signed APK and AAB after verifying the APK certificate. Configure `ANDROID_KEY_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD` as repository secrets before running it. The workflow writes the keystore only into the runner temporary directory and generates `keystore.properties` immediately before the build. Both files are ignored by Git.

The first Play Console upload must be manual so Google can register the application ID `com.akawazak.valovault` and upload certificate. Keep the upload key stable for every later release.

## Windows

The existing `TAURI_SIGNING_PRIVATE_KEY` signs updater artifacts; it does not remove SmartScreen's unknown-publisher warning. Authenticode additionally requires a trusted PFX/code-signing certificate.

Before enabling publisher signing in the release workflow:

1. Store the base64 PFX and password as `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD` repository secrets.
2. Import it into `Cert:\CurrentUser\My` on the Windows runner before `tauri-apps/tauri-action`.
3. Configure Tauri's `bundle.windows.certificateThumbprint`, `digestAlgorithm: sha256`, and the certificate authority's timestamp URL.
4. Verify the final installer and portable EXE with `Get-AuthenticodeSignature` before publishing the draft release.

Do not insert a placeholder thumbprint or self-signed certificate into production configuration. That would create the appearance of signing without establishing a trusted publisher.
