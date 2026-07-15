//go:build windows

package handlers

import (
	"bytes"
	"testing"
)

func TestChatDPAPIRoundTripAndEntropy(t *testing.T) {
	plain := []byte("private chat text")
	entropy := chatEntropy("account-a")
	ciphertext, err := protectChatData(plain, entropy)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ciphertext, plain) {
		t.Fatal("DPAPI ciphertext contains plaintext")
	}
	decoded, err := unprotectChatData(ciphertext, entropy)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, plain) {
		t.Fatalf("round trip = %q", decoded)
	}
	if _, err := unprotectChatData(ciphertext, chatEntropy("account-b")); err == nil {
		t.Fatal("different account entropy unexpectedly decrypted")
	}
}

func TestChatPathKeyRoundTrip(t *testing.T) {
	for _, key := range []string{"dm:abc-123", "party:room/value"} {
		if got := decodePathKey(encodePathKey(key)); got != key {
			t.Fatalf("round trip = %q, want %q", got, key)
		}
	}
}
