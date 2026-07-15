package handlers

import (
	"bufio"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var remoteSocialHub = &xmppSocialHub{sessions: map[string]*xmppSocialSession{}, subscribers: map[chan struct{}]struct{}{}}

// ChatMessage remains internal to the XMPP transport so incoming message
// stanzas can be safely consumed. VantaVault no longer exposes chat routes.
type ChatMessage struct {
	ID        string `json:"id"`
	FromPuuid string `json:"fromPuuid"`
	Body      string `json:"body"`
	Time      int64  `json:"time"`
	Archived  bool   `json:"-"`
}

type xmppSocialHub struct {
	mu          sync.Mutex
	sessions    map[string]*xmppSocialSession
	subscribers map[chan struct{}]struct{}
}

type xmppSocialSession struct {
	mu                 sync.RWMutex
	writeMu            sync.Mutex
	key                string
	auth               remoteAuthHeaders
	host               string
	domain             string
	port               int
	state              string
	lastError          string
	lastAttempt        time.Time
	reconnectDelay     time.Duration
	roster             map[string]xmppRosterItem
	requests           map[string]SocialFriendRequest
	requestJIDs        map[string]string
	optimisticRequests map[string]time.Time
	suppressedRequests map[string]time.Time
	rosterLoaded       bool
	presences          map[string]chatPresenceEntry
	selfPresences      map[string]chatPresenceEntry
	running            bool
	conn               net.Conn
	messages           map[string][]ChatMessage
	archiveRequests    map[string]string
	archiveRequested   map[string]time.Time
	archiveQueued      map[string]struct{}
	archivePaused      bool
	archivePausedAt    time.Time
	archiveDiagnostics map[string]xmppArchiveDiagnostic
	messageSink        func(peer string, message ChatMessage)
	archiveSink        func(peer string, diagnostic xmppArchiveDiagnostic)
}

// xmppArchiveDiagnostic deliberately excludes XMPP payloads, JIDs, player
// names, tokens, and message bodies. It is only for determining which archive
// response shape Riot actually returns to a request.
type xmppArchiveDiagnostic struct {
	RequestID     string   `json:"requestId"`
	ResponseType  string   `json:"responseType"`
	ErrorCode     string   `json:"errorCode,omitempty"`
	ErrorText     string   `json:"errorText,omitempty"`
	MessageCount  int      `json:"messageCount"`
	MessageShapes []string `json:"messageShapes,omitempty"`
}

type xmppMessage struct {
	From  string `xml:"from,attr"`
	To    string `xml:"to,attr"`
	Type  string `xml:"type,attr"`
	ID    string `xml:"id,attr"`
	Body  string `xml:"body"`
	Stamp string `xml:"stamp,attr"`
	Delay struct {
		Stamp string `xml:"stamp,attr"`
	} `xml:"delay"`
	LegacyDelay struct {
		Stamp string `xml:"stamp,attr"`
	} `xml:"x"`
	Archived struct {
		ID        string `xml:"id,attr"`
		Stamp     string `xml:"stamp,attr"`
		Timestamp string `xml:"timestamp,attr"`
	} `xml:"archived"`
}

type xmppRosterItem struct {
	JID          string
	PUUID        string
	Name         string
	GameName     string
	GameTag      string
	Subscription string
}

type xmppIQ struct {
	ID       string `xml:"id,attr"`
	Type     string `xml:"type,attr"`
	InnerXML string `xml:",innerxml"`
	Query    struct {
		XMLName  xml.Name
		InnerXML string `xml:",innerxml"`
		Items    []struct {
			JID          string `xml:"jid,attr"`
			Name         string `xml:"name,attr"`
			GameName     string `xml:"game_name,attr"`
			GameTag      string `xml:"game_tag,attr"`
			PUUID        string `xml:"puuid,attr"`
			Subscription string `xml:"subscription,attr"`
			Ask          string `xml:"ask,attr"`
			ID           struct {
				Name    string `xml:"name,attr"`
				Tagline string `xml:"tagline,attr"`
			} `xml:"id"`
		} `xml:"item"`
	} `xml:"query"`
	Error struct {
		Code     string `xml:"code,attr"`
		Type     string `xml:"type,attr"`
		Text     string `xml:"text"`
		InnerXML string `xml:",innerxml"`
	} `xml:"error"`
}

type xmppPresence struct {
	From   string `xml:"from,attr"`
	Type   string `xml:"type,attr"`
	Name   string `xml:"name,attr"`
	Show   string `xml:"show"`
	Status string `xml:"status"`
	Games  *struct {
		Valorant *struct {
			State     string `xml:"st"`
			Timestamp int64  `xml:"s.t"`
			Payload   string `xml:"p"`
		} `xml:"valorant"`
	} `xml:"games"`
}

func fetchRemoteSocialStatus(auth *remoteAuthHeaders) SocialStatusResponse {
	session := remoteSocialHub.ensure(auth)
	return session.snapshot()
}

func (h *xmppSocialHub) ensure(auth *remoteAuthHeaders) *xmppSocialSession {
	key := strings.ToLower(strings.TrimSpace(auth.Puuid)) + ":" + strings.ToLower(strings.TrimSpace(auth.Region))
	h.mu.Lock()
	session := h.sessions[key]
	if session == nil {
		session = &xmppSocialSession{
			key:                key,
			roster:             map[string]xmppRosterItem{},
			requests:           map[string]SocialFriendRequest{},
			requestJIDs:        map[string]string{},
			optimisticRequests: map[string]time.Time{},
			suppressedRequests: map[string]time.Time{},
			presences:          map[string]chatPresenceEntry{},
			selfPresences:      map[string]chatPresenceEntry{},
			state:              "connecting",
			messages:           map[string][]ChatMessage{},
			archiveRequests:    map[string]string{},
			archiveRequested:   map[string]time.Time{},
			archiveQueued:      map[string]struct{}{},
			archiveDiagnostics: map[string]xmppArchiveDiagnostic{},
		}
		h.sessions[key] = session
	}
	h.mu.Unlock()
	session.ensureRunning(*auth)
	return session
}

func (s *xmppSocialSession) ensureRunning(auth remoteAuthHeaders) {
	s.mu.Lock()
	s.auth = auth
	if s.running {
		s.mu.Unlock()
		return
	}
	if s.state == "error" && time.Since(s.lastAttempt) < 15*time.Second {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.state = "connecting"
	s.lastError = ""
	s.lastAttempt = time.Now()
	s.mu.Unlock()
	go s.run(auth)
}

func (s *xmppSocialSession) run(auth remoteAuthHeaders) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	pasToken, affinity, err := fetchChatPASToken(auth.AccessToken)
	if err != nil {
		s.fail(err)
		return
	}
	host, domain, port, err := fetchRemoteChatConfig(auth, affinity)
	if err != nil {
		s.fail(err)
		return
	}

	s.mu.Lock()
	s.host = host
	s.domain = domain
	s.port = port
	s.mu.Unlock()

	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 6 * time.Second}, "tcp", fmt.Sprintf("%s:%d", host, port), &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	})
	if err != nil {
		s.fail(fmt.Errorf("xmpp dial failed: %w", err))
		return
	}

	s.mu.Lock()
	if s.conn != nil {
		_ = s.conn.Close()
	}
	s.conn = conn
	s.mu.Unlock()

	reader := bufio.NewReader(conn)
	if err := xmppAuthenticate(conn, reader, domain, auth.AccessToken, pasToken, auth.EntitlementsToken); err != nil {
		_ = conn.Close()
		s.fail(err)
		return
	}

	s.mu.Lock()
	s.state = "live"
	s.lastError = ""
	s.reconnectDelay = 0
	s.mu.Unlock()

	go s.keepAlive(conn)

	s.writeMu.Lock()
	_, _ = io.WriteString(conn, `<iq type="get" id="1"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq><presence/>`)
	s.writeMu.Unlock()
	// A chat view can be opened before authentication finishes. Give the
	// roster a chance to provide the exact peer JID, then send queued archive
	// requests without requiring a second UI interaction.
	go func() {
		time.Sleep(time.Second)
		s.flushArchiveRequests()
	}()

	decoder := xml.NewDecoder(reader)
	for {
		tok, err := decoder.Token()
		if err != nil {
			_ = conn.Close()
			s.fail(fmt.Errorf("xmpp read failed: %w", err))
			return
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "iq":
			var iq xmppIQ
			if err := decoder.DecodeElement(&iq, &start); err == nil {
				s.applyRoster(iq)
				s.applyArchive(iq)
				if strings.EqualFold(iq.Type, "set") && iq.ID != "" {
					s.writeMu.Lock()
					_, _ = io.WriteString(conn, `<iq type="result" id="`+xmlEscapeAttribute(iq.ID)+`"/>`)
					s.writeMu.Unlock()
				}
			}
		case "presence":
			var presence xmppPresence
			if err := decoder.DecodeElement(&presence, &start); err == nil {
				s.applyPresence(presence)
			}
		case "message":
			var message xmppMessage
			if err := decoder.DecodeElement(&message, &start); err == nil {
				s.applyMessage(message, false)
			}
		default:
			_ = decoder.Skip()
		}
	}
}

