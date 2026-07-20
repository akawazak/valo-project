# Android Security, Riot API, and Play Release Plan

> Status: design and release decision record; not yet implemented.
> Last reviewed: 2026-07-15 against repository revision `27bbb21` and the linked policies.

## Purpose

This document preserves the agreed direction for an Android version of VantaVault. It keeps three separate questions from being confused later:

1. How we protect Riot session credentials on an Android device.
2. How the Android frontend and embedded backend should exchange authority.
3. Which product features are acceptable for a public Play Store release under Riot and Google policies.

The storage design can be made strong and testable. It cannot turn an undocumented Riot client endpoint into an official API. Riot authorization remains a separate release gate.

## Bottom line

The recommended architecture is:

```text
React UI
(account ID / opaque session handle only)
        |
        v
Native Android vault ----> Embedded Go backend ----HTTPS----> Riot
        ^
        |
Android Keystore
```

Riot access tokens, entitlement tokens, and `ssid` cookies must never be persisted in JavaScript storage, SQLite, logs, crash reports, Android backups, or VantaVault servers. The React UI should not receive their plaintext values at all. Android native code decrypts the selected session and gives it directly to the embedded Go backend, which owns Riot request authentication.

We should use Android Keystore, not Android Credential Manager, for this vault. Credential Manager is designed primarily for passwords, passkeys, and federated sign-in. Keystore is the native primitive for non-exportable application encryption keys.

## Evidence from the current code

### Observed: insecure fail-open fallback

`frontend/src/lib/accountStorage.ts` currently tries to save account secrets through a Tauri command. If secure storage fails, its catch path writes the complete `accounts` array to `localStorage`, including `accessToken`, `entitlementsToken`, and `ssid` when present:

- `frontend/src/lib/accountStorage.ts:49-59` sends the secrets to `save_riot_account_secrets`.
- `frontend/src/lib/accountStorage.ts:62-67` correctly persists a public copy with secrets removed.
- `frontend/src/lib/accountStorage.ts:83-88` falls back to `localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))` when secure storage fails.

This behavior is unacceptable on Android and must be removed before any Android build. Secure storage failure must be fail-closed: keep the session in memory only, tell the user it will not be remembered, and never persist plaintext.

### Observed: Android secure storage is not implemented

`frontend/src-tauri/src/lib.rs:748-821` implements Riot secret storage only for Windows Credential Manager. Non-Windows targets return `Secure Riot account storage is only available on Windows` for save, load, and delete operations. Without an Android implementation, the current frontend would enter the insecure fallback above.

### Observed: secrets currently cross the JavaScript boundary

`frontend/src/services/api.ts:7-13` retains the active access and entitlement tokens in JavaScript memory. `frontend/src/services/api.ts:119-135` adds them to localhost requests as `X-Riot-*` headers. They are not deliberately persisted there, but any compromised frontend context can read them while the session is active.

### Observed: the Go account store strips secrets

`backend/accounts/accounts.go:31-68` removes `accessToken`, `entitlementsToken`, and `ssid` before writing account metadata. We should preserve this invariant and ensure no other Android persistence path bypasses it.

## Threat model

### We intend to protect against

- A lost or stolen phone while it is locked.
- Filesystem extraction from ordinary, non-rooted devices.
- Other sandboxed Android applications.
- Accidental token leakage through `localStorage`, preferences, databases, caches, logs, crash reports, backups, or device transfer.
- A malicious or compromised web asset obtaining persistent Riot credentials.
- Old credentials remaining after logout or account removal.
- Accidental cleartext network traffic outside the loopback interface.

### We cannot completely protect against

- A rooted device with runtime instrumentation or a compromised operating system.
- Malicious accessibility software that can control the UI.
- A process compromise while a Riot session is actively decrypted and usable.
- A compromised Riot or Google account.
- Riot changing, disabling, or enforcing policy against undocumented endpoints.

No mobile storage design can make an actively usable credential completely inaccessible to a fully compromised device. The goal is to minimize where plaintext exists, how long it exists, and what can export it.

## Required security invariants

These are acceptance criteria, not aspirations:

