package handlers

import (
	"backend/tracking"
	"bufio"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"net"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestXMPPDirectMessageSendEscapesAndStores(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:    "live",
		domain:   "eu1",
		conn:     client,
		auth:     remoteAuthHeaders{Puuid: "local-player"},
		messages: map[string][]ChatMessage{},
	}
	stanza := make(chan string, 1)
	go func() {
		_ = server.SetReadDeadline(time.Now().Add(time.Second))
		buf := make([]byte, 2048)
		n, _ := server.Read(buf)
		stanza <- string(buf[:n])
	}()
	message, err := session.sendMessage("FRIEND", "hello <team> & you")
	if err != nil {
		t.Fatal(err)
	}
	got := <-stanza
	if !strings.Contains(got, `to="friend@eu1.pvp.net"`) || !strings.Contains(got, "hello &lt;team&gt; &amp; you") {
		t.Fatalf("unexpected stanza: %s", got)
	}
	if !regexp.MustCompile(`id="[0-9]+:1"`).MatchString(got) {
		t.Fatalf("Riot message id is not in timestamp:sequence format: %s", got)
	}
	if history := session.conversation("friend"); len(history) != 1 || history[0].ID != message.ID {
		t.Fatalf("sent message was not stored: %#v", history)
	}
}

func TestXMPPFriendRequestIsVisibleWhileRiotConfirmsIt(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{state: "live", conn: client, requests: map[string]SocialFriendRequest{}}
	stanza := make(chan string, 1)
	go func() { buf := make([]byte, 2048); n, _ := server.Read(buf); stanza <- string(buf[:n]) }()

	result := make(chan error, 1)
	go func() {
		_, err := session.sendFriendRequestByRiotID("Player", "EUW")
		result <- err
	}()
	got := <-stanza
	if !strings.Contains(got, `<item subscription="pending_out"><id name="Player" tagline="EUW"/>`) {
		t.Fatalf("unexpected friend request stanza: %s", got)
	}

	deadline := time.Now().Add(time.Second)
	for {
		session.mu.RLock()
		request, exists := session.requests["riot-id:player#euw"]
		session.mu.RUnlock()
		if exists {
			if request.Direction != "outgoing" || request.Name != "Player#EUW" {
				t.Fatalf("unexpected pending request: %#v", request)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("outgoing request was not exposed while awaiting Riot")
		}
		time.Sleep(time.Millisecond)
	}

	// Simulate Riot's roster push so the confirmation loop can finish quickly.
	session.mu.Lock()
	session.requests["confirmed-puuid"] = SocialFriendRequest{Puuid: "confirmed-puuid", Name: "Player#EUW", Direction: "outgoing"}
	session.mu.Unlock()
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestXMPPDirectMessageUsesRosterJID(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{state: "live", domain: "wrong-domain", conn: client, auth: remoteAuthHeaders{Puuid: "local"}, messages: map[string][]ChatMessage{}, roster: map[string]xmppRosterItem{"friend": {PUUID: "friend", JID: "friend@exact.pvp.net"}}}
	stanza := make(chan string, 1)
	go func() { buf := make([]byte, 1024); n, _ := server.Read(buf); stanza <- string(buf[:n]) }()
	if _, err := session.sendMessage("friend", "hello"); err != nil {
		t.Fatal(err)
	}
	if got := <-stanza; !strings.Contains(got, `to="friend@exact.pvp.net"`) {
		t.Fatalf("roster JID not used: %s", got)
	}
}

func TestXMPPIncomingMessageStoredByPeer(t *testing.T) {
	session := &xmppSocialSession{
		auth:     remoteAuthHeaders{Puuid: "local-player"},
		messages: map[string][]ChatMessage{},
	}
	session.applyMessage(xmppMessage{From: "friend@eu1.pvp.net/mobile", To: "local-player@eu1.pvp.net", Type: "chat", ID: "m1", Body: "hi"}, false)
	history := session.conversation("FRIEND")
	if len(history) != 1 || history[0].Body != "hi" || history[0].FromPuuid != "friend" {
		t.Fatalf("unexpected incoming history: %#v", history)
	}
}

func TestXMPPArchiveRequestUsesRiotArchiveQuery(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{state: "live", domain: "eu1", conn: client, roster: map[string]xmppRosterItem{"friend": {JID: "friend@eu2.pvp.net"}}}
	stanza := make(chan string, 1)
	go func() { buf := make([]byte, 2048); n, _ := server.Read(buf); stanza <- string(buf[:n]) }()
	if err := session.requestArchive("friend"); err != nil {
		t.Fatal(err)
	}
	got := <-stanza
	if !strings.Contains(got, `xmlns="jabber:iq:riotgames:archive"`) || !strings.Contains(got, `<with>friend@eu2.pvp.net</with>`) {
		t.Fatalf("unexpected archive query: %s", got)
	}
}

func TestXMPPArchiveRequestRespectsRefreshCooldown(t *testing.T) {
	session := &xmppSocialSession{
		archiveRequested: map[string]time.Time{"friend": time.Now()},
	}
	if err := session.requestArchive("friend"); err != nil {
		t.Fatal(err)
	}
	if len(session.archiveRequests) != 0 {
		t.Fatalf("archive request was retried: %#v", session.archiveRequests)
	}
}

func TestXMPPArchiveRequestRetriesSelectedPeerAfterCooldown(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:            "live",
		domain:           "eu1",
		conn:             client,
		archiveRequested: map[string]time.Time{"friend": time.Now().Add(-chatSnapshotRefreshInterval)},
	}
	stanza := make(chan string, 1)
	go func() { buf := make([]byte, 2048); n, _ := server.Read(buf); stanza <- string(buf[:n]) }()
	if err := session.requestArchive("friend"); err != nil {
		t.Fatal(err)
	}
	if got := <-stanza; !strings.Contains(got, `<with>friend@eu1.pvp.net</with>`) {
		t.Fatalf("unexpected refresh query: %s", got)
	}
}

func TestXMPPArchiveRequestDefersWhileAnotherRequestIsPending(t *testing.T) {
	session := &xmppSocialSession{
		archiveRequests: map[string]string{"archive-current": "other-friend"},
	}
	if err := session.requestArchive("friend"); err != nil {
		t.Fatal(err)
	}
	if diagnostic := session.archiveDiagnostic("friend"); diagnostic == nil || diagnostic.ResponseType != "deferred" {
		t.Fatalf("expected deferred diagnostic, got %#v", diagnostic)
	}
	if len(session.archiveRequests) != 1 {
		t.Fatalf("archive request was not serialized: %#v", session.archiveRequests)
	}
	if _, queued := session.archiveQueued["friend"]; !queued {
		t.Fatal("deferred selected peer was not queued")
	}
}

func TestXMPPArchiveWriteFailurePausesFurtherRequests(t *testing.T) {
	client, server := net.Pipe()
	_ = server.Close()
	defer client.Close()
	session := &xmppSocialSession{state: "live", domain: "eu1", conn: client}
	if err := session.requestArchive("friend"); err == nil {
		t.Fatal("expected archive write failure")
	}
	if !session.archivePaused {
		t.Fatal("archive requests were not paused after write failure")
	}
	if err := session.requestArchive("other-friend"); err == nil {
		t.Fatal("expected archive cooldown error")
	}
	if diagnostic := session.archiveDiagnostic("other-friend"); diagnostic == nil || diagnostic.ResponseType != "paused" {
		t.Fatalf("expected paused diagnostic, got %#v", diagnostic)
	}
}

func TestXMPPArchiveErrorPausesFurtherRequests(t *testing.T) {
	const raw = `<iq type="error" id="archive-1"><error type="cancel" code="429"><text>rate limited</text></error></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{archiveRequests: map[string]string{"archive-1": "friend"}}
	session.applyArchive(iq)
	if !session.archivePaused {
		t.Fatal("archive requests were not paused after XMPP error")
	}
	if err := session.requestArchive("other-friend"); err == nil {
		t.Fatal("expected archive cooldown error")
	}
	if diagnostic := session.archiveDiagnostic("other-friend"); diagnostic == nil || diagnostic.ResponseType != "paused" {
		t.Fatalf("expected paused diagnostic, got %#v", diagnostic)
	}
}

func TestXMPPArchiveResponseImportsMessagesAndDelay(t *testing.T) {
	const raw = `<iq type="result" id="archive-1"><query xmlns="jabber:iq:riotgames:archive"><message from="friend@eu1.pvp.net/mobile" to="local@eu1.pvp.net" type="chat" id="old-1"><body>old hello</body><delay xmlns="urn:xmpp:delay" stamp="2026-07-10T12:34:56Z"/></message></query></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{auth: remoteAuthHeaders{Puuid: "local"}, messages: map[string][]ChatMessage{}, archiveRequests: map[string]string{"archive-1": "friend"}}
	session.applyArchive(iq)
	history := session.conversation("friend")
	want := time.Date(2026, 7, 10, 12, 34, 56, 0, time.UTC).UnixMilli()
	if len(history) != 1 || history[0].Body != "old hello" || history[0].Time != want {
		t.Fatalf("archive history = %#v, want timestamp %d", history, want)
	}
}

func TestXMPPArchiveUsesRiotMessageIDWhenDelayIsMissing(t *testing.T) {
	const raw = `<iq type="result" id="archive-1"><query xmlns="jabber:iq:riotgames:archive"><message from="friend@eu1.pvp.net/mobile" to="local@eu1.pvp.net" type="chat" id="1782416072254:29"><body>older hello</body></message></query></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{auth: remoteAuthHeaders{Puuid: "local"}, messages: map[string][]ChatMessage{}, archiveRequests: map[string]string{"archive-1": "friend"}}
	session.applyArchive(iq)
	history := session.conversation("friend")
	if len(history) != 1 || history[0].Time != 1782416072254 {
		t.Fatalf("archive history=%#v, want Riot ID timestamp", history)
	}
}

func TestXMPPArchiveResponseImportsDirectIQMessages(t *testing.T) {
	const raw = `<iq type="result" id="archive-1"><message from="friend@eu1.pvp.net/mobile" to="local@eu1.pvp.net" type="chat" id="old-1"><body>old hello</body></message></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{auth: remoteAuthHeaders{Puuid: "local"}, messages: map[string][]ChatMessage{}, archiveRequests: map[string]string{"archive-1": "friend"}}
	session.applyArchive(iq)
	history := session.conversation("friend")
	if len(history) != 1 || history[0].ID != "old-1" || history[0].Body != "old hello" {
		t.Fatalf("direct IQ archive history = %#v", history)
	}
}

func TestXMPPArchiveResponsePersistsImmediately(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(nil)
	h.trackingConn = db
	const raw = `<iq type="result" id="archive-1"><query xmlns="jabber:iq:riotgames:archive"><message from="friend@eu1.pvp.net/mobile" to="local@eu1.pvp.net" type="chat" id="old-1"><body>old hello</body></message></query></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{auth: remoteAuthHeaders{Puuid: "local"}, messages: map[string][]ChatMessage{}, archiveRequests: map[string]string{"archive-1": "friend"}}
	session.setMessageSink(h.remoteChatMessageSink("local", session))
	session.applyArchive(iq)
	messages, err := h.archivedMessages("local", "dm:friend", 0, 50)
	if err != nil || len(messages) != 1 || messages[0].ID != "old-1" {
		t.Fatalf("persisted archive messages=%#v err=%v", messages, err)
	}
}

func TestXMPPArchiveResponseCompletesEmptySnapshot(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := NewHandler(nil)
	h.trackingConn = db
	conversation := ChatConversation{Key: "dm:friend", Type: "dm", PeerPuuid: "friend", DisplayName: "Friend", Source: "remote"}
	if err := h.archiveConversation("local", conversation); err != nil {
		t.Fatal(err)
	}
	if err := h.setChatSnapshotState("local", conversation.Key, "requested"); err != nil {
		t.Fatal(err)
	}
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result" id="archive-1"><query xmlns="jabber:iq:riotgames:archive"/></iq>`), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{archiveRequests: map[string]string{"archive-1": "friend"}}
	session.setArchiveSink(h.remoteChatArchiveSink("local"))
	session.applyArchive(iq)
	state, err := h.chatSnapshotState("local", conversation.Key)
	if err != nil || state != "complete" {
		t.Fatalf("snapshot state = %q, %v; want complete", state, err)
	}
}

