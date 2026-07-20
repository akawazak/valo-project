package handlers

import (
	"encoding/xml"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"backend/tracking"
)

func TestSocialHistoryRequiresCompleteSnapshotsAndDoesNotAssignRemovalActor(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	account := "account"
	baseline := &SocialStatusResponse{Source: "remote", RosterComplete: true, RequestsComplete: true, Presences: []SocialPresence{{Puuid: "friend", Name: "Friend#TAG", State: "online"}}}
	if err := recordSocialSnapshot(db, account, baseline, 1000); err != nil {
		t.Fatal(err)
	}

	// An unavailable/partial response must not alter the stored roster.
	partial := &SocialStatusResponse{Source: "remote"}
	if err := recordSocialSnapshot(db, account, partial, 2000); err != nil {
		t.Fatal(err)
	}
	var state string
	if err := db.QueryRow(`SELECT state FROM social_contacts WHERE accountPuuid=? AND peerPuuid='friend'`, account).Scan(&state); err != nil || state != "friend" {
		t.Fatalf("partial snapshot changed friend state: state=%q err=%v", state, err)
	}

	emptyComplete := &SocialStatusResponse{Source: "remote", RosterComplete: true}
	if err := recordSocialSnapshot(db, account, emptyComplete, 3000); err != nil {
		t.Fatal(err)
	}
	events, err := readSocialActivity(db, account, 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range events {
		if event.Type == "friendship_ended" {
			found = true
			if event.Evidence != "remote:roster_transition_actor_unknown" {
				t.Fatalf("removal evidence assigned an unsupported actor: %q", event.Evidence)
			}
		}
	}
	if !found {
		t.Fatal("expected friendship_ended after a second complete roster snapshot")
	}
}

func TestRemoteAcceptFriendRequestUsesRiotRosterMutationAndWaitsForConfirmation(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:       "live",
		domain:      "eu1",
		conn:        client,
		roster:      map[string]xmppRosterItem{},
		requests:    map[string]SocialFriendRequest{"peer": {Puuid: "peer", Direction: "incoming"}},
		requestJIDs: map[string]string{"peer": "peer@eu2.pvp.net"},
	}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 512)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
		session.mu.Lock()
		delete(session.requests, "peer")
		session.roster["peer"] = xmppRosterItem{PUUID: "peer"}
		session.mu.Unlock()
	}()
	confirmed, err := session.actOnFriendRequest("peer", "accept")
	if err != nil || !confirmed {
		t.Fatalf("accept did not receive roster confirmation: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `type="set"`) || !strings.Contains(sent, `subscription="pending_out" puuid="peer"`) || !strings.Contains(sent, `jabber:iq:riotgames:roster`) || strings.Contains(sent, `<presence`) {
		t.Fatalf("unexpected accept stanza: %s", sent)
	}
}

func TestRemoteRequestActionRejectsWrongDirectionWithoutWriting(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:    "live",
		conn:     client,
		requests: map[string]SocialFriendRequest{"peer": {Puuid: "peer", Direction: "outgoing"}},
	}
	if _, err := session.actOnFriendRequest("peer", "deny"); err == nil {
		t.Fatal("expected deny to reject an outgoing request")
	}
	_ = server.SetReadDeadline(time.Now().Add(25 * time.Millisecond))
	if data, err := io.ReadAll(server); err == nil && len(data) > 0 {
		t.Fatalf("invalid action wrote an XMPP stanza: %q", data)
	}
}

func TestRemoteDenyFriendRequestUsesRiotRosterRemovalAndRefreshesRoster(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:       "live",
		domain:      "eu1",
		conn:        client,
		roster:      map[string]xmppRosterItem{},
		requests:    map[string]SocialFriendRequest{"peer": {Puuid: "peer", Direction: "incoming"}},
		requestJIDs: map[string]string{"peer": "peer@eu2.pvp.net"},
	}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 1024)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
		session.mu.Lock()
		delete(session.requests, "peer")
		session.mu.Unlock()
	}()
	confirmed, err := session.actOnFriendRequest("peer", "deny")
	if err != nil || !confirmed {
		t.Fatalf("deny did not receive roster confirmation: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `jid="peer@eu2.pvp.net" subscription="remove"`) || !strings.Contains(sent, `jabber:iq:riotgames:roster`) || strings.Contains(sent, `<presence`) {
		t.Fatalf("unexpected deny stanza: %s", sent)
	}
}

