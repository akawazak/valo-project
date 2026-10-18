# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The product itself is a Windows desktop app (Tauri). This record covers the public website in `website/`, a static site deployed on Vercel at vanta-vault-app.vercel.app.

## Users

- VALORANT players on Windows who find VantaVault through search and need to judge quickly whether it is real, useful and worth installing.
- Friends and Discord members the developer shares the link with, who already know of it and mainly want to see it and download.

## Product Purpose

VantaVault is a free, open-source Windows companion for VALORANT: store checker, skin and loadout manager with presets applied in one click, profile and rank progress, locally stored match history with round and map review, live match context, Duos, profile comparison, career insights, session recaps and accolades. The website's success is a visitor downloading the Windows build.

## Positioning

One private desktop app for the whole account, built from the local Riot Client session rather than a website login, with match history kept on the player's own PC and the source public on GitHub.

## Operating Context

- Download comes from the latest GitHub release (`VantaVault-portable.exe`, plus an installer). The site reads release versions from the GitHub API in the browser.
- The app updates itself from inside the app.
- Android builds exist in the repository workflows but are not published; the site shows Android as not yet available.
- Community: Discord (https://discord.gg/gxGQwWyECE), GitHub issues.

## Capabilities and Constraints

- Static HTML/CSS/JS with no build step; `website/verify.mjs` checks required SEO, structured data, download links and analytics. Vercel Web Analytics and Speed Insights are installed.
- Three guide pages (`/valorant-store-checker/`, `/valorant-loadout-manager/`, `/valorant-match-history/`) carry search traffic and must stay.
- Required Riot disclaimer in the footer.

## Brand Commitments

- Name: VantaVault. Logo: the shield "V" mark (`website/assets/app-icon.png`, `brand-mark.svg`).
- Safety is described with facts only: open source, no injection, no memory reading, uses the local Riot Client. Never promise that players cannot be banned, and never imply Riot endorsement.
- The developer's real Riot name must never appear in public assets. All screenshots and video use demo identities (Vanta#DEMO, Echo#DEMO).

## Evidence on Hand

- Trailer: `website/assets/vantavault-trailer.mp4` (74 s, narrated, demo identities) with captions `vantavault-trailer.vtt`.
- Clean demo screenshots: `website/assets/shot-*.webp` (loadout, store, duos, live, round, map, compare, history, insights, accolades, sessions, profile).
- No testimonials, user counts, reviews or press exist. Do not invent them.

## Product Principles

1. Download first: every section should make the Windows download easier to reach.
2. Show the real app, never mockups or invented stats beyond clearly labelled demo data.
3. Honest about safety and Riot's position; facts, not promises.
4. Privacy is a feature: accounts and history stay on the player's PC.