func TestXMPPArchiveResponseDiagnosticsAreStructural(t *testing.T) {
	const raw = `<iq type="error" id="archive-1"><error type="cancel" code="501"><feature-not-implemented/><text>unsupported request</text></error></iq>`
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(raw), &iq); err != nil {
		t.Fatal(err)
	}
	session := &xmppSocialSession{archiveRequests: map[string]string{"archive-1": "friend"}}
	session.applyArchive(iq)
	diagnostic := session.archiveDiagnostics["friend"]
	if diagnostic.RequestID != "archive-1" || diagnostic.ResponseType != "error" || diagnostic.ErrorCode != "501" || diagnostic.ErrorText != "unsupported request" || diagnostic.MessageCount != 0 {
		t.Fatalf("unexpected diagnostic: %#v", diagnostic)
	}
}

func TestNormalizeChatPresenceKeepsPlayerCard(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{"matchPresenceData":{"sessionLoopState":"MENUS","playerCardId":"card-123"}}`))
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:   "friend",
		Product: "valorant",
		Private: private,
	}, nil)
	if presence.CardID != "card-123" {
		t.Fatalf("player card was dropped from presence: %#v", presence)
	}
}

func TestNormalizeChatPresenceReadsTopLevelValorantFields(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{
		"sessionLoopState":"INGAME",
		"queueId":"competitive",
		"partyState":"DEFAULT",
		"partySize":3,
		"maxPartySize":5,
		"playerCardId":"card-top-level"
	}`))
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:   "friend",
		Product: "valorant",
		State:   "away",
		Private: private,
	}, nil)
	if presence.State != "INGAME" || presence.Availability != "away" || presence.QueueID != "competitive" || presence.PartyState != "DEFAULT" || presence.PartySize != 3 || presence.MaxPartySize != 5 || presence.CardID != "card-top-level" {
		t.Fatalf("top-level presence fields were dropped: %#v", presence)
	}
}