func TestRemoteCancelFriendRequestUsesRiotRosterRemoval(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:       "live",
		conn:        client,
		roster:      map[string]xmppRosterItem{},
		requests:    map[string]SocialFriendRequest{"peer": {Puuid: "peer", Direction: "outgoing"}},
		requestJIDs: map[string]string{"peer": "peer@eu2.pvp.net"},
	}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 1024)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
		session.mu.Lock()
		delete(session.requests, "peer")
		session.mu.Unlock()
	}()
	confirmed, err := session.actOnFriendRequest("peer", "cancel")
	if err != nil || !confirmed {
		t.Fatalf("cancel did not receive roster confirmation: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `jid="peer@eu2.pvp.net" subscription="remove"`) || strings.Contains(sent, `<presence`) {
		t.Fatalf("unexpected cancel stanza: %s", sent)
	}
	var stale xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result"><query xmlns="jabber:iq:riotgames:roster"><item jid="peer@eu2.pvp.net" puuid="peer" subscription="pending_out"><id name="Peer" tagline="TAG"/></item></query></iq>`), &stale); err != nil {
		t.Fatal(err)
	}
	session.applyRoster(stale)
	if _, exists := session.requests["peer"]; exists {
		t.Fatal("stale roster response resurrected a cancelled request")
	}
}

func TestRemoteCancelResolvesRiotIDRequestToRosterJID(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{
		state:  "live",
		conn:   client,
		roster: map[string]xmppRosterItem{},
		requests: map[string]SocialFriendRequest{
			"riot-id:player#tag": {Puuid: "riot-id:player#tag", Name: "Player#TAG", Direction: "outgoing"},
			"resolved-puuid":     {Puuid: "resolved-puuid", Name: "Player#TAG", Direction: "outgoing"},
		},
		requestJIDs:        map[string]string{"resolved-puuid": "resolved-puuid@eu2.pvp.net"},
		optimisticRequests: map[string]time.Time{"riot-id:player#tag": time.Now()},
	}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 1024)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
	}()
	confirmed, err := session.actOnFriendRequest("riot-id:player#tag", "cancel")
	if err != nil || !confirmed {
		t.Fatalf("Riot ID cancel was not confirmed: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `jid="resolved-puuid@eu2.pvp.net" subscription="remove"`) {
		t.Fatalf("cancel did not use Riot's resolved roster JID: %s", sent)
	}
	if _, exists := session.requests["riot-id:player#tag"]; exists {
		t.Fatal("optimistic Riot ID request remained after cancellation")
	}
}

func TestRemoteCancelAlreadyRemovedRequestIsIdempotent(t *testing.T) {
	session := &xmppSocialSession{requests: map[string]SocialFriendRequest{}, requestJIDs: map[string]string{}}
	confirmed, err := session.actOnFriendRequest("already-removed", "cancel")
	if err != nil || !confirmed {
		t.Fatalf("already removed cancellation should succeed: confirmed=%v err=%v", confirmed, err)
	}
}

func TestRemoteSendFriendRequestUsesRiotRosterMutationAndWaitsForOutgoingState(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{state: "live", domain: "eu1", conn: client, roster: map[string]xmppRosterItem{}, requests: map[string]SocialFriendRequest{}}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 512)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
		session.mu.Lock()
		session.requests["peer"] = SocialFriendRequest{Puuid: "peer", Direction: "outgoing"}
		session.mu.Unlock()
	}()
	confirmed, err := session.sendFriendRequest("peer")
	if err != nil || !confirmed {
		t.Fatalf("send did not receive outgoing roster confirmation: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `subscription="pending_out" puuid="peer"`) || !strings.Contains(sent, `jabber:iq:riotgames:roster`) || strings.Contains(sent, `<presence`) {
		t.Fatalf("unexpected request stanza: %s", sent)
	}
}

