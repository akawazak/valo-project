package settings

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Settings struct {
	AutoSelectAgent    bool `json:"autoSelectAgent"`
	UseLocalSso        bool `json:"useLocalSso"`
	AutoSyncMatches    bool `json:"autoSyncMatches"`
	MatchRetentionDays int  `json:"matchRetentionDays"`
	ShowOfflineFriends bool `json:"showOfflineFriends"`
}

func (s *Settings) Marshal() ([]byte, error) {
	return json.Marshal(s)
}

var DefaultSettings = &Settings{
	AutoSelectAgent:    true,
	UseLocalSso:        false,
	AutoSyncMatches:    true,
	MatchRetentionDays: 365,
	ShowOfflineFriends: false,
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