func (s *xmppSocialSession) keepAlive(conn net.Conn) {
	ticker := time.NewTicker(150 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.RLock()
		sameConn := s.conn == conn
		s.mu.RUnlock()
		if !sameConn {
			return
		}
		s.writeMu.Lock()
		_, err := io.WriteString(conn, " ")
		s.writeMu.Unlock()
		if err != nil {
			return
		}
	}
}

func (s *xmppSocialSession) applyMessage(message xmppMessage, archived bool) {
	body := strings.TrimSpace(message.Body)
	if body == "" || (message.Type != "" && message.Type != "chat") {
		return
	}
	from := jidLocalpart(message.From)
	to := jidLocalpart(message.To)
	peer := from
	if strings.EqualFold(from, s.auth.Puuid) {
		peer = to
	}
	if peer == "" {
		return
	}
	timestamp := xmppMessageTime(message)
	s.appendMessage(peer, ChatMessage{
		ID:        firstNonEmpty(message.ID, fmt.Sprintf("xmpp-%d", time.Now().UnixNano())),
		FromPuuid: from,
		Body:      body,
		Time:      timestamp,
		Archived:  archived,
	})
}

func xmppMessageTime(message xmppMessage) int64 {
	for _, stamp := range []string{message.Delay.Stamp, message.LegacyDelay.Stamp, message.Stamp, message.Archived.Stamp, message.Archived.Timestamp} {
		stamp = strings.TrimSpace(stamp)
		if stamp == "" {
			continue
		}
		if millis, err := strconv.ParseInt(stamp, 10, 64); err == nil {
			if millis < 1e12 {
				millis *= 1000
			}
			return millis
		}
		for _, layout := range []string{time.RFC3339Nano, "20060102T15:04:05", "20060102T15:04:05Z"} {
			if parsed, err := time.Parse(layout, stamp); err == nil {
				return parsed.UnixMilli()
			}
		}
	}
	// Riot message IDs use "<unix-milliseconds>:<sequence>". Archive
	// responses commonly omit delayed-delivery metadata but retain this ID,
	// so it is the only original send time available for those messages.
	if timestamp, ok := epochTimestampFromID(message.ID); ok {
		return timestamp
	}
	// Standard XMPP archive IDs are often epoch microseconds.
	if timestamp, ok := epochTimestampFromID(message.Archived.ID); ok {
		return timestamp
	}
	return time.Now().UnixMilli()
}

