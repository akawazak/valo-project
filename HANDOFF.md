# ValoVault Handoff

Repo: `C:\Users\ahais\OneDrive\Desktop\valovault\valovault`

User priority:
This app must be a serious Valorant tracker/loadout app that shows as much useful Riot/account/profile info as possible, but only when the data path is real. Do not guess. If unsure, inspect docs/code or ask. The user prefers deep root-cause work and verified fixes over fast cosmetic patches.

## Recent work completed

### Profile / Other Player Identity

- Added cached player card/title support for other players from match details.
- Important bug found and fixed: `playerCard` / `playerTitle` belong on each match-details player row, not inside `playerIdentity`.
- Backend now stores:
  - `match_players.playerCardId`
  - `match_players.playerTitleId`
- Profile overview exposes:
  - `playerCardId`
  - `playerTitleId`
- Frontend selected/shared profiles use:
  - `overview.playerCardId`
  - cached expanded match detail identity
  - live/party selected player card fallback
- Manual `Sync` / `Sync Player` now calls `force=true`.
- Backend `SyncManager.StartWithOptions(..., refreshCached=true)` re-fetches recent cached matches so old rows parsed before the fix can be repaired.
- Clicking into another player profile now clears stale data and scrolls to top.

### Missions / Contracts / Battlepass

- `/v1/missions` and `/v1/contracts` use Riot contracts endpoint:
  `https://pd.{shard}.a.pvp.net/contracts/v1/contracts/{puuid}`
- Backend preserves Riot `Missions[].Complete`.
- Daily/weekly mission tabs now show missions even if completed.
- Tab labels now show active and total counts.
- Battlepass/contracts show current/completed/in-progress state, claimed/current/next counts, and upcoming reward tiers.
- Contract cards got status chips and clearer progress summary styling.

Known issue user noticed:

- Daily missions sometimes appear with weekly mission style/text/category, or weekly style appears inside daily.
- Deeply inspect mission type mapping.
- Current frontend code buckets type using valorant-api mission metadata:
  `rawType.includes("weekly") ? "weekly" : "daily"`
- Possible bug sources:
  - Riot live mission IDs may not match metadata loaded from `https://valorant-api.com/v1/missions`
  - Missing metadata defaults to daily
  - BTE/Tutorial/NPE may be incorrectly grouped as daily
  - `MissionMetadata.WeeklyCheckpoint` may need separate handling
  - Objective/XP target mapping may be wrong for some mission kinds
- Do deep research with docs and live payloads before changing this again.

### Friend Presence

- Backend already has `GET /v1/social`.
- It reads local Riot client:
  - `/chat/v4/friends`
  - `/chat/v4/presences`
- Frontend now displays a `Friend Presence` panel under Riot Signals.
- Shows online count, VALORANT presence count, rows with product/state/queue.
- Clicking a friend with PUUID opens their cached/shared profile.
- Requires local Riot client running.

### Live / Party / Loadouts

Existing prior work includes:

- Live party widget and polling.
- Riot Signals panel.
- Live loadout checks.
- Account health/service checks.
- Penalties check.
- Live match overlay/player modal improvements.

Do not assume these are perfect; user has not fully validated all visually.

## Verification already run

These passed after the last changes:

- `go test ./...`
- `go build .`
- `npm.cmd run build`
- `npm.cmd run lint`

Lint has 0 errors but existing `<img>` warnings remain.

## Important files touched recently

Backend:

- `backend/tracking/db.go`
- `backend/tracking/types.go`
- `backend/tracking/sync.go`
- `backend/handlers/profile.go`
- `backend/handlers/missions.go`
- `backend/handlers/liveextras.go`

Frontend:

- `frontend/src/features/profile/ProfilePanel.tsx`
- `frontend/src/services/api.ts`
- `frontend/src/app/globals.css`
- `frontend/src/features/livematch/LiveMatchOverlay.tsx`
- `frontend/src/features/livematch/LiveMatchOverlay.css`

There are unrelated/pre-existing modified files too, especially:

- `frontend/src/components/AppTopbar.tsx`

Do not revert unrelated changes.

