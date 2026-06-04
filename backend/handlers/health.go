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
	ticker := h.Ticker
	h.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")

	if val == nil {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(HealthResponse{
			Status:            "ok",
			LocalClientActive: false,
		})
		return
	}

	if _, err := val.GetHelp(); err != nil {
		if ticker != nil {
			ticker.Stop()
		}
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(HealthResponse{
			Status:            "error",
			LocalClientActive: false,
		})
		return
	}
	if ticker != nil {
		ticker.Start()
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(HealthResponse{
		Status:            "ok",
		LocalClientActive: true,
		LocalPuuid:        val.Player.Uuid,
	})
}
