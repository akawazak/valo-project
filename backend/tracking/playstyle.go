package tracking

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Playstyle scores six habits from cached matches. Each score compares the
// player with the other nine players in the same lobbies, so 50 means
// "typical for the games you play" and needs no outside population data.
type Playstyle struct {
	Matches int             `json:"matches"`
	Recent  int             `json:"recent"`
	Axes    []PlaystyleAxis `json:"axes"`
	// FirstDeath ranks how often the player dies first in a round (higher = more often than the lobby).
	FirstDeath PlaystyleAxis `json:"firstDeath"`
}

// PlaystyleAxis holds a 0–100 score plus the raw figure behind it. RecentScore
// covers the latest matches only and is -1 when there are too few of them.
type PlaystyleAxis struct {
	Key         string  `json:"key"`
	Score       int     `json:"score"`
	RecentScore int     `json:"recentScore"`
	Value       float64 `json:"value"`
	Lobby       float64 `json:"lobby"`
}

const (
	playstyleMinMatches = 5
	playstyleRecent     = 20
	tradeWindowMillis   = 5000
)

var playstyleKeys = []string{"aim", "entry", "clutch", "teamplay", "economy", "consistency"}

// playKill is one kill in feed order, subjects lowercased.
type playKill struct {
	at             int
	killer, victim string
	assistants     []string
}

// playerLine is one player's figures for one match.
type playerLine struct {
	team                                                                        string
	kills, deaths, assists, hs, body, legs, damage, rounds                      int
	firstKills, firstDeaths, trades, kastRounds, spent, clutchTries, clutchWins int
}

func (p *playerLine) metric(key string) (float64, bool) {
	rounds := float64(p.rounds)
	if p.rounds == 0 {
		return 0, false
	}
	switch key {
	case "hs":
		shots := p.hs + p.body + p.legs
		if shots == 0 {
			return 0, false
		}
		return float64(p.hs) / float64(shots), true
	case "adr":
		return float64(p.damage) / rounds, true
	case "entry":
		return float64(p.firstKills) / rounds, true
	case "firstDeath":
		return float64(p.firstDeaths) / rounds, true
	case "teamplay":
		return float64(p.assists+p.trades) / rounds, true
	case "economy":
		if p.spent < 1000 {
			return 0, false
		}
		return float64(p.damage) / float64(p.spent) * 1000, true
	case "consistency":
		return float64(p.kastRounds) / rounds, true
	}
	return 0, false
}

// lobbyRank is the share of the other players in a match who scored below the
// player (ties count half). It returns false when nobody can be compared.
func lobbyRank(lines map[string]*playerLine, me, key string) (float64, bool) {
	mine, ok := lines[me].metric(key)
	if !ok {
		return 0, false
	}
	below, others := 0.0, 0
	for subject, line := range lines {
		if subject == me {
			continue
		}
		value, ok := line.metric(key)
		if !ok {
			continue
		}
		others++
		if value < mine {
			below++
		} else if value == mine {
			below += .5
		}
	}
	if others == 0 {
		return 0, false
	}
	return below / float64(others), true
}

