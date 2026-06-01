package handlers

import (
	"net/http"
)

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	val := h.Val
	ticker := h.Ticker
	h.mu.RUnlock()

	if val == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	if _, err := val.GetHelp(); err != nil {
		if ticker != nil {
			ticker.Stop()
		}
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if ticker != nil {
		ticker.Start()
	}
	w.WriteHeader(http.StatusOK)
}
