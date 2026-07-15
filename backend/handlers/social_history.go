package handlers

import (
	"database/sql"
	"strings"
	"time"
)

type storedSocialContact struct {
	name            string
	state           string
	friendshipCount int
}

type storedSocialRequest struct {
	name      string
	state     string
	firstSeen int64
}

// attachSocialHistory records only transitions backed by a complete Riot
// roster/request snapshot. Unavailable or partially loaded responses never
// turn friends into former friends and never resolve pending requests.
func (h *Handler) attachSocialHistory(account string, response *SocialStatusResponse) {
	account = strings.ToLower(strings.TrimSpace(account))
	if account == "" || response == nil || (!response.RosterComplete && !response.RequestsComplete) {
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		return
	}
	if err := recordSocialSnapshot(db, account, response, time.Now().UnixMilli()); err != nil {
		return
	}
	response.Activity, _ = readSocialActivity(db, account, 50)
	firstSeen := map[string]int64{}
	rows, err := db.Query(`SELECT peerPuuid,direction,firstSeenAt FROM social_requests WHERE accountPuuid=? AND state='pending'`, account)
	if err == nil {
		for rows.Next() {
			var peer, direction string
			var at int64
			if rows.Scan(&peer, &direction, &at) == nil {
				firstSeen[peer+"\x00"+direction] = at
			}
		}
		_ = rows.Close()
	}
	for i := range response.Requests {
		response.Requests[i].FirstSeenAt = firstSeen[strings.ToLower(response.Requests[i].Puuid)+"\x00"+response.Requests[i].Direction]
	}
}