// computePlaystyle scores matches (oldest first) in round-based queues.
func computePlaystyle(db *sql.DB, puuid string, matches []insightMatch) (*Playstyle, error) {
	var ids []string
	for _, m := range matches {
		if _, ok := economyQueues[m.queue]; ok && m.decided {
			ids = append(ids, m.id)
		}
	}
	if len(ids) < playstyleMinMatches {
		return nil, nil
	}
	lines := map[string]map[string]*playerLine{}
	for _, id := range ids {
		lines[id] = map[string]*playerLine{}
	}

	rows, err := db.Query(`
		SELECT p.matchID, p.subject, p.teamId, p.kills, p.deaths, p.assists, p.headshots, p.bodyshots, p.legshots, p.damageDealt, p.roundsPlayed
		FROM match_players p JOIN match_players me ON me.matchID = p.matchID AND me.subject = ?`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: playstyle players: %w", err)
	}
	for rows.Next() {
		var matchID, subject string
		line := &playerLine{}
		if err := rows.Scan(&matchID, &subject, &line.team, &line.kills, &line.deaths, &line.assists, &line.hs, &line.body, &line.legs, &line.damage, &line.rounds); err != nil {
			rows.Close()
			return nil, err
		}
		if lines[matchID] != nil {
			lines[matchID][strings.ToLower(subject)] = line
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	type roundKey struct {
		match string
		round int
	}
	roundKills := map[roundKey][]playKill{}
	rows, err = db.Query(`
		SELECT k.matchID, k.roundNum, k.gameTime, k.killer, k.victim, k.assistants
		FROM match_kills k JOIN match_players me ON me.matchID = k.matchID AND me.subject = ?
		ORDER BY k.matchID, k.roundNum, k.gameTime`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: playstyle kills: %w", err)
	}
	for rows.Next() {
		var matchID, killer, victim, assistJSON string
		var round, at int
		if err := rows.Scan(&matchID, &round, &at, &killer, &victim, &assistJSON); err != nil {
			rows.Close()
			return nil, err
		}
		if lines[matchID] == nil {
			continue
		}
		k := playKill{at: at, killer: strings.ToLower(killer), victim: strings.ToLower(victim)}
		var assistants []string
		if json.Unmarshal([]byte(assistJSON), &assistants) == nil {
			for _, a := range assistants {
				k.assistants = append(k.assistants, strings.ToLower(a))
			}
		}
		roundKills[roundKey{matchID, round}] = append(roundKills[roundKey{matchID, round}], k)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	rows, err = db.Query(`
		SELECT r.matchID, r.roundNum, r.winningTeam, r.playerStats
		FROM match_rounds r JOIN match_players me ON me.matchID = r.matchID AND me.subject = ?`, puuid)
	if err != nil {
		return nil, fmt.Errorf("tracking: playstyle rounds: %w", err)
	}
	for rows.Next() {
		var matchID, winner, statsJSON string
		var round int
		if err := rows.Scan(&matchID, &round, &winner, &statsJSON); err != nil {
			rows.Close()
			return nil, err
		}
		match := lines[matchID]
		if match == nil {
			continue
		}
		var stats []struct {
			Subject string `json:"subject"`
			Economy struct {
				Spent int `json:"spent"`
			} `json:"economy"`
		}
		if json.Unmarshal([]byte(statsJSON), &stats) == nil {
			for _, stat := range stats {
				if line := match[strings.ToLower(stat.Subject)]; line != nil {
					line.spent += stat.Economy.Spent
				}
			}
		}
		scoreRound(match, roundKills[roundKey{matchID, round}], winner)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	// Kill-based axes need the kill feed; skip matches cached without it.
	var scored []string
	for _, id := range ids {
		if lines[id][puuid] != nil && lines[id][puuid].rounds > 0 && len(lines[id]) >= 4 {
			scored = append(scored, id)
		}
	}
	if len(scored) < playstyleMinMatches {
		return nil, nil
	}
	recent := scored
	if len(recent) > playstyleRecent {
		recent = recent[len(recent)-playstyleRecent:]
	}
	out := &Playstyle{Matches: len(scored), Recent: len(recent)}
	for _, key := range playstyleKeys {
		axis := PlaystyleAxis{Key: key, RecentScore: -1}
		axis.Score, axis.Value, axis.Lobby = axisScore(lines, puuid, scored, key)
		if len(recent) >= 10 && len(recent) < len(scored) {
			axis.RecentScore, _, _ = axisScore(lines, puuid, recent, key)
		}
		out.Axes = append(out.Axes, axis)
	}
	out.FirstDeath = PlaystyleAxis{Key: "firstDeath", RecentScore: -1}
	out.FirstDeath.Score, out.FirstDeath.Value, out.FirstDeath.Lobby = axisScore(lines, puuid, scored, "firstDeath")
	return out, nil
}

// scoreRound adds one round's first kill, trades, KAST and clutch result to
// every player. Riot's feed has no revives, so those rounds only undercount.
func scoreRound(match map[string]*playerLine, kills []playKill, winner string) {
	if len(kills) == 0 {
		return
	}
	if first, victim := match[kills[0].killer], match[kills[0].victim]; first != nil && victim != nil && first.team != victim.team {
		first.firstKills++
		victim.firstDeaths++
	}
	contributed := map[string]bool{}
	deathAt := map[string]int{}
	killedBy := map[string]string{}
	alive := map[string]int{}
	for _, line := range match {
		alive[line.team]++
	}
	clutcher := map[string]string{}
	for _, k := range kills {
		killer, victim := match[k.killer], match[k.victim]
		if killer != nil && victim != nil && killer.team != victim.team {
			contributed[k.killer] = true
			// A trade: this victim had killed one of the killer's teammates moments ago.
			for teammate, by := range killedBy {
				if by == k.victim && match[teammate] != nil && match[teammate].team == killer.team && k.at-deathAt[teammate] <= tradeWindowMillis {
					killer.trades++
					contributed[teammate] = true
					break
				}
			}
		}
		for _, a := range k.assistants {
			contributed[a] = true
		}
		if victim != nil {
			if _, dead := deathAt[k.victim]; !dead {
				deathAt[k.victim] = k.at
				killedBy[k.victim] = k.killer
				alive[victim.team]--
				if alive[victim.team] == 1 && clutcher[victim.team] == "" {
					for subject, line := range match {
						if _, gone := deathAt[subject]; line.team == victim.team && !gone {
							enemies := 0
							for team, count := range alive {
								if team != victim.team {
									enemies += count
								}
							}
							if enemies > 0 {
								clutcher[victim.team] = subject
							}
						}
					}
				}
			}
		}
	}
	for subject, line := range match {
		if _, dead := deathAt[subject]; !dead || contributed[subject] {
			line.kastRounds++
		}
	}
	// Riot's round winner decides the clutch, so defuses and detonations count.
	for team, subject := range clutcher {
		line := match[subject]
		line.clutchTries++
		if strings.EqualFold(team, winner) {
			line.clutchWins++
		}
	}
}

// axisScore averages the player's lobby rank over matchIDs. Clutches are too
// rare per match to rank, so that axis compares win rates instead: the lobby
// rate scores 50 and twice it scores 100.
func axisScore(lines map[string]map[string]*playerLine, me string, matchIDs []string, key string) (int, float64, float64) {
	if key == "clutch" {
		var tries, wins, lobbyTries, lobbyWins int
		for _, id := range matchIDs {
			for subject, line := range lines[id] {
				if subject == me {
					tries += line.clutchTries
					wins += line.clutchWins
				} else {
					lobbyTries += line.clutchTries
					lobbyWins += line.clutchWins
				}
			}
		}
		if tries == 0 || lobbyTries == 0 || lobbyWins == 0 {
			return 50, 0, 0
		}
		mine, lobby := float64(wins)/float64(tries), float64(lobbyWins)/float64(lobbyTries)
		return clampScore(50 * mine / lobby), mine * 100, lobby * 100
	}
	metrics := []string{key}
	if key == "aim" {
		metrics = []string{"hs", "adr"}
	}
	var total float64
	var count int
	var value, lobby float64
	var valueN, lobbyN int
	for _, id := range matchIDs {
		var rank float64
		ranked := 0
		for _, metric := range metrics {
			if r, ok := lobbyRank(lines[id], me, metric); ok {
				rank += r
				ranked++
			}
		}
		if ranked > 0 {
			total += rank / float64(ranked)
			count++
		}
		// The raw figure shown beside the score: HS% for aim, otherwise the metric itself.
		primary := metrics[0]
		for subject, line := range lines[id] {
			if v, ok := line.metric(primary); ok {
				if subject == me {
					value += v
					valueN++
				} else {
					lobby += v
					lobbyN++
				}
			}
		}
	}
	if count == 0 {
		return 50, 0, 0
	}
	if valueN > 0 {
		value /= float64(valueN)
	}
	if lobbyN > 0 {
		lobby /= float64(lobbyN)
	}
	return clampScore(total / float64(count) * 100), value, lobby
}

func clampScore(v float64) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return int(v + .5)
}
