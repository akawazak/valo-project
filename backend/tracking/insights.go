package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// CareerInsights are cross-match stats derived from the local cache: clutch
// record, weapon kills, buy-type win rates and session form. Nothing here
// calls Riot; it only reads matches the sync already stored.
type CareerInsights struct {
	Matches      int             `json:"matches"`
	Clutches     ClutchRecord    `json:"clutches"`
	Weapons      []WeaponTally   `json:"weapons"`
	WeaponDeaths []WeaponTally   `json:"weaponDeaths"`
	Buys         []BuyTypeRecord `json:"buys"`
	Sessions     SessionForm     `json:"sessions"`
	Playstyle    *Playstyle      `json:"playstyle,omitempty"`
}

// ClutchRecord counts rounds where the player became their team's last
// survivor while enemies were still alive. BySize[0] is 1v1 … BySize[4] 1v5.
type ClutchRecord struct {
	Attempts int           `json:"attempts"`
	Wins     int           `json:"wins"`
	BySize   [5]RoundTally `json:"bySize"`
}

type RoundTally struct {
	Attempts int `json:"attempts"`
	Wins     int `json:"wins"`
}

// WeaponTally is kills (or deaths) by Riot damage item. Abilities and other
// non-weapon damage are grouped under "ability"/"other".
type WeaponTally struct {
	Item  string `json:"item"`
	Count int    `json:"count"`
}

// BuyTypeRecord is the round win rate for one team-buy bracket.
type BuyTypeRecord struct {
	Type   string `json:"type"`
	Rounds int    `json:"rounds"`
	Wins   int    `json:"wins"`
}

type SessionForm struct {
	Decided int `json:"decided"`
	Wins    int `json:"wins"`
	// AfterTwoLosses counts games that followed two straight losses in the
	// same session.
	AfterTwoLosses RoundTally `json:"afterTwoLosses"`
	// ByGame is the record by game number within a session: 1st … 5th+.
	ByGame [5]RoundTally `json:"byGame"`
	// ByHour is the record by local start time in four-hour blocks from 00:00.
	ByHour   [6]RoundTally `json:"byHour"`
	Sessions int           `json:"sessions"`
}

const sessionGapMillis = 2 * 60 * 60 * 1000

// Queues with the standard buy economy and halves, where buy brackets mean
// something. Spike Rush, Deathmatch and draft modes hand out loadouts.
var economyQueues = map[string]int{"competitive": 12, "unrated": 12, "premier": 12, "newmap": 12, "swiftplay": 4}

// insightKill is one kill in feed order, subjects lowercased.
type insightKill struct{ killer, victim string }

type insightMatch struct {
	id, queue, team string
	start           int64
	decided, won    bool
}

