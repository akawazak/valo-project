package accounts

import (
	"bytes"
	"os"
	"path/filepath"
	"sync"
)

var saveMu sync.Mutex

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

	saveMu.Lock()
	defer saveMu.Unlock()
	if existing, readErr := os.ReadFile(path); readErr == nil && bytes.Equal(existing, data) {
		return nil
	}
	return writeFileAtomically(path, data)
}

func writeFileAtomically(path string, data []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), "accounts-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if err := temp.Chmod(0600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return replaceFile(tempPath, path)
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
