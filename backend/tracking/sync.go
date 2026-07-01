package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// SyncManager is the per-process handle to the Riot sync worker. It
// orchestrates per-puuid syncs with a per-puuid mutex so two
// concurrent calls for the same puuid return (false, inFlight=true).
// Different puuids sync concurrently.
//
// Construct via NewSyncManager. Start is safe to call from any
// goroutine; the actual sync runs in a background goroutine.
type SyncManager struct {
	db        *sql.DB
	fetchRiot func(method, url string, body []byte) ([]byte, error)
	appDir    string

	mu       sync.Mutex
	inFlight map[string]bool
	onDone   func(puuid string, err error)
}

type historyItem struct {
	MatchID       string `json:"MatchID"`
	GameStartTime int64  `json:"GameStartTime"`
	QueueID       string `json:"QueueID"`
}

// NewSyncManager builds a SyncManager. `fetchRiot` is the HTTP callback
// used to talk to the Riot PVP API. Pass NewRiotFetcher(headers) for
// production or StaticFetchRiot() for tests. `appDir` is the same
// appConfigDir used to open the tracking DB (needed for raw JSON
// persistence on insert).
func NewSyncManager(db *sql.DB, fetchRiot func(method, url string, body []byte) ([]byte, error), appDir string) *SyncManager {
	return &SyncManager{
		db:        db,
		fetchRiot: fetchRiot,
		appDir:    appDir,
		inFlight:  map[string]bool{},
	}
}

// SetDoneCallback registers a callback that runs when a background
// sync finishes. The API layer uses this to expose per-account errors
// through /v1/profile/sync-status.
func (m *SyncManager) SetDoneCallback(cb func(puuid string, err error)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onDone = cb
}

// InFlight reports whether a sync is currently running for the given
// puuid. Used by the API handler to populate the sync-status
// endpoint without claiming the lock.
func (m *SyncManager) InFlight(puuid string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inFlight[puuid]
}

// Start kicks off a background sync for the given puuid. The return
// tuple is:
//
//	started=true,  err=nil      — sync was queued, ran, and finished
//	                              without fatal error.
//	started=false, err=nil      — a sync is already in flight for this
//	                              puuid. Try again later.
//	started=false, err!=nil     — startup failed (DB error, initial
//	                              sync-state read failure, etc.).
//
// The actual sync runs in a goroutine and is non-blocking. Per-row
// fetch errors are logged and skipped — they do NOT abort the whole
// sync (see design doc §4.3).
func (m *SyncManager) Start(puuid, region string) (started bool, err error) {
	return m.StartWithOptions(puuid, region, false)
}

// StartWithOptions is Start plus an explicit refreshCached mode. When
// refreshCached is true, the recent history window is fetched again even if
// match rows already exist locally. This is useful after parser/schema fixes
// because old cached match_details rows may lack newly captured fields.
func (m *SyncManager) StartWithOptions(puuid, region string, refreshCached bool) (started bool, err error) {
	if puuid == "" {
		return false, fmt.Errorf("tracking: SyncManager.Start: puuid is required")
	}

	m.mu.Lock()
	if m.inFlight[puuid] {
		m.mu.Unlock()
		return false, nil
	}
	m.inFlight[puuid] = true
	m.mu.Unlock()

	// We need a background context (no caller cancellation) and we
	// return synchronously after launching the goroutine. Callers that
	// want "did it finish" should poll InFlight.
	go func() {
		var runErr error
		defer func() {
			m.mu.Lock()
			delete(m.inFlight, puuid)
			cb := m.onDone
			m.mu.Unlock()
			if cb != nil {
				cb(puuid, runErr)
			}
		}()
		if runErr = m.runOnce(puuid, region, refreshCached); runErr != nil {
			slog.Error("tracking: sync run failed", "puuid", puuid, "err", runErr)
		}
	}()
	return true, nil
}

