<div align="center">
  <img src="docs/assets/brand-mark.png" alt="VantaVault logo" width="96" />
  <h1>VantaVault</h1>
  <p>A private, open-source Windows companion for VALORANT, with an Android target in development.</p>
  <p>
    <a href="https://github.com/akawazak/valo-project/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/akawazak/valo-project?style=flat-square&color=ff4655" /></a>
    <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-0f1923?style=flat-square" /></a>
    <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078d4?style=flat-square" />
  </p>
  <p>
    <a href="https://vanta-vault-app.vercel.app/"><strong>Website</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/akawazak/valo-project/releases/latest/download/VantaVault-portable.exe"><strong>Download</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/akawazak/valo-project/releases/latest">Release notes</a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/akawazak/valo-project/issues">Issues</a>
    &nbsp;&middot;&nbsp;
    <a href="https://discord.gg/gxGQwWyECE">Discord</a>
  </p>
</div>

> [!IMPORTANT]
> VantaVault isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## Overview

VantaVault puts the VALORANT storefront, loadouts, profiles, match history, progression, friends, parties, and available live-match context in one native app. It is designed for players who want more than a store checker without keeping several browser tools open.

Account sessions and saved match data remain on your device. VantaVault can use a connected remote Riot session for account features and the local Riot Client for information that is only available while the game client is running.

![VantaVault profile showing rank, season averages, and RR progression](docs/screenshots/profile.png)

## Features

| Area | What it provides |
| --- | --- |
| **Storefront** | Daily offers, rotating featured bundles, Night Market, accessories, wallet balances, prices, upgrades, variants, and wishlist alerts. |
| **Loadouts** | Weapons, skins, variants, buddies, sprays, player cards, titles, flexes, and saved presets. Presets can be imported, exported, edited, and applied when ready. |
| **Profiles** | Current RR, rank history, lifetime peak, match history, win rate, agent and map performance, progression, and locally stored round analytics. |
| **Social** | Friends, player cards, Riot presence, party state, friend requests, chat history, and available pregame or live-match information. |
| **Live match** | Queue, map, teams, agents, current and peak ranks, party markers, live score when exposed, and clearly labelled likely stacks based on recent-match evidence. |
| **Accounts** | Multiple isolated Riot sessions, remote access renewal, and safe fallback to the local Riot Client when it is signed into the same account. |
| **Discord** | Rich Presence for the store, loadout editor, agent select, queue, map, agent, and in-match activity. |
| **Privacy** | Local match storage, configurable retention, encrypted mobile session storage, and diagnostics that can be exported without account tokens. |

<details>
<summary><strong>More screenshots</strong></summary>

### Complete loadout editor

![VantaVault loadout editor showing weapons, player identity, and expression slots](docs/screenshots/loadout.png)

### Current loadout

![VantaVault Current Loadout](docs/screenshots/current-loadout.png)

### Party and friends

![VantaVault Party and Friends panel](docs/screenshots/party-friends.png)

### Live match

![VantaVault live match view showing teams, ranks, and party evidence](docs/screenshots/live-match.png)

</details>

## Remote account and local Riot Client support

Most account information works through a connected remote session. Features tied to the running game client use the local Riot Client when available.

| Feature | Remote session | Local Riot Client |
| --- | :---: | :---: |
| Storefront, wallet, owned cosmetics, and loadout changes | Yes | Yes |
| Profiles, match history, progression, and map review | Yes | Yes |
| Friends, presence, and direct messages | Yes | Yes |
| Party chat and friend-request actions | No | Yes |
| Pregame and live-match teams | When Riot exposes the active session | Yes |
| Exact live score and automatic local game detection | No | Yes |
| Automatic custom-match preset apply and restore | No | Yes |
| Wishlist checks | While VantaVault is running | While VantaVault is running |

VantaVault never replaces the selected account with data from a different local account. If the remote session and Riot Client account do not match, local fallback is not used.

## Download and installation

1. Open the [latest release](https://github.com/akawazak/valo-project/releases/latest).
2. Choose one of the Windows builds:
   - **`VantaVault-portable.exe`** is the recommended no-setup build. Run it from anywhere and use portable in-app updates.
   - **`VantaVault_*_x64-setup.exe`** is the optional per-user installer with Start Menu integration.
3. Launch VantaVault and connect a Riot account.

GitHub's automatically generated source archives are for developers and are not Windows app downloads.

Windows may show a SmartScreen warning because community releases are not currently code-signed. Check that the file came from this repository's release page before running it.

### Requirements

- Windows 10 or Windows 11
- Microsoft Edge WebView2
- A Riot account

### Current limitations

- Party, presence, and live-match detail depends on the current Riot session, game phase, and fields Riot exposes.
- Exact live score and automatic game detection require the local Riot Client.
- Unknown player identities and party relationships are not guessed.
- Newly released cosmetic artwork can briefly appear as pending while community metadata catches up.
- The Android target is available for device development and testing but is not published on Google Play.

## Android target

Android uses the same remote-account data contracts in a phone-oriented interface. It includes the storefront, wallet, Night Market, loadouts and presets, contracts and Battle Pass progress, friends and chat, profiles, rank progression, match history, and conditional live-match data.

Android cannot use the Windows Riot lockfile, tray, desktop overlay, local game detection, Discord Rich Presence, or Windows updater. Riot sign-in runs in an isolated native WebView, and saved session secrets are encrypted with a key backed by Android Keystore.

For the current architecture, supported API surface, and security boundaries, read the [Android security and Riot API plan](docs/ANDROID_SECURITY_AND_RIOT_API_PLAN.md).

## Development

### Windows prerequisites

- [Node.js](https://nodejs.org/) with npm
- [Go 1.25+](https://go.dev/dl/)
- [Rust](https://www.rust-lang.org/tools/install) with the MSVC toolchain
- [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**
- Microsoft Edge WebView2 Runtime

### Run the desktop app

```powershell
git clone https://github.com/akawazak/valo-project.git
cd valo-project\frontend
npm install
npm.cmd run desktop
```

The desktop command builds and starts the private Go backend as a sidecar. Do not start a second backend separately; each desktop launch provides its own private key and uses port `31719`.

For interface-only work, run `npm.cmd run dev`. Riot accounts, the private backend, Discord Rich Presence, updates, and other native features require `npm.cmd run desktop`.

### Validation

```powershell
cd backend
go test ./...
go build .

cd ..\frontend
npm run build
npm run lint
cargo test --manifest-path src-tauri\Cargo.toml
```

## Privacy and security

Do not share Riot access tokens, entitlement tokens, cookies, account exports, or diagnostic logs containing identifiers. Read the [Privacy Policy](PRIVACY.md) and [Terms](TERMS.md) before distributing or modifying account-related behavior.

Security-sensitive Android decisions and Riot API boundaries are documented in [docs/ANDROID_SECURITY_AND_RIOT_API_PLAN.md](docs/ANDROID_SECURITY_AND_RIOT_API_PLAN.md).

## Contributing

Fork the repository, branch from the latest `main`, keep changes focused, and run the relevant validation commands. Pull requests should explain the problem, the change, and how it was verified.

## Credits

- [truearken/valovault](https://github.com/truearken/valovault) -- original loadout workflow, local-client integration, and Tauri foundation.
- [victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker) -- inspiration for Riot OAuth and remote storefront retrieval.

Released under the [Apache License 2.0](LICENSE).