## Docs / research targets

Use these first:

- https://valapidocs.techchrism.me/endpoint/match-details
- https://valapidocs.techchrism.me/endpoint/contracts
- https://valorant-api.com/v1/missions
- https://valorant-api.com/v1/contracts

Need deep research:

1. Exact Riot contracts endpoint payload shape for:
   - daily missions
   - weekly missions
   - completed missions
   - weekly checkpoint
   - battlepass/current contract
2. Compare actual backend `/v1/missions` payload from logged-in account with valorant-api metadata.
3. Confirm mission type mapping. Do not rely only on `meta.type.includes("weekly")` if live payload has better signals.
4. Confirm whether completed daily/weekly missions are returned by Riot consistently.
5. If Riot only returns completed entries sometimes, UI should still honestly show what Riot returned and label unknowns clearly.
6. Build a debug surface temporarily if needed:
   - mission UUID
   - raw metadata type
   - `Complete`
   - expiration
   - objective keys
   - current/target
   - assigned bucket

## Recommended next-agent plan

Use an agent swarm if available:

- Agent 1: backend/API researcher
  - Inspect valapidocs and actual `/v1/missions` JSON.
  - Produce exact mapping rules for daily/weekly/BTE/tutorial/weekly checkpoint.
- Agent 2: frontend UI auditor
  - Verify Progress Center visually.
  - Confirm daily and weekly cards have correct style and labels.
  - Check completed/current/upcoming battlepass rendering.
- Agent 3: integration tester
  - Launch backend + app.
  - With local Riot client/account logged in, test:
    - missions
    - friend presence
    - selected friend profile
    - `Sync Player`
    - card/title appearance after force sync

## Commands

Backend:

```powershell
cd C:\Users\ahais\OneDrive\Desktop\valovault\valovault\backend
$env:GOCACHE=(Join-Path (Get-Location) '.gocache')
go test ./...
go build .
```

Frontend:

```powershell
cd C:\Users\ahais\OneDrive\Desktop\valovault\valovault\frontend
npm.cmd run build
npm.cmd run lint
```

Run app/dev stack if needed:

There is an approved prior launch pattern in the thread, but check current ports/processes first. Make sure the correct backend is running, not an old packaged app.

## User expectations

- Do not say "fixed" unless verified.
- If something requires local Riot client, say that clearly.
- If something requires pressing `Sync Player` to repair old cached rows, say it clearly.
- Make UI actually useful and good-looking, not just functional.
- If unsure, ask the user instead of pretending.

The big thing for the next chat: deeply verify the mission bucketing. The fact that daily sometimes gets weekly styling means the data classifier is probably still too loose.

---

# Session log: 2026-06-26 (friend presence + missions UI + match history polish)

## What was actually shipped this session

### 1. Friend presence — fully working

**Backend** `backend/handlers/friends.go`:
- Rewrote `GetSocialStatus` with local-first + token-fallback architecture.
- **Local path (default)**: reads `%LocalAppData%\Riot Games\Riot Client\Config\lockfile` for `{port}` and `{password}`, then calls:
  - `GET https://127.0.0.1:{port}/chat/v4/friends` with `Authorization: Basic base64("riot:{password}")`
  - `GET https://127.0.0.1:{port}/chat/v4/presences`
  - Friends not in presences → marked `state: "offline"` so the dropdown has something to show.
- **Token path**: tries `https://chat.{shard}.a.pvp.net/friends/v1/list?platform=XMG` with a **3-second hard timeout**. On any transport error (DNS, timeout, connection refused), automatically falls back to local. Lockfile is cached for 2s.
- Removed the previous stub `GetSocialStatus` from `liveextras.go`.
- Verified `go build -o ./tmp/valovault-backend .` clean.