- No Riot password is collected, rendered by VantaVault, logged, or stored.
- Persistent Riot session secrets are encrypted with a non-exportable Android Keystore key.
- The encryption key is never hardcoded, exported, backed up, or stored beside ciphertext.
- Every encrypted write uses a fresh random nonce.
- Ciphertext is bound to its package, schema version, and account identity so it cannot be swapped between accounts.
- A secure-storage error never causes plaintext persistence.
- The React/JavaScript layer receives only public account metadata and an opaque active-session handle.
- The embedded backend never exposes an endpoint that returns a Riot token or cookie.
- Riot authentication is attached inside native/Go code, not by React request headers.
- The local backend listens only on a loopback address and requires a new random VantaVault key for every application launch.
- Logout and account deletion clear vault data, active memory, cookies, background work, and account-specific sensitive caches.
- Release builds never log tokens, cookies, authorization headers, login redirects, or raw authentication responses.
- Secure vault files are excluded from cloud backup and device-to-device transfer.

## Recommended design: native session vault and backend-owned authority

### 1. Android vault

Generate one AES-256 key per installation using the `AndroidKeyStore` provider. Authorize it only for encryption and decryption using `AES/GCM/NoPadding`. Prefer hardware-backed storage when the device supports it. StrongBox can be attempted, but the application must gracefully fall back to the normal hardware-backed or system Keystore when StrongBox is unavailable.

For each account, encrypt a compact versioned payload containing only what is required:

```json
{
  "schemaVersion": 1,
  "puuid": "...",
  "region": "...",
  "accessToken": "...",
  "entitlementsToken": "...",
  "ssid": "...",
  "expiresAt": 0
}
```

Encryption requirements:

- Algorithm: AES-256-GCM with no padding.
- Nonce: a new cryptographically random 96-bit value on every encryption.
- Additional authenticated data: package ID, vault schema version, and PUUID.
- File contents: version, nonce, and ciphertext only.
- Location: an application-private subdirectory under `noBackupFilesDir`.
- File writes: temporary file, flush/sync, then atomic replacement.
- File names: a non-secret stable account identifier or its digest, never a username.

The Keystore key is not biometric-gated by default so deliberate background work can use it. We may later add an optional "Lock account vault" setting requiring recent device authentication; enabling it must also disable background refresh that cannot satisfy the authentication prompt.

### 2. Keep plaintext out of React

The frontend selects an account using its PUUID or an opaque session handle. A small Android/Tauri bridge performs vault operations and controls the active backend session:

- `saveSession(accountMetadata, secretPayload)`
- `activateSession(accountId)`
- `clearActiveSession()`
- `deleteSession(accountId)`
- `sessionStatus(accountId)` returning only booleans and expiry metadata

`activateSession` decrypts the selected payload and transfers it directly to the embedded Go backend through an in-process/mobile bridge. The Go backend retains only one active remote session and attaches Riot authorization internally. The bridge and backend must not offer a "get token" function.

Plaintext lifetime should be limited to the login handoff and the active Go/native session. Clear it on logout, account switch, explicit app lock, and process shutdown. Mutable byte arrays should be overwritten where practical, although garbage-collected strings can leave residual copies and must not be presented as securely zeroizable.

### 3. Authentication flow

- Open Riot's real hosted sign-in page in an isolated in-app browser/WebView.
- Never build a VantaVault username/password form.
- Never read or inject scripts into password fields.
- Capture only the resulting authenticated session after Riot completes login.
- Move the resulting session immediately into the native vault/backend boundary.
- Clear the authentication WebView and cookies on account removal.
- Display an explicit consent explanation before linking the account.

If Riot grants production RSO access, prefer the official RSO flow. Any RSO client secret or production API key that must remain confidential belongs on a very small server-side broker, never in the APK. That broker must not receive or store undocumented Riot client-session tokens.

### 4. Embedded Go backend

The Android application cannot spawn the current desktop sidecar in the same way Windows does. The preferred compatibility path is to refactor the Go server entry point into a library, compile it for Android, and expose the narrow lifecycle/session bridge required by Tauri/Kotlin.

Backend requirements:

- Bind only to `127.0.0.1`, never `0.0.0.0`.
- Keep the existing per-launch random `X-VantaVault-Key` concept.
- Accept only the application frontend origin and expected methods.
- Do not accept Riot tokens through ordinary HTTP request headers on Android.
- Do not return raw Riot authentication responses.
- Centralize Riot endpoint selection, rate limits, retries, and backoff.
- Make unsupported or changed Riot endpoints fail gracefully without retry storms.

