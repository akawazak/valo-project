package accounts

import (
	"os"
	"path/filepath"
)

func GetRaw() ([]byte, error) {
	path, err := getPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []byte("[]"), nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return []byte("[]"), nil
	}
	return data, nil
}

func SaveRaw(data []byte) error {
	path, err := getPath()
	if err != nil {
		return err
	}
	if len(data) == 0 {
		data = []byte("[]")
	}
	return os.WriteFile(path, data, 0600)
}

func getPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	dir := filepath.Join(configDir, "valovault", "accounts")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "accounts.json"), nil
}
