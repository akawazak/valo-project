# VantaVault

VantaVault is an open-source Windows desktop companion for VALORANT. It combines loadout presets, storefront access, multi-account session management, player profiles, match history, friend presence, live party status, and live-match information in one Tauri app.

> VantaVault is not endorsed by Riot Games. Riot Games, VALORANT, and related assets are trademarks of Riot Games, Inc.

## Download

Use the latest build from [GitHub Releases](https://github.com/akawazak/valo-project/releases):

- `VantaVault-portable.exe` — runs without installation.
- `VantaVault_*_x64-setup.exe` — installer with update support.

## Features

- Save, import, export, edit, and apply weapon, buddy, spray, identity, and agent presets.
- View the daily store, featured bundles, Night Market, accessories, and wallet balances.
- Manage multiple Riot accounts with persistent WebView2 sessions and sequential access renewal.
- Inspect rank, RR progression, match history, agent/map performance, missions, and contracts.
- Show friend presence, current party members, and live pregame/match information when Riot exposes it.
- Store match history locally with configurable retention and sanitized diagnostics export.

## Current limitations

- Riot does not expose every piece of data consistently. Unknown party relationships and private identities are not guessed.
- Live score requires the local Riot client presence feed.
- Party, loadout, and live-match availability depends on the current Riot session and game phase.
- Flex cosmetics are not supported because no authoritative catalog/type is currently available.

## Development

Requirements:

- Windows 10/11
- Go 1.25+
- Node.js and npm
- Rust 1.77.2+ and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

Run the backend and frontend together:

```powershell
cd frontend
npm install
npm run dev:all
```

Run the desktop app:

```powershell
cd frontend
npm run tauri dev
```

Validation:

```powershell
cd backend
go test ./...
go build .

cd ..\frontend
npm run build
npm run lint
cargo test --manifest-path src-tauri\Cargo.toml
```

## Contributing

The repository is public. Fork it or branch from the latest `main`, keep changes focused, run the validation commands above, and open a pull request describing the root cause and verification evidence.

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c your-feature-branch
```

Do not include Riot access tokens, entitlement tokens, SSID cookies, lockfile credentials, account data, logs containing identifiers, or generated build/cache files.

## Data and privacy

Account sessions are stored locally in WebView2 user-data folders and the app configuration directory. Riot access credentials are sensitive. Read [Privacy](PRIVACY.md) and [Terms](TERMS.md) before distributing or modifying account-related behavior.

## Releases

Release CI validates the Go backend, Next.js frontend, Rust/Tauri code, and packages Windows artifacts. Maintainer requirements are documented in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

## Credits

- [truearken/valovault](https://github.com/truearken/valovault) — original loadout workflow, local-client integration, and Tauri foundation.
- [victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker) — inspiration for Riot OAuth and remote storefront retrieval.

Licensed under the [MIT License](LICENSE.md).