func TestNormalizeChatPresenceAcceptsUnpaddedURLBase64PlayerCard(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sessionLoopState":"MENUS","playerCardId":"card-url-safe"}`))
	presence := normalizeChatPresence(chatPresenceEntry{Puuid: "friend", Product: "valorant", Private: payload}, nil)
	if presence.CardID != "card-url-safe" {
		t.Fatalf("URL-safe player card payload was dropped: %#v", presence)
	}
}

func TestNormalizeChatPresenceAcceptsRawJSONPlayerCard(t *testing.T) {
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid: "friend", Product: "valorant", Private: `{"sessionLoopState":"MENUS","playerCardId":"card-json"}`,
	}, nil)
	if presence.CardID != "card-json" {
		t.Fatalf("raw JSON player card payload was dropped: %#v", presence)
	}
}

func TestBuildLocalSocialResponsePrefersValorantPresenceWithPlayerCard(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{"matchPresenceData":{"sessionLoopState":"INGAME","playerCardId":"card-in-game"}}`))
	friends := localFriendsResponse{}
	friends.Friends = append(friends.Friends, struct {
		PUUID          string  `json:"puuid"`
		GameName       string  `json:"game_name"`
		GameTag        string  `json:"game_tag"`
		Name           string  `json:"name"`
		Note           string  `json:"note"`
		Pid            string  `json:"pid"`
		Region         string  `json:"region"`
		LastOnlineTs   *int64  `json:"last_online_ts"`
		ActivePlatform *string `json:"activePlatform"`
	}{PUUID: "friend", GameName: "Friend", GameTag: "EUW"})
	presences := localPresencesResponse{Presences: []chatPresenceEntry{
		{Puuid: "friend", Product: "valorant", Private: private},
		{Puuid: "friend", Product: "riotclient", State: "away", Platform: "PC"},
	}}

	response := buildLocalSocialResponse(friends, presences, "local")
	if len(response.Presences) != 1 || response.Presences[0].CardID != "card-in-game" || response.InGameCount != 1 {
		t.Fatalf("Riot Client presence replaced VALORANT player card: %#v", response)
	}
}

func TestBuildLocalSocialResponseDeduplicatesAndUsesVerifiedDesktopPlatform(t *testing.T) {
	platform := "PC"
	friends := localFriendsResponse{}
	friend := struct {
		PUUID          string  `json:"puuid"`
		GameName       string  `json:"game_name"`
		GameTag        string  `json:"game_tag"`
		Name           string  `json:"name"`
		Note           string  `json:"note"`
		Pid            string  `json:"pid"`
		Region         string  `json:"region"`
		LastOnlineTs   *int64  `json:"last_online_ts"`
		ActivePlatform *string `json:"activePlatform"`
	}{PUUID: "FRIEND", GameName: "Friend", GameTag: "EUW", ActivePlatform: &platform}
	friends.Friends = append(friends.Friends, friend)
	friend.PUUID = "friend"
	friends.Friends = append(friends.Friends, friend)

	response := buildLocalSocialResponse(friends, localPresencesResponse{}, "local")
	if len(response.Presences) != 1 || response.Presences[0].Puuid != "friend" || response.Presences[0].State != "online" || response.OnlineCount != 1 {
		t.Fatalf("local friend was not normalized and deduplicated: %#v", response)
	}
}

func TestNormalizeChatPresenceTreatsUnknownChatActivityAsOffline(t *testing.T) {
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid: "friend",
		State: "away",
	}, nil)
	if presence.Product != "riot_chat" || presence.State != "offline" {
		t.Fatalf("unknown chat-only presence stayed active: %#v", presence)
	}
}

func TestNormalizeChatPresenceKeepsExplicitPCClientActive(t *testing.T) {
	presence := normalizeChatPresence(chatPresenceEntry{
		Puuid:    "friend",
		Product:  "riotclient",
		State:    "away",
		Platform: "PC",
	}, nil)
	if presence.State != "away" || presence.Availability != "away" || presence.Platform != "PC" {
		t.Fatalf("explicit PC presence was hidden: %#v", presence)
	}
}

func TestXMPPSessionPreservesRecentConnectionError(t *testing.T) {
	session := &xmppSocialSession{
		state:       "error",
		lastError:   "authentication failed",
		lastAttempt: time.Now(),
	}

	session.ensureRunning(remoteAuthHeaders{})

	if session.running || session.state != "error" || session.lastError != "authentication failed" {
		t.Fatalf("recent error was hidden by an immediate retry: %#v", session)
	}
}

func TestXMPPRosterAndPresenceBroadcastSocialChanges(t *testing.T) {
	updates, unsubscribe := remoteSocialHub.subscribe()
	defer unsubscribe()

	session := &xmppSocialSession{
		auth:          remoteAuthHeaders{Puuid: "local-player"},
		roster:        map[string]xmppRosterItem{},
		requests:      map[string]SocialFriendRequest{},
		requestJIDs:   map[string]string{},
		presences:     map[string]chatPresenceEntry{},
		selfPresences: map[string]chatPresenceEntry{},
	}
	var rosterIQ xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result" id="2"><query xmlns="jabber:iq:riotgames:roster"><item jid="friend@eu1.pvp.net" name="Friend" subscription="both"/></query></iq>`), &rosterIQ); err != nil {
		t.Fatal(err)
	}
	session.applyRoster(rosterIQ)
	select {
	case <-updates:
	case <-time.After(time.Second):
		t.Fatal("remote roster update was not broadcast to social subscribers")
	}
	if snapshot := session.snapshot(); !snapshot.RosterComplete || snapshot.FriendCount != 1 {
		t.Fatalf("remote roster was not available after its update: %#v", snapshot)
	}

	session.applyPresence(xmppPresence{From: "friend@eu1.pvp.net/RC-1", Show: "chat"})
	select {
	case <-updates:
	case <-time.After(time.Second):
		t.Fatal("remote presence update was not broadcast to social subscribers")
	}
}

