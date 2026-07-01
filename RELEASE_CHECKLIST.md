# VantaVault Release Checklist

## Verified in the current workspace

- [x] Frontend production build passes on Next.js 16.2.9.
- [x] Go tests, Go vet, Rust tests, and Clippy pass.
- [x] Production npm dependency audit reports zero vulnerabilities.
- [x] Tauri debug production build launches with CSP enabled.
- [x] Profile/API images and navigation work under the packaged CSP.
- [x] Account JSON writes are ordered and atomically replaced.
- [x] Repeated login preserves an existing SSID if the new capture is incomplete.
- [x] WebView session replacement is staged and recovers interrupted swaps.
- [x] Expired access tokens renew silently from valid stored Riot sessions.
- [x] Bulk renewal is sequential, cancellable, and does not open many popups.
- [x] Untrusted browser origins cannot reach local mutation endpoints.
- [x] Riot HTTPS certificate verification is enabled.
- [x] Release workflow uses the npm lockfile and runs verification.
- [x] VirusTotal workflow targets the actual release formats.
- [x] Privacy notice, terms, and current release instructions exist.

## Manual gates before a public binary

- [ ] Test repeated account addition with a representative 40-account set:
  add account, add another, add the first again, restart, then verify every
  account still has silent renewal.
- [ ] Leave the app running through at least two one-hour access-token
  expirations and verify renewal without a popup.
- [ ] Verify cancellation during single and bulk renewal.
- [ ] Build the signed NSIS installer with `TAURI_SIGNING_PRIVATE_KEY`.
- [ ] Configure Windows code signing and verify the EXE signature.
- [ ] Configure `VT_API_KEY` and confirm VirusTotal links appear on the release.
- [ ] Install and update on clean Windows 10 and Windows 11 user accounts.
- [ ] Test with VALORANT closed, at menus, in party, pregame, and in match.
- [ ] Confirm uninstall/data-removal wording against the final installer.

## Product and policy gate

Riot's published VALORANT policy requires player opt-in through RSO for public
player-data products and lists opponent scouting and online-store tracking as
unapproved use cases. Decide before public distribution whether VantaVault will:

1. remain an explicitly unofficial local utility with the associated policy
   and breakage risk; or
2. pursue a Riot production application and remove or redesign features that
   cannot be approved.

Do not describe the current unofficial Riot-client flow as approved RSO.