func recordSocialSnapshot(db *sql.DB, account string, response *SocialStatusResponse, now int64) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var friendsBaseline, requestsBaseline int64
	err = tx.QueryRow(`SELECT friendsBaselineAt,requestsBaselineAt FROM social_snapshot_state WHERE accountPuuid=?`, account).Scan(&friendsBaseline, &requestsBaseline)
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	contacts := map[string]storedSocialContact{}
	rows, err := tx.Query(`SELECT peerPuuid,displayName,state,friendshipCount FROM social_contacts WHERE accountPuuid=?`, account)
	if err != nil {
		return err
	}
	for rows.Next() {
		var peer string
		var item storedSocialContact
		if err := rows.Scan(&peer, &item.name, &item.state, &item.friendshipCount); err != nil {
			_ = rows.Close()
			return err
		}
		contacts[strings.ToLower(peer)] = item
	}
	_ = rows.Close()

	requests := map[string]storedSocialRequest{}
	rows, err = tx.Query(`SELECT peerPuuid,direction,displayName,state,firstSeenAt FROM social_requests WHERE accountPuuid=?`, account)
	if err != nil {
		return err
	}
	for rows.Next() {
		var peer, direction string
		var item storedSocialRequest
		if err := rows.Scan(&peer, &direction, &item.name, &item.state, &item.firstSeen); err != nil {
			_ = rows.Close()
			return err
		}
		requests[strings.ToLower(peer)+"\x00"+direction] = item
	}
	_ = rows.Close()

	friends := map[string]SocialPresence{}
	if response.RosterComplete {
		for _, presence := range response.Presences {
			peer := strings.ToLower(strings.TrimSpace(presence.Puuid))
			if peer != "" {
				friends[peer] = presence
			}
		}
		for peer, presence := range friends {
			current, exists := contacts[peer]
			name := strings.TrimSpace(presence.Name)
			lastOnline := int64(0)
			if socialPresenceIsActive(presence) {
				lastOnline = now
			}
			switch {
			case !exists:
				if _, err = tx.Exec(`INSERT INTO social_contacts(accountPuuid,peerPuuid,displayName,state,firstSeenAt,lastSeenAt,lastSeenOnlineAt,friendshipCount) VALUES(?,?,?,?,?,?,?,1)`, account, peer, name, "friend", now, now, lastOnline); err != nil {
					return err
				}
				if err = insertSocialEvent(tx, account, peer, name, "friend_first_observed", now, response.Source+":baseline"); err != nil {
					return err
				}
			case current.state != "friend":
				if _, err = tx.Exec(`UPDATE social_contacts SET displayName=?,state='friend',lastSeenAt=?,lastSeenOnlineAt=MAX(lastSeenOnlineAt,?),friendshipCount=friendshipCount+1 WHERE accountPuuid=? AND peerPuuid=?`, firstNonEmpty(name, current.name), now, lastOnline, account, peer); err != nil {
					return err
				}
				if err = insertSocialEvent(tx, account, peer, firstNonEmpty(name, current.name), "friend_readded", now, response.Source+":roster_transition"); err != nil {
					return err
				}
			default:
				if _, err = tx.Exec(`UPDATE social_contacts SET displayName=?,lastSeenAt=?,lastSeenOnlineAt=MAX(lastSeenOnlineAt,?) WHERE accountPuuid=? AND peerPuuid=?`, firstNonEmpty(name, current.name), now, lastOnline, account, peer); err != nil {
					return err
				}
			}
		}
		if friendsBaseline > 0 {
			for peer, contact := range contacts {
				if contact.state != "friend" {
					continue
				}
				if _, present := friends[peer]; present {
					continue
				}
				if _, err = tx.Exec(`UPDATE social_contacts SET state='former',lastSeenAt=? WHERE accountPuuid=? AND peerPuuid=?`, now, account, peer); err != nil {
					return err
				}
				if err = insertSocialEvent(tx, account, peer, contact.name, "friendship_ended", now, response.Source+":roster_transition_actor_unknown"); err != nil {
					return err
				}
			}
		}
		friendsBaseline = firstNonZero(friendsBaseline, now)
	}

	if response.RequestsComplete {
		currentRequests := map[string]SocialFriendRequest{}
		for _, request := range response.Requests {
			peer := strings.ToLower(strings.TrimSpace(request.Puuid))
			if peer == "" || (request.Direction != "incoming" && request.Direction != "outgoing") {
				continue
			}
			request.Puuid = peer
			currentRequests[peer+"\x00"+request.Direction] = request
		}
		for key, request := range currentRequests {
			stored, exists := requests[key]
			if !exists && request.Direction == "outgoing" {
				for oldKey, candidate := range requests {
					parts := strings.SplitN(oldKey, "\x00", 2)
					if len(parts) != 2 || !strings.HasPrefix(parts[0], "riot-id:") || parts[1] != "outgoing" || candidate.state != "pending" || !strings.EqualFold(candidate.name, request.Name) {
						continue
					}
					if _, err = tx.Exec(`UPDATE social_requests SET peerPuuid=?,displayName=?,lastSeenAt=? WHERE accountPuuid=? AND peerPuuid=? AND direction='outgoing'`, request.Puuid, firstNonEmpty(request.Name, candidate.name), now, account, parts[0]); err != nil {
						return err
					}
					stored, exists = candidate, true
					delete(requests, oldKey)
					requests[key] = candidate
					break
				}
			}
			if !exists {
				if _, err = tx.Exec(`INSERT INTO social_requests(accountPuuid,peerPuuid,direction,state,displayName,firstSeenAt,lastSeenAt) VALUES(?,?,?,'pending',?,?,?)`, account, request.Puuid, request.Direction, request.Name, now, now); err != nil {
					return err
				}
				eventType := "request_received"
				if request.Direction == "outgoing" {
					eventType = "request_sent"
				}
				if err = insertSocialEvent(tx, account, request.Puuid, request.Name, eventType, now, response.Source+":first_observed"); err != nil {
					return err
				}
			} else if stored.state != "pending" {
				if _, err = tx.Exec(`UPDATE social_requests SET state='pending',displayName=?,firstSeenAt=?,lastSeenAt=?,resolvedAt=0 WHERE accountPuuid=? AND peerPuuid=? AND direction=?`, firstNonEmpty(request.Name, stored.name), now, now, account, request.Puuid, request.Direction); err != nil {
					return err
				}
			} else if _, err = tx.Exec(`UPDATE social_requests SET displayName=?,lastSeenAt=? WHERE accountPuuid=? AND peerPuuid=? AND direction=?`, firstNonEmpty(request.Name, stored.name), now, account, request.Puuid, request.Direction); err != nil {
				return err
			}
		}
		if requestsBaseline > 0 {
			for key, stored := range requests {
				if stored.state != "pending" {
					continue
				}
				if _, present := currentRequests[key]; present {
					continue
				}
				parts := strings.SplitN(key, "\x00", 2)
				peer, direction := parts[0], parts[1]
				eventType, evidence := "request_closed_unknown", response.Source+":request_transition"
				if response.RosterComplete {
					if _, isFriend := friends[peer]; isFriend {
						eventType = "request_accepted_by_you"
						if direction == "outgoing" {
							eventType = "request_accepted_by_them"
						}
						evidence = response.Source + ":pending_to_friend"
					}
				}
				if _, err = tx.Exec(`UPDATE social_requests SET state='resolved',resolvedAt=? WHERE accountPuuid=? AND peerPuuid=? AND direction=?`, now, account, peer, direction); err != nil {
					return err
				}
				if err = insertSocialEvent(tx, account, peer, stored.name, eventType, now, evidence); err != nil {
					return err
				}
			}
		}
		requestsBaseline = firstNonZero(requestsBaseline, now)
	}

	_, err = tx.Exec(`INSERT INTO social_snapshot_state(accountPuuid,friendsBaselineAt,requestsBaselineAt,lastCompleteAt) VALUES(?,?,?,?) ON CONFLICT(accountPuuid) DO UPDATE SET friendsBaselineAt=excluded.friendsBaselineAt,requestsBaselineAt=excluded.requestsBaselineAt,lastCompleteAt=excluded.lastCompleteAt`, account, friendsBaseline, requestsBaseline, now)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func insertSocialEvent(tx *sql.Tx, account, peer, name, eventType string, occurredAt int64, evidence string) error {
	_, err := tx.Exec(`INSERT INTO social_events(accountPuuid,peerPuuid,displayName,eventType,occurredAt,evidence) VALUES(?,?,?,?,?,?)`, account, peer, name, eventType, occurredAt, evidence)
	return err
}