func epochTimestampFromID(value string) (int64, bool) {
	value = strings.TrimSpace(value)
	if prefix, _, found := strings.Cut(value, ":"); found {
		value = prefix
	}
	raw, err := strconv.ParseInt(value, 10, 64)
	if err != nil || raw <= 0 {
		return 0, false
	}
	switch {
	case raw >= 1e18:
		raw /= 1e6
	case raw >= 1e15:
		raw /= 1e3
	case raw < 1e12:
		raw *= 1e3
	}
	oldest := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
	newest := time.Now().Add(24 * time.Hour).UnixMilli()
	return raw, raw >= oldest && raw <= newest
}

func (s *xmppSocialSession) requestArchive(peer string) error {
	peer = strings.ToLower(strings.TrimSpace(peer))
	if peer == "" {
		return fmt.Errorf("chat recipient is required")
	}
	now := time.Now()
	s.mu.Lock()
	if s.archiveRequested == nil {
		s.archiveRequested = map[string]time.Time{}
	}
	if s.archiveRequests == nil {
		s.archiveRequests = map[string]string{}
	}
	if s.archiveQueued == nil {
		s.archiveQueued = map[string]struct{}{}
	}
	if s.archiveDiagnostics == nil {
		s.archiveDiagnostics = map[string]xmppArchiveDiagnostic{}
	}
	if s.archivePaused && now.Sub(s.archivePausedAt) < time.Minute {
		s.archiveDiagnostics[peer] = xmppArchiveDiagnostic{ResponseType: "paused"}
		s.mu.Unlock()
		return fmt.Errorf("Riot chat history requests are cooling down after an archive error")
	}
	if s.archivePaused {
		s.archivePaused = false
	}
	for _, pendingPeer := range s.archiveRequests {
		if pendingPeer == peer {
			s.mu.Unlock()
			return nil
		}
	}
	// The archive query has no documented pagination or "since" field. Refresh
	// only the selected peer after a short cooldown and deduplicate in SQLite.
	if requested := s.archiveRequested[peer]; !requested.IsZero() && now.Sub(requested) < chatSnapshotRefreshInterval {
		s.mu.Unlock()
		return nil
	}
	if len(s.archiveRequests) > 0 {
		s.archiveDiagnostics[peer] = xmppArchiveDiagnostic{ResponseType: "deferred"}
		s.archiveQueued[peer] = struct{}{}
		s.mu.Unlock()
		return nil
	}
	conn, domain, live := s.conn, s.domain, s.state == "live"
	recipient := ""
	if roster, ok := s.roster[peer]; ok {
		recipient = strings.TrimSpace(roster.JID)
	}
	if !live || conn == nil || domain == "" {
		s.archiveQueued[peer] = struct{}{}
		s.mu.Unlock()
		return nil
	}
	if recipient == "" {
		recipient = fmt.Sprintf("%s@%s.pvp.net", peer, domain)
	}
	id := fmt.Sprintf("vv_archive_%d", now.UnixNano())
	s.archiveRequested[peer] = now
	s.archiveRequests[id] = peer
	delete(s.archiveQueued, peer)
	s.mu.Unlock()
	var escaped strings.Builder
	if err := xml.EscapeText(&escaped, []byte(recipient)); err != nil {
		return err
	}
	stanza := fmt.Sprintf(`<iq type="get" id="%s"><query xmlns="jabber:iq:riotgames:archive"><with>%s</with></query></iq>`, id, escaped.String())
	s.writeMu.Lock()
	_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, err := io.WriteString(conn, stanza)
	_ = conn.SetWriteDeadline(time.Time{})
	s.writeMu.Unlock()
	if err != nil {
		s.mu.Lock()
		delete(s.archiveRequests, id)
		s.archivePaused = true
		s.archivePausedAt = time.Now()
		clear(s.archiveQueued)
		s.archiveDiagnostics[peer] = xmppArchiveDiagnostic{RequestID: id, ResponseType: "request_failed"}
		s.mu.Unlock()
		remoteSocialHub.broadcast()
		return fmt.Errorf("request XMPP chat archive: %w", err)
	}
	slog.Info("xmpp archive request sent", "request_id", id, "recipient_jid_length", len(recipient))
	return nil
}

func (s *xmppSocialSession) applyArchive(iq xmppIQ) {
	s.mu.Lock()
	peer := s.archiveRequests[iq.ID]
	if peer != "" {
		delete(s.archiveRequests, iq.ID)
	}
	s.mu.Unlock()
	if peer == "" {
		return
	}
	diagnostic := xmppArchiveResponseDiagnostic(iq)
	s.mu.Lock()
	if s.archiveDiagnostics == nil {
		s.archiveDiagnostics = map[string]xmppArchiveDiagnostic{}
	}
	s.archiveDiagnostics[peer] = diagnostic
	if !strings.EqualFold(iq.Type, "result") {
		s.archivePaused = true
		s.archivePausedAt = time.Now()
		clear(s.archiveQueued)
	}
	s.mu.Unlock()
	go s.flushArchiveRequests()
	slog.Info("xmpp archive response", "request_id", diagnostic.RequestID, "response_type", diagnostic.ResponseType, "error_code", diagnostic.ErrorCode, "error_text", diagnostic.ErrorText, "message_count", diagnostic.MessageCount, "message_shapes", strings.Join(diagnostic.MessageShapes, ","))
	remoteSocialHub.broadcast()
	payload := iqArchivePayload(iq)
	if !strings.EqualFold(iq.Type, "result") || strings.TrimSpace(payload) == "" {
		s.notifyArchiveSink(peer, diagnostic)
		return
	}
	decoder := xml.NewDecoder(strings.NewReader("<root>" + payload + "</root>"))
	for {
		token, err := decoder.Token()
		if err != nil {
			s.notifyArchiveSink(peer, diagnostic)
			return
		}
		start, ok := token.(xml.StartElement)
		if !ok || start.Name.Local != "message" {
			continue
		}
		var message xmppMessage
		if err := decoder.DecodeElement(&message, &start); err != nil {
			continue
		}
		if message.From == "" && message.To == "" {
			message.From = peer
		}
		s.applyMessage(message, true)
	}
}

