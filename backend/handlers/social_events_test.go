package handlers

import "testing"

func TestNotifySocialChangedSignalsSubscriber(t *testing.T) {
	h := NewHandler(nil)
	ch := make(chan struct{}, 1)
	h.socialSubscribers[ch] = struct{}{}

	h.NotifySocialChanged()

	select {
	case <-ch:
	default:
		t.Fatal("social subscriber was not notified")
	}
}