// runOnce executes a single sync for the given puuid following the
// 9-step algorithm in the design doc §4.2. Errors are logged at each
// step; a hard failure (DB read or parse error in the list) aborts.
func (m *SyncManager) runOnce(puuid, region string, refreshCached bool) error {
	// Step 1: read sync state.
	state, err := GetSyncState(m.db, puuid)
	if err != nil {
		return fmt.Errorf("read sync state: %w", err)
	}

	// Step 2: compute the history window and fetch it in Riot's
	// accepted page size. The endpoint rejects wide windows such as
	// 0..100 with MATCH_HISTORY_INVALID_INDICES.
	const pageSize = 20
	endIndex := pageSize
	if state.LastHistoryEndIndex > 0 {
		endIndex = state.LastHistoryEndIndex + pageSize
	}
	var history []historyItem
	for start := 0; start < endIndex; start += pageSize {
		pageEnd := start + pageSize
		if pageEnd > endIndex {
			pageEnd = endIndex
		}
		historyURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=%d&endIndex=%d",
			shardForRegion(region), puuid, start, pageEnd,
		)
		body, err := m.fetchRiot("GET", historyURL, nil)
		if err != nil {
			return fmt.Errorf("fetch match history %d..%d: %w", start, pageEnd, err)
		}
		var histResp struct {
			History []historyItem `json:"History"`
		}
		if err := json.Unmarshal(body, &histResp); err != nil {
			return fmt.Errorf("parse history %d..%d: %w", start, pageEnd, err)
		}
		history = append(history, histResp.History...)
		if len(histResp.History) < pageEnd-start {
			endIndex = pageEnd
			break
		}
	}

	// Ranked games can be buried behind a large all-queue history. Fetch the
	// documented competitive-only lane and use its Total to recover old acts.
	const maxCompetitiveMatches = 200
	for start := 0; start < maxCompetitiveMatches; start += pageSize {
		pageEnd := start + pageSize
		historyURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=%d&endIndex=%d&queue=competitive",
			shardForRegion(region), puuid, start, pageEnd,
		)
		body, fetchErr := m.fetchRiot("GET", historyURL, nil)
		if fetchErr != nil {
			slog.Warn("tracking: competitive match history fetch failed", "startIndex", start, "err", fetchErr)
			break
		}
		var histResp struct {
			Total   int           `json:"Total"`
			History []historyItem `json:"History"`
		}
		if err := json.Unmarshal(body, &histResp); err != nil {
			slog.Warn("tracking: competitive match history parse failed", "startIndex", start, "err", err)
			break
		}
		history = append(history, histResp.History...)
		if len(histResp.History) < pageSize || (histResp.Total > 0 && pageEnd >= histResp.Total) {
			break
		}
	}

	// Step 3: dedupe against cache.
	var newIDs []string
	var refreshIDs []string
	seenIDs := map[string]struct{}{}
	for _, h := range history {
		if h.MatchID == "" {
			continue
		}
		if _, seen := seenIDs[h.MatchID]; seen {
			continue
		}
		seenIDs[h.MatchID] = struct{}{}
		cached, err := IsMatchCached(m.db, h.MatchID)
		if err != nil {
			slog.Warn("tracking: IsMatchCached error", "matchID", h.MatchID, "err", err)
			continue
		}
		if !cached {
			newIDs = append(newIDs, h.MatchID)
		} else if refreshCached {
			refreshIDs = append(refreshIDs, h.MatchID)
		}
	}
	newIDs = append(newIDs, refreshIDs...)

	// Step 4: hydrate a bounded batch sequentially. Riot's match-details
	// endpoint rate-limits burst fan-out; failed IDs remain uncached and are
	// retried by the next sync because history is always rechecked from zero.
	const maxDetailsPerSync = 24
	if len(newIDs) > maxDetailsPerSync {
		newIDs = newIDs[:maxDetailsPerSync]
	}
	results := make([][]byte, len(newIDs))
	for i, id := range newIDs {
		if i > 0 {
			time.Sleep(250 * time.Millisecond)
		}
		url := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/match-details/v1/matches/%s",
			shardForRegion(region), id,
		)
		b, fetchErr := m.fetchRiot("GET", url, nil)
		if fetchErr != nil && strings.Contains(fetchErr.Error(), "status 429") {
			time.Sleep(2 * time.Second)
			b, fetchErr = m.fetchRiot("GET", url, nil)
		}
		if fetchErr != nil {
			slog.Warn("tracking: getMatchDetails failed", "matchID", id, "err", fetchErr)
			if strings.Contains(fetchErr.Error(), "status 429") {
				break
			}
			continue
		}
		results[i] = b
	}

	// Step 5: parse player subjects with empty names and resolve them via name-service.
	var emptyPUUIDs []string
	seenPUUIDs := make(map[string]bool)
	for _, raw := range results {
		if raw == nil {
			continue
		}
		var playerParser struct {
			Players []struct {
				Subject        string `json:"subject"`
				GameName       string `json:"gameName"`
				PlayerIdentity struct {
					GameName string `json:"gameName"`
				} `json:"playerIdentity"`
			} `json:"players"`
		}
		if err := json.Unmarshal(raw, &playerParser); err == nil {
			for _, p := range playerParser.Players {
				if p.GameName == "" && p.PlayerIdentity.GameName == "" {
					puid := strings.ToLower(p.Subject)
					if puid != "" && !seenPUUIDs[puid] {
						seenPUUIDs[puid] = true
						emptyPUUIDs = append(emptyPUUIDs, p.Subject) // Keep original case for Riot API
					}
				}
			}
		}
	}

	resolvedNames := make(map[string]struct{ Name, Tag string })
	if len(emptyPUUIDs) > 0 {
		nameURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/name-service/v2/players",
			shardForRegion(region),
		)
		reqBody, _ := json.Marshal(emptyPUUIDs)
		body, err := m.fetchRiot("PUT", nameURL, reqBody)
		if err == nil {
			var nameResp []struct {
				Subject  string `json:"Subject"`
				GameName string `json:"GameName"`
				TagLine  string `json:"TagLine"`
			}
			if err := json.Unmarshal(body, &nameResp); err == nil {
				for _, r := range nameResp {
					resolvedNames[strings.ToLower(r.Subject)] = struct{ Name, Tag string }{
						Name: r.GameName,
						Tag:  r.TagLine,
					}
				}
			} else {
				slog.Warn("tracking: failed to parse name-service response", "err", err)
			}
		} else {
			slog.Warn("tracking: name-service fetch failed", "err", err)
		}
	}

	// Step 6: insert each successfully fetched match.
	inserted := 0
	for i, raw := range results {
		if raw == nil {
			continue
		}
		if err := InsertMatchDetails(m.db, m.appDir, newIDs[i], puuid, raw, resolvedNames); err != nil {
			slog.Warn("tracking: InsertMatchDetails failed", "matchID", newIDs[i], "err", err)
			continue
		}
		inserted++
	}

	// Step 7: competitive updates for the current season.
	compURL := fmt.Sprintf(
		"https://pd.%s.a.pvp.net/mmr/v1/players/%s/competitiveupdates?startIndex=0&endIndex=20&queue=competitive",
		shardForRegion(region), puuid,
	)
	if cbody, ferr := m.fetchRiot("GET", compURL, nil); ferr == nil {
		m.ingestCompetitiveUpdates(puuid, cbody)
	} else {
		slog.Warn("tracking: competitive updates fetch failed", "err", ferr)
	}

	// Step 8: recompute aggregates for the local player.
	if err := RecomputeAggregates(m.db, puuid); err != nil {
		slog.Warn("tracking: RecomputeAggregates failed", "err", err)
	}

	// Step 8.5: resolve any missing names in the database for older matches.
	resolvedTotal := 0
	for batchCount := 0; batchCount < 20; batchCount++ { // cap at 20 batches of 100 to prevent infinite loop
		var dbEmptyPUUIDs []string
		drows, err := m.db.Query(`
			SELECT DISTINCT subject FROM match_players
			WHERE gameName = '' OR gameName IS NULL
			LIMIT 100
		`)
		if err != nil {
			slog.Warn("tracking: failed to query empty name PUUIDs", "err", err)
			break
		}
		for drows.Next() {
			var sub string
			if err := drows.Scan(&sub); err == nil && sub != "" {
				dbEmptyPUUIDs = append(dbEmptyPUUIDs, sub)
			}
		}
		drows.Close()

		if len(dbEmptyPUUIDs) == 0 {
			break
		}

		nameURL := fmt.Sprintf(
			"https://pd.%s.a.pvp.net/name-service/v2/players",
			shardForRegion(region),
		)
		reqBody, _ := json.Marshal(dbEmptyPUUIDs)
		body, err := m.fetchRiot("PUT", nameURL, reqBody)
		if err != nil {
			slog.Warn("tracking: batch name-service fetch failed", "err", err)
			break
		}

		var nameResp []struct {
			Subject  string `json:"Subject"`
			GameName string `json:"GameName"`
			TagLine  string `json:"TagLine"`
		}
		if err := json.Unmarshal(body, &nameResp); err != nil {
			slog.Warn("tracking: failed to unmarshal batch name-service response", "err", err)
			break
		}

		tx, err := m.db.Begin()
		if err != nil {
			slog.Warn("tracking: failed to begin transaction for name update", "err", err)
			break
		}
		stmt, err := tx.Prepare(`UPDATE match_players SET gameName = ?, tagLine = ? WHERE subject = ?`)
		if err != nil {
			_ = tx.Rollback()
			slog.Warn("tracking: failed to prepare statement for name update", "err", err)
			break
		}

		for _, r := range nameResp {
			_, err = stmt.Exec(r.GameName, r.TagLine, strings.ToLower(r.Subject))
			if err == nil {
				resolvedTotal++
			}
		}
		stmt.Close()
		if err := tx.Commit(); err != nil {
			slog.Warn("tracking: failed to commit transaction for name update", "err", err)
			break
		}
	}
	if resolvedTotal > 0 {
		slog.Info("tracking: background name resolution complete", "resolvedCount", resolvedTotal)
	}

	// Step 9: update sync state.
	if err := MarkSynced(m.db, puuid, endIndex); err != nil {
		slog.Warn("tracking: MarkSynced failed", "err", err)
	}

	slog.Info("tracking: sync complete", "puuid", puuid, "fetched", inserted, "endIndex", endIndex)
	return nil
}

