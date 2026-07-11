package handlers

import (
	"bufio"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var remoteSocialHub = &xmppSocialHub{sessions: map[string]*xmppSocialSession{}}

// ChatMessage remains internal to the XMPP transport so incoming message
// stanzas can be safely consumed. VantaVault no longer exposes chat routes.
type ChatMessage struct {
	ID        string `json:"id"`
	FromPuuid string `json:"fromPuuid"`
	Body      string `json:"body"`
	Time      int64  `json:"time"`
}

type xmppSocialHub struct {
	mu       sync.Mutex
	sessions map[string]*xmppSocialSession
}

type xmppSocialSession struct {
	mu            sync.RWMutex
	writeMu       sync.Mutex
	key           string
	auth          remoteAuthHeaders
	host          string
	domain        string
	port          int
	state         string
	lastError     string
	lastAttempt   time.Time
	roster        map[string]xmppRosterItem
	presences     map[string]chatPresenceEntry
	selfPresences map[string]chatPresenceEntry
	running       bool
	conn          net.Conn
	messages      map[string][]ChatMessage
}

type xmppMessage struct {
	From string `xml:"from,attr"`
	To   string `xml:"to,attr"`
	Type string `xml:"type,attr"`
	ID   string `xml:"id,attr"`
	Body string `xml:"body"`
}

type xmppRosterItem struct {
	PUUID    string
	Name     string
	GameName string
	GameTag  string
}

type xmppIQ struct {
	Query struct {
		Items []struct {
			JID          string `xml:"jid,attr"`
			Name         string `xml:"name,attr"`
			GameName     string `xml:"game_name,attr"`
			GameTag      string `xml:"game_tag,attr"`
			PUUID        string `xml:"puuid,attr"`
			Subscription string `xml:"subscription,attr"`
		} `xml:"item"`
	} `xml:"query"`
}

type xmppPresence struct {
	From   string `xml:"from,attr"`
	Type   string `xml:"type,attr"`
	Show   string `xml:"show"`
	Status string `xml:"status"`
	Games  *struct {
		Valorant *struct {
			Payload string `xml:"p"`
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
			key:           key,
			roster:        map[string]xmppRosterItem{},
			presences:     map[string]chatPresenceEntry{},
			selfPresences: map[string]chatPresenceEntry{},
			state:         "connecting",
			messages:      map[string][]ChatMessage{},
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
	s.mu.Unlock()

	go s.keepAlive(conn)

	s.writeMu.Lock()
	_, _ = io.WriteString(conn, `<iq type="get" id="1"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq><presence/>`)
	s.writeMu.Unlock()

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
			}
		case "presence":
			var presence xmppPresence
			if err := decoder.DecodeElement(&presence, &start); err == nil {
				s.applyPresence(presence)
			}
		case "message":
			var message xmppMessage
			if err := decoder.DecodeElement(&message, &start); err == nil {
				s.applyMessage(message)
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

func (s *xmppSocialSession) applyMessage(message xmppMessage) {
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
	s.appendMessage(peer, ChatMessage{
		ID:        firstNonEmpty(message.ID, fmt.Sprintf("xmpp-%d", time.Now().UnixNano())),
		FromPuuid: from,
		Body:      body,
		Time:      time.Now().UnixMilli(),
	})
}

func (s *xmppSocialSession) appendMessage(peer string, message ChatMessage) {
	peer = strings.ToLower(strings.TrimSpace(peer))
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.messages == nil {
		s.messages = map[string][]ChatMessage{}
	}
	for i, existing := range s.messages[peer] {
		if message.ID != "" && existing.ID == message.ID {
			s.messages[peer][i] = message
			return
		}
	}
	history := append(s.messages[peer], message)
	if len(history) > 100 {
		history = history[len(history)-100:]
	}
	s.messages[peer] = history
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
	s.mu.RUnlock()
	if !live || conn == nil || domain == "" {
		return ChatMessage{}, fmt.Errorf("Riot XMPP chat is still connecting")
	}
	message := ChatMessage{
		ID:        fmt.Sprintf("vv-%d", time.Now().UnixNano()),
		FromPuuid: strings.ToLower(localPuuid),
		Body:      body,
		Time:      time.Now().UnixMilli(),
	}
	var escaped strings.Builder
	if err := xml.EscapeText(&escaped, []byte(body)); err != nil {
		return ChatMessage{}, err
	}
	stanza := fmt.Sprintf(`<message to="%s@%s.pvp.net" type="chat" id="%s"><body>%s</body></message>`, peer, domain, message.ID, escaped.String())
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
	defer s.mu.Unlock()
	s.state = "error"
	s.lastError = err.Error()
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
}

func (s *xmppSocialSession) applyRoster(iq xmppIQ) {
	if len(iq.Query.Items) == 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range iq.Query.Items {
		puuid := strings.ToLower(strings.TrimSpace(item.PUUID))
		if puuid == "" {
			puuid = jidLocalpart(item.JID)
		}
		if puuid == "" || puuid == strings.ToLower(s.auth.Puuid) {
			continue
		}
		s.roster[puuid] = xmppRosterItem{
			PUUID:    puuid,
			Name:     item.Name,
			GameName: item.GameName,
			GameTag:  item.GameTag,
		}
	}
}

func (s *xmppSocialSession) applyPresence(p xmppPresence) {
	puuid := jidLocalpart(p.From)
	if puuid == "" {
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
		// Receiving an available XMPP stanza proves that this particular
		// desktop resource is online even when Riot omits game metadata.
		entry.Product = "riot_chat"
		entry.Platform = "desktop"
	}
	if p.Type == "unavailable" {
		entry.State = "offline"
	}
	if payload := p.Games; payload != nil && payload.Valorant != nil && payload.Valorant.Payload != "" {
		entry.Product = "valorant"
		entry.Private = payload.Valorant.Payload
	}

	s.mu.Lock()
	defer s.mu.Unlock()
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

func (s *xmppSocialSession) snapshot() SocialStatusResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]SocialPresence, 0, len(s.roster))
	onlineCount := 0
	inGameCount := 0
	for puuid, roster := range s.roster {
		var entry chatPresenceEntry
		ok := false
		for _, candidate := range s.presences {
			if !strings.EqualFold(candidate.Puuid, puuid) {
				continue
			}
			if !ok || (strings.EqualFold(candidate.Product, "valorant") && !strings.EqualFold(entry.Product, "valorant")) {
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
	for _, entry := range s.selfPresences {
		normalized := normalizeChatPresence(entry, nil)
		if self == nil || (strings.EqualFold(normalized.Product, "valorant") && !strings.EqualFold(self.Product, "valorant")) {
			copy := normalized
			self = &copy
		}
	}
	return SocialStatusResponse{
		Status:         status,
		Source:         "remote",
		RemoteStatus:   s.state,
		RemoteChatHost: s.host,
		RemoteChatPort: s.port,
		FriendCount:    len(s.roster),
		OnlineCount:    onlineCount,
		InGameCount:    inGameCount,
		Presences:      out,
		SelfPresence:   self,
		Error:          s.lastError,
	}
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
