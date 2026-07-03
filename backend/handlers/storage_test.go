package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateNestedTrackingDB(t *testing.T) {
	appDir := t.TempDir()
	legacyDir := filepath.Join(appDir, "valovault")
	if err := os.MkdirAll(legacyDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.WriteFile(filepath.Join(legacyDir, "tracking.db"+suffix), []byte(suffix), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if err := migrateNestedTrackingDB(appDir); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if _, err := os.Stat(filepath.Join(appDir, "tracking.db"+suffix)); err != nil {
			t.Fatalf("missing migrated database file %q: %v", suffix, err)
		}
	}
	if _, err := os.Stat(legacyDir); !os.IsNotExist(err) {
		t.Fatalf("legacy nested directory remains: %v", err)
	}
}
