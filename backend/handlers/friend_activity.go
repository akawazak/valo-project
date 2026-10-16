package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"backend/riothttp"

	"github.com/truearken/valclient/valclient"
)

// Riot's friend list carries no usable last-online time (last_online_ts is
// null for every friend on the local client, and absent over XMPP). Every
// player's match history is readable, though, so the latest match start is a
// real "last played" time. It is fetched in the background a few friends at a
// time and kept in friend_activity, which is shared across the user's
// accounts because it describes the friend, not the viewer.

const (
	friendActivityRecheck  = 6 * time.Hour
	friendActivityBatch    = 8
	friendActivitySpacing  = 1500 * time.Millisecond
	friendActivityCooldown = 2 * time.Minute
)

var friendActivityRun struct {
	sync.Mutex
	running bool
	lastRun time.Time
}

const friendActivitySchema = `CREATE TABLE IF NOT EXISTS friend_activity (
    peerPuuid   TEXT NOT NULL PRIMARY KEY,
    lastMatchAt INTEGER NOT NULL DEFAULT 0,
    checkedAt   INTEGER NOT NULL DEFAULT 0,
    lastMatchId TEXT NOT NULL DEFAULT '',
    cardId      TEXT NOT NULL DEFAULT ''
)`

// ensureFriendActivity creates the table and adds columns added after v1.
func ensureFriendActivity(db *sql.DB) error {
	if _, err := db.Exec(friendActivitySchema); err != nil {
		return err
	}
	for _, column := range []string{"lastMatchId", "cardId"} {
		var exists int
		if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('friend_activity') WHERE name = ?`, column).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			if _, err := db.Exec(`ALTER TABLE friend_activity ADD COLUMN ` + column + ` TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
	}
	return nil
}

type friendHistoryResponse struct {
	History []struct {
		MatchID       string `json:"MatchID"`
		GameStartTime int64  `json:"GameStartTime"`
	} `json:"History"`
}

// scheduleFriendActivity starts a background refresh of offline friends'
// latest match when one is due. It never blocks the social response.
func (h *Handler) scheduleFriendActivity(r *http.Request, response *SocialStatusResponse) {
	if response == nil || len(response.Presences) == 0 {
		return
	}
	// Only while idle: never compete with agent select, a match or a queue.
	if self := response.SelfPresence; self != nil && socialPresenceIsInGame(*self) {
		return
	}
	friendActivityRun.Lock()
	if friendActivityRun.running || time.Since(friendActivityRun.lastRun) < friendActivityCooldown {
		friendActivityRun.Unlock()
		return
	}
	friendActivityRun.running = true
	friendActivityRun.lastRun = time.Now()
	friendActivityRun.Unlock()
	release := func() {
		friendActivityRun.Lock()
		friendActivityRun.running = false
		friendActivityRun.Unlock()
	}

	db, err := h.trackingDB()
	if err != nil {
		release()
		return
	}
	// Offline friends need a last-played time; anyone without a card (often
	// online on Riot Mobile or another game) needs one looked up too.
	peers := make([]string, 0, len(response.Presences))
	for _, presence := range response.Presences {
		if peer := strings.ToLower(strings.TrimSpace(presence.Puuid)); peer != "" && (!socialPresenceIsActive(presence) || presence.CardID == "") {
			peers = append(peers, peer)
		}
	}
	knownCards := cardsKnownLocally(db, peers)
	due, err := friendsDueForActivity(db, peers, time.Now().Add(-friendActivityRecheck).UnixMilli(), friendActivityBatch)
	if err != nil || len(due) == 0 {
		release()
		return
	}
	client, err := h.getClient(r)
	if err != nil || client == nil {
		release()
		return
	}
	go func() {
		defer release()
		refreshed := 0
		for i, peer := range due {
			if i > 0 {
				time.Sleep(friendActivitySpacing)
			}
			lastMatch, matchID, fetchErr := fetchLatestMatchStart(client, peer)
			var apiErr *riothttp.APIError
			if fetchErr != nil && errors.As(fetchErr, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
				// No readable history on this shard (e.g. another region):
				// record the check so the friend does not block the queue.
				lastMatch, matchID, fetchErr = 0, "", nil
			}
			if fetchErr != nil {
				// Rate limits, expired auth and other failures stop the batch;
				// the remaining friends stay due for a later idle run.
				log.Printf("social: friend activity paused after %d lookups: %v", refreshed, fetchErr)
				return
			}
			// One extra request per friend, once: read their card from that match
			// when no card is known from presence or the local match cache.
			cardID := ""
			if matchID != "" && knownCards[peer] == "" {
				time.Sleep(friendActivitySpacing)
				if card, cardErr := fetchMatchPlayerCard(client, matchID, peer); cardErr == nil {
					cardID = card
				}
			}
			if _, err := db.Exec(`INSERT INTO friend_activity(peerPuuid,lastMatchAt,checkedAt,lastMatchId,cardId) VALUES(?,?,?,?,?)
				ON CONFLICT(peerPuuid) DO UPDATE SET lastMatchAt=MAX(lastMatchAt,excluded.lastMatchAt),checkedAt=excluded.checkedAt,
				lastMatchId=CASE WHEN excluded.lastMatchId<>'' THEN excluded.lastMatchId ELSE lastMatchId END,
				cardId=CASE WHEN excluded.cardId<>'' THEN excluded.cardId ELSE cardId END`,
				peer, lastMatch, time.Now().UnixMilli(), matchID, cardID); err != nil {
				return
			}
			refreshed++
		}
	}()
}

