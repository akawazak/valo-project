# ValoVault - Agent Development Guide

## Build Commands

### Backend (Go)
- **Development**: `cd backend && air` (live reload) or `go run .`
- **Build**: `go build -o ./tmp/valovault-backend .`
- **No test framework currently configured**

### Frontend (Next.js + Tauri)
- **Development**: `cd frontend && npx tauri dev`
- **Build**: `cd frontend && npm run build`
- **Lint**: `cd frontend && npm run lint`
- **Type check**: `cd frontend && npx tsc --noEmit`

## Code Style Guidelines

### TypeScript/React (Frontend)
- **Imports**: Use absolute paths with `@/*` alias (e.g., `@/components/Header`)
- **Components**: Functional components with hooks, `"use client";` directive for client components
- **Types**: Strict TypeScript enabled, define interfaces in `src/lib/types.ts`
- **Styling**: Bootstrap classes + custom CSS variables for theming
- **Error handling**: Use ErrorModal component for user-facing errors

### Go (Backend)
- **Formatting**: Standard Go formatting (`go fmt`)
- **Package structure**: Organize by feature (handlers/, presets/, settings/, tick/)
- **Concurrency**: Use sync.RWMutex for thread-safe operations
- **Error handling**: Return errors from functions, handle in HTTP handlers

### General
- **Naming**: camelCase for JS/TS, PascalCase for Go exports
- **File organization**: Group related files, keep components in feature directories
- **No tests**: Currently no test framework

## Lessons Learned & Gotchas

### Riot API Case Inconsistency (UUIDs)
- **Problem**: Riot Games PVP APIs return UUIDs (such as `OfferID`, `ItemID`, and `SingleItemOffers`) in **UPPERCASE**, whereas third-party asset databases (like `valorant-api.com`) return them in **lowercase**.
- **Lesson**: Never perform direct case-sensitive equality checks (`===` in React or map keys in Go) on Riot UUIDs. Always normalize all UUIDs to **lowercase** using `strings.ToLower()` (Go) or `.toLowerCase()` (TypeScript) before executing comparisons or dictionary lookups.