func iqArchivePayload(iq xmppIQ) string {
	if strings.TrimSpace(iq.InnerXML) != "" {
		return iq.InnerXML
	}
	return iq.Query.InnerXML
}

func (s *xmppSocialSession) archiveDiagnostic(peer string) *xmppArchiveDiagnostic {
	peer = strings.ToLower(strings.TrimSpace(peer))
	s.mu.RLock()
	defer s.mu.RUnlock()
	if diagnostic, ok := s.archiveDiagnostics[peer]; ok {
		copy := diagnostic
		copy.MessageShapes = append([]string(nil), diagnostic.MessageShapes...)
		return &copy
	}
	for id, requestedPeer := range s.archiveRequests {
		if requestedPeer == peer {
			return &xmppArchiveDiagnostic{RequestID: id, ResponseType: "pending"}
		}
	}
	return nil
}

func (s *xmppSocialSession) flushArchiveRequests() {
	s.mu.Lock()
	peers := make([]string, 0, len(s.archiveQueued))
	for peer := range s.archiveQueued {
		peers = append(peers, peer)
	}
	s.mu.Unlock()
	if len(peers) > 0 {
		_ = s.requestArchive(peers[0])
	}
}

func (s *xmppSocialSession) setMessageSink(sink func(peer string, message ChatMessage)) {
	s.mu.Lock()
	s.messageSink = sink
	s.mu.Unlock()
}

func (s *xmppSocialSession) setArchiveSink(sink func(peer string, diagnostic xmppArchiveDiagnostic)) {
	s.mu.Lock()
	s.archiveSink = sink
	s.mu.Unlock()
}

func (s *xmppSocialSession) notifyArchiveSink(peer string, diagnostic xmppArchiveDiagnostic) {
	s.mu.RLock()
	sink := s.archiveSink
	s.mu.RUnlock()
	if sink != nil {
		sink(peer, diagnostic)
	}
}

func (s *xmppSocialSession) peerDisplayName(peer string) string {
	s.mu.RLock()
	roster := s.roster[strings.ToLower(strings.TrimSpace(peer))]
	s.mu.RUnlock()
	return firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, peer), "Direct message")
}