func TestRemoteSendFriendRequestByRiotIDUsesNameAndTagline(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	session := &xmppSocialSession{state: "live", conn: client, requests: map[string]SocialFriendRequest{}}
	stanza := make(chan string, 1)
	go func() {
		buffer := make([]byte, 1024)
		n, _ := server.Read(buffer)
		stanza <- string(buffer[:n])
		session.mu.Lock()
		session.requests["resolved-puuid"] = SocialFriendRequest{Puuid: "resolved-puuid", Name: "Player Name#Tag", Direction: "outgoing"}
		session.mu.Unlock()
	}()
	confirmed, err := session.sendFriendRequestByRiotID("Player Name", "#Tag")
	if err != nil || !confirmed {
		t.Fatalf("name/tag request did not receive roster confirmation: confirmed=%v err=%v", confirmed, err)
	}
	if sent := <-stanza; !strings.Contains(sent, `subscription="pending_out"`) || !strings.Contains(sent, `<id name="Player Name" tagline="Tag"/>`) || strings.Contains(sent, `<presence`) {
		t.Fatalf("unexpected Riot ID request stanza: %s", sent)
	}
}

func TestFullRiotRosterResultReplacesStaleRequests(t *testing.T) {
	session := &xmppSocialSession{
		roster:      map[string]xmppRosterItem{"friend": {PUUID: "friend"}},
		requests:    map[string]SocialFriendRequest{"stale": {Puuid: "stale", Direction: "outgoing"}},
		requestJIDs: map[string]string{"stale": "stale@eu1.pvp.net"},
	}
	var iq xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result"><query xmlns="jabber:iq:riotgames:roster"><item jid="friend@eu1.pvp.net" puuid="friend" subscription="both"><id name="Friend" tagline="TAG"/></item></query></iq>`), &iq); err != nil {
		t.Fatal(err)
	}
	session.applyRoster(iq)
	if _, exists := session.requests["stale"]; exists {
		t.Fatal("full roster result retained a request Riot omitted")
	}
	if friend := session.roster["friend"]; friend.GameName != "Friend" || friend.GameTag != "TAG" {
		t.Fatalf("nested Riot ID was not parsed: %+v", friend)
	}
}

func TestFullRosterKeepsRecentRiotIDRequestUntilRealEntryArrives(t *testing.T) {
	session := &xmppSocialSession{
		requests:           map[string]SocialFriendRequest{"riot-id:player#tag": {Puuid: "riot-id:player#tag", Name: "Player#TAG", Direction: "outgoing"}},
		requestJIDs:        map[string]string{},
		optimisticRequests: map[string]time.Time{"riot-id:player#tag": time.Now()},
		roster:             map[string]xmppRosterItem{},
	}
	var empty xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result"><query xmlns="jabber:iq:riotgames:roster"></query></iq>`), &empty); err != nil {
		t.Fatal(err)
	}
	session.applyRoster(empty)
	if _, ok := session.requests["riot-id:player#tag"]; !ok {
		t.Fatal("recent sent request disappeared before Riot returned its roster entry")
	}
	var confirmed xmppIQ
	if err := xml.Unmarshal([]byte(`<iq type="result"><query xmlns="jabber:iq:riotgames:roster"><item jid="peer@eu1.pvp.net" puuid="peer" subscription="pending_out"><id name="Player" tagline="TAG"/></item></query></iq>`), &confirmed); err != nil {
		t.Fatal(err)
	}
	session.applyRoster(confirmed)
	if _, ok := session.requests["riot-id:player#tag"]; ok {
		t.Fatal("synthetic request remained after Riot supplied the real request")
	}
	if request := session.requests["peer"]; request.Direction != "outgoing" || request.Name != "Player#TAG" {
		t.Fatalf("real request=%+v", request)
	}
}

