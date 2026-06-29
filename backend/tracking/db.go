package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// schemaSQL is the full tracking schema, lifted verbatim from
// valovault/.mavis/plans/tracking-design.md §1. It is applied
// idempotently on every OpenTrackingDB call — all CREATE statements
// use IF NOT EXISTS.
const schemaSQL = `
CREATE TABLE IF NOT EXISTS matches (
    matchID            TEXT    NOT NULL PRIMARY KEY,
    queueID            TEXT    NOT NULL,
    mapID              TEXT    NOT NULL,
    gameMode           TEXT    NOT NULL,
    isRanked           INTEGER NOT NULL DEFAULT 0,
    gameStartMillis    INTEGER NOT NULL,
    seasonId           TEXT    NOT NULL,
    gameLengthMillis   INTEGER NOT NULL DEFAULT 0,
    completionState    TEXT    NOT NULL DEFAULT 'Completed',
    blueWins           INTEGER NOT NULL DEFAULT 0,
    blueRoundsWon      INTEGER NOT NULL DEFAULT 0,
    redRoundsWon       INTEGER NOT NULL DEFAULT 0,
    rawJsonPath        TEXT    NOT NULL,
    cachedAt           INTEGER NOT NULL,
    accountPuuid       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_account_start      ON matches(accountPuuid, gameStartMillis DESC);
CREATE INDEX IF NOT EXISTS idx_matches_account_queue_start ON matches(accountPuuid, queueID, gameStartMillis DESC);
CREATE INDEX IF NOT EXISTS idx_matches_account_season      ON matches(accountPuuid, seasonId);

CREATE TABLE IF NOT EXISTS match_players (
    matchID         TEXT    NOT NULL,
    subject         TEXT    NOT NULL,
    teamId          TEXT    NOT NULL,
    partyId         TEXT    NOT NULL DEFAULT '',
    gameName        TEXT    NOT NULL DEFAULT '',
    tagLine         TEXT    NOT NULL DEFAULT '',
    playerCardId    TEXT    NOT NULL DEFAULT '',
    playerTitleId   TEXT    NOT NULL DEFAULT '',
    characterId     TEXT    NOT NULL,
    accountLevel    INTEGER NOT NULL DEFAULT 0,
    competitiveTier INTEGER NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    assists         INTEGER NOT NULL DEFAULT 0,
    score           INTEGER NOT NULL DEFAULT 0,
    headshots       INTEGER NOT NULL DEFAULT 0,
    bodyshots       INTEGER NOT NULL DEFAULT 0,
    legshots        INTEGER NOT NULL DEFAULT 0,
    damageDealt     INTEGER NOT NULL DEFAULT 0,
    roundsPlayed    INTEGER NOT NULL DEFAULT 0,
    isLocal         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (matchID, subject)
);
CREATE INDEX IF NOT EXISTS idx_match_players_subject ON match_players(subject);

CREATE TABLE IF NOT EXISTS rr_snapshots (
    puuid          TEXT    NOT NULL DEFAULT '',
    matchID        TEXT    NOT NULL,
    seasonId       TEXT    NOT NULL,
    tierBefore     INTEGER NOT NULL DEFAULT 0,
    tierAfter      INTEGER NOT NULL DEFAULT 0,
    rrBefore       INTEGER NOT NULL DEFAULT 0,
    rrAfter        INTEGER NOT NULL DEFAULT 0,
    rrEarned       INTEGER NOT NULL DEFAULT 0,
    afkPenalty     INTEGER NOT NULL DEFAULT 0,
    matchStartTime INTEGER NOT NULL,
    PRIMARY KEY (puuid, matchID)
);
CREATE INDEX IF NOT EXISTS idx_rr_snapshots_season_time ON rr_snapshots(seasonId, matchStartTime);

CREATE TABLE IF NOT EXISTS agent_stats (
    puuid            TEXT    NOT NULL,
    characterId      TEXT    NOT NULL,
    queue            TEXT    NOT NULL DEFAULT 'all',
    matches          INTEGER NOT NULL DEFAULT 0,
    wins             INTEGER NOT NULL DEFAULT 0,
    kills            INTEGER NOT NULL DEFAULT 0,
    deaths           INTEGER NOT NULL DEFAULT 0,
    assists          INTEGER NOT NULL DEFAULT 0,
    headshots        INTEGER NOT NULL DEFAULT 0,
    timePlayedMillis INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (puuid, characterId, queue)
);
CREATE INDEX IF NOT EXISTS idx_agent_stats_puuid_queue_matches ON agent_stats(puuid, queue, matches DESC);

CREATE TABLE IF NOT EXISTS map_stats (
    puuid   TEXT    NOT NULL,
    mapID   TEXT    NOT NULL,
    queue   TEXT    NOT NULL DEFAULT 'all',
    matches INTEGER NOT NULL DEFAULT 0,
    wins    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (puuid, mapID, queue)
);
CREATE INDEX IF NOT EXISTS idx_map_stats_puuid_queue_matches ON map_stats(puuid, queue, matches DESC);

CREATE TABLE IF NOT EXISTS sync_state (
    puuid               TEXT    NOT NULL PRIMARY KEY,
    lastSyncedAt        INTEGER NOT NULL DEFAULT 0,
    lastHistoryEndIndex INTEGER NOT NULL DEFAULT 0
);
`

const sqliteDriverName = "sqlite"

