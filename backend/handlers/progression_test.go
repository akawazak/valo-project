package handlers

import (
	"testing"
	"time"
)

func TestNotifyProgressionChanged(t *testing.T) {
	h := NewHandler(nil)
	subscriber := make(chan struct{}, 1)
	h.progressionSubscribers[subscriber] = struct{}{}
	h.NotifyProgressionChanged()
	select {
	case <-subscriber:
	case <-time.After(time.Second):
		t.Fatal("progression subscriber was not notified")
	}
}
