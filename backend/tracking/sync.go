package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
)

// SyncManager is the per-process handle to the Riot sync worker. It
// orchestrates per-puuid syncs with a per-puuid mutex so two
// concurrent calls for the same puuid return (false, inFlight=true).
// Different puuids sync concurrently.
//
// Construct via NewSyncManager. Start is safe to call from any
// goroutine; the actual sync runs in a background goroutine.
type SyncManager struct {
	db       *sql.DB
	fetchRiot func(method, url string, body []byte) ([]byte, error)
	appDir   string

	mu        sync.Mutex
	inFlight  map[string]bool
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
//   started=true,  err=nil      — sync was queued, ran, and finished
//                                 without fatal error.
//   started=false, err=nil      — a sync is already in flight for this
//                                 puuid. Try again later.
//   started=false, err!=nil     — startup failed (DB error, initial
//                                 sync-state read failure, etc.).
//
// The actual sync runs in a goroutine and is non-blocking. Per-row
// fetch errors are logged and skipped — they do NOT abort the whole
// sync (see design doc §4.3).
func (m *SyncManager) Start(puuid, region string) (started bool, err error) {
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
		defer func() {
			m.mu.Lock()
			delete(m.inFlight, puuid)
			m.mu.Unlock()
		}()
		if runErr := m.runOnce(puuid, region); runErr != nil {
			slog.Error("tracking: sync run failed", "puuid", puuid, "err", runErr)
		}
	}()
	return true, nil
}

// runOnce executes a single sync for the given puuid following the
// 9-step algorithm in the design doc §4.2. Errors are logged at each
// step; a hard failure (DB read or parse error in the list) aborts.
func (m *SyncManager) runOnce(puuid, region string) error {
	// Step 1: read sync state.
	state, err := GetSyncState(m.db, puuid)
	if err != nil {
		return fmt.Errorf("read sync state: %w", err)
	}

	// Step 2: compute the batch to fetch.
	endIndex := 100
	if state.LastHistoryEndIndex > 0 {
		endIndex = state.LastHistoryEndIndex + 20
	}
	historyURL := fmt.Sprintf(
		"https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=0&endIndex=%d",
		shardForRegion(region), puuid, endIndex,
	)
	body, err := m.fetchRiot("GET", historyURL, nil)
	if err != nil {
		return fmt.Errorf("fetch match history: %w", err)
	}

	type historyItem struct {
		MatchID       string `json:"MatchID"`
		GameStartTime int64  `json:"GameStartTime"`
		QueueID       string `json:"QueueID"`
	}
	var histResp struct {
		History []historyItem `json:"History"`
	}
	if err := json.Unmarshal(body, &histResp); err != nil {
		return fmt.Errorf("parse history: %w", err)
	}

	// Step 3: dedupe against cache.
	var newIDs []string
	for _, h := range histResp.History {
		if h.MatchID == "" {
			continue
		}
		cached, err := IsMatchCached(m.db, h.MatchID)
		if err != nil {
			slog.Warn("tracking: IsMatchCached error", "matchID", h.MatchID, "err", err)
			continue
		}
		if !cached {
			newIDs = append(newIDs, h.MatchID)
		}
	}

	// Step 4: fetch match-details in parallel, 4-way concurrent.
	eg, _ := errgroup.WithContext(nil)
	eg.SetLimit(4)
	results := make([][]byte, len(newIDs))
	errs := make([]error, len(newIDs))
	for i, id := range newIDs {
		i, id := i, id
		eg.Go(func() error {
			url := fmt.Sprintf(
				"https://pd.%s.a.pvp.net/match-details/v1/matches/%s",
				shardForRegion(region), id,
			)
			b, fetchErr := m.fetchRiot("GET", url, nil)
			if fetchErr != nil {
				errs[i] = fetchErr
				slog.Warn("tracking: getMatchDetails failed", "matchID", id, "err", fetchErr)
				return nil // never abort
			}
			results[i] = b
			return nil
		})
	}
	_ = eg.Wait()

	// Step 5-6: insert each successfully fetched match.
	inserted := 0
	for i, raw := range results {
		if raw == nil {
			continue
		}
		if err := InsertMatchDetails(m.db, m.appDir, newIDs[i], puuid, raw); err != nil {
			slog.Warn("tracking: InsertMatchDetails failed", "matchID", newIDs[i], "err", err)
			continue
		}
		inserted++
	}

	// Step 7: competitive updates for the current season.
	compURL := fmt.Sprintf(
		"https://pd.%s.a.pvp.net/mmr/v1/players/%s/competitiveupdates?startIndex=0&endIndex=100",
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