func xmppArchiveResponseDiagnostic(iq xmppIQ) xmppArchiveDiagnostic {
	diagnostic := xmppArchiveDiagnostic{
		RequestID:    iq.ID,
		ResponseType: firstNonEmpty(strings.TrimSpace(iq.Type), "unknown"),
		ErrorCode:    firstNonEmpty(strings.TrimSpace(iq.Error.Code), strings.TrimSpace(iq.Error.Type)),
		ErrorText:    sanitizeArchiveDiagnosticText(iq.Error.Text),
	}
	payload := iqArchivePayload(iq)
	if strings.TrimSpace(payload) == "" {
		return diagnostic
	}
	decoder := xml.NewDecoder(strings.NewReader("<root>" + payload + "</root>"))
	stack := make([]string, 0, 4)
	shapes := map[string]struct{}{}
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch element := token.(type) {
		case xml.StartElement:
			stack = append(stack, element.Name.Local)
			if element.Name.Local == "message" {
				diagnostic.MessageCount++
				shapes[strings.Join(stack[1:], "/")] = struct{}{}
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	for shape := range shapes {
		diagnostic.MessageShapes = append(diagnostic.MessageShapes, shape)
	}
	sort.Strings(diagnostic.MessageShapes)
	return diagnostic
}

func sanitizeArchiveDiagnosticText(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if strings.Contains(value, "@") {
		return "redacted"
	}
	if len(value) > 160 {
		return value[:160]
	}
	return value
}

func (s *xmppSocialSession) appendMessage(peer string, message ChatMessage) {
	peer = strings.ToLower(strings.TrimSpace(peer))
	s.mu.Lock()
	if s.messages == nil {
		s.messages = map[string][]ChatMessage{}
	}
	for i, existing := range s.messages[peer] {
		if message.ID != "" && existing.ID == message.ID {
			s.messages[peer][i] = message
			sink := s.messageSink
			s.mu.Unlock()
			if sink != nil {
				sink(peer, message)
			}
			remoteSocialHub.broadcast()
			return
		}
	}
	history := append(s.messages[peer], message)
	if len(history) > 100 {
		history = history[len(history)-100:]
	}
	s.messages[peer] = history
	sink := s.messageSink
	s.mu.Unlock()
	if sink != nil {
		sink(peer, message)
	}
	remoteSocialHub.broadcast()
}

func (h *xmppSocialHub) broadcast() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (h *xmppSocialHub) subscribe() (chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.subscribers[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() { h.mu.Lock(); delete(h.subscribers, ch); h.mu.Unlock() }
}

func (s *xmppSocialSession) chatSnapshot() (string, map[string]xmppRosterItem, map[string][]ChatMessage) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	roster := make(map[string]xmppRosterItem, len(s.roster))
	for k, v := range s.roster {
		roster[k] = v
	}
	messages := make(map[string][]ChatMessage, len(s.messages))
	for k, v := range s.messages {
		messages[k] = append([]ChatMessage(nil), v...)
	}
	return s.state, roster, messages
}

func (s *xmppSocialSession) conversation(peer string) []ChatMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	history := s.messages[strings.ToLower(strings.TrimSpace(peer))]
	return append([]ChatMessage(nil), history...)
}

func (s *xmppSocialSession) sendMessage(peer, body string) (ChatMessage, error) {
	peer = strings.ToLower(strings.TrimSpace(peer))
	body = strings.TrimSpace(body)
	if peer == "" || body == "" {
		return ChatMessage{}, fmt.Errorf("chat recipient and message are required")
	}
	s.mu.RLock()
	conn := s.conn
	domain := s.domain
	localPuuid := s.auth.Puuid
	live := s.state == "live"
	recipient := ""
	if roster, ok := s.roster[peer]; ok {
		recipient = strings.TrimSpace(roster.JID)
	}
	s.mu.RUnlock()
	if !live || conn == nil || domain == "" {
		return ChatMessage{}, fmt.Errorf("Riot XMPP chat is still connecting")
	}
	message := ChatMessage{
		// Riot's clients use a millisecond Unix timestamp followed by the
		// message sequence. Arbitrary IDs are accepted by generic XMPP servers
		// but are ignored by Riot's chat pipeline.
		ID:        fmt.Sprintf("%d:1", time.Now().UnixMilli()),
		FromPuuid: strings.ToLower(localPuuid),
		Body:      body,
		Time:      time.Now().UnixMilli(),
	}
	var escaped strings.Builder
	if err := xml.EscapeText(&escaped, []byte(body)); err != nil {
		return ChatMessage{}, err
	}
	if recipient == "" {
		recipient = fmt.Sprintf("%s@%s.pvp.net", peer, domain)
	}
	stanza := fmt.Sprintf(`<message to="%s" type="chat" id="%s"><body>%s</body></message>`, xmlEscapeAttribute(recipient), message.ID, escaped.String())
	s.writeMu.Lock()
	_, err := io.WriteString(conn, stanza)
	s.writeMu.Unlock()
	if err != nil {
		return ChatMessage{}, fmt.Errorf("send XMPP chat: %w", err)
	}
	s.appendMessage(peer, message)
	return message, nil
}

func (s *xmppSocialSession) fail(err error) {
	s.mu.Lock()
	s.state = "error"
	s.lastError = err.Error()
	if s.reconnectDelay < 15*time.Second {
		s.reconnectDelay = 15 * time.Second
	} else {
		s.reconnectDelay *= 2
		if s.reconnectDelay > 5*time.Minute {
			s.reconnectDelay = 5 * time.Minute
		}
	}
	delay := s.reconnectDelay
	auth := s.auth
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	s.mu.Unlock()
	remoteSocialHub.broadcast()
	time.AfterFunc(delay, func() { s.ensureRunning(auth) })
}

func (s *xmppSocialSession) applyRoster(iq xmppIQ) {
	if iq.Query.XMLName.Space != "jabber:iq:riotgames:roster" {
		return
	}
	s.mu.Lock()
	defer func() {
		s.mu.Unlock()
		remoteSocialHub.broadcast()
	}()
	s.rosterLoaded = true
	// A roster result is a complete snapshot. A roster push (type=set) is an
	// incremental update. Replacing only complete results prevents requests
	// removed by Riot from lingering forever in VantaVault.
	optimistic := map[string]SocialFriendRequest{}
	if strings.EqualFold(iq.Type, "result") {
		for key, requestedAt := range s.optimisticRequests {
			if time.Since(requestedAt) <= 2*time.Minute {
				if request, ok := s.requests[key]; ok {
					optimistic[key] = request
				}
			} else {
				delete(s.optimisticRequests, key)
			}
		}
		s.roster = map[string]xmppRosterItem{}
		s.requests = map[string]SocialFriendRequest{}
		s.requestJIDs = map[string]string{}
	} else if s.roster == nil {
		s.roster = map[string]xmppRosterItem{}
	}
	if s.requests == nil {
		s.requests = map[string]SocialFriendRequest{}
	}
	if s.requestJIDs == nil {
		s.requestJIDs = map[string]string{}
	}
	for _, item := range iq.Query.Items {
		puuid := strings.ToLower(strings.TrimSpace(item.PUUID))
		if puuid == "" {
			puuid = jidLocalpart(item.JID)
		}
		if puuid == "" || puuid == strings.ToLower(s.auth.Puuid) {
			continue
		}
		subscription := strings.ToLower(strings.TrimSpace(item.Subscription))
		ask := strings.ToLower(strings.TrimSpace(item.Ask))
		gameName := firstNonEmpty(item.GameName, item.ID.Name)
		gameTag := firstNonEmpty(item.GameTag, item.ID.Tagline)
		if subscription == "remove" {
			delete(s.roster, puuid)
			delete(s.requests, puuid)
			delete(s.requestJIDs, puuid)
			continue
		}
		if subscription == "pending_in" || subscription == "pending_out" || ask == "subscribe" {
			if until := s.suppressedRequests[puuid]; until.After(time.Now()) {
				delete(s.roster, puuid)
				delete(s.requests, puuid)
				delete(s.requestJIDs, puuid)
				continue
			}
			delete(s.suppressedRequests, puuid)
			direction := "incoming"
			if subscription == "pending_out" || ask == "subscribe" {
				direction = "outgoing"
			}
			s.requests[puuid] = SocialFriendRequest{Puuid: puuid, Name: firstNonEmpty(friendDisplayName(gameName, gameTag, puuid), item.Name), Direction: direction}
			for key, pending := range optimistic {
				if direction == "outgoing" && strings.EqualFold(pending.Name, s.requests[puuid].Name) {
					delete(optimistic, key)
					delete(s.optimisticRequests, key)
				}
			}
			s.requestJIDs[puuid] = item.JID
			delete(s.roster, puuid)
			continue
		}
		delete(s.suppressedRequests, puuid)
		delete(s.requests, puuid)
		delete(s.requestJIDs, puuid)
		s.roster[puuid] = xmppRosterItem{
			JID:          item.JID,
			PUUID:        puuid,
			Name:         item.Name,
			GameName:     gameName,
			GameTag:      gameTag,
			Subscription: subscription,
		}
	}
	for key, request := range optimistic {
		s.requests[key] = request
	}
	go s.flushArchiveRequests()
}

func (s *xmppSocialSession) applyPresence(p xmppPresence) {
	puuid := jidLocalpart(p.From)
	if puuid == "" {
		return
	}
	if strings.EqualFold(p.Type, "subscribe") {
		s.mu.Lock()
		if s.requests == nil {
			s.requests = map[string]SocialFriendRequest{}
		}
		s.requests[puuid] = SocialFriendRequest{Puuid: puuid, Name: firstNonEmpty(strings.TrimSpace(p.Name), s.roster[puuid].Name), Direction: "incoming"}
		if s.requestJIDs == nil {
			s.requestJIDs = map[string]string{}
		}
		s.requestJIDs[puuid] = bareJID(p.From)
		s.mu.Unlock()
		remoteSocialHub.broadcast()
		return
	}
	entry := chatPresenceEntry{
		Puuid: puuid,
		State: "offline",
	}
	resourceKey := strings.ToLower(strings.TrimSpace(p.From))
	if resourceKey == "" {
		resourceKey = puuid
	}
	if p.Type == "" || p.Type == "available" {
		entry.State = firstNonEmpty(p.Status, p.Show, "online")
	}
	if p.Type == "unavailable" {
		entry.State = "offline"
	}
	if payload := p.Games; payload != nil && payload.Valorant != nil && payload.Valorant.Payload != "" {
		entry.Product = "valorant"
		entry.State = firstNonEmpty(payload.Valorant.State, entry.State)
		entry.TimeStamp = payload.Valorant.Timestamp
		entry.Private = payload.Valorant.Payload
	}

	s.mu.Lock()
	defer func() {
		s.mu.Unlock()
		remoteSocialHub.broadcast()
	}()
	if current, exists := s.presences[resourceKey]; exists &&
		strings.EqualFold(entry.Product, "valorant") &&
		strings.EqualFold(current.Product, "valorant") &&
		entry.TimeStamp > 0 && current.TimeStamp > entry.TimeStamp {
		// XMPP resources can deliver an older presence after a newer update.
		// Riot clients resolve the newest game timestamp, so keep it here too.
		return
	}
	if strings.EqualFold(puuid, s.auth.Puuid) {
		if entry.State == "offline" {
			delete(s.selfPresences, resourceKey)
			return
		}
		if s.selfPresences == nil {
			s.selfPresences = map[string]chatPresenceEntry{}
		}
		s.selfPresences[resourceKey] = entry
		return
	}
	if roster, ok := s.roster[puuid]; ok {
		entry.GameName = roster.GameName
		entry.GameTag = roster.GameTag
		entry.Name = firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid))
	}
	if entry.State == "offline" {
		// A friend can have Riot Client and VALORANT resources connected at
		// once. Closing one resource must not erase the other one.
		delete(s.presences, resourceKey)
		return
	}
	s.presences[resourceKey] = entry
}