func TestXMPPSnapshotDoesNotCountUnverifiedChatPresenceOnline(t *testing.T) {
	session := &xmppSocialSession{
		state: "live",
		roster: map[string]xmppRosterItem{
			"friend": {PUUID: "friend", GameName: "Friend", GameTag: "EUW"},
		},
		presences: map[string]chatPresenceEntry{
			"friend": {Puuid: "friend", State: "away"},
		},
	}

	snapshot := session.snapshot()
	if snapshot.OnlineCount != 0 || len(snapshot.Presences) != 1 || snapshot.Presences[0].State != "offline" {
		t.Fatalf("unverified chat presence was counted online: %#v", snapshot)
	}
}

func TestXMPPPresenceKeepsOtherResourcesAndPrefersValorant(t *testing.T) {
	private := base64.StdEncoding.EncodeToString([]byte(`{"sessionLoopState":"INGAME","queueId":"competitive"}`))
	session := &xmppSocialSession{
		state: "live",
		roster: map[string]xmppRosterItem{
			"friend": {PUUID: "friend", GameName: "Friend", GameTag: "EUW"},
		},
		presences: map[string]chatPresenceEntry{},
	}
	session.applyPresence(xmppPresence{From: "friend@eu1.pvp.net/riot-client"})
	valorant := xmppPresence{From: "friend@eu1.pvp.net/valorant"}
	valorant.Games = &struct {
		Valorant *struct {
			State     string `xml:"st"`
			Timestamp int64  `xml:"s.t"`
			Payload   string `xml:"p"`
		} `xml:"valorant"`
	}{Valorant: &struct {
		State     string `xml:"st"`
		Timestamp int64  `xml:"s.t"`
		Payload   string `xml:"p"`
	}{State: "chat", Timestamp: 2, Payload: private}}
	session.applyPresence(valorant)
	session.applyPresence(xmppPresence{From: "friend@eu1.pvp.net/riot-client", Type: "unavailable"})

	snapshot := session.snapshot()
	if snapshot.OnlineCount != 1 || snapshot.InGameCount != 1 || len(snapshot.Presences) != 1 || snapshot.Presences[0].Product != "valorant" {
		t.Fatalf("closing Riot Client resource erased VALORANT presence: %#v", snapshot)
	}
}

