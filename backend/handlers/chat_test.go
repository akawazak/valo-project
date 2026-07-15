package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"backend/tracking"
)

func TestChatSnapshotDueRefreshesCompletedSelectedConversation(t *testing.T) {
	now := time.Now()
	if chatSnapshotDue("complete", now.Add(-time.Second).UnixMilli(), false, now) {
		t.Fatal("recent completed snapshot should not be requested again")
	}
	if !chatSnapshotDue("complete", now.Add(-chatSnapshotRefreshInterval).UnixMilli(), false, now) {
		t.Fatal("completed selected conversation should refresh after cooldown")
	}
	if !chatSnapshotDue("failed", now.UnixMilli(), true, now) {
		t.Fatal("explicit retry should retry a failed snapshot immediately")
	}
}

func TestChatAccountRejectsRemoteSessionForDifferentSelectedAccount(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/chat/summary", nil)
	request.Header.Set("X-Riot-Access-Token", "opaque-token")
	request.Header.Set("X-Riot-Entitlements-JWT", "entitlement")
	request.Header.Set("X-Riot-Puuid", "account-a")
	request.Header.Set("X-Riot-Region", "eu")
	request.Header.Set("X-Riot-Selected-Puuid", "account-b")
	if _, _, err := chatAccount(request); err == nil {
		t.Fatal("expected selected-account mismatch to be rejected")
	}
}

