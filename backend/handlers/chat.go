package handlers

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ChatCapabilities struct {
	History        bool `json:"history"`
	DirectMessages bool `json:"directMessages"`
	Party          bool `json:"party"`
}
type ChatParticipant struct {
	Puuid       string `json:"puuid"`
	DisplayName string `json:"displayName"`
}
type ChatConversation struct {
	Key           string              `json:"key"`
	Type          string              `json:"type"`
	DisplayName   string              `json:"displayName"`
	PeerPuuid     string              `json:"peerPuuid"`
	Source        string              `json:"source"`
	State         string              `json:"state"`
	Participants  []ChatParticipant   `json:"participants"`
	LatestMessage *ChatArchiveMessage `json:"latestMessage,omitempty"`
	UnreadCount   int                 `json:"unreadCount"`
	SnapshotState string              `json:"snapshotState,omitempty"`
	Capabilities  ChatCapabilities    `json:"capabilities"`
	RiotCID       string              `json:"-"`
}
type ChatArchiveMessage struct {
	ID              string `json:"id"`
	ClientID        string `json:"clientId,omitempty"`
	ConversationKey string `json:"conversationKey"`
	SenderPuuid     string `json:"senderPuuid"`
	SenderName      string `json:"senderName"`
	Body            string `json:"body"`
	Direction       string `json:"direction"`
	Status          string `json:"status"`
	Error           string `json:"error,omitempty"`
	Timestamp       int64  `json:"timestamp"`
}
type localConversation struct {
	CID         string `json:"cid"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	UnreadCount int    `json:"unread_count"`
	LastMessage any    `json:"last_message"`
}
type localConversationsResponse struct {
	Conversations []localConversation `json:"conversations"`
}
type localMessage struct {
	ID        string `json:"id"`
	CID       string `json:"cid"`
	Puuid     string `json:"puuid"`
	Body      string `json:"body"`
	Message   string `json:"message"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Time      any    `json:"time"`
	Timestamp string `json:"timestamp"`
}
type localMessagesResponse struct {
	Messages []localMessage `json:"messages"`
}
type localParticipantsResponse struct {
	Participants []struct {
		Puuid    string `json:"puuid"`
		Name     string `json:"name"`
		GameName string `json:"game_name"`
		GameTag  string `json:"game_tag"`
	} `json:"participants"`
}

const chatSnapshotRefreshInterval = 30 * time.Second

func chatKey(kind, id string) string {
	return strings.ToLower(strings.TrimSpace(kind)) + ":" + strings.ToLower(strings.TrimSpace(id))
}
func chatEntropy(account string) []byte {
	sum := sha256.Sum256([]byte("VantaVault:Chat:" + strings.ToLower(account)))
	return sum[:]
}
func encodePathKey(key string) string { return base64.RawURLEncoding.EncodeToString([]byte(key)) }
func decodePathKey(key string) string {
	b, err := base64.RawURLEncoding.DecodeString(key)
	if err == nil {
		return string(b)
	}
	return key
}

func localChatConnection() (string, string, error) {
	port, password, err := readRiotLockfile()
	if err != nil {
		return "", "", err
	}
	return "https://127.0.0.1:" + port, "Basic " + base64.StdEncoding.EncodeToString([]byte("riot:"+password)), nil
}

func localChatJSON(method, path string, input, output any) error {
	base, auth, err := localChatConnection()
	if err != nil {
		return err
	}
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, base+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := localChatHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Riot Client chat returned %d", resp.StatusCode)
	}
	if output != nil && len(raw) > 0 {
		return json.Unmarshal(raw, output)
	}
	return nil
}

func chatAccount(r *http.Request) (string, *remoteAuthHeaders, error) {
	auth, ok, err := getRemoteAuthHeaders(r)
	if err != nil {
		return "", nil, err
	}
	if ok && auth.Puuid != "" {
		if selected := selectedAccountPuuid(r); selected != "" && !strings.EqualFold(selected, auth.Puuid) {
			return "", nil, fmt.Errorf("selected Riot account does not match the supplied remote session")
		}
		return strings.ToLower(auth.Puuid), auth, nil
	}
	var session localChatSessionResponse
	if err := localChatJSON(http.MethodGet, "/chat/v1/session", nil, &session); err == nil && session.PUUID != "" {
		if selected := selectedAccountPuuid(r); selected != "" && !strings.EqualFold(selected, session.PUUID) {
			return "", nil, fmt.Errorf("the selected Riot account is not connected remotely; refresh or reconnect it")
		}
		return strings.ToLower(session.PUUID), nil, nil
	}
	return "", nil, fmt.Errorf("authenticated Riot account required")
}

func localChatMatchesAccount(account string) bool {
	var session localChatSessionResponse
	return localChatJSON(http.MethodGet, "/chat/v1/session", nil, &session) == nil &&
		session.PUUID != "" && strings.EqualFold(session.PUUID, account)
}

func encryptChatString(account, value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	return protectChatData([]byte(value), chatEntropy(account))
}
func decryptChatString(account string, value []byte) string {
	if len(value) == 0 {
		return ""
	}
	plain, err := unprotectChatData(value, chatEntropy(account))
	if err != nil {
		return "Unavailable"
	}
	return string(plain)
}