func TestXMPPSnapshotUsesNewestValorantTimestamp(t *testing.T) {
	newer := base64.StdEncoding.EncodeToString([]byte(`{"sessionLoopState":"INGAME","queueId":"competitive"}`))
	older := base64.StdEncoding.EncodeToString([]byte(`{"sessionLoopState":"MENUS"}`))
	session := &xmppSocialSession{
		state:  "live",
		roster: map[string]xmppRosterItem{"friend": {PUUID: "friend", GameName: "Friend", GameTag: "EUW"}},
		presences: map[string]chatPresenceEntry{
			"friend/old": {Puuid: "friend", Product: "valorant", State: "chat", TimeStamp: 10, Private: older},
			"friend/new": {Puuid: "friend", Product: "valorant", State: "INGAME", TimeStamp: 20, Private: newer},
		},
	}

	snapshot := session.snapshot()
	if len(snapshot.Presences) != 1 || snapshot.Presences[0].State != "INGAME" || snapshot.Presences[0].QueueID != "competitive" {
		t.Fatalf("newest VALORANT presence was not selected: %#v", snapshot)
	}
}

func TestXMPPApplyPresenceRejectsStaleResourceUpdate(t *testing.T) {
	session := &xmppSocialSession{
		roster:    map[string]xmppRosterItem{"friend": {PUUID: "friend"}},
		presences: map[string]chatPresenceEntry{"friend@eu1.pvp.net/valorant": {Puuid: "friend", Product: "valorant", TimeStamp: 20, State: "INGAME"}},
	}
	stale := xmppPresence{From: "friend@eu1.pvp.net/valorant"}
	stale.Games = valorantPresenceGames("chat", 10, base64.StdEncoding.EncodeToString([]byte(`{"sessionLoopState":"MENUS"}`)))
	session.applyPresence(stale)

	if got := session.presences["friend@eu1.pvp.net/valorant"]; got.TimeStamp != 20 || got.State != "INGAME" {
		t.Fatalf("stale update replaced current presence: %#v", got)
	}
}

