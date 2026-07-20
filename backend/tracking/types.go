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
	Subject         string       `json:"subject"`
	TeamID          string       `json:"teamId"`
	PartyID         string       `json:"partyId,omitempty"`
	GameName        string       `json:"gameName"`
	TagLine         string       `json:"tagLine"`
	PlayerCardID    string       `json:"playerCardId,omitempty"`
	PlayerTitleID   string       `json:"playerTitleId,omitempty"`
	CharacterID     string       `json:"characterId"`
	Kills           int          `json:"kills"`
	Deaths          int          `json:"deaths"`
	Assists         int          `json:"assists"`
	Score           int          `json:"score"`
	Headshots       int          `json:"headshots"`
	Bodyshots       int          `json:"bodyshots"`
	Legshots        int          `json:"legshots"`
	DamageDealt     int          `json:"damageDealt"`
	RoundsPlayed    int          `json:"roundsPlayed"`
	PlaytimeMillis  int64        `json:"playtimeMillis,omitempty"`
	AbilityCasts    AbilityCasts `json:"abilityCasts,omitempty"`
	IsLocal         bool         `json:"isLocal"`
	CompetitiveTier int          `json:"competitiveTier"`
	KD              float64      `json:"kd"`
	KDA             float64      `json:"kda"`
	ADR             float64      `json:"adr"`
	ACS             float64      `json:"acs"`
	HSPct           float64      `json:"hsPct"`
}

type AbilityCasts struct {
	Grenade  int `json:"grenade"`
	Ability1 int `json:"ability1"`
	Ability2 int `json:"ability2"`
	Ultimate int `json:"ultimate"`
}

// MatchLocation is a Riot world-space coordinate captured at an event.
// The frontend converts it to minimap space using the map metadata scalars.
type MatchLocation struct {
	Subject     string  `json:"subject,omitempty"`
	ViewRadians float64 `json:"viewRadians,omitempty"`
	X           int     `json:"x"`
	Y           int     `json:"y"`
}

// KillEvent preserves the positional part of Riot's roundResults payload.
// It is intentionally factual event data; heatmaps and hotspots are derived
// by the UI rather than stored as opaque or AI-generated conclusions.
type KillEvent struct {
	RoundNum        int             `json:"roundNum"`
	GameTime        int             `json:"gameTime"`
	RoundTime       int             `json:"roundTime"`
	Killer          string          `json:"killer"`
	Victim          string          `json:"victim"`
	VictimX         int             `json:"victimX"`
	VictimY         int             `json:"victimY"`
	DamageType      string          `json:"damageType,omitempty"`
	DamageItem      string          `json:"damageItem,omitempty"`
	SecondaryFire   bool            `json:"secondaryFire,omitempty"`
	Assistants      []string        `json:"assistants,omitempty"`
	PlayerLocations []MatchLocation `json:"playerLocations,omitempty"`
}

type RoundDamage struct {
	Receiver  string `json:"receiver"`
	Damage    int    `json:"damage"`
	Legshots  int    `json:"legshots"`
	Bodyshots int    `json:"bodyshots"`
	Headshots int    `json:"headshots"`
}

type RoundEconomy struct {
	LoadoutValue int    `json:"loadoutValue"`
	Weapon       string `json:"weapon,omitempty"`
	Armor        string `json:"armor,omitempty"`
	Remaining    int    `json:"remaining"`
	Spent        int    `json:"spent"`
}

type RoundAbilityEffects struct {
	Grenade  int `json:"grenade"`
	Ability1 int `json:"ability1"`
	Ability2 int `json:"ability2"`
	Ultimate int `json:"ultimate"`
}

// RoundPlayerStat is the factual receipt for one player in one round. The UI
// uses this to explain buys, damage, assists and ability usage without guessing
// intent or pretending it has video evidence.
type RoundPlayerStat struct {
	Subject       string              `json:"subject"`
	Score         int                 `json:"score"`
	Damage        []RoundDamage       `json:"damage,omitempty"`
	Economy       RoundEconomy        `json:"economy"`
	Ability       RoundAbilityEffects `json:"ability"`
	WasAFK        bool                `json:"wasAfk,omitempty"`
	WasPenalized  bool                `json:"wasPenalized,omitempty"`
	StayedInSpawn bool                `json:"stayedInSpawn,omitempty"`
}