A feasibility spike must validate the Android toolchain for the Go dependencies used by SQLite and XMPP before we commit to this packaging strategy. If a dependency cannot be compiled safely, replace or isolate that dependency rather than moving user sessions to a hosted VantaVault backend.

### 5. Storage classification

| Data | Storage | Backup | Notes |
| --- | --- | --- | --- |
| Riot access/entitlement tokens and `ssid` | AES-GCM ciphertext under `noBackupFilesDir`; key in Android Keystore | Never | Native/Go only |
| Account PUUID, region, display name | App-private metadata | Optional | No tokens |
| Match history and derived analytics | App-private database | User-controlled/declared | Apply retention and delete controls |
| Chat history | Memory-only in Android v1 | Never | Persist only after Android encryption is designed and tested |
| Public artwork/metadata | Cache directory | No guarantee needed | Safe to evict |
| Diagnostics | Minimal structured events | No secrets | Error category, feature, and boolean state only |

We do not need SQLCipher for ordinary match statistics in the first Android release. Android sandboxing and device encryption are proportionate for non-secret cached gameplay data. Authentication material receives the stronger Keystore-backed vault.

## Failure handling and legacy migration

### Secure-storage failure

On any Keystore or vault error:

- Keep the freshly authenticated session in process memory only if it is safe to continue.
- Show: "Secure storage is unavailable. This account will not be remembered."
- Never write the full account object to `localStorage`, DataStore, SharedPreferences, SQLite, files, logs, or crash reports.
- Allow the user to retry or sign out.

### Existing account migration

For each legacy account containing secrets:

1. Read the legacy value once.
2. Validate account identity and expected token shape without logging it.
3. Encrypt and write it into the Android vault.
4. Read and decrypt the new record.
5. Verify identity and required fields.
6. Delete the legacy plaintext only after verification succeeds.
7. Record only a non-sensitive migration status.

Migration is idempotent. A failed migration must not delete the only working session, but it also must not silently keep plaintext indefinitely. The app should require the user to finish migration or reauthenticate.

## Backups, deletion, logs, and telemetry

Android backs up most private application files by default, so both Android 11-and-lower backup rules and Android 12+ data-extraction rules must exclude vault files, session state, authentication WebView data, and device-specific identifiers from cloud backup and device transfer.

Account removal must:

- Clear the active Go/native session.
- Delete its encrypted vault record.
- Remove login WebView cookies and session data.
- Cancel its scheduled background jobs and notifications.
- Delete account-specific sensitive caches and any future encrypted chat history.
- Remove public account metadata unless the user explicitly chooses to retain downloaded match data.

For the first Play release, do not add AdMob, Crashlytics, analytics, or tracking SDKs. This minimizes data flows, Play Data Safety complexity, and the chance that authentication context leaks into third-party telemetry. If telemetry is added later, it needs a separate data-flow review and must never receive player identifiers or authentication material by default.

## Network controls

- Riot traffic uses HTTPS only.
- Android Network Security Configuration disables cleartext globally.
- Loopback HTTP is the only narrow exception if the embedded backend retains an HTTP interface.
- No user-installed certificate authority is trusted in release builds unless Android's normal platform policy explicitly requires it.
- Do not add certificate pinning initially. Riot certificate rotation and undocumented host changes make pinning a reliability risk, while standard Android TLS verification already addresses ordinary network interception.
- No external or hosted service receives Riot client-session credentials.

## Options considered

### Option 1: Keystore at rest, tokens returned to React

This is the smallest change: encrypt sessions natively and decrypt them back into JavaScript when an account becomes active. It protects stored files but leaves every active token readable by the frontend, browser extensions/debugging surfaces, or a frontend compromise. It also preserves the current `X-Riot-*` localhost header flow.

This option is acceptable only for an early private feasibility prototype. It is not the recommended public-release architecture.

### Option 2: Native vault and backend-owned active session — recommended

React sees only account metadata and an opaque handle. Native code decrypts the session directly into the Go backend. This meaningfully narrows token exposure without adding a hosted service. The cost is a small native bridge and backend session lifecycle work.

I recommend this option because it uses Android's native security boundary, preserves the existing Go API investment, and prevents an entire class of accidental JavaScript persistence and export mistakes.

### Option 3: Hosted VantaVault backend stores or proxies Riot sessions

