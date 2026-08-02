<div align="center">
  <img src="docs/assets/brand-mark.png" alt="VantaVault logo" width="88" />
  <h1>VantaVault</h1>
  <p>A private, open-source Windows VALORANT companion, with an Android target in development.</p>
  <p>
    <a href="https://github.com/akawazak/valo-project/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/akawazak/valo-project?style=flat-square&color=ff4655" /></a>
    <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-0078d4?style=flat-square" />
    <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-0f1923?style=flat-square" /></a>
  </p>
  <p>
    <a href="https://vanta-vault-app.vercel.app/"><strong>Website</strong></a> ·
    <a href="https://github.com/akawazak/valo-project/releases/latest/download/VantaVault-portable.exe"><strong>Download for Windows</strong></a> ·
    <a href="https://github.com/akawazak/valo-project/issues">Report an issue</a> ·
    <a href="https://discord.gg/gxGQwWyECE">Discord</a>
  </p>
</div>

> [!IMPORTANT]
> VantaVault is not endorsed by Riot Games. Riot Games, VALORANT, and related assets are trademarks of Riot Games, Inc.

## What is VantaVault?

VantaVault brings your VALORANT storefront, loadouts, profiles, match history, friends, party, and live-match context into one app. Account sessions and stored match data stay on your device.

![VantaVault profile showing rank, season averages, and RR progression](docs/screenshots/profile.png)

## Features

- **Storefront:** daily offers, featured bundles, Night Market, accessories, balances, variants, and wishlist alerts.
- **Loadouts:** edit weapons, skins, buddies, sprays, player identity, expressions, and reusable presets.
- **Profiles:** rank, RR, match history, progression, agents, maps, and stored round analytics.
- **Social:** friends, player cards, Riot presence, party state, and available pregame or live-match details.
- **Live match:** map, queue, teams, agents, ranks, score, party markers, and likely stacks when Riot exposes the data.
- **Multiple accounts:** isolated sessions with remote access and local Riot Client support.
- **Privacy:** local storage, configurable history retention, and sanitized diagnostics.

<details>
<summary><strong>More screenshots</strong></summary>

### Loadout editor

![VantaVault loadout editor](docs/screenshots/loadout.png)

### Party and friends

![VantaVault Party and Friends panel](docs/screenshots/party-friends.png)

### Live match

![VantaVault live match view](docs/screenshots/live-match.png)

</details>

## Download

Download the newest build from [GitHub Releases](https://github.com/akawazak/valo-project/releases/latest):

- **`VantaVault-portable.exe`** — recommended; runs without installation and supports portable updates.
- **`VantaVault_*_x64-setup.exe`** — optional Windows installer with Start Menu integration.

Windows may show a SmartScreen warning because community builds are not currently code-signed.

### Requirements

- Windows 10 or 11
- Microsoft Edge WebView2
- A Riot account

Some party, presence, and live-match information requires the Riot Client to be running. Riot does not expose every field consistently, so unavailable data is shown as unavailable rather than guessed.

## Run from source

You need [Node.js](https://nodejs.org/), [Go 1.25+](https://go.dev/dl/), [Rust](https://www.rust-lang.org/tools/install), and Visual Studio Build Tools 2022 with the **Desktop development with C++** workload.

```powershell
git clone https://github.com/akawazak/valo-project.git
cd valo-project\frontend
npm install
npm.cmd run desktop
```

The desktop command builds and starts the private Go backend automatically. Do not run a second backend separately.

### Validation

```powershell
cd backend
go test ./...

cd ..\frontend
npm run build
npm run lint
cargo test --manifest-path src-tauri\Cargo.toml
```

Android is a separate Tauri target with a phone-oriented interface and remote-account support. It does not use Windows-only Riot lockfile features. See the [Android security and Riot API plan](docs/ANDROID_SECURITY_AND_RIOT_API_PLAN.md) for implementation details.

## Privacy

Never share Riot access tokens, entitlement tokens, cookies, or diagnostic logs containing account identifiers. Read the [Privacy Policy](PRIVACY.md) and [Terms](TERMS.md) before distributing or modifying account-related behavior.

## Contributing

Keep changes focused, run the relevant validation commands, and open a pull request with the problem, solution, and verification evidence.

## Credits

- [truearken/valovault](https://github.com/truearken/valovault) — original loadout workflow, local-client integration, and Tauri foundation.
- [victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker) — inspiration for Riot OAuth and remote storefront retrieval.

Released under the [Apache License 2.0](LICENSE).
