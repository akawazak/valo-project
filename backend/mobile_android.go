//go:build android

package main

/*
#include <stdint.h>
*/
import "C"

import (
	"backend/handlers"
	"log"
	"strings"
)

// StartVantaVaultBackend starts the authenticated loopback API inside the
// Android process. It returns immediately; the server owns its goroutine for
// the lifetime of the app process.
//
//export StartVantaVaultBackend
func StartVantaVaultBackend(apiKey *C.char, configDir *C.char, chatStorageKey *C.char) C.int {
	key := strings.TrimSpace(C.GoString(apiKey))
	dataDir := strings.TrimSpace(C.GoString(configDir))
	chatKey := strings.TrimSpace(C.GoString(chatStorageKey))
	if key == "" || dataDir == "" || chatKey == "" {
		return 1
	}
	if err := handlers.SetAndroidChatEncryptionKey(chatKey); err != nil {
		log.Printf("embedded Android backend rejected chat encryption key")
		return 2
	}
	go func() {
		if err := runBackend(key, false, dataDir); err != nil {
			log.Printf("embedded Android backend stopped")
		}
	}()
	return 0
}