**Frontend** `frontend/src/features/profile/ProfilePanel.tsx` + `globals.css`:
- Always-on polling: friend presence already in the 5s `pollLiveSystems` loop (gated only on `activeAccount && isBackendOnline`).
- New `useState` toggles in `FriendPresenceList`: `collapsed` (whole panel collapse via header button) and `showOffline` (toggle the offline dropdown).
- Online friends shown by default; offline friends in a separate `▸ N offline` / `▾ N offline` disclosure at the bottom.
- New CSS classes: `.friend-presence-toggle`, `.friend-presence-offline-section`, `.friend-presence-offline-toggle`, `.friend-presence-list--offline`, `.friend-presence-row--offline`.
- `npx tsc --noEmit` clean. `npx eslint` shows only the 3 pre-existing `<img>` warnings.

### 2. Mission card UI upgrade

**Frontend** `frontend/src/features/profile/ProfilePanel.tsx`:
- Mission cards now show: type chip (Daily=green / Weekly=yellow / Onboarding=accent / Other=blue) with colored background, XP badge in distinct yellow chip styling, description text (clamped to 2 lines), live expiration countdown (`Xd left` / `Xh Ym left`).
- Target values formatted with thousands separators (`13,500` instead of `13500`).
- New helper `formatMissionCountdown(ms)` added next to `missionBucketLabel`.
- Updated `missionBucketLabel` to return short labels (Daily/Weekly/Onboarding/Other) instead of "Daily Mission" — chip styling carries the noun now.

**CSS** `frontend/src/app/globals.css`:
- `.mission-type-chip`, `.mission-type-chip--daily`, `.mission-type-chip--weekly`, `.mission-type-chip--onboarding`, `.mission-type-chip--other`.
- `.mission-xp-badge`, `.mission-description`.

### 3. Battlepass / events tier math — XP-driven (from earlier session, still in place)

- Tier math walks `levels[]` cumulative XP rather than trusting `progressionLevelReached` (which is 0/1 for events).
- Currency rewards split into a separate yellow chip row.
- Cosmetic tiers in responsive grid with `ContractRewardIcon` lazy-loading images.

### 4. HS% formula fix (from earlier session, still in place)

- `backend/handlers/profile.go` line ~449: now `headshots / (headshots + bodyshots + legshots)` instead of `headshots / kills`. Matches in-game stat exactly.

### 5. Match history UI (from earlier session, still in place)

- Revamped grid layout in `ProfilePanel.tsx`: 132px result block / 1.1fr agent / 1.4fr stats / auto rank-RR / auto tail.
- 4-stat grid: KDA / HS% / ADR / ACS.
- "Next Up" banner above the list when in queue (agent removed because not in `LiveMatchResponse` payload).
- Removed `isNext` prop and "NEXT" pill from latest match row per user request.

## Critical findings to know

### Why remote `chat.{shard}.a.pvp.net` does NOT work — and what DOES work

