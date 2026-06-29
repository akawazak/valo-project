package handlers

import (
	"testing"
	"time"
)

func TestXMPPSessionPreservesRecentConnectionError(t *testing.T) {
	session := &xmppSocialSession{
		state:       "error",
		lastError:   "authentication failed",
		lastAttempt: time.Now(),
	}

	session.ensureRunning(remoteAuthHeaders{})

	if session.running || session.state != "error" || session.lastError != "authentication failed" {
		t.Fatalf("recent error was hidden by an immediate retry: %#v", session)
	}
}