// recordSocialRequestAction makes an explicit successful user action visible
// immediately. Roster snapshots still reconcile the final Riot state later.
func (h *Handler) recordSocialRequestAction(account, peer, name, direction, eventType string) {
	account = strings.ToLower(strings.TrimSpace(account))
	peer = strings.ToLower(strings.TrimSpace(peer))
	name = strings.TrimSpace(name)
	if account == "" || peer == "" || eventType == "" {
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		return
	}
	now := time.Now().UnixMilli()
	tx, err := db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()
	if eventType == "request_cancelled" {
		_, err = tx.Exec(`UPDATE social_requests SET state='resolved',resolvedAt=? WHERE accountPuuid=? AND peerPuuid=? AND direction='outgoing'`, now, account, peer)
	} else if eventType == "request_sent" && direction == "outgoing" {
		_, err = tx.Exec(`INSERT INTO social_requests(accountPuuid,peerPuuid,direction,state,displayName,firstSeenAt,lastSeenAt,resolvedAt) VALUES(?,?,?,'pending',?,?,?,0) ON CONFLICT(accountPuuid,peerPuuid,direction) DO UPDATE SET state='pending',displayName=excluded.displayName,lastSeenAt=excluded.lastSeenAt,resolvedAt=0`, account, peer, direction, name, now, now)
	}
	if err != nil {
		return
	}
	var duplicate int
	_ = tx.QueryRow(`SELECT 1 FROM social_events WHERE accountPuuid=? AND eventType=? AND (peerPuuid=? OR (?<>'' AND lower(displayName)=lower(?))) AND occurredAt>? LIMIT 1`, account, eventType, peer, name, name, now-5000).Scan(&duplicate)
	if duplicate == 0 {
		if err = insertSocialEvent(tx, account, peer, name, eventType, now, "user_action"); err != nil {
			return
		}
	}
	_ = tx.Commit()
}

func readSocialActivity(db *sql.DB, account string, limit int) ([]SocialActivityEvent, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(`SELECT id,peerPuuid,displayName,eventType,occurredAt,evidence FROM social_events WHERE accountPuuid=? ORDER BY occurredAt DESC,id DESC LIMIT ?`, account, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SocialActivityEvent, 0, limit)
	for rows.Next() {
		var event SocialActivityEvent
		if err := rows.Scan(&event.ID, &event.PeerPuuid, &event.Name, &event.Type, &event.OccurredAt, &event.Evidence); err != nil {
			return nil, err
		}
		out = append(out, event)
	}
	return out, rows.Err()
}

func firstNonZero(value, fallback int64) int64 {
	if value != 0 {
		return value
	}
	return fallback
}
