# VantaVault

VantaVault is a Windows desktop companion app for VALORANT loadouts and storefront viewing.

It lets you save/apply skin presets, manage agent-specific loadouts, connect Riot accounts, and view your live Riot storefront including daily offers, featured bundles, Night Market, accessories, and wallet balances.

> This project is not endorsed by Riot Games. Riot Games, VALORANT, and all related assets are trademarks or registered trademarks of Riot Games, Inc.

## Download

Releases are published at:

[github.com/akawazak/valo-project/releases](https://github.com/akawazak/valo-project/releases)

Recommended build:

- `VantaVault.exe`: run directly from anywhere.

Optional installer:

- NSIS setup executable from the latest release.

## Features

- Skin and buddy preset saving.
- Agent-specific preset assignment.
- Optional auto-apply flow for selected agents.
- Riot account connection through official Riot login plus pasted localhost redirect URL.
- Multi-account switching.
- Local persistent account storage.
- Daily Store, Featured Bundle, Night Market, Accessories, VP, and RP display.
- Preset import/export share codes.
- Early spray and identity preset customization work.
- Tauri updater support for GitHub Releases.

## Account Storage

Connected Riot account sessions are mirrored in two places:

- WebView `localStorage` for fast frontend access.
- Local backend file storage at the app config directory under `valovault/accounts/accounts.json`.

Riot OAuth access tokens expire. When a stored session expires, the app prompts you to reconnect that account instead of silently failing the storefront.

## Credits

This project builds on and takes inspiration from two open-source projects:

- [truearken/valovault](https://github.com/truearken/valovault): original ValoVault foundation, preset/loadout workflow, local VALORANT client integration, and Tauri app structure.
- [victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker): inspiration for the Riot OAuth paste-redirect flow and remote storefront retrieval pattern.

Thank you to both authors for making their work available.

## Development

Prerequisites:

- Go
- Node.js
- Rust/Tauri prerequisites

Run backend:

```powershell
cd backend
go run .
```

Run frontend dev server:

```powershell
cd frontend
npm run dev -- --hostname 127.0.0.1 --port 33100
```

Launch Tauri debug app:

```powershell
frontend\src-tauri\target\debug\app.exe
```

Build checks:

```powershell
cd backend
go build ./...
```

```powershell
cd frontend
npm.cmd run lint
npm.cmd run build
```

## Releases And Auto Update

The Tauri updater endpoint is configured for:

```text
https://github.com/akawazak/valo-project/releases/latest/download/latest.json
```

GitHub Actions builds the Tauri app and uploads release artifacts. Portable packaging is generated as:

```text
VantaVault.exe
```

For updater signing, add this repository secret before creating production releases:

```text
TAURI_SIGNING_PRIVATE_KEY
```

Create releases by pushing a version tag:

```powershell
git tag v0.4.1
git push origin v0.4.1
```