func (h *Handler) archiveConversation(account string, c ChatConversation) error {
	db, err := h.trackingDB()
	if err != nil {
		return err
	}
	if c.Type == "dm" && c.PeerPuuid != "" && c.Key == chatKey("dm", c.PeerPuuid) {
		if err := migrateChatConversationAliases(db, account, c.Key, c.PeerPuuid); err != nil {
			return err
		}
	}
	var exists int
	if db.QueryRow(`SELECT 1 FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, account, c.Key).Scan(&exists) == nil {
		_, err = db.Exec(`UPDATE chat_conversations SET type=?,peerPuuid=?,riotCID=CASE WHEN ?<>'' THEN ? ELSE riotCID END,source=?,unreadCount=CASE WHEN ? THEN ? ELSE unreadCount END,lastMessageAt=MAX(lastMessageAt,?) WHERE accountPuuid=? AND conversationKey=?`, c.Type, c.PeerPuuid, c.RiotCID, c.RiotCID, c.Source, c.Source == "local", c.UnreadCount, func() int64 {
			if c.LatestMessage != nil {
				return c.LatestMessage.Timestamp
			}
			return 0
		}(), account, c.Key)
		return err
	}
	title, err := encryptChatString(account, c.DisplayName)
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO chat_conversations(accountPuuid,conversationKey,type,peerPuuid,riotCID,encryptedTitle,source,unreadCount,lastMessageAt)
		VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(accountPuuid,conversationKey) DO UPDATE SET type=excluded.type,peerPuuid=excluded.peerPuuid,riotCID=CASE WHEN excluded.riotCID<>'' THEN excluded.riotCID ELSE chat_conversations.riotCID END,encryptedTitle=excluded.encryptedTitle,source=excluded.source,unreadCount=CASE WHEN excluded.source='local' THEN excluded.unreadCount ELSE chat_conversations.unreadCount END,lastMessageAt=MAX(chat_conversations.lastMessageAt,excluded.lastMessageAt)`,
		account, c.Key, c.Type, c.PeerPuuid, c.RiotCID, title, c.Source, c.UnreadCount, func() int64 {
			if c.LatestMessage != nil {
				return c.LatestMessage.Timestamp
			}
			return 0
		}())
	return err
}

