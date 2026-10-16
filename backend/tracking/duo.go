package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// DuoChemistry is how two players who queued together back each other up.
// Only standard 5v5 plant/defuse matchmaking games (Competitive, Unrated, Swiftplay,
// Premier, Spike Rush) where both were in the same party and team count. Random teammates,
// custom games and side modes like Skirmish or Deathmatch never mix in.
type DuoChemistry struct {
	Partner string `json:"partner"`
	Games   int    `json:"games"`
	Decided int    `json:"decided"`
	Wins    int    `json:"wins"`
	// Matches with a kill feed; the trade figures only cover these.
	KillFeedGames int `json:"killFeedGames"`
	// Partner deaths you avenged within the trade window, and the reverse.
	YouTradedThem DuoCount `json:"youTradedThem"`
	TheyTradedYou DuoCount `json:"theyTradedYou"`
	// Of each player's first deaths of a round, how many the other one traded.
	YourFirstDeathsCovered  DuoCount `json:"yourFirstDeathsCovered"`
	TheirFirstDeathsCovered DuoCount `json:"theirFirstDeathsCovered"`
	// Kills where the other player is in the assist list.
	TheyAssistedYou int           `json:"theyAssistedYou"`
	YouAssistedThem int           `json:"youAssistedThem"`
	Pairings        []DuoPairing  `json:"pairings"`
	Moments         []DuoMoment   `json:"moments"`
	Recent          []DuoGameLine `json:"recent"`
}

// DuoCount is a count out of the rounds where it could have happened.
type DuoCount struct {
	Count    int `json:"count"`
	Eligible int `json:"eligible"`
}

// DuoPairing is one agent combination the pair has played.
type DuoPairing struct {
	You     string `json:"you"`
	Partner string `json:"partner"`
	Games   int    `json:"games"`
	Decided int    `json:"decided"`
	Wins    int    `json:"wins"`
}

// DuoMoment is one round where a trade between the two happened, newest first.
type DuoMoment struct {
	MatchID string `json:"matchId"`
	Round   int    `json:"round"`
	MapID   string `json:"mapId"`
	Start   int64  `json:"start"`
	Kind    string `json:"kind"` // "you-traded" or "they-traded"
	Gap     int    `json:"gapMillis"`
}

// DuoGameLine is one shared match, newest first.
type DuoGameLine struct {
	MatchID string `json:"matchId"`
	MapID   string `json:"mapId"`
	Start   int64  `json:"start"`
	You     string `json:"you"`
	Partner string `json:"partner"`
	Decided bool   `json:"decided"`
	Won     bool   `json:"won"`
}

type duoMatch struct {
	DuoGameLine
	team, partnerTeam string
}

