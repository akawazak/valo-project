package accounts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteFileAtomicallyReplacesCompleteAccountSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.json")
	if err := os.WriteFile(path, []byte(`[{"puuid":"old"}]`), 0600); err != nil {
		t.Fatal(err)
	}

	want := []byte(`[{"puuid":"new","ssid":"ssid=value"}]`)
	if err := writeFileAtomically(path, want); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("got %q, want %q", got, want)
	}

	matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), "accounts-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary account files were not cleaned up: %v", matches)
	}
}
