package handlers

import (
	"bytes"
	"testing"
)

func TestPortableChatEncryptionRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{0x2a}, 32)
	entropy := []byte("account-a")
	plain := []byte("message history")

	ciphertext, err := sealChatData(key, plain, entropy)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(ciphertext, plain) {
		t.Fatal("ciphertext contains plaintext")
	}
	decoded, err := openChatData(key, ciphertext, entropy)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, plain) {
		t.Fatalf("decoded %q, want %q", decoded, plain)
	}
	if _, err := openChatData(key, ciphertext, []byte("account-b")); err == nil {
		t.Fatal("decrypting with different account entropy succeeded")
	}
}