func migrateChatConversationAliases(db *sql.DB, account, canonicalKey, peer string) error {
	rows, err := db.Query(`SELECT conversationKey,type,riotCID,encryptedTitle,source,historySnapshotState,historySnapshotAt,unreadCount,lastMessageAt,lastReadAt FROM chat_conversations WHERE accountPuuid=? AND lower(peerPuuid)=? AND conversationKey<>?`, account, strings.ToLower(peer), canonicalKey)
	if err != nil {
		return err
	}
	type alias struct {
		key, kind, cid, source, snapshot string
		title                            []byte
		last, read, snapshotAt           int64
		unread                           int
	}
	aliases := []alias{}
	for rows.Next() {
		var item alias
		if err := rows.Scan(&item.key, &item.kind, &item.cid, &item.title, &item.source, &item.snapshot, &item.snapshotAt, &item.unread, &item.last, &item.read); err != nil {
			rows.Close()
			return err
		}
		aliases = append(aliases, item)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range aliases {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT OR IGNORE INTO chat_messages(accountPuuid,conversationKey,messageId,clientId,senderPuuid,encryptedSenderName,encryptedBody,sentAt,direction,status) SELECT accountPuuid,?,messageId,clientId,senderPuuid,encryptedSenderName,encryptedBody,sentAt,direction,status FROM chat_messages WHERE accountPuuid=? AND conversationKey=?`, canonicalKey, account, item.key); err == nil {
			_, err = tx.Exec(`DELETE FROM chat_messages WHERE accountPuuid=? AND conversationKey=?`, account, item.key)
		}
		if err == nil {
			_, err = tx.Exec(`INSERT INTO chat_conversations(accountPuuid,conversationKey,type,peerPuuid,riotCID,encryptedTitle,source,historySnapshotState,historySnapshotAt,unreadCount,lastMessageAt,lastReadAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(accountPuuid,conversationKey) DO UPDATE SET riotCID=CASE WHEN chat_conversations.riotCID<>'' THEN chat_conversations.riotCID ELSE excluded.riotCID END,historySnapshotState=CASE WHEN chat_conversations.historySnapshotState<>'' THEN chat_conversations.historySnapshotState ELSE excluded.historySnapshotState END,historySnapshotAt=MAX(chat_conversations.historySnapshotAt,excluded.historySnapshotAt),unreadCount=MAX(chat_conversations.unreadCount,excluded.unreadCount),encryptedTitle=CASE WHEN length(chat_conversations.encryptedTitle)=0 THEN excluded.encryptedTitle ELSE chat_conversations.encryptedTitle END,lastMessageAt=MAX(chat_conversations.lastMessageAt,excluded.lastMessageAt),lastReadAt=MAX(chat_conversations.lastReadAt,excluded.lastReadAt)`, account, canonicalKey, item.kind, strings.ToLower(peer), item.cid, item.title, item.source, item.snapshot, item.snapshotAt, item.unread, item.last, item.read)
		}
		if err == nil {
			_, err = tx.Exec(`DELETE FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, account, item.key)
		}
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (h *Handler) archiveMessage(account string, m ChatArchiveMessage) error {
	_, err := h.archiveMessageResult(account, m)
	return err
}

// archiveMessageResult reports whether this was a new stored message. Callers
// use that signal for unread counts so XMPP retries and archive snapshots can
// never create duplicate notifications.
func (h *Handler) archiveMessageResult(account string, m ChatArchiveMessage) (bool, error) {
	if strings.TrimSpace(m.Body) == "" {
		return false, nil
	}
	db, err := h.trackingDB()
	if err != nil {
		return false, err
	}
	var exists int
	if db.QueryRow(`SELECT 1 FROM chat_messages WHERE accountPuuid=? AND conversationKey=? AND (messageId=? OR (?<>'' AND clientId=?))`, account, m.ConversationKey, m.ID, m.ClientID, m.ClientID).Scan(&exists) == nil {
		_, err = db.Exec(`UPDATE chat_messages SET status=? WHERE accountPuuid=? AND conversationKey=? AND (messageId=? OR (?<>'' AND clientId=?))`, m.Status, account, m.ConversationKey, m.ID, m.ClientID, m.ClientID)
		return false, err
	}
	body, err := encryptChatString(account, m.Body)
	if err != nil {
		return false, err
	}
	sender, err := encryptChatString(account, m.SenderName)
	if err != nil {
		return false, err
	}
	_, err = db.Exec(`INSERT INTO chat_messages(accountPuuid,conversationKey,messageId,clientId,senderPuuid,encryptedSenderName,encryptedBody,sentAt,direction,status)
		VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(accountPuuid,conversationKey,messageId) DO UPDATE SET clientId=CASE WHEN excluded.clientId<>'' THEN excluded.clientId ELSE chat_messages.clientId END,status=excluded.status`,
		account, m.ConversationKey, m.ID, m.ClientID, m.SenderPuuid, sender, body, m.Timestamp, m.Direction, m.Status)
	if err == nil {
		_, _ = db.Exec(`UPDATE chat_conversations SET lastMessageAt=MAX(lastMessageAt,?) WHERE accountPuuid=? AND conversationKey=?`, m.Timestamp, account, m.ConversationKey)
	}
	return err == nil, err
}

func (h *Handler) archivedMessages(account, key string, before int64, limit int) ([]ChatArchiveMessage, error) {
	db, err := h.trackingDB()
	if err != nil {
		return nil, err
	}
	repairArchivedChatTimestamps(db, account)
	if limit < 1 || limit > 100 {
		limit = 50
	}
	if before <= 0 {
		before = time.Now().Add(24 * time.Hour).UnixMilli()
	}
	rows, err := db.Query(`SELECT messageId,clientId,senderPuuid,encryptedSenderName,encryptedBody,sentAt,direction,status FROM chat_messages WHERE accountPuuid=? AND conversationKey=? AND sentAt<? ORDER BY sentAt DESC LIMIT ?`, account, key, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatArchiveMessage{}
	for rows.Next() {
		var m ChatArchiveMessage
		var sn, b []byte
		if err := rows.Scan(&m.ID, &m.ClientID, &m.SenderPuuid, &sn, &b, &m.Timestamp, &m.Direction, &m.Status); err != nil {
			return nil, err
		}
		m.ConversationKey = key
		m.SenderName = decryptChatString(account, sn)
		m.Body = decryptChatString(account, b)
		out = append(out, m)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

func (h *Handler) archivedConversations(account string) ([]ChatConversation, error) {
	db, err := h.trackingDB()
	if err != nil {
		return nil, err
	}
	repairArchivedChatTimestamps(db, account)
	rows, err := db.Query(`SELECT conversationKey,type,peerPuuid,riotCID,encryptedTitle,source,historySnapshotState,unreadCount,lastMessageAt FROM chat_conversations WHERE accountPuuid=? ORDER BY lastMessageAt DESC`, account)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatConversation{}
	for rows.Next() {
		var c ChatConversation
		var title []byte
		var last int64
		if err := rows.Scan(&c.Key, &c.Type, &c.PeerPuuid, &c.RiotCID, &title, &c.Source, &c.SnapshotState, &c.UnreadCount, &last); err != nil {
			return nil, err
		}
		c.DisplayName = decryptChatString(account, title)
		c.State = "archive"
		c.Capabilities = ChatCapabilities{}
		// This is an unresolved transport placeholder, not a conversation that
		// can be opened safely. Keep its stored data untouched, but never expose
		// it in a chat list or unread summary.
		if c.Type == "dm" && strings.TrimSpace(c.PeerPuuid) == "" {
			continue
		}
		msgs, _ := h.archivedMessages(account, c.Key, 0, 1)
		if len(msgs) > 0 {
			c.LatestMessage = &msgs[len(msgs)-1]
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// repairArchivedChatTimestamps corrects rows imported before Riot message-ID
// timestamps were understood. It never reads message bodies and is idempotent.
func repairArchivedChatTimestamps(db *sql.DB, account string) {
	now := time.Now().Add(24 * time.Hour).UnixMilli()
	oldest := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	_, _ = db.Exec(`UPDATE chat_messages
		SET sentAt=CAST(substr(messageId,1,instr(messageId,':')-1) AS INTEGER)
		WHERE accountPuuid=? AND instr(messageId,':')>1
		AND CAST(substr(messageId,1,instr(messageId,':')-1) AS INTEGER) BETWEEN ? AND ?
		AND sentAt<>CAST(substr(messageId,1,instr(messageId,':')-1) AS INTEGER)`, account, oldest, now)
	_, _ = db.Exec(`UPDATE chat_conversations SET lastMessageAt=COALESCE((
		SELECT MAX(sentAt) FROM chat_messages WHERE chat_messages.accountPuuid=chat_conversations.accountPuuid AND chat_messages.conversationKey=chat_conversations.conversationKey
	),0) WHERE accountPuuid=?`, account)
}

func localTimestamp(m localMessage) int64 {
	var millis int64
	switch value := m.Time.(type) {
	case float64:
		millis = int64(value)
	case string:
		millis, _ = strconv.ParseInt(value, 10, 64)
	case json.Number:
		millis, _ = value.Int64()
	}
	if millis > 0 {
		if millis < 1e12 {
			return millis * 1000
		}
		return millis
	}
	if t, err := time.Parse(time.RFC3339Nano, m.Timestamp); err == nil {
		return t.UnixMilli()
	}
	return time.Now().UnixMilli()
}

func (h *Handler) localConversations(account string, partiesOnly bool) ([]ChatConversation, error) {
	var response localConversationsResponse
	if err := localChatJSON(http.MethodGet, "/chat/v6/conversations", nil, &response); err != nil {
		return nil, err
	}
	// /chat/v4/friends already includes the PUUID and the local conversation
	// ID (pid) for normal DMs. Use that metadata first instead of making one
	// participant request per conversation. Keep /participants as a fallback
	// for party chats and unmatched conversations.
	var friends localFriendsResponse
	if !partiesOnly {
		_ = localChatJSON(http.MethodGet, "/chat/v4/friends", nil, &friends)
	}
	friendsByCID := make(map[string]struct {
		puuid string
		name  string
	}, len(friends.Friends))
	for _, friend := range friends.Friends {
		cid := strings.ToLower(strings.TrimSpace(friend.Pid))
		if cid == "" || strings.TrimSpace(friend.PUUID) == "" {
			continue
		}
		friendsByCID[cid] = struct {
			puuid string
			name  string
		}{puuid: friend.PUUID, name: friendDisplayName(friend.GameName, friend.GameTag, friend.PUUID)}
	}
	out := make([]ChatConversation, 0, len(response.Conversations))
	for _, raw := range response.Conversations {
		if raw.CID == "" {
			continue
		}
		kind := "dm"
		if partiesOnly && !strings.Contains(strings.ToLower(raw.CID), "party") {
			continue
		}
		if strings.Contains(strings.ToLower(raw.Type), "group") && !strings.Contains(strings.ToLower(raw.CID), "party") {
			continue
		}
		if strings.Contains(strings.ToLower(raw.CID), "party") {
			kind = "party"
		}
		key := chatKey(kind, raw.CID)
		c := ChatConversation{Key: key, RiotCID: raw.CID, Type: kind, DisplayName: firstNonEmpty(raw.Name, map[bool]string{true: "Party Chat", false: "Direct message"}[kind == "party"]), Source: "local", State: "live", UnreadCount: raw.UnreadCount, Capabilities: ChatCapabilities{History: true, DirectMessages: true, Party: true}}
		if friend, ok := friendsByCID[strings.ToLower(strings.TrimSpace(raw.CID))]; kind == "dm" && ok {
			c.PeerPuuid = friend.puuid
			c.DisplayName = friend.name
			c.Participants = []ChatParticipant{{Puuid: friend.puuid, DisplayName: friend.name}}
		} else {
			var parts localParticipantsResponse
			if localChatJSON(http.MethodGet, "/chat/v5/participants?cid="+url.QueryEscape(raw.CID), nil, &parts) == nil {
				for _, p := range parts.Participants {
					name := friendDisplayName(p.GameName, p.GameTag, p.Puuid)
					if strings.TrimSpace(p.Name) != "" {
						name = p.Name
					}
					c.Participants = append(c.Participants, ChatParticipant{Puuid: p.Puuid, DisplayName: name})
					if !strings.EqualFold(p.Puuid, account) {
						c.PeerPuuid = p.Puuid
						if kind == "dm" {
							c.DisplayName = name
						}
					}
				}
			}
		}
		if kind == "dm" && c.PeerPuuid != "" {
			c.Key = chatKey("dm", c.PeerPuuid)
		}
		if kind == "dm" && strings.TrimSpace(c.PeerPuuid) == "" {
			continue
		}
		_ = h.archiveConversation(account, c)
		out = append(out, c)
	}
	if len(friends.Friends) > 0 {
		known := make(map[string]bool, len(out))
		for _, c := range out {
			known[strings.ToLower(c.PeerPuuid)] = true
		}
		for _, friend := range friends.Friends {
			if friend.PUUID == "" || friend.Pid == "" || known[strings.ToLower(friend.PUUID)] {
				continue
			}
			c := ChatConversation{Key: chatKey("dm", friend.PUUID), RiotCID: friend.Pid, Type: "dm", DisplayName: friendDisplayName(friend.GameName, friend.GameTag, friend.PUUID), PeerPuuid: friend.PUUID, Source: "local", State: "live", Capabilities: ChatCapabilities{History: true, DirectMessages: true, Party: true}}
			c.Participants = []ChatParticipant{{Puuid: friend.PUUID, DisplayName: c.DisplayName}}
			_ = h.archiveConversation(account, c)
			out = append(out, c)
		}
	}
	return out, nil
}

func (h *Handler) importLocalMessages(account string, c ChatConversation) error {
	cid := firstNonEmpty(c.RiotCID, strings.TrimPrefix(c.Key, c.Type+":"))
	var response localMessagesResponse
	if err := localChatJSON(http.MethodGet, "/chat/v6/messages?cid="+url.QueryEscape(cid), nil, &response); err != nil {
		return err
	}
	for _, raw := range response.Messages {
		body := firstNonEmpty(raw.Body, raw.Message)
		m := ChatArchiveMessage{ID: firstNonEmpty(raw.ID, fmt.Sprintf("local-%d-%x", localTimestamp(raw), sha256.Sum256([]byte(body+raw.Puuid)))), ConversationKey: c.Key, SenderPuuid: raw.Puuid, SenderName: raw.Name, Body: body, Timestamp: localTimestamp(raw), Direction: "incoming", Status: "sent"}
		if strings.EqualFold(raw.Puuid, account) {
			m.Direction = "outgoing"
		}
		_ = h.archiveMessage(account, m)
	}
	return nil
}

func mergeConversations(primary, archive []ChatConversation) []ChatConversation {
	by := map[string]ChatConversation{}
	for _, c := range archive {
		by[c.Key] = c
	}
	for _, c := range primary {
		if old, ok := by[c.Key]; ok {
			if c.LatestMessage == nil {
				c.LatestMessage = old.LatestMessage
			}
			if c.UnreadCount == 0 {
				c.UnreadCount = old.UnreadCount
			}
		}
		by[c.Key] = c
	}
	out := make([]ChatConversation, 0, len(by))
	for _, c := range by {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := int64(0), int64(0)
		if out[i].LatestMessage != nil {
			a = out[i].LatestMessage.Timestamp
		}
		if out[j].LatestMessage != nil {
			b = out[j].LatestMessage.Timestamp
		}
		if a != b {
			return a > b
		}
		return strings.ToLower(out[i].DisplayName) < strings.ToLower(out[j].DisplayName)
	})
	return out
}

func (h *Handler) GetChatConversations(w http.ResponseWriter, r *http.Request) {
	account, auth, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	archive, _ := h.archivedConversations(account)
	var live []ChatConversation
	var localErr error
	if auth != nil {
		// Party chat remains a local-only feature, but it is safe to include when
		// the local Riot Client is signed into this exact selected account.
		if localChatMatchesAccount(account) {
			if local, err := h.localConversations(account, true); err == nil {
				for _, conversation := range local {
					if conversation.Type == "party" {
						live = append(live, conversation)
					}
				}
			}
		}
		session := remoteSocialHub.ensure(auth)
		session.setMessageSink(h.remoteChatMessageSink(account, session))
		session.setArchiveSink(h.remoteChatArchiveSink(account))
		state, roster, messages := session.chatSnapshot()
		presenceNames := make(map[string]string)
		social := session.snapshot()
		h.enrichRemoteSocialNames(auth, &social)
		for _, presence := range social.Presences {
			if presence.Puuid != "" && presence.Name != "" {
				presenceNames[strings.ToLower(presence.Puuid)] = presence.Name
			}
		}
		for peer, item := range roster {
			c := ChatConversation{Key: chatKey("dm", peer), Type: "dm", PeerPuuid: peer, DisplayName: firstNonEmpty(presenceNames[strings.ToLower(peer)], item.Name, friendDisplayName(item.GameName, item.GameTag, peer)), Source: "remote", State: state, Capabilities: ChatCapabilities{History: true, DirectMessages: state == "live"}}
			for _, raw := range messages[peer] {
				m := ChatArchiveMessage{ID: raw.ID, ConversationKey: c.Key, SenderPuuid: raw.FromPuuid, Body: raw.Body, Timestamp: raw.Time, Direction: "incoming", Status: "sent"}
				if strings.EqualFold(raw.FromPuuid, account) {
					m.Direction = "outgoing"
				}
				_ = h.archiveMessage(account, m)
				c.LatestMessage = &m
			}
			_ = h.archiveConversation(account, c)
			live = append(live, c)
		}
	} else {
		live, localErr = h.localConversations(account, false)
	}
	archive, _ = h.archivedConversations(account)
	h.returnAny(w, map[string]any{"conversations": mergeConversations(live, archive), "source": func() string {
		if auth != nil {
			return "remote"
		}
		if localErr == nil {
			return "local"
		}
		return "archive"
	}()})
}

func (h *Handler) GetChatMessages(w http.ResponseWriter, r *http.Request) {
	account, auth, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	key := decodePathKey(r.PathValue("key"))
	before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	messages, err := h.archivedMessages(account, key, before, limit)
	if err != nil {
		h.returnError(w, err)
		return
	}
	state, _ := h.chatSnapshotState(account, key)
	response := map[string]any{"messages": messages, "snapshotState": state}
	if kind, peer, ok := strings.Cut(key, ":"); auth != nil && ok && kind == "dm" {
		if diagnostic := remoteSocialHub.ensure(auth).archiveDiagnostic(peer); diagnostic != nil {
			response["archiveDiagnostic"] = diagnostic
		}
	}
	h.returnAny(w, response)
}

// ChatSummary is deliberately SQLite-only. It is used by the party widget's
// frequent refresh and must never cause a Riot history request.
func (h *Handler) ChatSummary(w http.ResponseWriter, r *http.Request) {
	account, _, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	conversations, err := h.archivedConversations(account)
	if err != nil {
		h.returnError(w, err)
		return
	}
	total := 0
	for _, conversation := range conversations {
		total += conversation.UnreadCount
	}
	h.returnAny(w, map[string]any{"conversations": conversations, "unreadCount": total})
}

func (h *Handler) chatSnapshotState(account, key string) (string, error) {
	state, _, err := h.chatSnapshotStatus(account, key)
	return state, err
}

func (h *Handler) chatSnapshotStatus(account, key string) (string, int64, error) {
	db, err := h.trackingDB()
	if err != nil {
		return "", 0, err
	}
	var state string
	var snapshotAt int64
	err = db.QueryRow(`SELECT historySnapshotState,historySnapshotAt FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, account, key).Scan(&state, &snapshotAt)
	if err == sql.ErrNoRows {
		return "", 0, nil
	}
	return state, snapshotAt, err
}

func chatSnapshotDue(state string, snapshotAt int64, force bool, now time.Time) bool {
	if state == "" || snapshotAt <= 0 {
		return true
	}
	if force && state == "failed" {
		return true
	}
	return now.Sub(time.UnixMilli(snapshotAt)) >= chatSnapshotRefreshInterval
}

func (h *Handler) setChatSnapshotState(account, key, state string) error {
	db, err := h.trackingDB()
	if err != nil {
		return err
	}
	_, err = db.Exec(`UPDATE chat_conversations SET historySnapshotState=?,historySnapshotAt=? WHERE accountPuuid=? AND conversationKey=?`, state, time.Now().UnixMilli(), account, key)
	return err
}

func (h *Handler) archivedConversation(account, key string) (ChatConversation, error) {
	db, err := h.trackingDB()
	if err != nil {
		return ChatConversation{}, err
	}
	var c ChatConversation
	var title []byte
	err = db.QueryRow(`SELECT type,peerPuuid,riotCID,encryptedTitle,source,historySnapshotState,unreadCount FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, account, key).Scan(&c.Type, &c.PeerPuuid, &c.RiotCID, &title, &c.Source, &c.SnapshotState, &c.UnreadCount)
	if err != nil {
		return ChatConversation{}, err
	}
	c.Key = key
	c.DisplayName = decryptChatString(account, title)
	return c, nil
}

func (h *Handler) archivedConversationByCID(account, cid string) (ChatConversation, error) {
	db, err := h.trackingDB()
	if err != nil {
		return ChatConversation{}, err
	}
	var c ChatConversation
	var title []byte
	err = db.QueryRow(`SELECT conversationKey,type,peerPuuid,riotCID,encryptedTitle,source,historySnapshotState,unreadCount FROM chat_conversations WHERE accountPuuid=? AND lower(riotCID)=lower(?) LIMIT 1`, account, strings.TrimSpace(cid)).Scan(&c.Key, &c.Type, &c.PeerPuuid, &c.RiotCID, &title, &c.Source, &c.SnapshotState, &c.UnreadCount)
	if err != nil {
		return ChatConversation{}, err
	}
	c.DisplayName = decryptChatString(account, title)
	return c, nil
}

func (h *Handler) beginChatSnapshot(account, key string) bool {
	h.chatSnapshotMu.Lock()
	defer h.chatSnapshotMu.Unlock()
	if h.chatSnapshots == nil {
		h.chatSnapshots = make(map[string]struct{})
	}
	if _, exists := h.chatSnapshots[account+"\x00"+key]; exists {
		return false
	}
	h.chatSnapshots[account+"\x00"+key] = struct{}{}
	return true
}

// HandleLocalChatEvent receives the existing Riot Client websocket event
// stream. It refreshes metadata, archives event-supplied messages, and if Riot
// only sends a changed CID, imports that one conversation.
func (h *Handler) HandleLocalChatEvent(uri string, data []byte) {
	event := localMessagesFromEvent(data)
	var session localChatSessionResponse
	if localChatJSON(http.MethodGet, "/chat/v1/session", nil, &session) != nil || session.PUUID == "" {
		return
	}
	account := strings.ToLower(session.PUUID)
	// This updates local cids and the Riot-provided unread counts. It is safe
	// on an event because localConversations is metadata-only.
	_, _ = h.localConversations(account, false)
	if len(event.Messages) == 0 {
		if cid := chatCIDFromEvent(uri, data); cid != "" {
			if c, err := h.archivedConversationByCID(account, cid); err == nil {
				_ = h.importLocalMessages(account, c)
			}
		}
		h.NotifyChatChanged()
		return
	}
	for _, raw := range event.Messages {
		if strings.TrimSpace(raw.CID) == "" {
			continue
		}
		db, err := h.trackingDB()
		if err != nil {
			return
		}
		var key string
		if db.QueryRow(`SELECT conversationKey FROM chat_conversations WHERE accountPuuid=? AND riotCID=? LIMIT 1`, account, raw.CID).Scan(&key) != nil {
			continue
		}
		body := firstNonEmpty(raw.Body, raw.Message)
		message := ChatArchiveMessage{ID: firstNonEmpty(raw.ID, fmt.Sprintf("local-%d-%x", localTimestamp(raw), sha256.Sum256([]byte(body+raw.Puuid)))), ConversationKey: key, SenderPuuid: raw.Puuid, SenderName: raw.Name, Body: body, Timestamp: localTimestamp(raw), Direction: "incoming", Status: "sent"}
		if strings.EqualFold(raw.Puuid, account) {
			message.Direction = "outgoing"
		}
		_ = h.archiveMessage(account, message)
	}
	h.NotifyChatChanged()
}

func localMessagesFromEvent(data []byte) localMessagesResponse {
	var direct localMessagesResponse
	if json.Unmarshal(data, &direct) == nil && len(direct.Messages) > 0 {
		return direct
	}
	var root any
	if json.Unmarshal(data, &root) != nil {
		return localMessagesResponse{}
	}
	var messages []localMessage
	findLocalMessages(root, &messages)
	return localMessagesResponse{Messages: messages}
}

func findLocalMessages(value any, out *[]localMessage) {
	switch typed := value.(type) {
	case map[string]any:
		if raw, ok := typed["messages"]; ok {
			encoded, err := json.Marshal(raw)
			if err == nil {
				var messages []localMessage
				if json.Unmarshal(encoded, &messages) == nil && len(messages) > 0 {
					*out = append(*out, messages...)
				}
			}
		}
		for _, child := range typed {
			findLocalMessages(child, out)
		}
	case []any:
		for _, child := range typed {
			findLocalMessages(child, out)
		}
	}
}

func chatCIDFromEvent(uri string, data []byte) string {
	if parsed, err := url.Parse(uri); err == nil {
		if cid := strings.TrimSpace(parsed.Query().Get("cid")); cid != "" {
			return cid
		}
	}
	var root any
	if json.Unmarshal(data, &root) != nil {
		return ""
	}
	return findStringField(root, "cid")
}

func findStringField(value any, field string) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if strings.EqualFold(key, field) {
				if text, ok := child.(string); ok && strings.TrimSpace(text) != "" {
					return strings.TrimSpace(text)
				}
			}
			if found := findStringField(child, field); found != "" {
				return found
			}
		}
	case []any:
		for _, child := range typed {
			if found := findStringField(child, field); found != "" {
				return found
			}
		}
	}
	return ""
}

func (h *Handler) finishChatSnapshot(account, key string) {
	h.chatSnapshotMu.Lock()
	delete(h.chatSnapshots, account+"\x00"+key)
	h.chatSnapshotMu.Unlock()
}

// StartChatSnapshot starts exactly one non-blocking snapshot for a selected
// conversation. The messages route remains a fast SQLite read.
func (h *Handler) StartChatSnapshot(w http.ResponseWriter, r *http.Request) {
	account, auth, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	key := decodePathKey(r.PathValue("key"))
	state, snapshotAt, err := h.chatSnapshotStatus(account, key)
	if err != nil {
		h.returnError(w, err)
		return
	}
	force := r.URL.Query().Get("retry") == "1"
	if !chatSnapshotDue(state, snapshotAt, force, time.Now()) {
		h.returnAny(w, map[string]any{"snapshotState": state})
		return
	}
	conversation, err := h.archivedConversation(account, key)
	if err != nil {
		h.returnError(w, err)
		return
	}
	if !h.beginChatSnapshot(account, key) {
		h.returnAny(w, map[string]any{"snapshotState": "pending"})
		return
	}
	if err := h.setChatSnapshotState(account, key, "pending"); err != nil {
		h.finishChatSnapshot(account, key)
		h.returnError(w, err)
		return
	}
	go func() {
		defer h.finishChatSnapshot(account, key)
		if auth == nil {
			if err := h.importLocalMessages(account, conversation); err != nil {
				_ = h.setChatSnapshotState(account, key, "failed")
			} else {
				_ = h.setChatSnapshotState(account, key, "complete")
			}
			h.NotifyChatChanged()
			return
		}
		kind, peer, ok := strings.Cut(key, ":")
		if !ok || kind != "dm" || auth == nil {
			_ = h.setChatSnapshotState(account, key, "failed")
			h.NotifyChatChanged()
			return
		}
		session := remoteSocialHub.ensure(auth)
		session.setMessageSink(h.remoteChatMessageSink(account, session))
		session.setArchiveSink(h.remoteChatArchiveSink(account))
		if err := session.requestArchive(peer); err != nil {
			_ = h.setChatSnapshotState(account, key, "failed")
		} else {
			// The response arrives asynchronously and is persisted by the message
			// sink. "requested" intentionally prevents repeat archive traffic.
			_ = h.setChatSnapshotState(account, key, "requested")
		}
		h.NotifyChatChanged()
	}()
	h.returnAny(w, map[string]any{"snapshotState": "pending"})
}

func (h *Handler) remoteChatMessageSink(account string, session *xmppSocialSession) func(peer string, raw ChatMessage) {
	return func(peer string, raw ChatMessage) {
		peer = strings.ToLower(strings.TrimSpace(peer))
		if peer == "" {
			return
		}
		conversation := ChatConversation{
			Key:          chatKey("dm", peer),
			Type:         "dm",
			PeerPuuid:    peer,
			DisplayName:  session.peerDisplayName(peer),
			Source:       "remote",
			State:        "live",
			Capabilities: ChatCapabilities{History: true, DirectMessages: true},
		}
		if err := h.archiveConversation(account, conversation); err != nil {
			slog.Warn("remote chat conversation persistence failed", "account_puuid_length", len(account), "peer_puuid_length", len(peer), "err", err)
			return
		}
		message := ChatArchiveMessage{ID: raw.ID, ConversationKey: conversation.Key, SenderPuuid: raw.FromPuuid, Body: raw.Body, Timestamp: raw.Time, Direction: "incoming", Status: "sent"}
		if strings.EqualFold(raw.FromPuuid, account) {
			message.Direction = "outgoing"
		}
		inserted, err := h.archiveMessageResult(account, message)
		if err != nil {
			slog.Warn("remote chat message persistence failed", "account_puuid_length", len(account), "peer_puuid_length", len(peer), "message_id_length", len(raw.ID), "err", err)
			return
		}
		if inserted && message.Direction == "incoming" && !raw.Archived {
			db, dbErr := h.trackingDB()
			if dbErr == nil {
				_, dbErr = db.Exec(`UPDATE chat_conversations SET unreadCount=unreadCount+1 WHERE accountPuuid=? AND conversationKey=?`, account, conversation.Key)
			}
			if dbErr != nil {
				slog.Warn("remote chat unread increment failed", "account_puuid_length", len(account), "peer_puuid_length", len(peer), "err", dbErr)
			}
		}
		h.NotifyChatChanged()
	}
}

// remoteChatArchiveSink records that Riot has finished a cooldown-limited
// archive catch-up. A successful empty result is complete, not loading: Riot
// has no retained messages for that conversation. Failed attempts remain
// retryable without restarting the app.
func (h *Handler) remoteChatArchiveSink(account string) func(peer string, diagnostic xmppArchiveDiagnostic) {
	return func(peer string, diagnostic xmppArchiveDiagnostic) {
		state := "complete"
		if !strings.EqualFold(diagnostic.ResponseType, "result") {
			state = "failed"
		}
		if err := h.setChatSnapshotState(account, chatKey("dm", peer), state); err != nil {
			slog.Warn("remote chat archive state persistence failed", "account_puuid_length", len(account), "peer_puuid_length", len(peer), "state", state, "err", err)
		}
		h.NotifyChatChanged()
	}
}

func mergeRemoteChatMessages(messages []ChatArchiveMessage, live []ChatMessage, account, key string, before int64, limit int) []ChatArchiveMessage {
	byID := make(map[string]int, len(messages))
	for i, message := range messages {
		byID[message.ID] = i
	}
	for _, raw := range live {
		if before > 0 && raw.Time >= before {
			continue
		}
		message := ChatArchiveMessage{ID: raw.ID, ConversationKey: key, SenderPuuid: raw.FromPuuid, Body: raw.Body, Timestamp: raw.Time, Direction: "incoming", Status: "sent"}
		if strings.EqualFold(raw.FromPuuid, account) {
			message.Direction = "outgoing"
		}
		if index, exists := byID[message.ID]; exists {
			messages[index] = message
		} else {
			byID[message.ID] = len(messages)
			messages = append(messages, message)
		}
	}
	sort.Slice(messages, func(i, j int) bool { return messages[i].Timestamp < messages[j].Timestamp })
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}
	return messages
}

func (h *Handler) PostChatMessage(w http.ResponseWriter, r *http.Request) {
	account, auth, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	var input struct {
		ConversationKey string `json:"conversationKey"`
		Body            string `json:"body"`
		ClientID        string `json:"clientId"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&input) != nil || strings.TrimSpace(input.Body) == "" || len([]rune(input.Body)) > 2000 {
		http.Error(w, "valid message required", http.StatusBadRequest)
		return
	}
	key := input.ConversationKey
	kind, id, ok := strings.Cut(key, ":")
	if !ok {
		http.Error(w, "invalid conversation", http.StatusBadRequest)
		return
	}
	m := ChatArchiveMessage{ID: input.ClientID, ClientID: input.ClientID, ConversationKey: key, SenderPuuid: account, Body: input.Body, Timestamp: time.Now().UnixMilli(), Direction: "outgoing", Status: "pending"}
	if m.ID == "" {
		m.ID = fmt.Sprintf("vv-%d", time.Now().UnixNano())
	}
	if kind == "party" {
		if !localChatMatchesAccount(account) {
			err = fmt.Errorf("open Riot Client with the selected account to use Party chat")
		} else {
			// Party keys use the party id, while Riot Client's local send endpoint
			// expects its chat participant/conversation id (pid/cid).
			localCID := id
			if conversation, err := h.archivedConversation(account, key); err == nil && conversation.RiotCID != "" {
				localCID = conversation.RiotCID
			}
			var result localMessagesResponse
			err = localChatJSON(http.MethodPost, "/chat/v6/messages", map[string]any{"cid": localCID, "message": input.Body, "type": map[bool]string{true: "groupchat", false: "chat"}[kind == "party"]}, &result)
			if err == nil {
				if len(result.Messages) > 0 {
					m.ID = firstNonEmpty(result.Messages[0].ID, m.ID)
					m.Timestamp = localTimestamp(result.Messages[0])
				}
				m.Status = "sent"
			}
		}
	} else if auth != nil {
		sent, sendErr := remoteSocialHub.ensure(auth).sendMessage(id, input.Body)
		err = sendErr
		if err == nil {
			m.ID = sent.ID
			m.Timestamp = sent.Time
			m.Status = "sent"
		}
	} else if localChatMatchesAccount(account) {
		localCID := id
		if conversation, findErr := h.archivedConversation(account, key); findErr == nil && conversation.RiotCID != "" {
			localCID = conversation.RiotCID
		}
		var result localMessagesResponse
		err = localChatJSON(http.MethodPost, "/chat/v6/messages", map[string]any{"cid": localCID, "message": input.Body, "type": "chat"}, &result)
		if err == nil {
			if len(result.Messages) > 0 {
				m.ID = firstNonEmpty(result.Messages[0].ID, m.ID)
				m.Timestamp = localTimestamp(result.Messages[0])
			}
			m.Status = "sent"
		}
	} else {
		err = fmt.Errorf("the selected Riot account is not connected")
	}
	if err != nil {
		m.Status = "failed"
		m.Error = err.Error()
	}
	if archiveErr := h.archiveMessage(account, m); archiveErr != nil {
		if m.Error == "" {
			m.Error = "Message was sent but could not be saved locally."
		}
	}
	h.NotifyChatChanged()
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	h.returnAny(w, m)
}

func (h *Handler) PostChatRead(w http.ResponseWriter, r *http.Request) {
	account, _, err := chatAccount(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	key := decodePathKey(r.PathValue("key"))
	db, err := h.trackingDB()
	if err == nil {
		_, err = db.Exec(`UPDATE chat_conversations SET lastReadAt=?,unreadCount=0 WHERE accountPuuid=? AND conversationKey=?`, time.Now().UnixMilli(), account, key)
	}
	if err != nil {
		h.returnError(w, err)
		return
	}
	h.NotifyChatChanged()
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteChatHistory(w http.ResponseWriter, r *http.Request) {
	account, _, err := chatAccount(r)
	if requested := strings.TrimSpace(r.URL.Query().Get("accountPuuid")); requested != "" {
		account = strings.ToLower(requested)
		err = nil
	}
	if err != nil {
		h.returnError(w, err)
		return
	}
	key := decodePathKey(r.URL.Query().Get("conversationKey"))
	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, err)
		return
	}
	tx, err := db.Begin()
	if err == nil {
		if key != "" {
			_, err = tx.Exec(`DELETE FROM chat_messages WHERE accountPuuid=? AND conversationKey=?`, account, key)
			if err == nil {
				_, err = tx.Exec(`DELETE FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, account, key)
			}
		} else {
			_, err = tx.Exec(`DELETE FROM chat_messages WHERE accountPuuid=?`, account)
			if err == nil {
				_, err = tx.Exec(`DELETE FROM chat_conversations WHERE accountPuuid=?`, account)
			}
		}
	}
	if err != nil {
		if tx != nil {
			_ = tx.Rollback()
		}
		h.returnError(w, err)
		return
	}
	_ = tx.Commit()
	h.NotifyChatChanged()
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) NotifyChatChanged() {
	h.chatMu.Lock()
	defer h.chatMu.Unlock()
	if h.chatSubscribers == nil {
		h.chatSubscribers = make(map[chan struct{}]struct{})
	}
	for ch := range h.chatSubscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}
func (h *Handler) ChatEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unavailable", 500)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	local := make(chan struct{}, 1)
	h.chatMu.Lock()
	if h.chatSubscribers == nil {
		h.chatSubscribers = make(map[chan struct{}]struct{})
	}
	h.chatSubscribers[local] = struct{}{}
	h.chatMu.Unlock()
	defer func() { h.chatMu.Lock(); delete(h.chatSubscribers, local); h.chatMu.Unlock() }()
	remote, unsubscribe := remoteSocialHub.subscribe()
	defer unsubscribe()
	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-local:
			fmt.Fprint(w, "event: chat\ndata: {}\n\n")
			flusher.Flush()
		case <-remote:
			fmt.Fprint(w, "event: chat\ndata: {}\n\n")
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

var _ = sql.ErrNoRows