func TestChatArchivePersistsAcrossHandlerReads(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	account := "account-a"
	conversation := ChatConversation{Key: "dm:friend-a", Type: "dm", PeerPuuid: "friend-a", DisplayName: "Friend A", Source: "remote"}
	if err := h.archiveConversation(account, conversation); err != nil {
		t.Fatal(err)
	}
	want := ChatArchiveMessage{ID: "message-a", ConversationKey: conversation.Key, SenderPuuid: account, Body: "hello", Timestamp: time.Now().UnixMilli(), Direction: "outgoing", Status: "sent"}
	if err := h.archiveMessage(account, want); err != nil {
		t.Fatal(err)
	}
	got, err := h.archivedMessages(account, conversation.Key, 0, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Body != want.Body || got[0].ID != want.ID {
		t.Fatalf("archived messages = %#v", got)
	}
}

func TestLocalMessagesFromWrappedEvent(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"messages": []map[string]any{{
				"id":      "m1",
				"cid":     "cid-a",
				"puuid":   "peer-a",
				"message": "hello",
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := localMessagesFromEvent(payload)
	if len(got.Messages) != 1 || got.Messages[0].ID != "m1" || got.Messages[0].CID != "cid-a" || got.Messages[0].Message != "hello" {
		t.Fatalf("messages = %#v", got.Messages)
	}
}

func TestChatCIDFromEvent(t *testing.T) {
	if got := chatCIDFromEvent("/chat/v6/messages?cid=cid-a", nil); got != "cid-a" {
		t.Fatalf("cid from uri = %q", got)
	}
	payload := []byte(`{"data":{"cid":"cid-b"}}`)
	if got := chatCIDFromEvent("/chat/v6/messages", payload); got != "cid-b" {
		t.Fatalf("cid from payload = %q", got)
	}
}

func TestChatConversationAliasesMergeIntoPuuidKey(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	account, peer := "account-a", "friend-a"
	legacy := ChatConversation{Key: "dm:friend-a@eu1.pvp.net", Type: "dm", PeerPuuid: peer, DisplayName: "Friend A", Source: "local"}
	if err := h.archiveConversation(account, legacy); err != nil {
		t.Fatal(err)
	}
	if err := h.archiveMessage(account, ChatArchiveMessage{ID: "old", ConversationKey: legacy.Key, SenderPuuid: peer, Body: "persist me", Timestamp: time.Now().UnixMilli(), Direction: "incoming", Status: "sent"}); err != nil {
		t.Fatal(err)
	}
	canonical := ChatConversation{Key: "dm:friend-a", Type: "dm", PeerPuuid: peer, DisplayName: "Friend A", Source: "remote"}
	if err := h.archiveConversation(account, canonical); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM chat_conversations WHERE accountPuuid=?`, account).Scan(&count); err != nil || count != 1 {
		t.Fatalf("conversation count=%d err=%v", count, err)
	}
	messages, err := h.archivedMessages(account, canonical.Key, 0, 50)
	if err != nil || len(messages) != 1 || messages[0].Body != "persist me" {
		t.Fatalf("messages=%#v err=%v", messages, err)
	}
}

func TestChatConversationKeepsCIDUnreadAndSnapshotState(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	account := "account-a"
	conversation := ChatConversation{Key: "dm:friend-a", Type: "dm", PeerPuuid: "friend-a", RiotCID: "friend-a@eu1.pvp.net", DisplayName: "Friend A", Source: "local", UnreadCount: 3}
	if err := h.archiveConversation(account, conversation); err != nil {
		t.Fatal(err)
	}
	if err := h.setChatSnapshotState(account, conversation.Key, "complete"); err != nil {
		t.Fatal(err)
	}
	got, err := h.archivedConversation(account, conversation.Key)
	if err != nil {
		t.Fatal(err)
	}
	if got.RiotCID != conversation.RiotCID || got.UnreadCount != 3 || got.SnapshotState != "complete" {
		t.Fatalf("conversation persistence = %#v", got)
	}
}

func TestRemoteLiveMessageIncrementsUnreadOnceAndArchiveDoesNot(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	session := &xmppSocialSession{roster: map[string]xmppRosterItem{"friend-a": {Name: "Friend A"}}}
	sink := h.remoteChatMessageSink("account-a", session)
	live := ChatMessage{ID: "live-1", FromPuuid: "friend-a", Body: "hello", Time: time.Now().UnixMilli()}
	sink("friend-a", live)
	sink("friend-a", live)
	sink("friend-a", ChatMessage{ID: "archive-1", FromPuuid: "friend-a", Body: "older", Time: live.Time - 1000, Archived: true})
	var unread int
	if err := db.QueryRow(`SELECT unreadCount FROM chat_conversations WHERE accountPuuid=? AND conversationKey=?`, "account-a", "dm:friend-a").Scan(&unread); err != nil {
		t.Fatal(err)
	}
	if unread != 1 {
		t.Fatalf("unreadCount=%d, want 1", unread)
	}
}

func TestArchivedChatTimestampRepairUsesRiotIDsOnly(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	h := &Handler{trackingConn: db}
	account := "account-a"
	conversation := ChatConversation{Key: "dm:friend-a", Type: "dm", PeerPuuid: "friend-a", DisplayName: "Friend A", Source: "remote"}
	if err := h.archiveConversation(account, conversation); err != nil {
		t.Fatal(err)
	}
	wrongPullTime := int64(1784056042656)
	if err := h.archiveMessage(account, ChatArchiveMessage{ID: "1782416072254:29", ConversationKey: conversation.Key, Body: "old", Timestamp: wrongPullTime, Direction: "incoming", Status: "sent"}); err != nil {
		t.Fatal(err)
	}
	opaqueTime := int64(1783905966748)
	if err := h.archiveMessage(account, ChatArchiveMessage{ID: "opaque-id", ConversationKey: conversation.Key, Body: "kept", Timestamp: opaqueTime, Direction: "outgoing", Status: "sent"}); err != nil {
		t.Fatal(err)
	}
	repairArchivedChatTimestamps(db, account)
	var repaired, untouched int64
	if err := db.QueryRow(`SELECT sentAt FROM chat_messages WHERE accountPuuid=? AND messageId='1782416072254:29'`, account).Scan(&repaired); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT sentAt FROM chat_messages WHERE accountPuuid=? AND messageId='opaque-id'`, account).Scan(&untouched); err != nil {
		t.Fatal(err)
	}
	if repaired != 1782416072254 || untouched != opaqueTime {
		t.Fatalf("repaired=%d untouched=%d", repaired, untouched)
	}
}