// MatchRound is factual, post-match round metadata returned by Riot. Keeping
// the winner and objective result lets the UI calculate conversion rates
// without presenting a modelled win probability as if it were ground truth.
type MatchRound struct {
	RoundNum        int               `json:"roundNum"`
	WinningTeam     string            `json:"winningTeam"`
	RoundResult     string            `json:"roundResult,omitempty"`
	RoundCeremony   string            `json:"roundCeremony,omitempty"`
	BombPlanter     string            `json:"bombPlanter,omitempty"`
	BombDefuser     string            `json:"bombDefuser,omitempty"`
	PlantRoundTime  int               `json:"plantRoundTime,omitempty"`
	PlantSite       string            `json:"plantSite,omitempty"`
	DefuseRoundTime int               `json:"defuseRoundTime,omitempty"`
	PlantLocation   MatchLocation     `json:"plantLocation,omitempty"`
	DefuseLocation  MatchLocation     `json:"defuseLocation,omitempty"`
	PlayerStats     []RoundPlayerStat `json:"playerStats,omitempty"`
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
	MatchID          string             `json:"matchId"`
	QueueID          string             `json:"queueID"`
	MapID            string             `json:"mapID"`
	GameMode         string             `json:"gameMode"`
	GameStartMillis  int64              `json:"gameStartMillis"`
	GameLengthMillis int64              `json:"gameLengthMillis"`
	SeasonID         string             `json:"seasonId"`
	IsRanked         bool               `json:"isRanked"`
	Win              bool               `json:"win"`
	BlueRoundsWon    int                `json:"blueRoundsWon"`
	RedRoundsWon     int                `json:"redRoundsWon"`
	TierAfter        int                `json:"tierAfter"`
	RREarned         int                `json:"rrEarned"`
	AFKPenalty       int                `json:"afkPenalty,omitempty"`
	PerformanceBonus int                `json:"performanceBonus,omitempty"`
	LocalPlayer      PlayerStats        `json:"localPlayer"`
	PartyMembers     []MatchPartyMember `json:"partyMembers,omitempty"`
}

// RRSnapshot is one row of `rr_snapshots` plus the API-shaped JSON.
type RRSnapshot struct {
	Puuid            string `json:"puuid"`
	MatchID          string `json:"matchId"`
	SeasonID         string `json:"seasonId"`
	TierBefore       int    `json:"tierBefore"`
	TierAfter        int    `json:"tierAfter"`
	RRBefore         int    `json:"rrBefore"`
	RRAfter          int    `json:"rrAfter"`
	RREarned         int    `json:"rrEarned"`
	AFKPenalty       int    `json:"afkPenalty"`
	PerformanceBonus int    `json:"performanceBonus"`
	MatchStartTime   int64  `json:"matchStartTime"`
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
	Kills      []KillEvent   `json:"kills,omitempty"`
	Rounds     []MatchRound  `json:"rounds,omitempty"`
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
	ReachedAt       int64  `json:"reachedAt,omitempty"`
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
	RankSource              string           `json:"rankSource,omitempty"`
	RankError               string           `json:"rankError,omitempty"`
	SeasonSummary           *SeasonSummary   `json:"seasonSummary"`
}

// SyncState is one row of `sync_state`.
type SyncState struct {
	Puuid                   string `json:"puuid"`
	LastSyncedAt            int64  `json:"lastSyncedAt"`
	LastHistoryEndIndex     int    `json:"lastHistoryEndIndex"`
	LastCompetitiveEndIndex int    `json:"lastCompetitiveEndIndex"`
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
	RetryAt        int64  `json:"retryAt,omitempty"`
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
	AnalyticsVersion int
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
	PlaytimeMillis  int64
	AbilityCasts    AbilityCasts
	IsLocal         bool
}

// MatchCache bundles a match row with all of its player rows.
type MatchCache struct {
	Match   MatchRow
	Players []PlayerRow
	Kills   []KillEvent
	Rounds  []MatchRound
}

// LocalPlayerRow is the per-row payload for the local player inside
// a MatchSummary. It is a type alias of PlayerStats so the listing
// SQL Scan can populate the API-shaped fields directly.
type LocalPlayerRow = PlayerStats
