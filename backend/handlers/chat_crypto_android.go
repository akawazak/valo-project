//go:build android

package handlers

import (
	"encoding/base64"
	"fmt"
	"sync"
)

var androidChatEncryptionKey struct {
	sync.RWMutex
	value []byte
}

// SetAndroidChatEncryptionKey installs the per-app AES key unwrapped by
// Android Keystore before the embedded API begins serving requests.
func SetAndroidChatEncryptionKey(encoded string) error {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("decode Android chat encryption key: %w", err)
	}
	if len(key) != 32 {
		return fmt.Errorf("Android chat encryption key must be 32 bytes")
	}
	androidChatEncryptionKey.Lock()
	defer androidChatEncryptionKey.Unlock()
	androidChatEncryptionKey.value = append(androidChatEncryptionKey.value[:0], key...)
	for index := range key {
		key[index] = 0
	}
	return nil
}

func currentAndroidChatEncryptionKey() ([]byte, error) {
	androidChatEncryptionKey.RLock()
	defer androidChatEncryptionKey.RUnlock()
	if len(androidChatEncryptionKey.value) != 32 {
		return nil, fmt.Errorf("Android chat encryption key is unavailable")
	}
	return append([]byte(nil), androidChatEncryptionKey.value...), nil
}

func protectChatData(plain, entropy []byte) ([]byte, error) {
	key, err := currentAndroidChatEncryptionKey()
	if err != nil {
		return nil, err
	}
	defer func() {
		for index := range key {
			key[index] = 0
		}
	}()
	return sealChatData(key, plain, entropy)
}

func unprotectChatData(ciphertext, entropy []byte) ([]byte, error) {
	key, err := currentAndroidChatEncryptionKey()
	if err != nil {
		return nil, err
	}
	defer func() {
		for index := range key {
			key[index] = 0
		}
	}()
	return openChatData(key, ciphertext, entropy)
}