// ComputeCareerInsights reads every cached match for puuid that passes the
// queue and act filters.
func ComputeCareerInsights(db *sql.DB, puuid, queue, seasonID string) (*CareerInsights, error) {
	puuid = strings.ToLower(strings.TrimSpace(puuid))
	if puuid == "" {
		return nil, fmt.Errorf("tracking: ComputeCareerInsights: puuid is required")
	}
	seasonIDs := ResolveSeasonIDs(seasonID)
	seasonClause := "? = ''"
	seasonArgs := []any{seasonID}
	if len(seasonIDs) > 0 {
		seasonClause = "m.seasonId IN (" + strings.TrimSuffix(strings.Repeat("?,", len(seasonIDs)), ",") + ")"
		seasonArgs = seasonArgs[:0]
		for _, id := range seasonIDs {
			seasonArgs = append(seasonArgs, id)
		}
	}
	rows, err := db.Query(`
		SELECT m.matchID, LOWER(m.queueID), m.gameStartMillis, m.blueWins, m.blueRoundsWon + m.redRoundsWon, mp.teamId
		FROM matches m
		JOIN match_players mp ON mp.matchID = m.matchID
		WHERE mp.subject = ?
		  AND (? = '' OR LOWER(m.queueID) = LOWER(?))
		  AND `+seasonClause+`
		ORDER BY m.gameStartMillis ASC`, append([]any{puuid, queue, queue}, seasonArgs...)...)
	if err != nil {
		return nil, fmt.Errorf("tracking: insights matches: %w", err)
	}
	var matches []insightMatch
	byID := map[string]*insightMatch{}
	for rows.Next() {
		var m insightMatch
		var blueWins, rounds int
		if err := rows.Scan(&m.id, &m.queue, &m.start, &blueWins, &rounds, &m.team); err != nil {
			rows.Close()
			return nil, fmt.Errorf("tracking: insights match scan: %w", err)
		}
		blue := strings.EqualFold(m.team, "Blue")
		m.decided = rounds > 0 && (blue || strings.EqualFold(m.team, "Red"))
		m.won = m.decided && (blueWins == 1) == blue
		matches = append(matches, m)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range matches {
		byID[matches[i].id] = &matches[i]
	}
	out := &CareerInsights{Matches: len(matches), Weapons: []WeaponTally{}, WeaponDeaths: []WeaponTally{}, Buys: []BuyTypeRecord{}}
	out.Sessions = sessionForm(matches)
	if len(matches) == 0 {
		return out, nil
	}

	// Rosters of every match the player is in, keyed by match then subject.
	teams := map[string]map[string]string{}
	rows, err = db.Query(`
		SELECT p.matchID, p.subject, p.teamId
		FROM match_players p JOIN match_players me ON me.matchID = p.matchID AND me.subject = ?`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: insights rosters: %w", err)
	}
	for rows.Next() {
		var matchID, subject, team string
		if err := rows.Scan(&matchID, &subject, &team); err != nil {
			rows.Close()
			return nil, err
		}
		if byID[matchID] == nil {
			continue
		}
		if teams[matchID] == nil {
			teams[matchID] = map[string]string{}
		}
		teams[matchID][strings.ToLower(subject)] = team
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	type roundKey struct {
		match string
		round int
	}
	roundKills := map[roundKey][]insightKill{}
	weapons, deaths := map[string]int{}, map[string]int{}
	rows, err = db.Query(`
		SELECT k.matchID, k.roundNum, k.killer, k.victim, k.damageType, k.damageItem
		FROM match_kills k JOIN match_players me ON me.matchID = k.matchID AND me.subject = ?
		ORDER BY k.matchID, k.roundNum, k.gameTime`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: insights kills: %w", err)
	}
	for rows.Next() {
		var matchID, killer, victim, damageType, item string
		var round int
		if err := rows.Scan(&matchID, &round, &killer, &victim, &damageType, &item); err != nil {
			rows.Close()
			return nil, err
		}
		if byID[matchID] == nil {
			continue
		}
		killer, victim = strings.ToLower(killer), strings.ToLower(victim)
		key := roundKey{matchID, round}
		roundKills[key] = append(roundKills[key], insightKill{killer, victim})
		label := damageLabel(damageType, item)
		if killer == puuid && victim != puuid {
			weapons[label]++
		}
		if victim == puuid && killer != puuid && killer != "" {
			deaths[label]++
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	out.Weapons = topTallies(weapons, 10)
	out.WeaponDeaths = topTallies(deaths, 6)

	buys := map[string]*BuyTypeRecord{}
	for _, name := range []string{"pistol", "eco", "force", "full"} {
		buys[name] = &BuyTypeRecord{Type: name}
	}
	rows, err = db.Query(`
		SELECT r.matchID, r.roundNum, r.winningTeam, r.playerStats
		FROM match_rounds r JOIN match_players me ON me.matchID = r.matchID AND me.subject = ?
		ORDER BY r.matchID, r.roundNum`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: insights rounds: %w", err)
	}
	for rows.Next() {
		var matchID, winner, statsJSON string
		var round int
		if err := rows.Scan(&matchID, &round, &winner, &statsJSON); err != nil {
			rows.Close()
			return nil, err
		}
		m := byID[matchID]
		roster := teams[matchID]
		if m == nil || !m.decided || roster == nil || (!strings.EqualFold(winner, "Blue") && !strings.EqualFold(winner, "Red")) {
			continue
		}
		won := strings.EqualFold(winner, m.team)
		if attempt, size := clutchAttempt(roster, puuid, m.team, roundKills[roundKey{matchID, round}]); attempt {
			out.Clutches.Attempts++
			out.Clutches.BySize[size-1].Attempts++
			if won {
				out.Clutches.Wins++
				out.Clutches.BySize[size-1].Wins++
			}
		}
		half, standard := economyQueues[m.queue]
		if !standard {
			continue
		}
		bracket := ""
		if round == 0 || round == half {
			bracket = "pistol"
		} else if avg, ok := teamLoadout(statsJSON, roster, m.team); ok {
			bracket = buyBracket(avg)
		}
		if b := buys[bracket]; b != nil {
			b.Rounds++
			if won {
				b.Wins++
			}
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, name := range []string{"pistol", "eco", "force", "full"} {
		out.Buys = append(out.Buys, *buys[name])
	}
	if out.Playstyle, err = computePlaystyle(db, puuid, matches); err != nil {
		return nil, err
	}
	return out, nil
}

// clutchAttempt replays a round's kills and reports whether the player became
// the last one alive on their team with 1–5 enemies standing. Riot's kill
// feed has no revive events, so a Sage revive can hide a clutch; that only
// undercounts.
func clutchAttempt(roster map[string]string, puuid, team string, kills []insightKill) (bool, int) {
	alive := map[string]int{}
	for _, side := range roster {
		alive[strings.ToLower(side)]++
	}
	own := strings.ToLower(team)
	if alive[own] < 3 {
		return false, 0
	}
	enemies := func() int {
		n := 0
		for side, count := range alive {
			if side != own {
				n += count
			}
		}
		return n
	}
	dead := map[string]bool{}
	for _, k := range kills {
		if dead[k.victim] {
			continue
		}
		dead[k.victim] = true
		alive[strings.ToLower(roster[k.victim])]--
		if dead[puuid] {
			return false, 0
		}
		if alive[own] == 1 {
			if n := enemies(); n >= 1 && n <= 5 {
				return true, n
			}
			return false, 0
		}
	}
	return false, 0
}

func damageLabel(damageType, item string) string {
	item = strings.ToLower(strings.TrimSpace(item))
	switch {
	case strings.EqualFold(damageType, "Weapon") && len(item) == 36:
		return item
	case strings.EqualFold(damageType, "Ability"):
		return "ability"
	case strings.EqualFold(damageType, "Bomb"):
		return "spike"
	case strings.EqualFold(damageType, "Melee"):
		return "melee"
	default:
		return "other"
	}
}

func topTallies(counts map[string]int, limit int) []WeaponTally {
	out := make([]WeaponTally, 0, len(counts))
	for item, count := range counts {
		out = append(out, WeaponTally{Item: item, Count: count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Item < out[j].Item
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// teamLoadout averages Riot's per-player loadoutValue for one team in a round.
func teamLoadout(statsJSON string, roster map[string]string, team string) (float64, bool) {
	var stats []struct {
		Subject string `json:"subject"`
		Economy struct {
			LoadoutValue int `json:"loadoutValue"`
		} `json:"economy"`
	}
	if json.Unmarshal([]byte(statsJSON), &stats) != nil {
		return 0, false
	}
	total, players := 0, 0
	for _, stat := range stats {
		if strings.EqualFold(roster[strings.ToLower(stat.Subject)], team) {
			total += stat.Economy.LoadoutValue
			players++
		}
	}
	if players == 0 || total == 0 {
		return 0, false
	}
	return float64(total) / float64(players), true
}

// buyBracket uses the average team loadout: under 1,600 is an eco (pistols
// and light gear), 1,600–3,600 a force or half buy, and above that a full buy
// (rifle plus heavy shields is 3,900).
func buyBracket(avg float64) string {
	switch {
	case avg < 1600:
		return "eco"
	case avg < 3600:
		return "force"
	default:
		return "full"
	}
}

func sessionForm(matches []insightMatch) SessionForm {
	var form SessionForm
	var last int64
	game, lossStreak := 0, 0
	for i, m := range matches {
		if i == 0 || m.start-last > sessionGapMillis {
			form.Sessions++
			game, lossStreak = 0, 0
		}
		last = m.start
		if !m.decided {
			continue
		}
		game++
		form.Decided++
		slot := min(game, 5) - 1
		hour := time.UnixMilli(m.start).Local().Hour() / 4
		if lossStreak >= 2 {
			form.AfterTwoLosses.Attempts++
		}
		form.ByGame[slot].Attempts++
		form.ByHour[hour].Attempts++
		if m.won {
			form.Wins++
			form.ByGame[slot].Wins++
			form.ByHour[hour].Wins++
			if lossStreak >= 2 {
				form.AfterTwoLosses.Wins++
			}
			lossStreak = 0
		} else {
			lossStreak++
		}
	}
	return form
}

// Encounter is the cached history between the local player and one other
// player: games on the same team and against them, with the local result.
type Encounter struct {
	With         int   `json:"with"`
	WithWins     int   `json:"withWins"`
	Against      int   `json:"against"`
	AgainstWins  int   `json:"againstWins"`
	LastPlayedAt int64 `json:"lastPlayedAt"`
}

// GetEncounters returns cached encounters for each of others that shares at
// least one match with local. Wins only count decided Blue/Red matches.
func GetEncounters(db *sql.DB, local string, others []string) (map[string]Encounter, error) {
	local = strings.ToLower(strings.TrimSpace(local))
	out := map[string]Encounter{}
	ids := make([]any, 0, len(others))
	for _, other := range others {
		if other = strings.ToLower(strings.TrimSpace(other)); other != "" && other != local {
			ids = append(ids, other)
		}
	}
	if local == "" || len(ids) == 0 {
		return out, nil
	}
	rows, err := db.Query(`
		SELECT o.subject, o.teamId, me.teamId, m.blueWins, m.blueRoundsWon + m.redRoundsWon, m.gameStartMillis
		FROM match_players me
		JOIN match_players o ON o.matchID = me.matchID AND o.subject <> me.subject
		JOIN matches m ON m.matchID = me.matchID
		WHERE me.subject = ? AND o.subject IN (`+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`)`,
		append([]any{local}, ids...)...)
	if err != nil {
		return nil, fmt.Errorf("tracking: encounters: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var subject, theirTeam, myTeam string
		var blueWins, rounds int
		var start int64
		if err := rows.Scan(&subject, &theirTeam, &myTeam, &blueWins, &rounds, &start); err != nil {
			return nil, fmt.Errorf("tracking: encounters scan: %w", err)
		}
		subject = strings.ToLower(subject)
		e := out[subject]
		blue := strings.EqualFold(myTeam, "Blue")
		decided := rounds > 0 && (blue || strings.EqualFold(myTeam, "Red"))
		won := decided && (blueWins == 1) == blue
		if strings.EqualFold(theirTeam, myTeam) {
			e.With++
			if won {
				e.WithWins++
			}
		} else {
			e.Against++
			if won {
				e.AgainstWins++
			}
		}
		e.LastPlayedAt = max(e.LastPlayedAt, start)
		out[subject] = e
	}
	return out, rows.Err()
}
