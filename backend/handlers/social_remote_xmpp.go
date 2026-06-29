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

type xmppSocialHub struct {
	mu       sync.Mutex
	sessions map[string]*xmppSocialSession
}

type xmppSocialSession struct {
	mu        sync.RWMutex
	key       string
	auth      remoteAuthHeaders
	host      string
	domain    string
	port      int
	state     string
	lastError string
	roster    map[string]xmppRosterItem
	presences map[string]chatPresenceEntry
	running   bool
	conn      net.Conn
}

type xmppRosterItem struct {
	PUUID   string
	Name    string
	GameName string
	GameTag string
}

type xmppIQ struct {
	Query struct {
		Items []struct {
			JID         string `xml:"jid,attr"`
			Name        string `xml:"name,attr"`
			GameName    string `xml:"game_name,attr"`
			GameTag     string `xml:"game_tag,attr"`
			PUUID       string `xml:"puuid,attr"`
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
			key:       key,
			roster:    map[string]xmppRosterItem{},
			presences: map[string]chatPresenceEntry{},
			state:     "connecting",
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
	s.running = true
	s.state = "connecting"
	s.lastError = ""
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

	_, _ = io.WriteString(conn, `<iq type="get" id="1"><query xmlns="jabber:iq:riotgames:roster" last_state="true"/></iq><presence/>`)

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
		if _, err := io.WriteString(conn, " "); err != nil {
			return
		}
	}
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
	if puuid == "" || puuid == strings.ToLower(s.auth.Puuid) {
		return
	}
	entry := chatPresenceEntry{
		Puuid: puuid,
		State: "offline",
	}
	if p.Type == "" || p.Type == "available" {
		entry.State = firstNonEmpty(p.Status, p.Show, "online")
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
	if roster, ok := s.roster[puuid]; ok {
		entry.GameName = roster.GameName
		entry.GameTag = roster.GameTag
		entry.Name = firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid))
	}
	if entry.State == "offline" {
		delete(s.presences, puuid)
		return
	}
	s.presences[puuid] = entry
}

func (s *xmppSocialSession) snapshot() SocialStatusResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]SocialPresence, 0, len(s.roster))
	onlineCount := 0
	inGameCount := 0
	for puuid, roster := range s.roster {
		entry, ok := s.presences[puuid]
		if !ok {
			out = append(out, SocialPresence{
				Puuid: puuid,
				Name:  firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid)),
				State: "offline",
			})
			continue
		}
		if productIsActive(entry.Product) || strings.EqualFold(entry.State, "online") {
			onlineCount++
		}
		if strings.EqualFold(entry.Product, "valorant") {
			inGameCount++
		}
		out = append(out, normalizeChatPresence(entry, map[string]string{
			puuid: firstNonEmpty(roster.Name, friendDisplayName(roster.GameName, roster.GameTag, puuid)),
		}))
	}

	status := "ok"
	if s.state == "error" && len(out) == 0 {
		status = "unavailable"
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
	}{
		{out: fmt.Sprintf(`<?xml version="1.0"?><stream:stream to="%s.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, domain), until: "X-Riot-RSO-PAS"},
		{out: fmt.Sprintf(`<auth mechanism="X-Riot-RSO-PAS" xmlns="urn:ietf:params:xml:ns:xmpp-sasl"><rso_token>%s</rso_token><pas_token>%s</pas_token></auth>`, accessToken, pasToken), until: "</success>"},
		{out: fmt.Sprintf(`<?xml version="1.0"?><stream:stream to="%s.pvp.net" version="1.0" xmlns:stream="http://etherx.jabber.org/streams">`, domain), until: "stream:features"},
		{out: `<iq id="_xmpp_bind1" type="set"><bind xmlns="urn:ietf:params:xml:ns:xmpp-bind"><puuid-mode enabled="true"/></bind></iq>`, until: "_xmpp_bind1"},
		{out: `<iq id="_xmpp_session1" type="set"><session xmlns="urn:ietf:params:xml:ns:xmpp-session"><platform>riot</platform></session></iq>`, until: "_xmpp_session1"},
		{out: fmt.Sprintf(`<iq id="xmpp_entitlements_0" type="set"><entitlements xmlns="urn:riotgames:entitlements"><token xmlns="">%s</token></entitlements></iq>`, entitlementToken), until: "xmpp_entitlements_0"},
	}
	for _, step := range steps {
		_ = conn.SetReadDeadline(time.Now().Add(8 * time.Second))
		if _, err := io.WriteString(conn, step.out); err != nil {
			return fmt.Errorf("xmpp write failed: %w", err)
		}
		if _, err := readUntilContains(reader, step.until); err != nil {
			return err
		}
	}
	_ = conn.SetReadDeadline(time.Time{})
	return nil
}

func readUntilContains(reader *bufio.Reader, needle string) (string, error) {
	var out strings.Builder
	for {
		if len(needle) > 0 && strings.Contains(out.String(), needle) {
			return out.String(), nil
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