func bareJID(value string) string {
	if index := strings.IndexByte(value, '/'); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

func (s *xmppSocialSession) actOnFriendRequest(peer, action string) (bool, error) {
	peer = strings.ToLower(strings.TrimSpace(peer))
	action = strings.ToLower(strings.TrimSpace(action))
	s.mu.RLock()
	request, exists := s.requests[peer]
	jid := s.requestJIDs[peer]
	conn := s.conn
	state := s.state
	s.mu.RUnlock()
	if !exists {
		return false, fmt.Errorf("friend request is no longer pending")
	}
	id := fmt.Sprintf("vv_friend_%d", time.Now().UnixNano())
	var mutation string
	switch action {
	case "accept":
		if request.Direction != "incoming" {
			return false, fmt.Errorf("only incoming requests can be accepted")
		}
		mutation = `<iq type="set" id="` + id + `"><query xmlns="jabber:iq:riotgames:roster"><item subscription="pending_out" puuid="` + xmlEscapeAttribute(peer) + `"/></query></iq>`
	case "deny":
		if request.Direction != "incoming" {
			return false, fmt.Errorf("only incoming requests can be denied")
		}
		if jid == "" {
			return false, fmt.Errorf("Riot request JID is unavailable")
		}
		mutation = `<iq type="set" id="` + id + `"><query xmlns="jabber:iq:riotgames:roster"><item jid="` + xmlEscapeAttribute(jid) + `" subscription="remove"/></query></iq>`
	case "cancel":
		if request.Direction != "outgoing" {
			return false, fmt.Errorf("only outgoing requests can be cancelled")
		}
		if jid == "" {
			return false, fmt.Errorf("Riot request JID is unavailable")
		}
		mutation = `<iq type="set" id="` + id + `"><query xmlns="jabber:iq:riotgames:roster"><item jid="` + xmlEscapeAttribute(jid) + `" subscription="remove"/></query></iq>`
	default:
		return false, fmt.Errorf("unsupported friend request action")
	}
	if conn == nil || state != "live" {
		return false, fmt.Errorf("remote Riot social session is not connected")
	}
	stanza := mutation + `<iq type="get" id="` + id + `_roster"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq>`
	s.writeMu.Lock()
	_, err := io.WriteString(conn, stanza)
	s.writeMu.Unlock()
	if err != nil {
		return false, fmt.Errorf("send Riot friend action: %w", err)
	}
	if action == "cancel" || action == "deny" {
		s.mu.Lock()
		if s.suppressedRequests == nil {
			s.suppressedRequests = map[string]time.Time{}
		}
		delete(s.requests, peer)
		delete(s.requestJIDs, peer)
		delete(s.optimisticRequests, peer)
		s.suppressedRequests[peer] = time.Now().Add(30 * time.Second)
		s.mu.Unlock()
		remoteSocialHub.broadcast()
		return true, nil
	}

	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		s.mu.RLock()
		_, stillPending := s.requests[peer]
		_, nowFriend := s.roster[peer]
		s.mu.RUnlock()
		if !stillPending && (action != "accept" || nowFriend) {
			return true, nil
		}
	}
	return false, nil
}