func TestSocialPendingRequestBecomesAcceptedOnlyWhenFriendAppears(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	account := "account"
	request := SocialFriendRequest{Puuid: "peer", Name: "Peer#TAG", Direction: "incoming"}
	if err := recordSocialSnapshot(db, account, &SocialStatusResponse{Source: "remote", RosterComplete: true, RequestsComplete: true, Requests: []SocialFriendRequest{request}}, 1000); err != nil {
		t.Fatal(err)
	}
	if err := recordSocialSnapshot(db, account, &SocialStatusResponse{Source: "remote", RosterComplete: true, RequestsComplete: true, Presences: []SocialPresence{{Puuid: "peer", Name: "Peer#TAG", State: "offline"}}}, 2000); err != nil {
		t.Fatal(err)
	}
	events, err := readSocialActivity(db, account, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.Type == "request_accepted_by_you" {
			return
		}
	}
	t.Fatal("expected pending-to-friend transition to be recorded as accepted")
}

func TestRemoteRosterSeparatesPendingRequestsFromFriends(t *testing.T) {
	session := &xmppSocialSession{
		auth:          remoteAuthHeaders{Puuid: "self"},
		state:         "live",
		roster:        map[string]xmppRosterItem{},
		requests:      map[string]SocialFriendRequest{},
		presences:     map[string]chatPresenceEntry{},
		selfPresences: map[string]chatPresenceEntry{},
	}
	var iq xmppIQ
	iq.Query.XMLName.Space = "jabber:iq:riotgames:roster"
	iq.Query.Items = append(iq.Query.Items, struct {
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
	}{JID: "peer@eu1.pvp.net", PUUID: "peer", GameName: "Peer", GameTag: "TAG", Subscription: "pending_in"})
	session.applyRoster(iq)
	snapshot := session.snapshot()
	if snapshot.FriendCount != 0 || len(snapshot.Presences) != 0 {
		t.Fatalf("pending request was counted as a friend: %+v", snapshot)
	}
	if len(snapshot.Requests) != 1 || snapshot.Requests[0].Direction != "incoming" {
		t.Fatalf("pending request not exposed correctly: %+v", snapshot.Requests)
	}
}

func TestRemoteRosterRecognizesStandardPendingOutAskAttribute(t *testing.T) {
	session := &xmppSocialSession{
		auth:          remoteAuthHeaders{Puuid: "self"},
		state:         "live",
		roster:        map[string]xmppRosterItem{},
		requests:      map[string]SocialFriendRequest{},
		presences:     map[string]chatPresenceEntry{},
		selfPresences: map[string]chatPresenceEntry{},
	}
	var iq xmppIQ
	iq.Query.XMLName.Space = "jabber:iq:riotgames:roster"
	iq.Query.Items = append(iq.Query.Items, struct {
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
	}{JID: "peer@eu1.pvp.net", PUUID: "peer", GameName: "Peer", GameTag: "TAG", Subscription: "none", Ask: "subscribe"})
	session.applyRoster(iq)
	snapshot := session.snapshot()
	if snapshot.FriendCount != 0 {
		t.Fatalf("pending-out roster item was counted as a friend: %+v", snapshot)
	}
	if len(snapshot.Requests) != 1 || snapshot.Requests[0].Direction != "outgoing" {
		t.Fatalf("ask=subscribe was not exposed as outgoing: %+v", snapshot.Requests)
	}
}

func TestExplicitRequestActionsAppearInActivityAndCancelResolvesRequest(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	h.recordSocialRequestAction("account", "peer", "Peer#TAG", "outgoing", "request_sent")
	h.recordSocialRequestAction("account", "peer", "Peer#TAG", "outgoing", "request_cancelled")
	events, err := readSocialActivity(db, "account", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Type != "request_cancelled" || events[1].Type != "request_sent" {
		t.Fatalf("activity=%+v", events)
	}
	var state string
	if err := db.QueryRow(`SELECT state FROM social_requests WHERE accountPuuid='account' AND peerPuuid='peer' AND direction='outgoing'`).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "resolved" {
		t.Fatalf("request state=%q, want resolved", state)
	}
}
