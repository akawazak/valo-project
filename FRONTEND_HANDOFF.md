# ValoVault Frontend Handoff

This document is for another AI/developer who does not have access to the original conversation. It explains the current frontend state, intended product direction, important files, and known problems.

## Product Goal

ValoVault is a Tauri + Next.js app for VALORANT loadout/store management.

The frontend should eventually feel like a premium tactical VALORANT companion:

- Storefront view: daily shop, featured bundle, Night Market, accessories, wallet balances, and connected Riot accounts.
- Presets view: saved skin loadouts, agent assignment, custom sprays, player card/title identity, import/export.
- Account flow: user can connect Riot accounts through a Riot OAuth/paste-redirect flow, switch accounts, and reconnect when sessions expire.

The current UI is not final. The user wants a more creative, spacious, polished redesign. Avoid cramped layouts. Use the available screen space.

## Current Frontend Stack

- Framework: Next.js app router
- Language: TypeScript + React
- Styling: global CSS in `frontend/src/app/globals.css`
- Desktop shell: Tauri
- Backend API base: `http://localhost:31719/v1`
- Riot/public asset data: `https://valorant-api.com/v1/*`

Important package scripts:

- `npm run dev -- --hostname 127.0.0.1 --port 33100`
- `npm run lint`
- `npm run build`

## Design Direction

Reference screenshots the user liked:

- Dark tactical dashboard.
- Centered top navigation, not a left sidebar.
- Large spacious content canvas.
- Subtle grid background.
- VALORANT red accent.
- Clipped/slanted tactical containers.
- Compact top wallet/account pills.
- Store sections stacked vertically: daily offers, featured bundle, night market, accessories.
- Presets view should be similarly tactical but must prioritize usability.

Current problem:

- The UI has improved but still feels uneven.
- Some old sidebar-era CSS/components still exist and should be removed or consolidated.
- Store empty/account states should feel intentional and premium.
- Preset customization should contain sprays/player-card identity, not the storefront.

## Main Files To Give Another AI

Give these files first:

- `frontend/src/app/page.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/context/DataContext.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/lib/types.ts`
- `frontend/src/components/RiotLoginCard.tsx`
- `frontend/src/features/dashboard/StorePanels.tsx`
- `frontend/src/features/presets/PresetList.tsx`
- `frontend/src/hooks/usePresets.ts`
- `frontend/src/hooks/useLoadout.ts`
- `frontend/src/features/gun-skins/WeaponGrid.tsx`
- `frontend/src/features/identity/IdentitySelector.tsx`
- `frontend/src/features/sprays/SpraySelector.tsx`
- `frontend/src/lib/presetShare.ts`
- `frontend/next.config.ts`
- `frontend/package.json`

If they need backend context for API shapes, also provide:

- `backend/main.go`
- `backend/handlers/handlers.go`
- `backend/handlers/remote.go`
- `backend/presets/presets.go`

If they need Tauri launch/config context, also provide:

- `frontend/src-tauri/tauri.conf.json`
- `frontend/src-tauri/Cargo.toml`

## Current Frontend Architecture

### `frontend/src/app/page.tsx`

This is the main app shell.

Current responsibilities:

- Controls active tab: `store` or `skins`.
- Renders top command bar.
- Shows Riot account controls.
- Opens `RiotLoginCard` as a modal overlay.
- Renders `StorePanels` for store.
- Renders weapon/preset/agent/identity/spray panels for presets.
- Handles preset import/export modal.
- Handles account delete confirmation modal.

Known issue:

- This file is too large and should be split into components.
- Suggested extraction:
  - `AppTopbar.tsx`
  - `AccountSwitcher.tsx`
  - `PresetWorkspace.tsx`
  - `ImportPresetModal.tsx`
  - `AccountDeleteModal.tsx`

### `frontend/src/context/DataContext.tsx`

Global data/provider.

Responsibilities:

- Loads static Valorant catalog data:
  - agents
  - weapons
  - gun buddies
  - content tiers
  - bundles
  - sprays
  - player cards
  - player titles
- Loads user inventory:
  - owned skins
  - owned buddies
  - owned agents
  - owned sprays
  - owned cards
  - owned titles
  - player spray slots
- Manages Riot account list in `localStorage`.
- Activates accounts by writing these keys:
  - `riot_access_token`
  - `riot_entitlements`
  - `riot_puuid`
  - `riot_region`
- Stores account list under:
  - `riot_accounts`
- Tracks `isTokenExpired`.
- Emits `storefrontRefreshKey` to trigger store refreshes.

Important behavior:

- Riot OAuth tokens expire. The current implementation stores an `expiresAt` on accounts and removes expired accounts on startup/switch.
- If a stored account no longer works, the user must reconnect.

Known issue:

- Account/session logic should probably be extracted into a dedicated hook like `useRiotAccounts`.
- Remote tokens are currently in `localStorage`; this is convenient but not ideal.

### `frontend/src/services/api.ts`

API client.

Key functions:

- `getAuthUrl()`
- `submitTokenUrl(url)`
- `getStorefront()`
- `getWallet()`
- `getOwnedSkins()`
- `getOwnedGunBuddies()`
- `getOwnedAgents()`
- `getOwnedSprays()`
- `getOwnedPlayerCards()`
- `getOwnedPlayerTitles()`
- `getSprays()`
- `getPlayerCards()`
- `getPlayerTitles()`
- `getBundles()`
- `getPlayerLoadout()`
- `getPlayerSprays()`
- `getPresets()`
- `savePresets()`
- `applyLoadout()`

