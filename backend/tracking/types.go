// Package tracking implements the persistent local match-history DB
// and the background sync worker that populates it from the Riot PVP
// API. The full design contract lives in
// valovault/.mavis/plans/tracking-design.md.
//
// On the `tracking/api-routes` branch this file is a STUB: the types
// are real, but the bodies of the methods in db.go / sync.go are
// placeholders that return zero values. The `tracking/data-layer`
// branch replaces the bodies with the real `modernc.org/sqlite`
// implementation. The `tracking/integration` branch reconciles the
// two.
//
// STUB marker. Safe to delete on merge with `tracking/data-layer`.
package tracking

// PlayerStats is the per-row KDA bundle for a single (matchID, subject).
// Derived fields (KD, KDA, ADR, ACS, HSPct) are precomputed on the
// backend at row-serialization time (see design doc §3).
type PlayerStats struct {
	Subject         string  `json:"subject"`
	TeamID          string  `json:"teamId"`
	PartyID         string  `json:"partyId,omitempty"`
	GameName        string  `json:"gameName"`
	TagLine         string  `json:"tagLine"`
	PlayerCardID    string  `json:"playerCardId,omitempty"`
	PlayerTitleID   string  `json:"playerTitleId,omitempty"`
	CharacterID     string  `json:"characterId"`
	Kills           int     `json:"kills"`
	Deaths          int     `json:"deaths"`
	Assists         int     `json:"assists"`
	Score           int     `json:"score"`
	Headshots       int     `json:"headshots"`
	Bodyshots       int     `json:"bodyshots"`
	Legshots        int     `json:"legshots"`
	DamageDealt     int     `json:"damageDealt"`
	RoundsPlayed    int     `json:"roundsPlayed"`
	IsLocal         bool    `json:"isLocal"`
	CompetitiveTier int     `json:"competitiveTier"`
	KD              float64 `json:"kd"`
	KDA             float64 `json:"kda"`
	ADR             float64 `json:"adr"`
	ACS             float64 `json:"acs"`
	HSPct           float64 `json:"hsPct"`
}

type MatchPartyMember struct {
	Subject       string `json:"subject"`
	GameName      string `json:"gameName"`
	TagLine       string `json:"tagLine"`
	CharacterID   string `json:"characterId"`
	PlayerCardID  string `json:"playerCardId,omitempty"`
	PlayerTitleID string `json:"playerTitleId,omitempty"`
}

// MatchSummary is the per-row payload of `GET /v1/profile/match-history`.
type MatchSummary struct {
	MatchID          string      `json:"matchId"`
	QueueID          string      `json:"queueID"`
	MapID            string      `json:"mapID"`
	GameMode         string      `json:"gameMode"`
	GameStartMillis  int64       `json:"gameStartMillis"`
	GameLengthMillis int64       `json:"gameLengthMillis"`
	SeasonID         string      `json:"seasonId"`
	IsRanked         bool        `json:"isRanked"`
	Win              bool        `json:"win"`
	TierAfter        int         `json:"tierAfter"`
	RREarned         int         `json:"rrEarned"`
	LocalPlayer      PlayerStats `json:"localPlayer"`
	PartyMembers     []MatchPartyMember `json:"partyMembers,omitempty"`
}

// RRSnapshot is one row of `rr_snapshots` plus the API-shaped JSON.
type RRSnapshot struct {
	Puuid          string `json:"puuid"`
	MatchID        string `json:"matchId"`
	SeasonID       string `json:"seasonId"`
	TierBefore     int    `json:"tierBefore"`
	TierAfter      int    `json:"tierAfter"`
	RRBefore       int    `json:"rrBefore"`
	RRAfter        int    `json:"rrAfter"`
	RREarned       int    `json:"rrEarned"`
	AFKPenalty     int    `json:"afkPenalty"`
	MatchStartTime int64  `json:"matchStartTime"`
}

// AgentStat is one row of `agent_stats` (queue='all' by default).
type AgentStat struct {
	CharacterID      string  `json:"characterId"`
	Matches          int     `json:"matches"`
	Wins             int     `json:"wins"`
	Winrate          float64 `json:"winrate"`
	Kills            int     `json:"kills"`
	Deaths           int     `json:"deaths"`
	Assists          int     `json:"assists"`
	KD               float64 `json:"kd"`
	KDA              float64 `json:"kda"`
	Headshots        int     `json:"headshots"`
	HSPct            float64 `json:"hsPct"`
	TimePlayedMillis int64   `json:"timePlayedMillis"`
}

// MapStat is one row of `map_stats`.
type MapStat struct {
	MapID   string  `json:"mapID"`
	Matches int     `json:"matches"`
	Wins    int     `json:"wins"`
	Winrate float64 `json:"winrate"`
}

// MatchInfo is the per-match summary block of the cached
// MatchDetailsResponse. Field names mirror Riot's camelCase schema.
type MatchInfo struct {
	MatchID          string `json:"matchId"`
	MapID            string `json:"mapID"`
	GameStartMillis  int64  `json:"gameStartMillis"`
	GameLengthMillis int64  `json:"gameLengthMillis"`
	IsRanked         bool   `json:"isRanked"`
	QueueID          string `json:"queueID"`
	GameMode         string `json:"gameMode"`
	SeasonID         string `json:"seasonId"`
	CompletionState  string `json:"completionState"`
	BlueRoundsWon    int    `json:"blueRoundsWon"`
	RedRoundsWon     int    `json:"redRoundsWon"`
	BlueWins         bool   `json:"blueWins"`
}

