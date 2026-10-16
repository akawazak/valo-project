package handlers

import (
	"testing"

	"backend/tracking"
)

func TestFriendActivityDueOrderAndAttach(t *testing.T) {
	db, err := tracking.OpenTrackingDB(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := ensureFriendActivity(db); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		`INSERT INTO friend_activity(peerPuuid,lastMatchAt,checkedAt,lastMatchId,cardId) VALUES('fresh',900,1000,'m1','card-fresh')`,
		`INSERT INTO friend_activity(peerPuuid,lastMatchAt,checkedAt) VALUES('stale',400,10)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	due, err := friendsDueForActivity(db, []string{"stale", "fresh", "never"}, 500, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 2 || due[0] != "never" || due[1] != "stale" {
		t.Fatalf("due = %v, want [never stale]", due)
	}
	response := &SocialStatusResponse{Presences: []SocialPresence{{Puuid: "FRESH"}, {Puuid: "never"}}}
	attachFriendActivity(db, response)
	if response.Presences[0].LastMatchAt != 900 || response.Presences[1].LastMatchAt != 0 || response.Presences[0].CardID != "card-fresh" {
		t.Fatalf("presences = %+v", response.Presences)
	}
}