// OpenTrackingDB opens (or creates) the tracking SQLite database at
// <appConfigDir>/valovault/tracking.db, ensures the surrounding
// directory exists, and applies the full schema idempotently.
//
// The returned *sql.DB is safe for concurrent use; the caller is
// responsible for Close()ing it.
func OpenTrackingDB(appConfigDir string) (*sql.DB, error) {
	if strings.TrimSpace(appConfigDir) == "" {
		return nil, fmt.Errorf("tracking: appConfigDir is required")
	}
	dir := filepath.Join(appConfigDir, "valovault")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("tracking: mkdir %s: %w", dir, err)
	}
	dsn := filepath.Join(dir, "tracking.db")

	db, err := sql.Open(sqliteDriverName, dsn+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("tracking: open %s: %w", dsn, err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("tracking: ping %s: %w", dsn, err)
	}
	if err := migrateRRSnapshotsTable(db); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("tracking: migrate rr_snapshots: %w", err)
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("tracking: apply schema: %w", err)
	}
	if err := ensureMatchPlayerNameColumns(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

func migrateRRSnapshotsTable(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(rr_snapshots)")
	if err != nil {
		return nil
	}
	defer rows.Close()

	hasPuuid := false
	hasTable := false
	for rows.Next() {
		hasTable = true
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if strings.EqualFold(name, "puuid") {
			hasPuuid = true
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if hasTable && !hasPuuid {
		if _, err := db.Exec(`
			ALTER TABLE rr_snapshots RENAME TO rr_snapshots_legacy;
			CREATE TABLE rr_snapshots (
			    puuid TEXT NOT NULL,
			    matchID TEXT NOT NULL,
			    seasonId TEXT NOT NULL,
			    matchStartTime INTEGER NOT NULL,
			    tierAfter INTEGER NOT NULL DEFAULT 0,
			    rrBefore INTEGER NOT NULL DEFAULT 0,
			    rrAfter INTEGER NOT NULL DEFAULT 0,
			    rrEarned INTEGER NOT NULL DEFAULT 0,
			    PRIMARY KEY (puuid, matchID)
			);
			INSERT OR IGNORE INTO rr_snapshots
			    (puuid, matchID, seasonId, matchStartTime, tierAfter, rrBefore, rrAfter, rrEarned)
			SELECT
			    COALESCE((
			        SELECT mp.subject
			        FROM match_players mp
			        WHERE mp.matchID = legacy.matchID
			        ORDER BY mp.subject ASC
			        LIMIT 1
			    ), ''),
			    legacy.matchID,
			    legacy.seasonId,
			    legacy.matchStartTime,
			    legacy.tierAfter,
			    legacy.rrBefore,
			    legacy.rrAfter,
			    legacy.rrEarned
			FROM rr_snapshots_legacy legacy
			WHERE COALESCE((
			        SELECT mp.subject
			        FROM match_players mp
			        WHERE mp.matchID = legacy.matchID
			        ORDER BY mp.subject ASC
			        LIMIT 1
			    ), '') <> '';
			DROP TABLE rr_snapshots_legacy;
		`); err != nil {
			return fmt.Errorf("migrate legacy rr_snapshots: %w", err)
		}
	}
	return nil
}

func ensureMatchPlayerNameColumns(db *sql.DB) error {
	if err := addColumnIfMissing(db, "match_players", "partyId", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "match_players", "gameName", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "match_players", "tagLine", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumnIfMissing(db, "match_players", "playerCardId", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	return addColumnIfMissing(db, "match_players", "playerTitleId", "TEXT NOT NULL DEFAULT ''")
}

func addColumnIfMissing(db *sql.DB, table, column, definition string) error {
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return fmt.Errorf("tracking: inspect %s columns: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("tracking: scan %s columns: %w", table, err)
		}
		if strings.EqualFold(name, column) {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("tracking: read %s columns: %w", table, err)
	}
	if _, err := db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition); err != nil {
		return fmt.Errorf("tracking: add %s.%s: %w", table, column, err)
	}
	return nil
}

// RawMatchesDir returns the on-disk directory where InsertMatchDetails
// persists raw Riot JSON. Exposed so tests and the sync worker can
// mirror the same path the API responses point at.
func RawMatchesDir(appConfigDir string) string {
	return filepath.Join(appConfigDir, "valovault", "raw_matches")
}

// IsMatchCached reports whether the given matchID already has a row
// in `matches` (regardless of age). Used by the sync worker to skip
// Riot detail fetches for matches we already have.
func IsMatchCached(db *sql.DB, matchID string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(1) FROM matches WHERE matchID = ?`, matchID).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("tracking: IsMatchCached: %w", err)
	}
	return n > 0, nil
}

// InsertMatchDetails persists a raw Riot MatchDetailsResponse to
// <appConfigDir>/valovault/raw_matches/<matchID>.json AND inserts/updates
// the `matches` and `match_players` rows parsed from it.
//
// The raw JSON is written to disk BEFORE the DB transaction so a
// partial disk failure doesn't leave us with DB rows pointing at a
// missing file. Insertion is atomic per (match, players) tuple.
// Existing rows for the same matchID are overwritten.
func InsertMatchDetails(db *sql.DB, appConfigDir, matchID, puuid string, raw []byte, resolvedNames map[string]struct{ Name, Tag string }) error {
	if matchID == "" {
		return fmt.Errorf("tracking: InsertMatchDetails: matchID is required")
	}
	if puuid == "" {
		return fmt.Errorf("tracking: InsertMatchDetails: puuid is required")
	}
	if len(raw) == 0 {
		return fmt.Errorf("tracking: InsertMatchDetails: raw is empty")
	}

	// 1. Persist raw JSON to disk.
	rawDir := RawMatchesDir(appConfigDir)
	if err := os.MkdirAll(rawDir, 0o755); err != nil {
		return fmt.Errorf("tracking: mkdir raw_matches: %w", err)
	}
	rawPath := filepath.Join(rawDir, matchID+".json")
	if err := os.WriteFile(rawPath, raw, 0o644); err != nil {
		return fmt.Errorf("tracking: write raw json: %w", err)
	}

	// 2. Parse the raw JSON.
	parsed, err := parseMatchDetails(raw, puuid, resolvedNames)
	if err != nil {
		return fmt.Errorf("tracking: parse match details: %w", err)
	}

	// 3. INSERT OR REPLACE both tables in a single transaction.
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("tracking: begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	cachedAt := time.Now().UnixMilli()
	_, err = tx.Exec(`
		INSERT OR REPLACE INTO matches
		    (matchID, queueID, mapID, gameMode, isRanked, gameStartMillis, seasonId,
		     gameLengthMillis, completionState, blueWins, blueRoundsWon, redRoundsWon,
		     rawJsonPath, cachedAt, accountPuuid)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		parsed.Match.MatchID,
		parsed.Match.QueueID,
		parsed.Match.MapID,
		parsed.Match.GameMode,
		boolToInt(parsed.Match.IsRanked),
		parsed.Match.GameStartMillis,
		parsed.Match.SeasonID,
		parsed.Match.GameLengthMillis,
		parsed.Match.CompletionState,
		boolToInt(parsed.Match.BlueWins),
		parsed.Match.BlueRoundsWon,
		parsed.Match.RedRoundsWon,
		rawPath,
		cachedAt,
		puuid,
	)
	if err != nil {
		return fmt.Errorf("tracking: insert match: %w", err)
	}

	// Wipe existing players for this match (handles re-insert cleanly).
	if _, err := tx.Exec(`DELETE FROM match_players WHERE matchID = ?`, matchID); err != nil {
		return fmt.Errorf("tracking: clear old players: %w", err)
	}

	stmt, err := tx.Prepare(`
		INSERT INTO match_players
		    (matchID, subject, teamId, partyId, gameName, tagLine, playerCardId, playerTitleId, characterId, accountLevel, competitiveTier,
		     kills, deaths, assists, score, headshots, bodyshots, legshots,
		     damageDealt, roundsPlayed, isLocal)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("tracking: prepare player insert: %w", err)
	}
	defer stmt.Close()

	for _, p := range parsed.Players {
		_, err = stmt.Exec(
			matchID,
			strings.ToLower(p.Subject),
			p.TeamID,
			p.PartyID,
			p.GameName,
			p.TagLine,
			p.PlayerCardID,
			p.PlayerTitleID,
			strings.ToLower(p.CharacterID),
			p.AccountLevel,
			p.CompetitiveTier,
			p.Kills,
			p.Deaths,
			p.Assists,
			p.Score,
			p.Headshots,
			p.Bodyshots,
			p.Legshots,
			p.DamageDealt,
			p.RoundsPlayed,
			boolToInt(p.IsLocal),
		)
		if err != nil {
			return fmt.Errorf("tracking: insert player %s: %w", p.Subject, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("tracking: commit: %w", err)
	}
	return nil
}

// GetMatchFromCache returns the parsed match details (match row + all
// player rows) from the local cache, or (nil, nil) if the matchID
// is not present.
func GetMatchFromCache(db *sql.DB, matchID, puuid string) (*MatchCache, error) {
	if matchID == "" {
		return nil, nil
	}
	var m MatchRow
	err := db.QueryRow(`
		SELECT matchID, queueID, mapID, gameMode, isRanked, gameStartMillis, seasonId,
		       gameLengthMillis, completionState, blueWins, blueRoundsWon, redRoundsWon,
		       rawJsonPath, cachedAt, accountPuuid
		FROM matches WHERE matchID = ?`, matchID,
	).Scan(
		&m.MatchID, &m.QueueID, &m.MapID, &m.GameMode, &m.IsRanked, &m.GameStartMillis,
		&m.SeasonID, &m.GameLengthMillis, &m.CompletionState, &m.BlueWins,
		&m.BlueRoundsWon, &m.RedRoundsWon, &m.RawJsonPath, &m.CachedAt, &m.AccountPuuid,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("tracking: GetMatchFromCache select: %w", err)
	}

	rows, err := db.Query(`
		SELECT matchID, subject, teamId, partyId, gameName, tagLine, playerCardId, playerTitleId, characterId, accountLevel, competitiveTier,
		       kills, deaths, assists, score, headshots, bodyshots, legshots,
		       damageDealt, roundsPlayed, isLocal
		FROM match_players WHERE matchID = ? ORDER BY teamId, score DESC`, matchID)
	if err != nil {
		return nil, fmt.Errorf("tracking: GetMatchFromCache players: %w", err)
	}
	defer rows.Close()

	var players []PlayerRow
	for rows.Next() {
		var p PlayerRow
		var isLocal int
		if err := rows.Scan(
			&p.MatchID, &p.Subject, &p.TeamID, &p.PartyID, &p.GameName, &p.TagLine,
			&p.PlayerCardID, &p.PlayerTitleID,
			&p.CharacterID, &p.AccountLevel, &p.CompetitiveTier,
			&p.Kills, &p.Deaths, &p.Assists, &p.Score,
			&p.Headshots, &p.Bodyshots, &p.Legshots, &p.DamageDealt,
			&p.RoundsPlayed, &isLocal,
		); err != nil {
			return nil, fmt.Errorf("tracking: scan player: %w", err)
		}
		p.IsLocal = isLocal == 1
		if !p.IsLocal && puuid != "" && strings.EqualFold(p.Subject, puuid) {
			p.IsLocal = true
		}
		players = append(players, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: iterate players: %w", err)
	}

	return &MatchCache{Match: m, Players: players}, nil
}

// UpsertRRSnapshot inserts a new RR snapshot row, or REPLACES an
// existing one keyed by (puuid, matchID).
func UpsertRRSnapshot(db *sql.DB, snap RRSnapshot) error {
	if snap.MatchID == "" {
		return fmt.Errorf("tracking: UpsertRRSnapshot: matchID is required")
	}
	_, err := db.Exec(`
		INSERT OR REPLACE INTO rr_snapshots
		    (puuid, matchID, seasonId, tierBefore, tierAfter, rrBefore, rrAfter, rrEarned, afkPenalty, matchStartTime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		strings.ToLower(snap.Puuid), snap.MatchID, snap.SeasonID, snap.TierBefore, snap.TierAfter,
		snap.RRBefore, snap.RRAfter, snap.RREarned, snap.AFKPenalty, snap.MatchStartTime,
	)
	if err != nil {
		return fmt.Errorf("tracking: UpsertRRSnapshot: %w", err)
	}
	return nil
}

// InsertRRSnapshotIfAbsent is the append-only variant used by the
// sync worker (RR history must never be overwritten; Riot occasionally
// re-emits MatchIDs and we keep the first record).
func InsertRRSnapshotIfAbsent(db *sql.DB, snap RRSnapshot) error {
	if snap.MatchID == "" {
		return fmt.Errorf("tracking: InsertRRSnapshotIfAbsent: matchID is required")
	}
	_, err := db.Exec(`
		INSERT OR IGNORE INTO rr_snapshots
		    (puuid, matchID, seasonId, tierBefore, tierAfter, rrBefore, rrAfter, rrEarned, afkPenalty, matchStartTime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		strings.ToLower(snap.Puuid), snap.MatchID, snap.SeasonID, snap.TierBefore, snap.TierAfter,
		snap.RRBefore, snap.RRAfter, snap.RREarned, snap.AFKPenalty, snap.MatchStartTime,
	)
	if err != nil {
		return fmt.Errorf("tracking: InsertRRSnapshotIfAbsent: %w", err)
	}
	return nil
}

// RecomputeAggregates rebuilds the per-puuid agent_stats and map_stats
// tables from match_players + matches in a single transactional pass.
// queue is always written as 'all' in this implementation.
func RecomputeAggregates(db *sql.DB, puuid string) error {
	if puuid == "" {
		return fmt.Errorf("tracking: RecomputeAggregates: puuid is required")
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("tracking: RecomputeAggregates begin: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.Exec(`DELETE FROM agent_stats WHERE puuid = ?`, puuid); err != nil {
		return fmt.Errorf("tracking: clear agent_stats: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM map_stats WHERE puuid = ?`, puuid); err != nil {
		return fmt.Errorf("tracking: clear map_stats: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO agent_stats
		    (puuid, characterId, queue, matches, wins, kills, deaths, assists,
		     headshots, timePlayedMillis)
		SELECT
		    mp.subject, mp.characterId, 'all',
		    COUNT(*),
		    SUM(CASE WHEN (m.blueWins = 1 AND mp.teamId = 'Blue')
		              OR (m.blueWins = 0 AND mp.teamId = 'Red')
		             THEN 1 ELSE 0 END),
		    SUM(mp.kills), SUM(mp.deaths), SUM(mp.assists),
		    SUM(mp.headshots), SUM(m.gameLengthMillis)
		FROM match_players mp
		JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject = ?
		GROUP BY mp.characterId
	`, puuid); err != nil {
		return fmt.Errorf("tracking: recompute agent_stats: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO agent_stats
		    (puuid, characterId, queue, matches, wins, kills, deaths, assists,
		     headshots, timePlayedMillis)
		SELECT
		    mp.subject, mp.characterId, m.queueID,
		    COUNT(*),
		    SUM(CASE WHEN (m.blueWins = 1 AND mp.teamId = 'Blue')
		              OR (m.blueWins = 0 AND mp.teamId = 'Red')
		             THEN 1 ELSE 0 END),
		    SUM(mp.kills), SUM(mp.deaths), SUM(mp.assists),
		    SUM(mp.headshots), SUM(m.gameLengthMillis)
		FROM match_players mp
		JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject = ? AND m.queueID != '' AND m.queueID != 'all'
		GROUP BY mp.characterId, m.queueID
	`, puuid); err != nil {
		return fmt.Errorf("tracking: recompute agent_stats per queue: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO map_stats
		    (puuid, mapID, queue, matches, wins)
		SELECT
		    mp.subject, m.mapID, 'all',
		    COUNT(*),
		    SUM(CASE WHEN (m.blueWins = 1 AND mp.teamId = 'Blue')
		              OR (m.blueWins = 0 AND mp.teamId = 'Red')
		             THEN 1 ELSE 0 END)
		FROM matches m
		JOIN match_players mp ON mp.matchID = m.matchID
		WHERE mp.subject = ?
		GROUP BY m.mapID
	`, puuid); err != nil {
		return fmt.Errorf("tracking: recompute map_stats: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO map_stats
		    (puuid, mapID, queue, matches, wins)
		SELECT
		    mp.subject, m.mapID, m.queueID,
		    COUNT(*),
		    SUM(CASE WHEN (m.blueWins = 1 AND mp.teamId = 'Blue')
		              OR (m.blueWins = 0 AND mp.teamId = 'Red')
		             THEN 1 ELSE 0 END)
		FROM matches m
		JOIN match_players mp ON mp.matchID = m.matchID
		WHERE mp.subject = ? AND m.queueID != '' AND m.queueID != 'all'
		GROUP BY m.mapID, m.queueID
	`, puuid); err != nil {
		return fmt.Errorf("tracking: recompute map_stats per queue: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("tracking: RecomputeAggregates commit: %w", err)
	}
	return nil
}

// ListCachedMatches returns cached match summaries for the local
// player, paginated by [start, end). queue may be empty (= "all").
//
// Ordering: gameStartMillis DESC, then matchID ASC for determinism.
// Each row carries the local player's per-match derived stats
// computed from the cached match_players columns.
func ListCachedMatches(db *sql.DB, puuid, queue string, start, end int) ([]MatchSummary, error) {
	if puuid == "" {
		return nil, fmt.Errorf("tracking: ListCachedMatches: puuid is required")
	}
	if end <= start {
		return []MatchSummary{}, nil
	}

	var (
		rows *sql.Rows
		err  error
	)
	if queue == "" {
		rows, err = db.Query(`
			SELECT m.matchID, m.queueID, m.mapID, m.gameMode, m.gameStartMillis,
			       m.gameLengthMillis, m.seasonId, m.isRanked, m.blueWins,
			       mp.teamId, mp.partyId, mp.characterId, mp.kills, mp.deaths, mp.assists, mp.score,
			       mp.headshots, mp.bodyshots, mp.legshots, mp.damageDealt,
			       mp.roundsPlayed,
			       COALESCE(rr.tierAfter, 0), COALESCE(rr.rrEarned, 0)
			FROM matches m
			JOIN match_players mp ON mp.matchID = m.matchID
			LEFT JOIN rr_snapshots rr ON rr.matchID = m.matchID AND rr.puuid = mp.subject
			WHERE mp.subject = ?
			ORDER BY m.gameStartMillis DESC, m.matchID ASC
			LIMIT ? OFFSET ?
		`, strings.ToLower(puuid), end-start, start)
	} else {
		rows, err = db.Query(`
			SELECT m.matchID, m.queueID, m.mapID, m.gameMode, m.gameStartMillis,
			       m.gameLengthMillis, m.seasonId, m.isRanked, m.blueWins,
			       mp.teamId, mp.partyId, mp.characterId, mp.kills, mp.deaths, mp.assists, mp.score,
			       mp.headshots, mp.bodyshots, mp.legshots, mp.damageDealt,
			       mp.roundsPlayed,
			       COALESCE(rr.tierAfter, 0), COALESCE(rr.rrEarned, 0)
			FROM matches m
			JOIN match_players mp ON mp.matchID = m.matchID
			LEFT JOIN rr_snapshots rr ON rr.matchID = m.matchID AND rr.puuid = mp.subject
			WHERE mp.subject = ? AND m.queueID = ?
			ORDER BY m.gameStartMillis DESC, m.matchID ASC
			LIMIT ? OFFSET ?
		`, strings.ToLower(puuid), queue, end-start, start)
	}
	if err != nil {
		return nil, fmt.Errorf("tracking: ListCachedMatches query: %w", err)
	}
	defer rows.Close()

	var out []MatchSummary
	for rows.Next() {
		var (
			s          MatchSummary
			isRanked   int
			blueWins   int
			roundsPlay int
		)
		if err := rows.Scan(
			&s.MatchID, &s.QueueID, &s.MapID, &s.GameMode, &s.GameStartMillis,
			&s.GameLengthMillis, &s.SeasonID, &isRanked, &blueWins,
			&s.LocalPlayer.TeamID, &s.LocalPlayer.PartyID,
			&s.LocalPlayer.CharacterID, &s.LocalPlayer.Kills, &s.LocalPlayer.Deaths,
			&s.LocalPlayer.Assists, &s.LocalPlayer.Score,
			&s.LocalPlayer.Headshots, &s.LocalPlayer.Bodyshots, &s.LocalPlayer.Legshots,
			&s.LocalPlayer.DamageDealt, &roundsPlay,
			&s.TierAfter, &s.RREarned,
		); err != nil {
			return nil, fmt.Errorf("tracking: ListCachedMatches scan: %w", err)
		}
		s.IsRanked = isRanked == 1
		s.LocalPlayer.RoundsPlayed = roundsPlay
		s.Win = (blueWins == 1 && strings.EqualFold(s.LocalPlayer.TeamID, "Blue")) ||
			(blueWins == 0 && strings.EqualFold(s.LocalPlayer.TeamID, "Red"))
		s.LocalPlayer = deriveLocalPlayer(s.LocalPlayer)
		if s.LocalPlayer.PartyID != "" {
			partyRows, partyErr := db.Query(`
				SELECT subject, gameName, tagLine, characterId, playerCardId, playerTitleId
				FROM match_players
				WHERE matchID = ? AND partyId = ? AND subject <> ?
				ORDER BY score DESC, subject ASC
			`, s.MatchID, s.LocalPlayer.PartyID, strings.ToLower(puuid))
			if partyErr != nil {
				return nil, fmt.Errorf("tracking: ListCachedMatches party members: %w", partyErr)
			}
			for partyRows.Next() {
				var member MatchPartyMember
				if err := partyRows.Scan(
					&member.Subject, &member.GameName, &member.TagLine, &member.CharacterID, &member.PlayerCardID, &member.PlayerTitleID,
				); err != nil {
					partyRows.Close()
					return nil, fmt.Errorf("tracking: ListCachedMatches party member scan: %w", err)
				}
				member.CharacterID = strings.ToLower(member.CharacterID)
				s.PartyMembers = append(s.PartyMembers, member)
			}
			if err := partyRows.Err(); err != nil {
				partyRows.Close()
				return nil, fmt.Errorf("tracking: ListCachedMatches party member rows: %w", err)
			}
			partyRows.Close()
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: ListCachedMatches rows: %w", err)
	}
	return out, nil
}

// GetRRSnapshots returns the RR snapshot series for the given puuid
// (filtered via join on match_players) and seasonID, ordered by
// matchStartTime ASC. Empty seasonID returns rows across all seasons.
func GetRRSnapshots(db *sql.DB, puuid, seasonID string) ([]RRSnapshot, error) {
	if puuid == "" {
		return nil, fmt.Errorf("tracking: GetRRSnapshots: puuid is required")
	}
	var (
		rows *sql.Rows
		err  error
	)
	if seasonID == "" {
		rows, err = db.Query(`
			SELECT r.puuid, r.matchID, r.seasonId, r.tierBefore, r.tierAfter, r.rrBefore,
			       r.rrAfter, r.rrEarned, r.afkPenalty, r.matchStartTime
			FROM rr_snapshots r
			WHERE r.puuid = ?
			ORDER BY r.matchStartTime ASC, r.matchID ASC
		`, strings.ToLower(puuid))
	} else {
		rows, err = db.Query(`
			SELECT r.puuid, r.matchID, r.seasonId, r.tierBefore, r.tierAfter, r.rrBefore,
			       r.rrAfter, r.rrEarned, r.afkPenalty, r.matchStartTime
			FROM rr_snapshots r
			WHERE r.puuid = ? AND r.seasonId = ?
			ORDER BY r.matchStartTime ASC, r.matchID ASC
		`, strings.ToLower(puuid), seasonID)
	}
	if err != nil {
		return nil, fmt.Errorf("tracking: GetRRSnapshots query: %w", err)
	}
	defer rows.Close()

	var out []RRSnapshot
	for rows.Next() {
		var r RRSnapshot
		if err := rows.Scan(
			&r.Puuid, &r.MatchID, &r.SeasonID, &r.TierBefore, &r.TierAfter, &r.RRBefore,
			&r.RRAfter, &r.RREarned, &r.AFKPenalty, &r.MatchStartTime,
		); err != nil {
			return nil, fmt.Errorf("tracking: GetRRSnapshots scan: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: GetRRSnapshots rows: %w", err)
	}
	return out, nil
}

func RankActsFromSnapshots(snapshots []RRSnapshot) []RankActSummary {
	type actState struct {
		summary RankActSummary
		lastAt  int64
	}
	bySeason := make(map[string]*actState)
	for _, snapshot := range snapshots {
		if snapshot.SeasonID == "" {
			continue
		}
		state := bySeason[snapshot.SeasonID]
		if state == nil {
			state = &actState{summary: RankActSummary{SeasonID: snapshot.SeasonID}}
			bySeason[snapshot.SeasonID] = state
		}
		state.summary.Games++
		if snapshot.RREarned > 0 {
			state.summary.Wins++
		}
		state.summary.PeakRank = max(state.summary.PeakRank, snapshot.TierBefore, snapshot.TierAfter)
		if snapshot.MatchStartTime >= state.lastAt {
			state.lastAt = snapshot.MatchStartTime
			state.summary.FinalRank = snapshot.TierAfter
			state.summary.RankedRating = snapshot.RRAfter
		}
	}

	states := make([]*actState, 0, len(bySeason))
	for _, state := range bySeason {
		states = append(states, state)
	}
	sort.Slice(states, func(i, j int) bool { return states[i].lastAt > states[j].lastAt })

	acts := make([]RankActSummary, 0, min(8, len(states)))
	for _, state := range states {
		acts = append(acts, state.summary)
		if len(acts) == 8 {
			break
		}
	}
	return acts
}

// GetAgentStats returns per-agent aggregate rows for the given puuid,
// sorted by matches DESC. queue == "" means "all".
func GetAgentStats(db *sql.DB, puuid, queue string) ([]AgentStat, error) {
	if puuid == "" {
		return nil, fmt.Errorf("tracking: GetAgentStats: puuid is required")
	}
	q := queue
	if q == "" {
		q = "all"
	}
	rows, err := db.Query(`
		SELECT characterId, matches, wins, kills, deaths, assists, headshots, timePlayedMillis
		FROM agent_stats
		WHERE puuid = ? AND queue = ?
		ORDER BY matches DESC, characterId ASC
	`, puuid, q)
	if err != nil {
		return nil, fmt.Errorf("tracking: GetAgentStats query: %w", err)
	}
	defer rows.Close()

	var out []AgentStat
	for rows.Next() {
		var a AgentStat
		if err := rows.Scan(
			&a.CharacterID, &a.Matches, &a.Wins, &a.Kills, &a.Deaths,
			&a.Assists, &a.Headshots, &a.TimePlayedMillis,
		); err != nil {
			return nil, fmt.Errorf("tracking: GetAgentStats scan: %w", err)
		}
		a.Winrate = pct(a.Wins, a.Matches)
		a.KD = ratio(a.Kills, a.Deaths)
		a.KDA = ratio(a.Kills+a.Assists, a.Deaths)
		a.HSPct = pct(a.Headshots, a.Kills)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: GetAgentStats rows: %w", err)
	}
	return out, nil
}

// GetMapStats returns per-map aggregate rows for the given puuid,
// sorted by matches DESC. queue == "" means "all".
func GetMapStats(db *sql.DB, puuid, queue string) ([]MapStat, error) {
	if puuid == "" {
		return nil, fmt.Errorf("tracking: GetMapStats: puuid is required")
	}
	q := queue
	if q == "" {
		q = "all"
	}
	rows, err := db.Query(`
		SELECT mapID, matches, wins
		FROM map_stats
		WHERE puuid = ? AND queue = ?
		ORDER BY matches DESC, mapID ASC
	`, puuid, q)
	if err != nil {
		return nil, fmt.Errorf("tracking: GetMapStats query: %w", err)
	}
	defer rows.Close()

	var out []MapStat
	for rows.Next() {
		var m MapStat
		if err := rows.Scan(&m.MapID, &m.Matches, &m.Wins); err != nil {
			return nil, fmt.Errorf("tracking: GetMapStats scan: %w", err)
		}
		m.Winrate = pct(m.Wins, m.Matches)
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: GetMapStats rows: %w", err)
	}
	return out, nil
}

// GetOverview assembles the top-level profile overview payload from
// the local cache only.
func GetOverview(db *sql.DB, puuid string) (*Overview, error) {
	if puuid == "" {
		return nil, fmt.Errorf("tracking: GetOverview: puuid is required")
	}
	puuid = strings.ToLower(puuid)
	out := &Overview{Puuid: puuid}

	// Look up the latest cached identity fields from match details. Riot's
	// match-details playerIdentity block is the reliable source for other
	// players' cards/titles once their match rows have been synced.
	var name, tag, playerCardID, playerTitleID string
	_ = db.QueryRow(`
		SELECT mp.gameName, mp.tagLine, mp.playerCardId, mp.playerTitleId
		FROM match_players mp
		JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject = ?
		  AND (mp.gameName != '' OR mp.playerCardId != '' OR mp.playerTitleId != '')
		ORDER BY m.gameStartMillis DESC
		LIMIT 1
	`, puuid).Scan(&name, &tag, &playerCardID, &playerTitleID)
	out.GameName = name
	out.TagLine = tag
	out.PlayerCardID = playerCardID
	out.PlayerTitleID = playerTitleID

	// Latest competitive state derived from match_players (competitiveTier
	// comes from Riot per player per match; we take the freshest value).
	// accountLevel also lives on match_players.
	var (
		latestTier   int
		latestLevel  int
		latestSeason string
	)
	// Query 1: Get the absolute latest match info for account level and season ID.
	_ = db.QueryRow(`
		SELECT mp.accountLevel, m.seasonId
		FROM match_players mp
		JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject = ?
		ORDER BY m.gameStartMillis DESC
		LIMIT 1
	`, puuid).Scan(&latestLevel, &latestSeason)

	out.Account.Level = latestLevel
	if latestSeason != "" {
		out.CurrentSeasonID = latestSeason
	}

	// Query 2: Get the latest competitive tier where the player actually has a rank (tier > 0).
	_ = db.QueryRow(`
		SELECT mp.competitiveTier
		FROM match_players mp
		JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject = ? AND mp.competitiveTier > 0
		ORDER BY m.gameStartMillis DESC
		LIMIT 1
	`, puuid).Scan(&latestTier)

	out.CurrentRank.CompetitiveTier = latestTier
	out.CurrentRank.NumberOfGames = 1

	row := db.QueryRow(`
		SELECT r.tierAfter, r.rrAfter, r.seasonId
		FROM rr_snapshots r
		WHERE r.puuid = ?
		ORDER BY r.matchStartTime DESC, r.matchID DESC
		LIMIT 1
	`, puuid)
	var latestRRTier, latestRR int
	var latestRRSeason string
	if err := row.Scan(&latestRRTier, &latestRR, &latestRRSeason); err == nil {
		if latestRRTier > 0 {
			latestTier = latestRRTier
			out.CurrentRank.CompetitiveTier = latestRRTier
		}
		out.CurrentRank.RankedRating = latestRR
		if latestRRSeason != "" {
			out.CurrentSeasonID = latestRRSeason
		}
	}
	// Look up the tier's friendly name from the static assets table.
	if latestTier > 0 {
		var tname string
		_ = db.QueryRow(`SELECT name FROM tier_names WHERE tier = ?`, latestTier).Scan(&tname)
		out.CurrentRank.TierName = tname
	}

	// Peak rank: highest competitiveTier ever recorded across all this
	// account's matches.
	row = db.QueryRow(`
		SELECT MAX(mp.competitiveTier)
		FROM match_players mp
		WHERE mp.subject = ?
	`, puuid)
	var peakTier int
	if err := row.Scan(&peakTier); err == nil && peakTier > 0 {
		out.PeakRank.CompetitiveTier = peakTier
		var ptname string
		_ = db.QueryRow(`SELECT name FROM tier_names WHERE tier = ?`, peakTier).Scan(&ptname)
		out.PeakRank.TierName = ptname
	}

	rows, err := db.Query(`
		SELECT r.puuid, r.matchID, r.seasonId, r.tierBefore, r.tierAfter, r.rrBefore,
		       r.rrAfter, r.rrEarned, r.afkPenalty, r.matchStartTime
		FROM rr_snapshots r
		WHERE r.puuid = ?
		ORDER BY r.matchStartTime DESC
		LIMIT 5
	`, strings.ToLower(puuid))
	if err != nil {
		return nil, fmt.Errorf("tracking: GetOverview rr: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r RRSnapshot
		if err := rows.Scan(
			&r.Puuid, &r.MatchID, &r.SeasonID, &r.TierBefore, &r.TierAfter, &r.RRBefore,
			&r.RRAfter, &r.RREarned, &r.AFKPenalty, &r.MatchStartTime,
		); err != nil {
			return nil, fmt.Errorf("tracking: GetOverview rr scan: %w", err)
		}
		out.LastDeltas = append(out.LastDeltas, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tracking: GetOverview rr rows: %w", err)
	}

	allSnapshots, err := GetRRSnapshots(db, puuid, "")
	if err != nil {
		return nil, fmt.Errorf("tracking: GetOverview act history: %w", err)
	}
	out.RankActs = RankActsFromSnapshots(allSnapshots)
	for _, act := range out.RankActs {
		if act.PeakRank > out.PeakRank.CompetitiveTier {
			out.PeakRank.CompetitiveTier = act.PeakRank
			out.PeakRank.SeasonID = act.SeasonID
		}
	}

	// Season summary aggregates.
	var (
		matches int
		wins    int
		kills   int
		deaths  int
		assists int
		hits    int
		hshots  int
	)
	err = db.QueryRow(`
		SELECT
		    COUNT(*),
		    COALESCE(SUM(CASE WHEN (m.blueWins = 1 AND mp.teamId = 'Blue')
		              OR (m.blueWins = 0 AND mp.teamId = 'Red')
		             THEN 1 ELSE 0 END), 0),
		    COALESCE(SUM(mp.kills), 0),
		    COALESCE(SUM(mp.deaths), 0),
		    COALESCE(SUM(mp.assists), 0),
		    COALESCE(SUM(mp.headshots + mp.bodyshots + mp.legshots), 0),
		    COALESCE(SUM(mp.headshots), 0)
		FROM matches m
		JOIN match_players mp ON mp.matchID = m.matchID
		WHERE mp.subject = ? AND m.isRanked = 1
	`, puuid).Scan(&matches, &wins, &kills, &deaths, &assists, &hits, &hshots)
	if err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("tracking: GetOverview summary: %w", err)
	}

	summary := SeasonSummary{
		Matches:  matches,
		Wins:     wins,
		Winrate:  pct(wins, matches),
		AvgKDA:   ratio(kills+assists, deaths),
		AvgHSPct: pct(hshots, hits),
	}
	out.CurrentRank.NumberOfGames = matches
	out.CurrentRank.NumberOfWins = wins

	// Top agent.
	row = db.QueryRow(`
		SELECT characterId
		FROM agent_stats
		WHERE puuid = ? AND queue = 'all'
		ORDER BY matches DESC, characterId ASC
		LIMIT 1
	`, puuid)
	var topID string
	if err := row.Scan(&topID); err == nil && topID != "" {
		summary.TopAgent = topID
		summary.TopAgentCharacterID = topID
	}

	if summary.Matches > 0 {
		out.SeasonSummary = &summary
	}
	return out, nil
}

// MarkSynced updates the sync_state row for the given puuid, setting
// lastSyncedAt to now (millis) and lastHistoryEndIndex to the given
// value. Insert or update.
func MarkSynced(db *sql.DB, puuid string, lastIndex int) error {
	if puuid == "" {
		return fmt.Errorf("tracking: MarkSynced: puuid is required")
	}
	now := time.Now().UnixMilli()
	_, err := db.Exec(`
		INSERT INTO sync_state (puuid, lastSyncedAt, lastHistoryEndIndex)
		VALUES (?, ?, ?)
		ON CONFLICT(puuid) DO UPDATE SET
		    lastSyncedAt = excluded.lastSyncedAt,
		    lastHistoryEndIndex = excluded.lastHistoryEndIndex
	`, puuid, now, lastIndex)
	if err != nil {
		return fmt.Errorf("tracking: MarkSynced: %w", err)
	}
	return nil
}

// GetSyncState returns the sync state for the given puuid. If no row
// exists, the returned SyncState has a zero value and a nil error.
func GetSyncState(db *sql.DB, puuid string) (SyncState, error) {
	if puuid == "" {
		return SyncState{}, fmt.Errorf("tracking: GetSyncState: puuid is required")
	}
	var s SyncState
	err := db.QueryRow(`
		SELECT puuid, lastSyncedAt, lastHistoryEndIndex
		FROM sync_state WHERE puuid = ?
	`, puuid).Scan(&s.Puuid, &s.LastSyncedAt, &s.LastHistoryEndIndex)
	if err == sql.ErrNoRows {
		return SyncState{Puuid: puuid}, nil
	}
	if err != nil {
		return SyncState{}, fmt.Errorf("tracking: GetSyncState: %w", err)
	}
	return s, nil
}

// --- helpers ---------------------------------------------------------------

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func pct(num, denom int) float64 {
	if denom <= 0 {
		return 0
	}
	return float64(num) / float64(denom) * 100.0
}

func ratio(num, denom int) float64 {
	d := denom
	if d <= 0 {
		d = 1
	}
	r := float64(num) / float64(d)
	return float64(int(r*100+0.5)) / 100
}

func deriveLocalPlayer(p LocalPlayerRow) LocalPlayerRow {
	if p.RoundsPlayed < 1 {
		p.RoundsPlayed = 1
	}
	if p.Kills < 0 {
		p.Kills = 0
	}
	p.ADR = round1(float64(p.DamageDealt) / float64(p.RoundsPlayed))
	p.ACS = round1(float64(p.Score) / float64(p.RoundsPlayed))
	totalShots := p.Headshots + p.Bodyshots + p.Legshots
	p.HSPct = round1(float64(p.Headshots) / float64(maxInt(totalShots, 1)) * 100.0)
	p.KD = ratio(p.Kills, p.Deaths)
	p.KDA = ratio(p.Kills+p.Assists, p.Deaths)
	return p
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// --- raw-JSON parsing ------------------------------------------------------

// parsedMatch is the intermediate result of decoding a single
// MatchDetailsResponse. Internal so the public API surface stays
// narrow.
type parsedMatch struct {
	Match   parsedMatchHeader
	Players []parsedPlayer
}

type parsedMatchHeader struct {
	MatchID          string
	QueueID          string
	MapID            string
	GameMode         string
	IsRanked         bool
	GameStartMillis  int64
	SeasonID         string
	GameLengthMillis int64
	CompletionState  string
	BlueWins         bool
	BlueRoundsWon    int
	RedRoundsWon     int
}

type parsedPlayer struct {
	Subject         string
	TeamID          string
	PartyID         string
	GameName        string
	TagLine         string
	PlayerCardID    string
	PlayerTitleID   string
	CharacterID     string
	AccountLevel    int
	CompetitiveTier int
	Kills           int
	Deaths          int
	Assists         int
	Score           int
	Headshots       int
	Bodyshots       int
	Legshots        int
	DamageDealt     int
	RoundsPlayed    int
	IsLocal         bool
}

// rawMatchDetails matches the Riot MatchDetailsResponse shape (see
// https://valapidocs.techchrism.me/endpoint/match-details). Only the
// fields we consume are declared; json.Unmarshal ignores anything
// else.
type rawMatchDetails struct {
	MatchInfo struct {
		MatchID          string `json:"matchId"`
		MapID            string `json:"mapId"`
		QueueID          string `json:"queueID"`
		GameMode         string `json:"gameMode"`
		IsRanked         bool   `json:"isRanked"`
		GameStartMillis  int64  `json:"gameStartMillis"`
		SeasonID         string `json:"seasonId"`
		GameLengthMillis int64  `json:"gameLengthMillis"`
		CompletionState  string `json:"completionState"`
	} `json:"matchInfo"`
	Players []struct {
		Subject        string `json:"subject"`
		GameName       string `json:"gameName"`
		TagLine        string `json:"tagLine"`
		PartyID        string `json:"partyId"`
		PlayerCardID   string `json:"playerCard"`
		PlayerTitleID  string `json:"playerTitle"`
		PlayerIdentity struct {
			GameName         string `json:"gameName"`
			TagLine          string `json:"tagLine"`
			HideAccountLevel bool   `json:"hideAccountLevel"`
			Incognito        bool   `json:"incognito"`
		} `json:"playerIdentity"`
		TeamID          string `json:"teamId"`
		CharacterID     string `json:"characterId"`
		AccountLevel    int    `json:"accountLevel"`
		CompetitiveTier int    `json:"competitiveTier"`
		Stats           *struct {
			Score        int `json:"score"`
			RoundsPlayed int `json:"roundsPlayed"`
			Kills        int `json:"kills"`
			Deaths       int `json:"deaths"`
			Assists      int `json:"assists"`
		} `json:"stats"`
		RoundDamage []struct {
			Receiver string `json:"receiver"`
			Damage   int    `json:"damage"`
		} `json:"roundDamage"`
	} `json:"players"`
	Teams []struct {
		TeamID    string `json:"teamId"`
		Won       bool   `json:"won"`
		RoundsWon int    `json:"roundsWon"`
	} `json:"teams"`
	RoundResults []struct {
		PlayerStats []struct {
			Subject string `json:"subject"`
			Damage  []struct {
				Receiver  string `json:"receiver"`
				Damage    int    `json:"damage"`
				Legshots  int    `json:"legshots"`
				Bodyshots int    `json:"bodyshots"`
				Headshots int    `json:"headshots"`
			} `json:"damage"`
		} `json:"playerStats"`
	} `json:"roundResults"`
}

func parseMatchDetails(raw []byte, puuid string, resolvedNames map[string]struct{ Name, Tag string }) (*parsedMatch, error) {
	var r rawMatchDetails
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, err
	}
	if r.MatchInfo.MatchID == "" {
		return nil, fmt.Errorf("missing matchInfo.matchId")
	}

	out := &parsedMatch{
		Match: parsedMatchHeader{
			MatchID:          r.MatchInfo.MatchID,
			QueueID:          r.MatchInfo.QueueID,
			MapID:            r.MatchInfo.MapID,
			GameMode:         r.MatchInfo.GameMode,
			IsRanked:         r.MatchInfo.IsRanked,
			GameStartMillis:  r.MatchInfo.GameStartMillis,
			SeasonID:         r.MatchInfo.SeasonID,
			GameLengthMillis: r.MatchInfo.GameLengthMillis,
			CompletionState:  r.MatchInfo.CompletionState,
		},
	}

	for _, t := range r.Teams {
		switch strings.ToLower(t.TeamID) {
		case "blue":
			out.Match.BlueWins = t.Won
			out.Match.BlueRoundsWon = t.RoundsWon
		case "red":
			if t.Won {
				out.Match.BlueWins = false
			}
			out.Match.RedRoundsWon = t.RoundsWon
		}
	}
	if out.Match.CompletionState == "" {
		out.Match.CompletionState = "Completed"
	}

	// Index round-results damage by subject for shot breakdown.
	type shotTally struct{ head, body, leg, dmg int }
	shots := map[string]*shotTally{}
	for _, rr := range r.RoundResults {
		for _, ps := range rr.PlayerStats {
			t, ok := shots[ps.Subject]
			if !ok {
				t = &shotTally{}
				shots[ps.Subject] = t
			}
			for _, d := range ps.Damage {
				t.head += d.Headshots
				t.body += d.Bodyshots
				t.leg += d.Legshots
				t.dmg += d.Damage
			}
		}
	}

	for _, p := range r.Players {
		pl := parsedPlayer{
			Subject:         p.Subject,
			TeamID:          p.TeamID,
			PartyID:         p.PartyID,
			GameName:        p.GameName,
			TagLine:         p.TagLine,
			CharacterID:     p.CharacterID,
			AccountLevel:    p.AccountLevel,
			CompetitiveTier: p.CompetitiveTier,
		}
		if p.Stats != nil {
			pl.Kills = p.Stats.Kills
			pl.Deaths = p.Stats.Deaths
			pl.Assists = p.Stats.Assists
			pl.Score = p.Stats.Score
			pl.RoundsPlayed = p.Stats.RoundsPlayed
		}
		for _, rd := range p.RoundDamage {
			pl.DamageDealt += rd.Damage
		}
		if t, ok := shots[p.Subject]; ok {
			pl.Headshots = t.head
			pl.Bodyshots = t.body
			pl.Legshots = t.leg
			if pl.DamageDealt == 0 {
				pl.DamageDealt = t.dmg
			}
		}
		if pl.GameName == "" {
			pl.GameName = p.PlayerIdentity.GameName
		}
		if pl.TagLine == "" {
			pl.TagLine = p.PlayerIdentity.TagLine
		}
		pl.PlayerCardID = p.PlayerCardID
		pl.PlayerTitleID = p.PlayerTitleID
		if p.PlayerIdentity.Incognito || p.PlayerIdentity.HideAccountLevel {
			pl.AccountLevel = 0
		}
		if pl.GameName == "" && resolvedNames != nil {
			if res, ok := resolvedNames[strings.ToLower(pl.Subject)]; ok {
				pl.GameName = res.Name
				pl.TagLine = res.Tag
			}
		}
		pl.IsLocal = strings.EqualFold(p.Subject, puuid)
		out.Players = append(out.Players, pl)
	}

	return out, nil
}