func TestXMPPSnapshotIgnoresUnverifiedRemoteChatPresence(t *testing.T) {
	session := &xmppSocialSession{
		state:     "live",
		roster:    map[string]xmppRosterItem{"friend": {PUUID: "friend", GameName: "Friend", GameTag: "EUW"}},
		presences: map[string]chatPresenceEntry{},
	}
	session.applyPresence(xmppPresence{From: "friend@eu1.pvp.net/mobile"})

	snapshot := session.snapshot()
	if snapshot.OnlineCount != 0 || len(snapshot.Presences) != 1 || snapshot.Presences[0].State != "offline" {
		t.Fatalf("mobile/background presence was presented as desktop online: %#v", snapshot)
	}
}

func valorantPresenceGames(state string, timestamp int64, payload string) *struct {
	Valorant *struct {
		State     string `xml:"st"`
		Timestamp int64  `xml:"s.t"`
		Payload   string `xml:"p"`
	} `xml:"valorant"`
} {
	games := &struct {
		Valorant *struct {
			State     string `xml:"st"`
			Timestamp int64  `xml:"s.t"`
			Payload   string `xml:"p"`
		} `xml:"valorant"`
	}{}
	games.Valorant = &struct {
		State     string `xml:"st"`
		Timestamp int64  `xml:"s.t"`
		Payload   string `xml:"p"`
	}{State: state, Timestamp: timestamp, Payload: payload}
	return games
}

