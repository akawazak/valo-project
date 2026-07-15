package settings

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Settings struct {
	AutoSelectAgent      bool               `json:"autoSelectAgent"`
	UseLocalSso          bool               `json:"useLocalSso"`
	AutoSyncMatches      bool               `json:"autoSyncMatches"`
	MatchRetentionDays   int                `json:"matchRetentionDays"`
	ShowOfflineFriends   bool               `json:"showOfflineFriends"`
	ShowLiveMatch        bool               `json:"showLiveMatch"`
	ShowPartyWidget      bool               `json:"showPartyWidget"`
	ShowUnownedCosmetics bool               `json:"showUnownedCosmetics"`
	Theme                string             `json:"theme"`
	AccentTheme          string             `json:"accentTheme"`
	InterfaceTheme       string             `json:"interfaceTheme"`
	UISettingsSaved      bool               `json:"uiSettingsSaved"`
	Appearance           AppearanceSettings `json:"appearance"`
}

type AppearanceSettings struct {
	BackgroundID   string `json:"backgroundId"`
	BackgroundURL  string `json:"backgroundUrl"`
	BackgroundName string `json:"backgroundName"`
	Strength       int    `json:"strength"`
	Blur           int    `json:"blur"`
	Saturation     int    `json:"saturation"`
	PanelOpacity   int    `json:"panelOpacity"`
	Position       string `json:"position"`
}

func (s *Settings) Marshal() ([]byte, error) {
	return json.Marshal(s)
}

var DefaultSettings = &Settings{
	AutoSelectAgent:      true,
	UseLocalSso:          false,
	AutoSyncMatches:      true,
	MatchRetentionDays:   365,
	ShowOfflineFriends:   false,
	ShowLiveMatch:        true,
	ShowPartyWidget:      true,
	ShowUnownedCosmetics: false,
	Theme:                "dark",
	AccentTheme:          "valorant",
	InterfaceTheme:       "default",
	UISettingsSaved:      false,
	Appearance:           AppearanceSettings{Strength: 38, Saturation: 90, PanelOpacity: 82, Position: "center"},
}

func Get() (*Settings, error) {
	return read()
}

func GetRaw() ([]byte, error) {
	settings, err := read()
	if err != nil {
		return nil, err
	}
	return settings.Marshal()
}

func SaveRaw(data []byte) error {
	settings := *DefaultSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return fmt.Errorf("invalid settings: %w", err)
	}
	if err := settings.Validate(); err != nil {
		return err
	}
	encoded, err := settings.Marshal()
	if err != nil {
		return err
	}
	path, err := getPath()
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, encoded, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s Settings) Validate() error {
	switch s.MatchRetentionDays {
	case 0, 30, 90, 180, 365:
		if s.Appearance.Strength < 0 || s.Appearance.Strength > 100 || s.Appearance.Blur < 0 || s.Appearance.Blur > 30 || s.Appearance.Saturation < 0 || s.Appearance.Saturation > 200 || s.Appearance.PanelOpacity < 0 || s.Appearance.PanelOpacity > 100 {
			return fmt.Errorf("appearance values are out of range")
		}
		if s.Appearance.Position != "left" && s.Appearance.Position != "center" && s.Appearance.Position != "right" {
			return fmt.Errorf("appearance position is invalid")
		}
		if s.Theme != "dark" && s.Theme != "light" {
			return fmt.Errorf("theme is invalid")
		}
		if s.AccentTheme != "valorant" && s.AccentTheme != "aqua" && s.AccentTheme != "violet" && s.AccentTheme != "gold" {
			return fmt.Errorf("accent theme is invalid")
		}
		if s.InterfaceTheme != "default" && s.InterfaceTheme != "protocol" && s.InterfaceTheme != "cinematic" {
			return fmt.Errorf("interface theme is invalid")
		}
		return nil
	default:
		return fmt.Errorf("matchRetentionDays must be 0, 30, 90, 180, or 365")
	}
}

func read() (*Settings, error) {
	path, err := getPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			copy := *DefaultSettings
			return &copy, nil
		}
		return nil, err
	}
	if bytes.Equal(bytes.TrimSpace(data), []byte("{}")) {
		copy := *DefaultSettings
		return &copy, nil
	}
	settings := *DefaultSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	return &settings, nil
}

func getPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	valovaultDir := filepath.Join(configDir, "valovault/settings")
	if err := os.MkdirAll(valovaultDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(valovaultDir, "settings_v1.json"), nil
}
