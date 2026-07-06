package presets

import (
	"os"
	"testing"

	"github.com/truearken/valclient/valclient"
)

func TestRestoreSnapshotRoundTripAndClear(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	want := &valclient.GetPlayerLoadoutRequest{
		Subject:   "player",
		Incognito: true,
		Guns:      []*valclient.Gun{{ID: "weapon", SkinID: "skin"}},
	}
	if err := SaveRestoreSnapshot("Player-123", want); err != nil {
		t.Fatal(err)
	}
	got, err := LoadRestoreSnapshot("Player-123")
	if err != nil {
		t.Fatal(err)
	}
	if got.Subject != want.Subject || !got.Incognito || len(got.Guns) != 1 || got.Guns[0].SkinID != "skin" {
		t.Fatalf("unexpected restored snapshot: %#v", got)
	}
	if err := ClearRestoreSnapshot("Player-123"); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRestoreSnapshot("Player-123"); !os.IsNotExist(err) {
		t.Fatalf("expected removed snapshot, got %v", err)
	}
}