This would simplify the mobile client but would move every user's Riot session to infrastructure we must secure, monitor, disclose, and defend. A server compromise would affect many accounts rather than one device. It also creates a larger Riot-policy and privacy burden.

Reject this option. A tiny broker may be necessary later for official RSO client secrets, but it must not become a store for undocumented client sessions.

## Security validation before release

The following checks are release gates:

- Vault round-trip succeeds for every supported Android API level.
- Modified ciphertext or authentication tag fails without returning plaintext.
- Ciphertext copied to another account fails because authenticated data differs.
- Reinstall or cross-device restore cannot silently activate an old session.
- Simulated Keystore failure produces memory-only behavior and no plaintext persistence.
- A canary token cannot be found in `localStorage`, IndexedDB, SharedPreferences, DataStore, SQLite, files, backups, logs, crash artifacts, or the built AAB.
- Logout and account deletion remove every expected artifact and cancel background work.
- Network capture shows only Riot HTTPS traffic plus authenticated loopback traffic.
- The backend binds only to loopback and rejects requests without the per-launch key.
- No endpoint, UI event, error payload, or debug command returns a Riot token.
- Static inspection of the AAB finds no hardcoded Riot API key, RSO client secret, vault key, password, or test session.
- Background work decrypts a session only for one bounded task and clears it afterward.

## Riot API and product-policy boundary

### What existing applications demonstrate

Full companion applications such as VALPAW and ValPal publicly state that they use Riot sessions or communicate directly with Riot while keeping sessions on-device. Their current presence in mobile stores demonstrates technical and market precedent for this model.

That precedent does **not** establish that Riot approved every feature, that undocumented endpoints are stable, or that Riot cannot request removal later. Google Play review is not a Riot authorization process.

Not every application reviewed uses undocumented client APIs. Statistics-first applications can use Riot's official API. The undocumented/session APIs are primarily what enable store, wallet, party, friends, chat, presets, and similar full-client features that the public API does not expose.

### Riot's published requirements

Riot's VALORANT developer policy currently states that:

- A player-facing product must be registered even if it does not use official documented APIs.
- Player-specific data requires player opt-in through the approved ecosystem.
- Training tools showing a player's own match history and aggregate statistics are an accepted use case.
- Opponent scouting before a match is not accepted.
- Real-time guidance that changes immediate player behavior is not accepted.
- Online store tracking or updates are listed as an unapproved use case because the official API does not provide the technology.
- Personal API key applications are not currently supported for VALORANT; production approval and RSO are the official route.

Riot's general legal policy says an Apple App Store or Google Play project using Riot IP requires either a written license or a valid Riot API key and compliance with the applicable API terms and policies.

### Public Android release boundary

| Feature | Public-release position | Reason |
| --- | --- | --- |
| Own match history and aggregate statistics | Include after registration/opt-in requirements are satisfied | Explicitly accepted training use case |
| Post-match maps and factual coaching insights | Include | Reflective, not immediate tactical guidance |
| Profile, rank, owned content, and loadout viewing | Request Riot confirmation; feature-flag if unclear | Player-authorized data, but some sources are undocumented |
| Loadout/preset changes | Require written Riot confirmation before release | Performs client-account mutation through undocumented endpoints |
| Friends, party, and chat | Require written Riot confirmation before release | Undocumented social/client functionality and other-player data |
| Deliberately opened live-match page | Only after Riot confirms exact behavior | Must not become opponent scouting or tactical guidance |
| Store/night-market viewing | Disabled in public build until Riot explicitly approves | Riot currently lists store tracking/updates as unapproved |
| Store background notifications | Disabled until explicit Riot approval | Repeated automated store tracking increases policy and operational risk |
| Automated purchases | Never | High-impact account mutation and user-harm risk |
| Enemy scouting/hidden-player analysis | Never | Explicitly incompatible with opt-in/scouting rules |
| Tactical overlay or "go here now" guidance | Never | Explicitly prohibited behavior-changing real-time guidance |
| Agent auto-lock, queue automation, or match manipulation | Exclude from v1; require explicit approval for any future consideration | Unnecessary account/gameplay automation risk |

All undocumented endpoint use should be centralized behind one client module with:

- User-initiated operations by default.
- Conservative caching.
- Request coalescing.
- Rate limiting and exponential backoff with jitter.
- No retry storms.
- No automated purchases.
- Clear "temporarily unavailable" states when Riot changes an endpoint.
- A release feature flag for capabilities awaiting Riot confirmation.