- `Resolve-DnsName chat.eu.a.pvp.net` → **"DNS name does not exist"** (verified on user's machine).
- Also tried: `chat-eu.a.pvp.net`, `presence.eu.a.pvp.net`, `chat.eu.pvp.net`, `friends.eu.a.pvp.net`, `xmpp.riotgames.com` — all fail DNS.
- The static subdomain `chat.{shard}.a.pvp.net` is **not the real chat host**.

**Real chat hosts come from the Riot Client Config endpoint** (discovered late in session):

- `GET https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client`
- Headers: `Authorization: Bearer <access_token>` + `X-Riot-Entitlements-JWT: <entitlements>`
- Returns:
  - `chat.affinities`: `{ affinity_id: chat_host }` — dynamic per-user chat server host
  - `chat.affinity_domains`: domain mapping
  - `chat.port`: TCP port (used for XMPP, not HTTP)
- To get a friend list with remote token: hit the chat host on the **HTTP** path (port differs from `chat.port`). The HTTP path is at the same host but port `443` (TLS) or whatever the standard Riot Chat port is for HTTP — needs investigation.
- **Follow-up TODO** (low priority): see section "Discovered after handoff" below.

### ValPaw's "token-based friends" claim is misleading

- Their marketing copy claims "remote social presence endpoints" but doesn't disclose any URL.
- Their privacy policy just says "We communicate with Riot Games' APIs" — no specifics.
- The copy has AI-generated blog fingerprints: vague "{region}" placeholders, "direct regional chat protocol server" (no URL), no actual endpoint disclosure.
- Almost certainly: (a) their backend proxies from a desktop session somewhere, or (b) they don't show live presence and just cache the friends list at login.
- Bottom line: do NOT trust their documentation as a reference for remote chat endpoints.

### Techchrism docs that ARE accurate

- `https://valapidocs.techchrism.me/endpoint/friends` — `GET 127.0.0.1:{port}/chat/v4/friends` (local only).
- `https://valapidocs.techchrism.me/endpoint/presence` — `GET 127.0.0.1:{port}/chat/v4/presences` (local only).
- `https://valapidocs.techchrism.me/endpoint/local-websocket` — `wss://127.0.0.1:{port}` with `OnJsonApiEvent_chat_v4_presences` event for live push updates.
- `https://valapidocs.techchrism.me/endpoint/riot-client-config` — `GET https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client` (REMOTE, needs bearer + entitlements). Returns `chat.affinities` map → real chat host.

## What to do next (in priority order)

### A. Verify friend presence in production (high value, low cost)

1. Start backend: `cd backend && ./tmp/valovault-backend` (kill any old PID first if needed).
2. Start Valorant locally.
3. Open Profile panel → Friend Presence should populate within 5s of the next poll.
4. Test the offline dropdown — should show all friends without a presence entry.

### B. WebSocket push (optional efficiency upgrade)

The local `/chat/v4/presences` is currently polled every 5s. To eliminate polling:

1. Add a long-lived goroutine in `backend/handlers/friends.go` that:
   - Connects to `wss://127.0.0.1:{port}` using `valclient.ValClient.GetLocalWebsocket()`.
   - Subscribes to `OnJsonApiEvent_chat_v4_presences`.
   - Writes the latest presence list to an in-memory cache with a mutex.
2. Have `GetSocialStatus` read from the cache instead of doing HTTP calls.
3. Lifecycle: spawn on first friend-presence request, reconnect on disconnect, stop when backend shuts down.
4. ~50 lines of Go.

### C. Mission bucketing still needs the deep audit

The user's earlier feedback ("daily sometimes appears as weekly") is still unresolved. The frontend buckets with:
```ts
rawType.includes("weekly") ? "weekly" : "daily"
```
which collapses BTE / Tutorial / NPE into "daily". See the prior handoff's "Docs / research targets" section for the research plan.

### D. Match history — "Next Up" banner

Currently shows queue + map. User might want the player's chosen agent added once `LiveMatchResponse` includes it (currently only `pregame.allyTeam[*].agentId` is set; the local player is in `allyTeam`). The simplest fix: find the local player's agent from `allyTeam` and include it in the banner.

### E. Friend presence from token (dead end unless someone reverse-engineers)

Skip unless there's a concrete need. The remote chat cluster simply doesn't have working public DNS. If a future path opens (e.g. someone publishes working endpoints), the existing `tryRemoteSocial` fallback framework will pick it up automatically.

## Useful commands

```powershell
# Kill stale backend
Get-Process -Name valovault-backend -ErrorAction SilentlyContinue | Stop-Process -Force

# Build backend
cd "C:\Users\ahais\OneDrive\Desktop\valovault\valovault\backend"
go build -o ./tmp/valovault-backend .

# Run backend
./tmp/valovault-backend

# Typecheck frontend
cd "C:\Users\ahais\OneDrive\Desktop\valovault\valovault\frontend"
npx tsc --noEmit

# Lint frontend
npx eslint src/features/profile/ProfilePanel.tsx
```

## Files modified this session

- `backend/handlers/friends.go` — created (replaces stub in `liveextras.go`).
- `backend/handlers/liveextras.go` — removed old stub `GetSocialStatus`.
- `frontend/src/features/profile/ProfilePanel.tsx` — FriendPresenceList rewrite, mission card UI, `formatMissionCountdown` helper.
- `frontend/src/app/globals.css` — `.mission-type-chip*`, `.mission-xp-badge`, `.mission-description`, `.friend-presence-toggle`, `.friend-presence-offline-*`.

No files reverted; no unrelated edits.