// MatchDetails is the payload of `GET /v1/profile/match-details/:matchID`.
type MatchDetails struct {
	MatchID    string        `json:"matchId"`
	MatchInfo  MatchInfo     `json:"matchInfo"`
	Players    []PlayerStats `json:"players"`
	ServedFrom string        `json:"servedFrom"`
}

// CurrentRank mirrors the Riot
// QueueSkills.competitive.SeasonalInfoBySeasonID payload (design §2.1).
type CurrentRank struct {
	CompetitiveTier int    `json:"competitiveTier"`
	TierName        string `json:"tierName"`
	RankedRating    int    `json:"rankedRating"`
	NumberOfWins    int    `json:"numberOfWins"`
	NumberOfGames   int    `json:"numberOfGames"`
	LeaderboardRank int    `json:"leaderboardRank"`
}

// PeakRank is the highest tier ever recorded for this account.
type PeakRank struct {
	CompetitiveTier int    `json:"competitiveTier"`
	TierName        string `json:"tierName"`
	SeasonID        string `json:"seasonId"`
}

// AccountSummary is the level + xp payload.
type AccountSummary struct {
	Level   int `json:"level"`
	TotalXp int `json:"totalXp"`
}

type RankActSummary struct {
	SeasonID     string `json:"seasonId"`
	Wins         int    `json:"wins"`
	Games        int    `json:"games"`
	RankedRating int    `json:"rankedRating"`
	PeakRank     int    `json:"peakRank"`
	FinalRank    int    `json:"finalRank"`
}

// SeasonSummary is the aggregates block of `GET /v1/profile/overview`.
type SeasonSummary struct {
	Matches             int     `json:"matches"`
	Wins                int     `json:"wins"`
	Winrate             float64 `json:"winrate"`
	AvgKDA              float64 `json:"avgKda"`
	AvgHSPct            float64 `json:"avgHsPct"`
	TopAgent            string  `json:"topAgent"`
	TopAgentCharacterID string  `json:"topAgentCharacterId"`
}

// Overview is the payload of `GET /v1/profile/overview`.
type Overview struct {
	Puuid                   string           `json:"puuid"`
	Region                  string           `json:"region"`
	CurrentSeasonID         string           `json:"currentSeasonId"`
	CurrentRank             CurrentRank      `json:"currentRank"`
	PeakRank                PeakRank         `json:"peakRank"`
	Account                 AccountSummary   `json:"account"`
	LastDeltas              []RRSnapshot     `json:"lastDeltas"`
	RankActs                []RankActSummary `json:"rankActs"`
	GameName                string           `json:"gameName,omitempty"`
	TagLine                 string           `json:"tagLine,omitempty"`
	PlayerCardID            string           `json:"playerCardId,omitempty"`
	PlayerTitleID           string           `json:"playerTitleId,omitempty"`
	LastCacheSyncedAt       int64            `json:"lastCacheSyncedAt"`
	LastLiveRankRefreshedAt int64            `json:"lastLiveRankRefreshedAt"`
	SeasonSummary           *SeasonSummary   `json:"seasonSummary"`
}

// SyncState is one row of `sync_state`.
type SyncState struct {
	Puuid               string `json:"puuid"`
	LastSyncedAt        int64  `json:"lastSyncedAt"`
	LastHistoryEndIndex int    `json:"lastHistoryEndIndex"`
}

// SyncStatus is the payload of `GET /v1/profile/sync-status`.
type SyncStatus struct {
	Puuid          string `json:"puuid"`
	Status         string `json:"status"`
	LastSyncedAt   int64  `json:"lastSyncedAt"`
	LastFinishedAt int64  `json:"lastFinishedAt"`
	InFlight       bool   `json:"inFlight"`
	TotalMatches   int    `json:"totalMatches"`
	ErrorKind      string `json:"errorKind,omitempty"`
	LastError      string `json:"lastError,omitempty"`
}

// --- internal row types used by db.go ---
//
// These mirror the SQL columns of the `matches` and `match_players`
// tables. They are exported so db.go can Scan into them; the
// higher-level public types above (MatchSummary, PlayerStats, etc.)
// are the API-shaped DTOs that wrap or compose these.

// MatchRow is a raw row from the `matches` table.
type MatchRow struct {
	MatchID          string
	QueueID          string
	MapID            string
	GameMode         string
	IsRanked         int
	GameStartMillis  int64
	SeasonID         string
	GameLengthMillis int64
	CompletionState  string
	BlueWins         int
	BlueRoundsWon    int
	RedRoundsWon     int
	RawJsonPath      string
	CachedAt         int64
	AccountPuuid     string
}

// PlayerRow is a raw row from the `match_players` table.
type PlayerRow struct {
	MatchID         string
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

// MatchCache bundles a match row with all of its player rows.
type MatchCache struct {
	Match   MatchRow
	Players []PlayerRow
}

// LocalPlayerRow is the per-row payload for the local player inside
// a MatchSummary. It is a type alias of PlayerStats so the listing
// SQL Scan can populate the API-shaped fields directly.
type LocalPlayerRow = PlayerStats