func TestRemoteOnlySocialRequiresOAuthHeaders(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/social?remoteOnly=true", nil)
	response := httptest.NewRecorder()
	(&Handler{}).GetSocialStatus(response, request)

	var body SocialStatusResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Source != "remote" || body.RemoteStatus != "missing" || body.Status != "unavailable" {
		t.Fatalf("unexpected remote-only response: %#v", body)
	}
}

func TestRemoteAuthRejectsTokenForDifferentPlayer(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/profile/overview", nil)
	request.Header.Set("X-Riot-Access-Token", "e30.eyJzdWIiOiJvd25lci0xIn0.signature")
	request.Header.Set("X-Riot-Entitlements-JWT", "entitlement")
	request.Header.Set("X-Riot-Puuid", "owner-2")
	request.Header.Set("X-Riot-Region", "eu")

	if _, _, err := getRemoteAuthHeaders(request); err == nil {
		t.Fatal("expected mismatched Riot token subject to be rejected")
	}
}

func TestReadUntilContainsConsumesWholeXMPPStanza(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(
		`<stream:features><mechanisms>X-Riot-RSO-PAS</mechanisms></stream:features><iq id="next"></iq>`,
	))
	if _, err := readUntilContains(reader, "</stream:features>"); err != nil {
		t.Fatal(err)
	}
	remaining, _ := reader.Peek(4)
	if string(remaining) != "<iq " {
		t.Fatalf("next stanza was not left intact: %q", remaining)
	}
}

func TestReadUntilContainsReportsAuthenticationFailure(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(`<failure><not-authorized/></failure>`))
	if _, err := readUntilContains(reader, ">"); err == nil {
		t.Fatal("expected authentication failure")
	}
}

func TestReadUntilContainsAcceptsSelfClosingSASLSuccess(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader(`<success xmlns="urn:ietf:params:xml:ns:xmpp-sasl"/>`))
	reply, err := readUntilContains(reader, ">")
	if err != nil || !strings.Contains(reply, "<success") {
		t.Fatalf("self-closing SASL success was not accepted: %q, %v", reply, err)
	}
}