## Google Play developer-account risk

Google distinguishes rejection, removal, warning, and suspension:

- A rejection does not by itself harm developer-account standing.
- A removal does not immediately harm standing, but multiple removals can escalate.
- A suspension counts as a strike.
- Multiple or egregious violations can lead to termination of the developer account and related accounts.
- Repeatedly resubmitting the same unresolved violation is dangerous.

This means a careful review process and a rejected first submission are not automatically catastrophic. We must nevertheless avoid treating Play review as experimentation. If Google or Riot identifies an issue, stop resubmission until the issue is actually understood and fixed.

Before submission:

- Register the product with Riot and keep the description accurate.
- Give Riot a working prototype or clear mockup showing login and every data flow.
- Ask in writing about the exact undocumented features we plan to ship.
- Keep Riot's response and API-key/licensing evidence.
- Submit written IP authorization to Google Play in advance when available.
- Use an original VantaVault brand and store listing that does not imply Riot endorsement.
- Include Riot's required third-party/non-endorsement wording.
- Complete Play Data Safety declarations based on actual traffic and SDK behavior, not a competitor's declaration.
- Provide reviewers a test account or precise access instructions when required.

## Decision gates

### Gate A: before Android implementation

- Remove the plaintext `localStorage` fallback.
- Decide the minimum supported Android version.
- Prove the Go mobile bridge can compile the required backend dependencies.
- Confirm that the public build does not require desktop-only overlay, local Riot client detection, Windows Credential Manager, tray, hotkeys, or NSIS updater behavior.

### Gate B: before external testing

- Complete the native vault and backend-owned session flow.
- Pass the security validation checklist.
- Publish an accurate privacy policy and in-app data explanation.
- Verify account removal and session expiry behavior.
- Keep chat persistence disabled until Android encryption exists.

### Gate C: before Play production submission

- Register the product with Riot.
- Obtain and archive Riot guidance for the exact feature set.
- Disable every feature that lacks adequate approval, especially store tracking/notifications.
- Verify Riot IP permission/API-key status and provide it to Google Play in advance.
- Audit the final AAB, permissions, Data Safety form, screenshots, description, disclaimers, and reviewer instructions.

## Residual risk and honest conclusion

The recommended vault and authority boundary can make Android token storage professionally defensible and substantially safer than the current frontend-owned flow. It protects against common device loss, backup leakage, accidental persistence, and ordinary application compromise paths.

It does not grant permission to use Riot's undocumented endpoints. Existing companion applications are encouraging precedent, but not legal or policy guarantees. The safest sustainable plan is therefore:

1. Build the Android security boundary correctly.
2. Keep all Riot sessions device-local.
3. Ship only post-match and player-consented features that fit published policy.
4. Register the product and request written guidance for every undocumented feature.
5. Keep uncertain features disabled in the public build until that guidance exists.

## References

Official Android and security guidance:

- [Android Keystore system](https://developer.android.com/privacy-and-security/keystore)
- [Android cryptography guidance](https://developer.android.com/privacy-and-security/cryptography)
- [Android Auto Backup and data extraction rules](https://developer.android.com/identity/data/autobackup)
- [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config)
- [Android Credential Manager overview](https://developer.android.com/identity/credential-manager)
- [OWASP MASVS Storage](https://mas.owasp.org/MASVS/05-MASVS-STORAGE/)
- [OWASP: sensitive data stored unencrypted in private storage](https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0006/)

Riot policy:

- [Riot VALORANT developer policy](https://developer.riotgames.com/docs/valorant)
- [Riot Legal Jibber Jabber](https://www.riotgames.com/en/legal)

Google Play policy:

- [Google Play intellectual-property policy](https://support.google.com/googleplay/android-developer/answer/9888072)
- [Provide advance notice to Google Play review](https://support.google.com/googleplay/android-developer/answer/6320428)
- [Google Play enforcement outcomes](https://support.google.com/googleplay/android-developer/answer/2477981)
- [Google Play fair warnings](https://support.google.com/googleplay/android-developer/answer/2985876)

Existing companion-app disclosures, useful as implementation precedent but not authorization evidence:

- [VALPAW privacy policy](https://valpaw.com/privacy-policy/)
- [ValPal support and security description](https://www.valpal-companion.com/support)

