<div align="center">
  <img src="docs/assets/brand-mark.png" alt="VantaVault logo" width="96" />
  <h1>VantaVault</h1>
  <p>A private, open-source Windows companion for VALORANT.</p>
  <p>
    <a href="https://github.com/akawazak/valo-project/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/akawazak/valo-project?style=flat-square&color=ff4655" /></a>
    <a href="LICENSE.md"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-0f1923?style=flat-square" /></a>
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square" />
    <img alt="Tauri" src="https://img.shields.io/badge/desktop-Tauri-24c8db?style=flat-square" />
  </p>
  <p>
    <a href="#screenshots">Screenshots</a> ·
    <a href="#features">Features</a> ·
    <a href="#installation">Installation</a> ·
    <a href="#development">Development</a>
  </p>
</div>

> [!IMPORTANT]
> VantaVault is not endorsed by Riot Games. Riot Games, VALORANT, and related assets are trademarks of Riot Games, Inc.

VantaVault brings loadout presets, the storefront, multi-account sessions, player profiles, match history, friend presence, party status, and live-match information into one native desktop app. Account data and sessions stay on your computer.

## Screenshots

### Profile and competitive history

![VantaVault player profile showing rank, season averages, and RR progression](docs/screenshots/profile.png)

### Complete loadout editor

![VantaVault loadout editor showing weapon, player card, and expression slots](docs/screenshots/loadout.png)

### Cosmetic picker

![VantaVault spray picker showing owned cosmetics](docs/screenshots/cosmetic-picker.png)

## Features

| Area | What VantaVault provides |
| --- | --- |
| Loadouts | Save, import, export, edit, and apply weapon, buddy, spray, identity, and agent presets. |
| Storefront | View the daily store, featured bundles, Night Market, accessories, and wallet balances. |
| Accounts | Manage multiple Riot accounts with persistent WebView2 sessions and sequential access renewal. |
| Profile | Inspect rank, RR progression, match history, agent/map performance, missions, and contracts. |
| Social | See friend presence, party members, pregame state, and live-match information when available. |
| Privacy | Keep match history locally with configurable retention and sanitized diagnostics export. |

## Installation

1. Open the [latest release](https://github.com/akawazak/valo-project/releases/latest).
2. Download `VantaVault-portable.exe` to run without installing, or `VantaVault_*_x64-setup.exe` for the installer and update support.
3. Launch VantaVault and connect a Riot account.

Windows may show a SmartScreen warning for community builds that are not code-signed. Review the release source before choosing **Run anyway**.

## Requirements and limitations

- Windows 10 or 11 with WebView2 (the installer can bootstrap it).
- Party, loadout, presence, and live-match data depend on a running Riot client, the active Riot session, and the current game phase.
- Riot does not expose every field consistently; VantaVault does not guess private identities or unknown party relationships.
- Live score requires the local Riot client presence feed.
- Flex cosmetics are not supported because no authoritative catalog/type is currently available.

## Development

Install [Go 1.25+](https://go.dev/dl/), [Node.js](https://nodejs.org/), [Rust 1.77.2+](https://www.rust-lang.org/tools/install), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
git clone https://github.com/akawazak/valo-project.git
cd valo-project\frontend
npm install
npm run tauri dev
```

For browser-only frontend and backend development, use `npm run dev:all` from `frontend`.

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

Account sessions are stored locally in WebView2 user-data folders and the app configuration directory. Never share Riot access tokens, entitlement tokens, SSID cookies, account data, or diagnostic logs containing identifiers. Read [Privacy](PRIVACY.md) and [Terms](TERMS.md) before distributing or modifying account-related behavior.

## Contributing and releases

Fork the repository, branch from the latest `main`, keep changes focused, run the validation commands above, and open a pull request with the root cause and verification evidence.

## Credits

- [truearken/valovault](https://github.com/truearken/valovault) — original loadout workflow, local-client integration, and Tauri foundation.
- [victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker) — inspiration for Riot OAuth and remote storefront retrieval.

Released under the [MIT License](LICENSE.md).
