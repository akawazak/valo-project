package settings

import (
	"os"
	"runtime"
	"testing"
)

func TestSaveRawMergesDefaultsAndReplacesExistingFile(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("APPDATA", configDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	if err := SaveRaw([]byte(`{"autoSelectAgent":false}`)); err != nil {
		t.Fatal(err)
	}
	got, err := Get()
	if err != nil {
		t.Fatal(err)
	}
	if got.AutoSelectAgent || !got.AutoSyncMatches || got.MatchRetentionDays != 365 {
		t.Fatalf("legacy settings were not merged with defaults: %+v", got)
	}

	if err := SaveRaw([]byte(`{"matchRetentionDays":30,"showOfflineFriends":true}`)); err != nil {
		t.Fatal(err)
	}
	got, err = Get()
	if err != nil {
		t.Fatal(err)
	}
	if got.MatchRetentionDays != 30 || !got.ShowOfflineFriends {
		t.Fatalf("updated settings were not persisted: %+v", got)
	}

	path, err := getPath()
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path); err != nil || (runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		t.Fatalf("settings file permissions are not private: info=%v err=%v", info, err)
	}
}

func TestSaveRawRejectsInvalidRetention(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("APPDATA", configDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	if err := SaveRaw([]byte(`{"matchRetentionDays":7}`)); err == nil {
		t.Fatal("expected invalid retention to be rejected")
	}
}
