# ValoVault Bug Investigation & Diagnostic Report

This report documents the root causes of the critical bugs identified in the **ValoVault** application, focusing on the profile rank/RR synchronization issues, storefront re-authentication failures, and WebView login window lockups.

---

## 1. Storefront Re-authentication / Account Refresh Bug

### Symptom
When the active Riot account's token expires, refreshing the session via the **Account Manager** or manual login fails to restore live storefront access. The storefront continues to display the `"Riot Session Expired"` warning even after a successful login.

### Root Cause
In `DataContext.tsx`, the `refreshAccountToken` function handles token re-authentication (both silently via SSID cookies and via the WebView popup). When the re-authentication succeeds and new tokens are retrieved:
1. It updates the account's state in memory and saves the updated account array to the list of accounts (`localStorage.setItem("riot_accounts")`).
2. **Crucially, it never calls `activateAccount(updatedAcc)` or updates the standalone localStorage keys (`riot_access_token`, `riot_entitlements`).**
3. When `fetchWithAuth` (defined in `api.ts`) sends subsequent API requests (like fetching the storefront), it reads the credentials directly from the individual `riot_access_token` and `riot_entitlements` keys in `localStorage`.
4. Because these keys still hold the old, expired tokens, the storefront requests continue to fail with `401 Unauthorized` in the background.

### Fix
Call `activateAccount` inside `refreshAccountToken` whenever new tokens are successfully saved.

---

## 2. WebView Login Window Timeout and App Lockup Bugs

### Symptoms
- If a user takes more than 10 seconds to enter their credentials in the login popup, the process fails and aborts, even if the window is fully visible.
- If the user closes the login window manually without logging in, the app remains permanently stuck in a "Refreshing..." lock state, and the login window cannot be opened again without restarting the application.

### Root Causes
1. **Unconditional Timeout Abort**: In `refreshAccountToken`, a `setTimeout` of 10,000ms is registered. If the login process is visible, the timeout still triggers and calls `finish(false)`, which unsubscribes the redirect listener and marks the attempt as failed. If the user finishes logging in after 10 seconds, the redirect event is ignored.
2. **Missing Closed-Window Listener during Login**: The application only listens for the `"riot-login-closed"` event *after* a successful redirect has already occurred (to flush cookies). If the user closes the window *before* redirecting, the event is never caught. The mutex lock (`globalRefreshInFlightRef.current` and `refreshInFlightRef.current`) is never cleared, locking the user out of all future refresh attempts.

### Fixes
- Disable or adjust the 10-second abort timeout so that it only handles the transition from silent to visible state and does not abort active visible sessions.
- Register the `"riot-login-closed"` listener in parallel with `"riot-login-redirect"` so manual cancellations release the locks and resolve the re-authentication promise.

---

## 3. Stale Rank and RR Display / Multiple Syncs Bug

### Symptom
When syncing the profile, the correct rank and RR are not shown. The user is forced to hit the sync button multiple times to get the UI to display the correct competitive rank and RR.

### Root Cause
1. **Lack of `puuid` in `rr_snapshots`**: The `rr_snapshots` database table only has `matchID` as its primary key and does not store the player's PUUID.
2. **Forced Join on `match_players`**: Because there is no `puuid` in `rr_snapshots`, queries to retrieve the player's rank overview or snapshots (in `GetOverview` and `GetRRSnapshots`) are forced to join `rr_snapshots` with `match_players` on `matchID` and filter by `mp.subject = ?`.
3. **Stale Match Cache**: `match_players` is only populated when a match's details are downloaded and cached. The sync process only downloads details for the most recent 20 matches of the player's history (a single page).
4. If a player plays other non-competitive modes (Swiftplay, Unrated, etc.), their last competitive match will be pushed past the first 20 matches of their history page.
5. In this case, the competitive match details are never fetched or cached in `match_players` during the first sync. Thus, the join fails, and the latest competitive snapshot in `rr_snapshots` is ignored, showing the wrong rank/RR.
6. **Why Multiple Syncs Work**: Each sync increments the history window end-index by 20 (`LastHistoryEndIndex + 20`). By syncing multiple times, the window expands (40, 60, etc.) until it finally reaches the old competitive match, fetches its details, populates `match_players`, and allows the join to succeed.

### Fixes
- Add a `puuid` column to the `rr_snapshots` table and define a compound primary key `(puuid, matchID)`.
- Populate `puuid` when ingesting snapshots.
- Remove the dependency on `match_players` joins inside `GetOverview` and `GetRRSnapshots` by querying `puuid` directly.

---

## 4. Multi-Account Competitive Leakage Bug

### Symptom
If a user switches between multiple Riot accounts that have played in the same matches, competitive details (like RR change and tier after updates) leak or overlap between the accounts.

### Root Cause
In `ListCachedMatches` (`db.go`), the query joins `rr_snapshots` purely on `matchID`:
```sql
LEFT JOIN rr_snapshots rr ON rr.matchID = m.matchID
```
If multiple accounts have competitive snapshots for the same match, the database query will return whichever snapshot matches first, regardless of which account is active.

### Fix
Join `rr_snapshots` on both `matchID` and `puuid` (i.e. `rr.matchID = m.matchID AND rr.puuid = mp.subject`).

---

## 5. Early Return in Live MMR Fallbacks

### Symptom
If a player has not played any competitive games in the current act, the competitive section in `QueueSkills` is empty. The backend returns early, completely ignoring the `LatestCompetitiveUpdate` block which still holds their last known rank from the previous act.

### Root Cause
In `applyLiveMMRToOverview` (`profile.go`), the validation check:
```go
comp, ok := live.QueueSkills["competitive"]
if !ok {
    return
}
```
runs *before* processing `live.LatestCompetitiveUpdate`. 

### Fix
Move the `LatestCompetitiveUpdate` parsing and fallback tier name calculations *above* the `QueueSkills["competitive"]` check.
