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
	if got.AutoSelectAgent || !got.AutoSyncMatches || got.MatchRetentionDays != 365 || !got.ShowLiveMatch || !got.ShowPartyWidget || got.ShowUnownedCosmetics || !got.SoundEnabled || got.SoundVolume != 28 {
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

func TestSaveRawRejectsInvalidSoundVolume(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("APPDATA", configDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)

	if err := SaveRaw([]byte(`{"soundVolume":101}`)); err == nil {
		t.Fatal("expected invalid sound volume to be rejected")
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

func TestSaveRawPersistsCompleteUISettings(t *testing.T) {
	configDir := t.TempDir()
	t.Setenv("APPDATA", configDir)
	t.Setenv("XDG_CONFIG_HOME", configDir)
	raw := []byte(`{"theme":"light","accentTheme":"aqua","interfaceTheme":"cinematic","uiSettingsSaved":true,"appearance":{"backgroundId":"deadlock","backgroundUrl":"/themes/deadlock.jpg","backgroundName":"Deadlock","strength":52,"blur":3,"saturation":110,"panelOpacity":76,"position":"right"}}`)
	if err := SaveRaw(raw); err != nil {
		t.Fatal(err)
	}
	got, err := Get()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != "light" || got.AccentTheme != "aqua" || got.InterfaceTheme != "cinematic" || !got.UISettingsSaved || got.Appearance.BackgroundID != "deadlock" || got.Appearance.Position != "right" || got.Appearance.PanelOpacity != 76 {
		t.Fatalf("UI settings were not persisted: %+v", got)
	}
}