func fetchLatestMatchStart(client *valclient.ValClient, puuid string) (int64, string, error) {
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/match-history/v1/history/%s?startIndex=0&endIndex=3", client.Shard, url.PathEscape(puuid))
	var response friendHistoryResponse
	if err := runRiotJSON(http.MethodGet, apiURL, client.Header, nil, &response); err != nil {
		return 0, "", err
	}
	latest, matchID := int64(0), ""
	for _, item := range response.History {
		if item.GameStartTime > latest {
			latest, matchID = item.GameStartTime, item.MatchID
		}
	}
	return latest, matchID, nil
}

// fetchMatchPlayerCard reads one player's card from a match's details.
func fetchMatchPlayerCard(client *valclient.ValClient, matchID, puuid string) (string, error) {
	apiURL := fmt.Sprintf("https://pd.%s.a.pvp.net/match-details/v1/matches/%s", client.Shard, url.PathEscape(matchID))
	var details struct {
		Players []struct {
			Subject    string `json:"subject"`
			PlayerCard string `json:"playerCard"`
		} `json:"players"`
	}
	if err := runRiotJSON(http.MethodGet, apiURL, client.Header, nil, &details); err != nil {
		return "", err
	}
	for _, player := range details.Players {
		if strings.EqualFold(player.Subject, puuid) {
			return strings.ToLower(player.PlayerCard), nil
		}
	}
	return "", nil
}

// friendsDueForActivity returns up to limit peers never checked or last
// checked before cutoff, oldest check first.
func friendsDueForActivity(db *sql.DB, peers []string, cutoff int64, limit int) ([]string, error) {
	if len(peers) == 0 {
		return nil, nil
	}
	if err := ensureFriendActivity(db); err != nil {
		return nil, err
	}
	checked := map[string]int64{}
	activity, err := readFriendActivity(db, peers, true)
	if err != nil {
		return nil, err
	}
	for peer, row := range activity {
		checked[peer] = row.checkedAt
		// Rows written before match IDs were kept have a match but no card
		// lookup yet; let them come up again on the next idle run.
		if row.lastMatchAt > 0 && row.lastMatchID == "" {
			checked[peer] = 0
		}
	}
	due := make([]string, 0, limit)
	// Never-checked friends first, then the stalest checks.
	for _, peer := range peers {
		if _, seen := checked[peer]; !seen {
			due = append(due, peer)
		}
	}
	for _, peer := range peers {
		if at, seen := checked[peer]; seen && at < cutoff {
			due = append(due, peer)
		}
	}
	if len(due) > limit {
		due = due[:limit]
	}
	return due, nil
}