// ComputeDuoChemistry compares puuid and partner across the cached matches where they shared a party.
func ComputeDuoChemistry(db *sql.DB, puuid, partner, queue string) (*DuoChemistry, error) {
	me := strings.ToLower(strings.TrimSpace(puuid))
	mate := strings.ToLower(strings.TrimSpace(partner))
	if me == "" || mate == "" || me == mate {
		return nil, fmt.Errorf("tracking: ComputeDuoChemistry: two different players are required")
	}
	rows, err := db.Query(`
		SELECT m.matchID, m.mapID, m.gameStartMillis, me.teamId, other.teamId, lower(me.characterId), lower(other.characterId),
		       m.blueRoundsWon + m.redRoundsWon > 0,
		       (m.blueWins = 1 AND lower(me.teamId) = 'blue') OR (m.blueWins = 0 AND lower(me.teamId) = 'red')
		FROM match_players me
		JOIN match_players other ON other.matchID = me.matchID AND other.subject = ? AND other.partyId = me.partyId AND other.teamId = me.teamId
		JOIN matches m ON m.matchID = me.matchID
		WHERE me.subject = ? AND trim(me.partyId) != '' AND `+duoModes+`
		  AND (? = '' OR m.queueID = ?)
		ORDER BY m.gameStartMillis DESC`, mate, me, queue, queue)
	if err != nil {
		return nil, fmt.Errorf("tracking: duo matches: %w", err)
	}
	out := &DuoChemistry{Partner: mate, Pairings: []DuoPairing{}, Moments: []DuoMoment{}, Recent: []DuoGameLine{}}
	matches := map[string]*duoMatch{}
	order := []string{}
	pairings := map[[2]string]*DuoPairing{}
	for rows.Next() {
		var m duoMatch
		if err := rows.Scan(&m.MatchID, &m.MapID, &m.Start, &m.team, &m.partnerTeam, &m.You, &m.Partner, &m.Decided, &m.Won); err != nil {
			rows.Close()
			return nil, err
		}
		m.Won = m.Won && m.Decided
		matches[m.MatchID] = &m
		order = append(order, m.MatchID)
		out.Games++
		key := [2]string{m.You, m.Partner}
		if pairings[key] == nil {
			pairings[key] = &DuoPairing{You: m.You, Partner: m.Partner}
		}
		pairings[key].Games++
		if m.Decided {
			out.Decided++
			pairings[key].Decided++
			if m.Won {
				out.Wins++
				pairings[key].Wins++
			}
		}
		if len(out.Recent) < 10 {
			out.Recent = append(out.Recent, m.DuoGameLine)
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, p := range pairings {
		out.Pairings = append(out.Pairings, *p)
	}
	sort.Slice(out.Pairings, func(i, j int) bool {
		if out.Pairings[i].Games != out.Pairings[j].Games {
			return out.Pairings[i].Games > out.Pairings[j].Games
		}
		return out.Pairings[i].You+out.Pairings[i].Partner < out.Pairings[j].You+out.Pairings[j].Partner
	})
	if len(matches) == 0 {
		return out, nil
	}

	type roundKey struct {
		match string
		round int
	}
	roundKills := map[roundKey][]playKill{}
	rounds := []roundKey{}
	rows, err = db.Query(`
		SELECT k.matchID, k.roundNum, k.gameTime, k.killer, k.victim, k.assistants
		FROM match_kills k JOIN match_players me ON me.matchID = k.matchID AND me.subject = ?
		ORDER BY k.matchID, k.roundNum, k.gameTime`, me)
	if err != nil {
		return nil, fmt.Errorf("tracking: duo kills: %w", err)
	}
	for rows.Next() {
		var matchID, killer, victim, assistJSON string
		var round, at int
		if err := rows.Scan(&matchID, &round, &at, &killer, &victim, &assistJSON); err != nil {
			rows.Close()
			return nil, err
		}
		if matches[matchID] == nil {
			continue
		}
		k := playKill{at: at, killer: strings.ToLower(killer), victim: strings.ToLower(victim)}
		var assistants []string
		if json.Unmarshal([]byte(assistJSON), &assistants) == nil {
			for _, a := range assistants {
				k.assistants = append(k.assistants, strings.ToLower(a))
			}
		}
		key := roundKey{matchID, round}
		if roundKills[key] == nil {
			rounds = append(rounds, key)
		}
		roundKills[key] = append(roundKills[key], k)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	fed := map[string]bool{}
	for _, key := range rounds {
		m := matches[key.match]
		fed[key.match] = true
		r := scoreDuoRound(roundKills[key], me, mate)
		out.YouTradedThem.Eligible += r.mateDeaths
		out.TheyTradedYou.Eligible += r.myDeaths
		out.YouTradedThem.Count += len(r.youTraded)
		out.TheyTradedYou.Count += len(r.theyTraded)
		out.TheyAssistedYou += r.theyAssisted
		out.YouAssistedThem += r.youAssisted
		if r.firstDeath == me {
			out.YourFirstDeathsCovered.Eligible++
			if r.firstCovered {
				out.YourFirstDeathsCovered.Count++
			}
		} else if r.firstDeath == mate {
			out.TheirFirstDeathsCovered.Eligible++
			if r.firstCovered {
				out.TheirFirstDeathsCovered.Count++
			}
		}
		for _, gap := range r.youTraded {
			out.Moments = append(out.Moments, DuoMoment{MatchID: m.MatchID, Round: key.round, MapID: m.MapID, Start: m.Start, Kind: "you-traded", Gap: gap})
		}
		for _, gap := range r.theyTraded {
			out.Moments = append(out.Moments, DuoMoment{MatchID: m.MatchID, Round: key.round, MapID: m.MapID, Start: m.Start, Kind: "they-traded", Gap: gap})
		}
	}
	out.KillFeedGames = len(fed)
	sort.SliceStable(out.Moments, func(i, j int) bool {
		if out.Moments[i].Start != out.Moments[j].Start {
			return out.Moments[i].Start > out.Moments[j].Start
		}
		return out.Moments[i].Round > out.Moments[j].Round
	})
	if len(out.Moments) > 8 {
		out.Moments = out.Moments[:8]
	}
	return out, nil
}

type duoRound struct {
	myDeaths, mateDeaths      int
	youTraded, theyTraded     []int // gap in milliseconds for each trade
	theyAssisted, youAssisted int
	firstDeath                string
	firstCovered              bool
}

// scoreDuoRound walks one round's kill feed (in time order). A trade is the
// other player killing your killer within the trade window, the same rule Insights uses.
func scoreDuoRound(kills []playKill, me, mate string) duoRound {
	var r duoRound
	for i, k := range kills {
		if i == 0 {
			r.firstDeath = k.victim
		}
		if k.killer == me && hasSubject(k.assistants, mate) {
			r.theyAssisted++
		}
		if k.killer == mate && hasSubject(k.assistants, me) {
			r.youAssisted++
		}
		if k.victim != me && k.victim != mate {
			continue
		}
		avenger := mate
		if k.victim == mate {
			avenger = me
			r.mateDeaths++
		} else {
			r.myDeaths++
		}
		for _, later := range kills[i+1:] {
			if later.at-k.at > tradeWindowMillis {
				break
			}
			if later.killer == avenger && later.victim == k.killer {
				if avenger == me {
					r.youTraded = append(r.youTraded, later.at-k.at)
				} else {
					r.theyTraded = append(r.theyTraded, later.at-k.at)
				}
				if i == 0 {
					r.firstCovered = true
				}
				break
			}
		}
	}
	return r
}

func hasSubject(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// duoModes keeps Duo chemistry to standard 5v5 plant/defuse matchmaking.
const duoModes = `m.blueRoundsWon + m.redRoundsWon > 0 AND m.queueID != ''
	AND (m.gameMode LIKE '%/Bomb/%' OR m.gameMode LIKE '%Swiftplay%' OR m.gameMode LIKE '%/QuickBomb/%')`

// ListDuoPartners lists everyone who shared a party and team with puuid in
// standard 5v5 games, across every saved match, most games first.
func ListDuoPartners(db *sql.DB, puuid string, limit int) ([]TeammateStat, error) {
	me := strings.ToLower(strings.TrimSpace(puuid))
	if me == "" {
		return nil, fmt.Errorf("tracking: ListDuoPartners: puuid is required")
	}
	if limit <= 0 {
		limit = 30
	}
	rows, err := db.Query(`
		SELECT other.subject, COUNT(*),
		       SUM(CASE WHEN (m.blueWins = 1 AND lower(me.teamId) = 'blue') OR (m.blueWins = 0 AND lower(me.teamId) = 'red') THEN 1 ELSE 0 END),
		       MAX(m.gameStartMillis)
		FROM match_players me
		JOIN match_players other ON other.matchID = me.matchID AND other.partyId = me.partyId AND other.teamId = me.teamId AND other.subject <> me.subject
		JOIN matches m ON m.matchID = me.matchID
		WHERE me.subject = ? AND trim(me.partyId) != '' AND `+duoModes+`
		GROUP BY other.subject
		ORDER BY COUNT(*) DESC, MAX(m.gameStartMillis) DESC
		LIMIT ?`, me, limit)
	if err != nil {
		return nil, fmt.Errorf("tracking: ListDuoPartners query: %w", err)
	}
	out := []TeammateStat{}
	for rows.Next() {
		var mate TeammateStat
		if err := rows.Scan(&mate.Subject, &mate.Games, &mate.Wins, &mate.LastPlayed); err != nil {
			rows.Close()
			return nil, err
		}
		mate.Decided = mate.Games
		out = append(out, mate)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range out {
		// Name, card and their most played agent with you.
		err := db.QueryRow(`
			SELECT other.gameName, other.tagLine, other.playerCardId,
			       (SELECT lower(o2.characterId) FROM match_players o2 JOIN match_players me2 ON me2.matchID = o2.matchID AND me2.subject = ? AND me2.partyId = o2.partyId
			         WHERE o2.subject = other.subject GROUP BY lower(o2.characterId) ORDER BY COUNT(*) DESC LIMIT 1)
			FROM match_players me
			JOIN match_players other ON other.matchID = me.matchID AND other.partyId = me.partyId AND other.subject = ?
			JOIN matches m ON m.matchID = me.matchID
			WHERE me.subject = ? AND trim(me.partyId) != ''
			ORDER BY (other.gameName != '') DESC, m.gameStartMillis DESC
			LIMIT 1`, me, out[i].Subject, me).Scan(&out[i].GameName, &out[i].TagLine, &out[i].PlayerCardID, &out[i].CharacterID)
		if err != nil && err != sql.ErrNoRows {
			return nil, fmt.Errorf("tracking: ListDuoPartners identity: %w", err)
		}
	}
	return out, nil
}
