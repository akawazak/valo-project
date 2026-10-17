<!-- DRAFT. Publish only after SignPath Foundation approves the project. See docs/Code signing.md. -->
# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

VantaVault's Windows builds (`VantaVault-portable.exe` and the `VantaVault_<version>_x64-setup.exe` installer) are built from this repository by GitHub Actions and signed through SignPath. Each signing request is approved by hand.

## Team

- **Committers and reviewers:** [akawazak](https://github.com/akawazak)
- **Approvers:** [akawazak](https://github.com/akawazak)

## Privacy

The app sends Riot account and game requests straight from your PC to Riot, loads public game images from valorant-api.com, and checks GitHub Releases for updates. It does not run a server of its own and sells no data. See [PRIVACY.md](https://github.com/akawazak/valo-project/blob/main/PRIVACY.md).