type friendActivityRow struct {
	lastMatchAt, checkedAt int64
	lastMatchID, cardID    string
}

func readFriendActivity(db *sql.DB, peers []string, ensure bool) (map[string]friendActivityRow, error) {
	out := map[string]friendActivityRow{}
	if len(peers) == 0 {
		return out, nil
	}
	if ensure {
		if err := ensureFriendActivity(db); err != nil {
			return nil, err
		}
	}
	args := make([]any, len(peers))
	for i, peer := range peers {
		args[i] = strings.ToLower(peer)
	}
	rows, err := db.Query(`SELECT peerPuuid,lastMatchAt,checkedAt,lastMatchId,cardId FROM friend_activity WHERE peerPuuid IN (`+strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var peer string
		var row friendActivityRow
		if err := rows.Scan(&peer, &row.lastMatchAt, &row.checkedAt, &row.lastMatchID, &row.cardID); err != nil {
			return nil, err
		}
		out[strings.ToLower(peer)] = row
	}
	return out, rows.Err()
}

// attachFriendActivity copies cached last-played times onto the response.
func attachFriendActivity(db *sql.DB, response *SocialStatusResponse) {
	if db == nil || response == nil || len(response.Presences) == 0 {
		return
	}
	peers := make([]string, 0, len(response.Presences))
	for _, presence := range response.Presences {
		peers = append(peers, presence.Puuid)
	}
	activity, err := readFriendActivity(db, peers, true)
	if err != nil {
		return
	}
	localCards := cardsKnownLocally(db, peers)
	for i := range response.Presences {
		peer := strings.ToLower(response.Presences[i].Puuid)
		row, ok := activity[peer]
		if ok && row.lastMatchAt > 0 {
			response.Presences[i].LastMatchAt = row.lastMatchAt
		}
		if response.Presences[i].CardID == "" {
			if card := localCards[peer]; card != "" {
				response.Presences[i].CardID = card
			} else if ok && row.cardID != "" {
				response.Presences[i].CardID = row.cardID
			}
		}
	}
}

// cardsKnownLocally returns each peer's newest card seen by any of the
// user's accounts (social history) or in a cached match, without Riot calls.
func cardsKnownLocally(db *sql.DB, peers []string) map[string]string {
	out := map[string]string{}
	if db == nil || len(peers) == 0 {
		return out
	}
	args := make([]any, len(peers))
	for i, peer := range peers {
		args[i] = strings.ToLower(peer)
	}
	in := strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")
	// Cached matches first (newest match wins), then social history overrides.
	if rows, err := db.Query(`SELECT mp.subject, mp.playerCardId FROM match_players mp JOIN matches m ON m.matchID = mp.matchID
		WHERE mp.subject IN (`+in+`) AND mp.playerCardId <> '' ORDER BY m.gameStartMillis ASC`, args...); err == nil {
		for rows.Next() {
			var peer, card string
			if rows.Scan(&peer, &card) == nil {
				out[strings.ToLower(peer)] = strings.ToLower(card)
			}
		}
		_ = rows.Close()
	}
	if rows, err := db.Query(`SELECT peerPuuid, playerCardId FROM social_contacts WHERE peerPuuid IN (`+in+`) AND playerCardId <> '' ORDER BY lastSeenAt ASC`, args...); err == nil {
		for rows.Next() {
			var peer, card string
			if rows.Scan(&peer, &card) == nil {
				out[strings.ToLower(peer)] = strings.ToLower(card)
			}
		}
		_ = rows.Close()
	}
	return out
}