// ingestCompetitiveUpdates parses a /competitiveupdates response and
// INSERT OR IGNOREs each row. RR history is append-only.
func (m *SyncManager) ingestCompetitiveUpdates(puuid string, raw []byte) {
	var resp struct {
		Matches []struct {
			MatchID                  string `json:"MatchID"`
			SeasonID                 string `json:"SeasonID"`
			MatchStartTime           int64  `json:"MatchStartTime"`
			TierAfterUpdate          int    `json:"TierAfterUpdate"`
			TierBeforeUpdate         int    `json:"TierBeforeUpdate"`
			RankedRatingAfterUpdate  int    `json:"RankedRatingAfterUpdate"`
			RankedRatingBeforeUpdate int    `json:"RankedRatingBeforeUpdate"`
			RankedRatingEarned       int    `json:"RankedRatingEarned"`
			AFKPenalty               int    `json:"AFKPenalty"`
		} `json:"Matches"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		slog.Warn("tracking: parse competitive updates", "err", err)
		return
	}
	for _, r := range resp.Matches {
		if r.MatchID == "" {
			continue
		}
		snap := RRSnapshot{
			Puuid:          puuid,
			MatchID:        r.MatchID,
			SeasonID:       r.SeasonID,
			TierBefore:     r.TierBeforeUpdate,
			TierAfter:      r.TierAfterUpdate,
			RRBefore:       r.RankedRatingBeforeUpdate,
			RRAfter:        r.RankedRatingAfterUpdate,
			RREarned:       r.RankedRatingEarned,
			AFKPenalty:     r.AFKPenalty,
			MatchStartTime: r.MatchStartTime,
		}
		if err := InsertRRSnapshotIfAbsent(m.db, snap); err != nil {
			slog.Warn("tracking: InsertRRSnapshotIfAbsent failed", "matchID", r.MatchID, "err", err)
		}
	}
}

// shardForRegion maps the user-facing region string (passed via
// X-Riot-Region) to a pd shard. Mirrors getShardFromRegion in
// backend/handlers/remote.go.
func shardForRegion(region string) string {
	switch strings.ToLower(region) {
	case "na", "latam", "br":
		return "na"
	case "eu":
		return "eu"
	case "ap":
		return "ap"
	case "kr":
		return "kr"
	default:
		return "na"
	}
}