func (s *xmppSocialSession) sendFriendRequest(peer string) (bool, error) {
	peer = strings.ToLower(strings.TrimSpace(peer))
	if peer == "" {
		return false, fmt.Errorf("friend request target is required")
	}
	s.mu.RLock()
	_, alreadyFriend := s.roster[peer]
	_, alreadyPending := s.requests[peer]
	conn, state := s.conn, s.state
	s.mu.RUnlock()
	if alreadyFriend {
		return false, fmt.Errorf("account is already in the Riot friends roster")
	}
	if alreadyPending {
		return false, fmt.Errorf("a friend request is already pending")
	}
	if conn == nil || state != "live" {
		return false, fmt.Errorf("remote Riot social session is not connected")
	}
	id := fmt.Sprintf("vv_friend_%d", time.Now().UnixNano())
	stanza := `<iq type="set" id="` + id + `"><query xmlns="jabber:iq:riotgames:roster"><item subscription="pending_out" puuid="` + xmlEscapeAttribute(peer) + `"/></query></iq>` +
		`<iq type="get" id="` + id + `_roster"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq>`
	s.writeMu.Lock()
	_, err := io.WriteString(conn, stanza)
	s.writeMu.Unlock()
	if err != nil {
		return false, fmt.Errorf("send Riot friend request: %w", err)
	}
	s.mu.Lock()
	if s.requests == nil {
		s.requests = map[string]SocialFriendRequest{}
	}
	if s.optimisticRequests == nil {
		s.optimisticRequests = map[string]time.Time{}
	}
	delete(s.suppressedRequests, peer)
	s.requests[peer] = SocialFriendRequest{Puuid: peer, Name: s.roster[peer].Name, Direction: "outgoing"}
	s.optimisticRequests[peer] = time.Now()
	s.mu.Unlock()
	remoteSocialHub.broadcast()
	return true, nil
}

func (s *xmppSocialSession) sendFriendRequestByRiotID(gameName, gameTag string) (bool, error) {
	gameName = strings.TrimSpace(gameName)
	gameTag = strings.TrimPrefix(strings.TrimSpace(gameTag), "#")
	if gameName == "" || gameTag == "" {
		return false, fmt.Errorf("Riot ID must include both name and tag")
	}
	s.mu.RLock()
	conn, state := s.conn, s.state
	for _, request := range s.requests {
		if request.Direction == "outgoing" && strings.EqualFold(request.Name, friendDisplayName(gameName, gameTag, "")) {
			s.mu.RUnlock()
			return false, fmt.Errorf("a friend request is already pending")
		}
	}
	s.mu.RUnlock()
	if conn == nil || state != "live" {
		return false, fmt.Errorf("remote Riot social session is not connected")
	}

	id := fmt.Sprintf("vv_friend_%d", time.Now().UnixNano())
	target := friendDisplayName(gameName, gameTag, "")
	// Riot identifies this request by Riot ID until the roster push supplies
	// its PUUID/JID. Show that real pending state immediately; the complete
	// roster query below then confirms it or removes it if Riot rejected it.
	requestKey := "riot-id:" + strings.ToLower(gameName) + "#" + strings.ToLower(gameTag)
	s.mu.Lock()
	if s.requests == nil {
		s.requests = map[string]SocialFriendRequest{}
	}
	if s.optimisticRequests == nil {
		s.optimisticRequests = map[string]time.Time{}
	}
	s.requests[requestKey] = SocialFriendRequest{Puuid: requestKey, Name: target, Direction: "outgoing"}
	s.optimisticRequests[requestKey] = time.Now()
	s.mu.Unlock()
	remoteSocialHub.broadcast()

	stanza := `<iq type="set" id="` + id + `"><query xmlns="jabber:iq:riotgames:roster"><item subscription="pending_out"><id name="` + xmlEscapeAttribute(gameName) + `" tagline="` + xmlEscapeAttribute(gameTag) + `"/></item></query></iq>` +
		`<iq type="get" id="` + id + `_roster"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq>`
	s.writeMu.Lock()
	_, err := io.WriteString(conn, stanza)
	s.writeMu.Unlock()
	if err != nil {
		s.mu.Lock()
		delete(s.requests, requestKey)
		delete(s.optimisticRequests, requestKey)
		s.mu.Unlock()
		remoteSocialHub.broadcast()
		return false, fmt.Errorf("send Riot friend request: %w", err)
	}

	return true, nil
}

func xmlEscapeAttribute(value string) string {
	var escaped strings.Builder
	_ = xml.EscapeText(&escaped, []byte(value))
	return escaped.String()
}

func (s *xmppSocialSession) snapshot() SocialStatusResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]SocialPresence, 0, len(s.roster))
	onlineCount := 0
	inGameCount := 0
	presenceKeys := make([]string, 0, len(s.presences))
	for key := range s.presences {
		presenceKeys = append(presenceKeys, key)
	}
	sort.Strings(presenceKeys)
	for puuid, roster := range s.roster {
		var entry chatPresenceEntry
		ok := false
		for _, key := range presenceKeys {
			candidate := s.presences[key]
			if !strings.EqualFold(candidate.Puuid, puuid) || !strings.EqualFold(candidate.Product, "valorant") {
				continue
			}
			if !ok || candidate.TimeStamp > entry.TimeStamp {
				entry = candidate
				ok = true
			}
		}
		if !ok {
			out = append(out, SocialPresence{
				Puuid: puuid,
				Name:  firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid)),
				State: "offline",
			})
			continue
		}
		// Entries only remain in this map while XMPP reports them available.
		// "away" and Riot Client presences may omit product metadata.
		normalized := normalizeChatPresence(entry, map[string]string{
			puuid: firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid)),
		})
		if socialPresenceIsActive(normalized) {
			onlineCount++
		}
		if socialPresenceIsInGame(normalized) {
			inGameCount++
		}
		out = append(out, normalized)
	}

	status := "ok"
	if s.state == "error" && len(out) == 0 {
		status = "unavailable"
	}
	var self *SocialPresence
	var selfTimestamp int64
	for _, entry := range s.selfPresences {
		if !strings.EqualFold(entry.Product, "valorant") {
			continue
		}
		normalized := normalizeChatPresence(entry, nil)
		if self == nil || entry.TimeStamp > selfTimestamp {
			copy := normalized
			self = &copy
			selfTimestamp = entry.TimeStamp
		}
	}
	return SocialStatusResponse{
		Status:           status,
		Source:           "remote",
		RemoteStatus:     s.state,
		RemoteChatHost:   s.host,
		RemoteChatPort:   s.port,
		FriendCount:      len(s.roster),
		OnlineCount:      onlineCount,
		InGameCount:      inGameCount,
		Presences:        out,
		Requests:         cloneSocialRequests(s.requests),
		RosterComplete:   s.rosterLoaded,
		RequestsComplete: s.rosterLoaded,
		SelfPresence:     self,
		Error:            s.lastError,
	}
}

