package handlers

import (
	"encoding/json"
	"net/http"
)

type HealthResponse struct {
	Status            string `json:"status"`
	LocalClientActive bool   `json:"local_client_active"`
	LocalPuuid        string `json:"local_puuid,omitempty"`
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	val := h.Val
	h.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")

	if val == nil || val.Player == nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(HealthResponse{
			Status:            "ok",
			LocalClientActive: false,
		})
		return
	}

	// The connection monitor owns liveness and its transient-failure grace
	// period. Health must stay fast and must not turn a Riot outage into a
	// backend outage (or mutate the shared client's lockfile credentials).
	h.StartLocalTicker()
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(HealthResponse{
		Status:            "ok",
		LocalClientActive: true,
		LocalPuuid:        val.Player.Uuid,
	})
}