`fetchWithAuth()` injects Riot headers from `localStorage`:

- `X-Riot-Access-Token`
- `X-Riot-Entitlements-JWT`
- `X-Riot-Puuid`
- `X-Riot-Region`

Known issue:

- Error handling is inconsistent across functions.
- Some functions throw `LocalClientError`, some throw regular `Error`, and some silently return empty arrays.

### `frontend/src/features/dashboard/StorePanels.tsx`

Storefront UI.

Responsibilities:

- Fetches storefront and wallet.
- Shows daily offers.
- Shows featured bundle.
- Shows Night Market.
- Shows accessories when available.
- Shows token-expired state.
- Shows no-account connect state.

Important constants:

- VP currency ID: `85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741`
- RP currency ID: `e59aa87c-4cbf-517a-5983-6e81511be9b7`

Known issue:

- The store UI still needs a strong redesign pass.
- It should be more spacious, cinematic, and intentional.
- It should not show fake/mock data.
- Empty/error/loading states should be beautiful and obvious.

### Presets / Sprays / Identity

The user clarified:

- Sprays and player-card/title customization belong in the Presets section, not the shop.
- Sprays are the main customization priority.
- The ideal behavior is custom sprays per preset, potentially agent-specific later.

Current files:

- `frontend/src/features/identity/IdentitySelector.tsx`
- `frontend/src/features/sprays/SpraySelector.tsx`
- `frontend/src/hooks/usePresets.ts`
- `frontend/src/lib/presetShare.ts`

Current data model in `types.ts`:

- `IdentityV1`
- `SpraySlot`
- `Preset.identity`
- `Preset.sprays`
- `SprayAsset`
- `PlayerCardAsset`
- `PlayerTitleAsset`

Known issue:

- Current spray/identity panels are functional-looking but not polished.
- Current import/export uses copyable Base64 share codes, not actual download/file picker yet.
- The user mainly wants custom sprays, so prioritize a clean spray selector before over-polishing identity.

## Backend API Shape Relevant To Frontend

Storefront:

- Frontend calls `GET /v1/storefront`.
- Backend remote flow should call Riot:
  - `POST https://pd.{shard}.a.pvp.net/store/v3/storefront/{puuid}`
- Backend may enrich `SkinsPanelLayout.SingleItemStoreOffers`.

Wallet:

- Frontend calls `GET /v1/wallet`.

Auth:

- Frontend calls `GET /v1/auth/url`.
- User opens Riot auth URL.
- After Riot redirects to `http://localhost/redirect#access_token=...`, user copies full URL.
- Frontend calls `POST /v1/auth/token` with `{ url }`.
- Backend returns:
  - `access_token`
  - `entitlements_token`
  - `expires_in`
  - `puuid`
  - `region`
  - `game_name`
  - `tag_line`

Important:

- Do not use mock store data.
- If tokens expire, prompt reconnect.

## Known Bugs / Work Still Needed

- UI still needs a real componentized redesign instead of one huge `page.tsx` plus huge `globals.css`.
- Storefront layout should be visually rebuilt from first principles.
- Account controls should be tested after relaunch:
  - `+ Account`
  - switch account
  - delete account
  - reconnect expired account
- Storefront should be tested for:
  - no account
  - connected fresh account
  - expired account
  - Riot API error
  - empty Night Market
  - missing bundle image
- Presets need better spray UX:
  - clear 4-slot spray selector
  - search/filter
  - show owned-only when owned data exists
  - possibly agent-specific spray assignments later
- Identity selector can stay secondary.
- Convert raw `<img>` tags in `IdentitySelector.tsx` and `SpraySelector.tsx` to Next `Image` or intentionally disable warnings.
- Remove old sidebar CSS once the topbar design is finalized.
- Avoid adding OAuth token interception/cookie stealing behavior. Current flow is paste-redirect URL after official Riot login.

## Suggested Redesign Plan

1. Split app shell:
   - `AppTopbar`
   - `AccountSwitcher`
   - `StorefrontView`
   - `PresetsView`
2. Build a clean design system:
   - dark grid background
   - tactical clipped panels
   - VALORANT red accent
   - mono labels
   - large airy spacing
3. Storefront:
   - big hero/status strip at top
   - daily offers as 4 large cards
   - featured bundle as a cinematic wide panel
   - Night Market as discount cards
   - accessories as compact rows
4. Presets:
   - saved presets as big loadout cards
   - selected preset editor as a side/detail panel
   - custom sprays as a prominent panel
   - identity as smaller secondary panel
5. Account UX:
   - top/right account rail or dropdown
   - visible `+ Account`
   - account modal overlay
   - expired badge/reconnect action

## Commands Used For Verification

Run from `frontend`:

```powershell
npm.cmd run lint
npm.cmd run build
```

Run from `backend`:

```powershell
go build ./...
```

Launch dev app from project root:

```powershell
cd C:\Users\ahais\OneDrive\Desktop\valovault\valovault\frontend
npm run dev -- --hostname 127.0.0.1 --port 33100
```

Backend:

```powershell
cd C:\Users\ahais\OneDrive\Desktop\valovault\valovault\backend
go run .
```

Tauri debug app:

```powershell
C:\Users\ahais\OneDrive\Desktop\valovault\valovault\frontend\src-tauri\target\debug\app.exe
```