func cloneSocialRequests(source map[string]SocialFriendRequest) []SocialFriendRequest {
	out := make([]SocialFriendRequest, 0, len(source))
	for _, request := range source {
		out = append(out, request)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func fetchChatPASToken(accessToken string) (string, string, error) {
	req, err := http.NewRequest(http.MethodGet, "https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := (&http.Client{Timeout: 6 * time.Second}).Do(req)
	if err != nil {
		return "", "", fmt.Errorf("pas token request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("pas token returned %d: %s", resp.StatusCode, string(body))
	}
	token := strings.TrimSpace(string(body))
	affinity, err := decodePASAffinity(token)
	if err != nil {
		return "", "", err
	}
	return token, affinity, nil
}

func decodePASAffinity(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid pas token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("decode pas token failed: %w", err)
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return "", fmt.Errorf("parse pas token failed: %w", err)
	}
	affinity := strings.TrimSpace(fmt.Sprint(body["affinity"]))
	if affinity == "" || affinity == "<nil>" {
		return "", fmt.Errorf("pas token missing affinity")
	}
	return strings.ToLower(affinity), nil
}

func fetchRemoteChatConfig(auth remoteAuthHeaders, affinity string) (string, string, int, error) {
	req, err := http.NewRequest(http.MethodGet, "https://clientconfig.rpg.riotgames.com/api/v1/config/player?app=Riot%20Client", nil)
	if err != nil {
		return "", "", 0, err
	}
	headers := buildRiotHeaders(auth.AccessToken, auth.EntitlementsToken)
	for k, vs := range headers {
		for _, v := range vs {
			req.Header.Set(k, v)
		}
	}
	resp, err := (&http.Client{Timeout: 6 * time.Second}).Do(req)
	if err != nil {
		return "", "", 0, fmt.Errorf("token chat config failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", 0, fmt.Errorf("token chat config returned %d: %s", resp.StatusCode, string(body))
	}
	var cfg map[string]any
	if err := json.Unmarshal(body, &cfg); err != nil {
		return "", "", 0, fmt.Errorf("decode token chat config failed: %w", err)
	}
	affinities, port := extractChatConfig(cfg)
	domains := mapStringString(cfg["chat.affinity_domains"])
	if chat, ok := cfg["chat"].(map[string]any); ok && len(domains) == 0 {
		domains = mapStringString(chat["affinity_domains"])
	}
	host := strings.TrimSpace(affinities[affinity])
	domain := strings.TrimSpace(domains[affinity])
	if host == "" {
		host = pickChatHost(affinities, auth.Region)
	}
	if domain == "" {
		domain = affinity
	}
	if host == "" || port == 0 {
		return "", "", 0, fmt.Errorf("chat config missing host or port")
	}
	return host, domain, port, nil
}

func xmppAuthenticate(conn net.Conn, reader *bufio.Reader, domain, accessToken, pasToken, entitlementToken string) error {
	steps := []struct {
		out   string
		until string
		want  string
	}{
		{out: fmt.Sprintf(`<?xml version="1.0"?><stream:stream to="%s.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, domain), until: "</stream:features>"},
		{out: fmt.Sprintf(`<auth mechanism="X-Riot-RSO-PAS" xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><rso_token>%s</rso_token><pas_token>%s</pas_token></auth>`, accessToken, pasToken), until: ">", want: "<success"},
		{out: fmt.Sprintf(`<?xml version="1.0"?><stream:stream to="%s.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, domain), until: "</stream:features>"},
		{out: `<iq id="_xmpp_bind1" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"></bind></iq>`, until: "</iq>"},
		{out: `<iq id="_xmpp_session1" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"/></iq>`, until: "</iq>"},
		{out: fmt.Sprintf(`<iq id="xmpp_entitlements_0" type="set"><entitlements xmlns="urn:riotgames:entitlements"><token xmlns="">%s</token></entitlements></iq>`, entitlementToken), until: "</iq>"},
	}
	for _, step := range steps {
		_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
		if _, err := io.WriteString(conn, step.out); err != nil {
			return fmt.Errorf("xmpp write failed: %w", err)
		}
		reply, err := readUntilContains(reader, step.until)
		if err != nil {
			return err
		}
		if step.want != "" && !strings.Contains(reply, step.want) {
			return fmt.Errorf("xmpp authentication rejected")
		}
	}
	_ = conn.SetReadDeadline(time.Time{})
	return nil
}

func readUntilContains(reader *bufio.Reader, needle string) (string, error) {
	var out strings.Builder
	for {
		current := out.String()
		if strings.Contains(current, "<failure") || strings.Contains(current, "<stream:error") {
			return current, fmt.Errorf("xmpp authentication rejected")
		}
		if len(needle) > 0 && strings.Contains(current, needle) {
			return current, nil
		}
		b, err := reader.ReadByte()
		if err != nil {
			return out.String(), err
		}
		out.WriteByte(b)
	}
}

func jidLocalpart(jid string) string {
	jid = strings.TrimSpace(jid)
	if jid == "" {
		return ""
	}
	if at := strings.IndexByte(jid, '@'); at > 0 {
		jid = jid[:at]
	}
	return strings.ToLower(jid)
}
