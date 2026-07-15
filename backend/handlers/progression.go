package handlers

import (
	"fmt"
	"net/http"
	"time"
)

// GetItemUpgrades returns Riot's read-only modern Agent Gear definitions.
func (h *Handler) GetItemUpgrades(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}
	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/contract-definitions/v3/item-upgrades")
	var response map[string]any
	if err := runRiotJSON(http.MethodGet, url, val.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response)
}

func (h *Handler) NotifyProgressionChanged() {
	h.progressionMu.Lock()
	defer h.progressionMu.Unlock()
	if h.progressionSubscribers == nil {
		h.progressionSubscribers = make(map[chan struct{}]struct{})
	}
	for subscriber := range h.progressionSubscribers {
		select {
		case subscriber <- struct{}{}:
		default:
		}
	}
}

// ProgressionEvents streams cache-invalidations only; account data is fetched
// through the normal authenticated endpoints after each event.
func (h *Handler) ProgressionEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	subscriber := make(chan struct{}, 1)
	h.progressionMu.Lock()
	if h.progressionSubscribers == nil {
		h.progressionSubscribers = make(map[chan struct{}]struct{})
	}
	h.progressionSubscribers[subscriber] = struct{}{}
	h.progressionMu.Unlock()
	defer func() {
		h.progressionMu.Lock()
		delete(h.progressionSubscribers, subscriber)
		h.progressionMu.Unlock()
	}()

	fmt.Fprint(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-subscriber:
			fmt.Fprint(w, "event: progression\ndata: {}\n\n")
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