### Storefront Auth (No Developer API Key)
- ValoVault does **not** use a Riot Developer Portal API key for the store.
- Auth uses the public OAuth client `client_id=riot-client` with a paste-redirect-URL flow.
- The backend exchanges the user's `access_token` + entitlements JWT for Riot PVP store/wallet endpoints.
- Cosmetic metadata (skin images, tiers, bundles) comes from the public [valorant-api.com](https://valorant-api.com) — no key required.
- Tokens expire after ~3 hours; the app should detect 401s and prompt re-login.

---

## Planned Work (Session Notes — 2026-05-31)

> **Status (current):**
> - **Phase 1 (storefront + Riot OAuth)** — **restored** after an over-broad `git restore` / `git clean` accidentally removed pre-session storefront files. Do not run destructive git cleanup on untracked storefront work.
> - **Phases 2–4** (sprays/card in presets, Profile/Collection tabs, wishlist, export/import, `profile.go`, etc.) — **reverted only** — implemented in one session, then removed per user request. Re-implement only when asked.

### Context

ValoVault is a Tauri desktop app (Go backend + Next.js frontend) for managing VALORANT weapon skin loadout presets with optional auto-apply on agent select. The user wanted to expand beyond core presets into a **Riot storefront viewer** and broader account tools — inspired in part by the separate `valorant-shop-checker` project in the parent workspace.

### Phase 1 — Riot Storefront Tab (was in progress locally)

Goal: View daily shop, featured bundles, Night Market, and wallet **without Valorant running**, via Riot OAuth.

Planned / partially built UI:
- **StorePanels** tab with daily offers, collapsible featured bundle, Night Market container
- **RiotLoginCard** — open Riot login, paste redirect URL, multi-account registry in `localStorage`
- Content-tier colored cards, owned-skin badges, bundle discount pricing
- Backend routes: `GET /v1/auth/url`, `POST /v1/auth/token`, `GET /v1/storefront`, `GET /v1/wallet`
- Remote auth via custom headers: `X-Riot-Access-Token`, `X-Riot-Entitlements-JWT`, `X-Riot-Puuid`, `X-Riot-Region`
- Fallback to `store/v1/offers/` when `store/v3/storefront` omits `SingleItemStoreOffers`

### Phase 2 — Preset Expansion (user requested)

Goal: Extend presets beyond gun skins + gun buddies.

| Feature | User wanted? | Notes |
|---------|--------------|-------|
| **Sprays** (4 spray wheel slots) | Yes | Store `ActiveExpressions` `{ typeId, assetId }` per preset; apply by matching `TypeID` on current loadout |
| **Player card & title** | Yes | Store `IdentityV1 { playerCardId, playerTitleId }`; apply via `SetPlayerLoadout` |
| **Export / import presets** | Yes | JSON file download + file picker import; merge with new UUIDs on conflict |
| **Melee-only presets** | **No** | User explicitly declined |

Backend shape planned:
```go
type ApplyLoadoutRequest struct {
    Loadout  map[string]LoadoutItemV1
    Identity *IdentityV1
    Sprays   []SpraySlotV1
}
```

New owned-item endpoints: `/v1/owned-sprays`, `/v1/owned-cards`, `/v1/owned-titles`

Asset data from valorant-api.com: `/v1/sprays`, `/v1/playercards`, `/v1/playertitles`

### Phase 3 — Storefront QoL

| Feature | Description |
|---------|-------------|
| **Wishlist** | Star skins in store; highlight wishlisted cards; persist in `localStorage` |
| **Auto-refresh** | Re-fetch storefront when daily reset countdown hits 0 |
| **Store history** | Snapshot daily/night-market offer IDs on each refresh (local log) |
| **Token expiry UX** | Detect 401 from Riot APIs → "Session expired, sign in again" |

### Phase 4 — New App Tabs (beyond presets + storefront)

User asked what features ValoVault could offer **instead of** only presets and storefront. Two tabs were planned:

**Profile tab**
- Account level (`/v1/account-xp`)
- Competitive rank + RR (`/v1/player-mmr`)
- Recent match history (`/v1/match-history`)
- Rank icons from valorant-api.com `/v1/competitivetiers`

**Collection tab**
- Skin ownership % vs total catalog
- Breakdown by content tier
- Wishlist count + store snapshot count

Backend handlers were planned in `backend/handlers/profile.go`.

### Phase 5 — Future Ideas (not started)

Broader directions the user was interested in for later:
- Match analytics (K/D, agent win rates from match details)
- Rank tracker / RR graph over time
- Shop notifications when wishlisted skin appears (tray icon already exists in Tauri)
- Multi-account shop compare
- Store ↔ preset bridge ("add this store skin to preset")
- Contract / battle pass tracker
- Crosshair gallery
- Inventory VP value estimate

### Files That Existed in the Reverted Session

**Backend:** `handlers/handlers.go` (remote auth + storefront), `handlers/profile.go`, `presets/presets.go` (identity/sprays apply), `main.go` (new routes)

**Frontend:** `RiotLoginCard.tsx`, `features/dashboard/StorePanels.tsx`, `features/identity/IdentityPanel.tsx`, `features/sprays/SpraySelector.tsx`, `features/profile/ProfilePanel.tsx`, `features/collection/CollectionPanel.tsx`, `lib/wishlist.ts`, `lib/storeHistory.ts`, `lib/presetExport.ts`, heavy `globals.css` storefront theme

### Suggested Implementation Order (when resuming)

1. Storefront + Riot OAuth (Phase 1) — largest standalone value
2. Preset sprays + player card + export (Phase 2)
3. Wishlist + auto-refresh + token expiry (Phase 3)
4. Profile + Collection tabs (Phase 4)
