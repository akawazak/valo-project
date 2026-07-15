//go:build !windows

package handlers

import "fmt"

func protectChatData(_, _ []byte) ([]byte, error) {
	return nil, fmt.Errorf("chat encryption requires Windows")
}
func unprotectChatData(_, _ []byte) ([]byte, error) {
	return nil, fmt.Errorf("chat encryption requires Windows")
}
