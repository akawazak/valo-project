package handlers

import (
	"backend/presets"
	"bytes"
	"io"
	"net/http"
	"os"
	"strings"
)

func (h *Handler) GetPresets(w http.ResponseWriter, r *http.Request) {
	owner := h.presetOwner(r)
	data, err := presets.GetRawForOwner(owner)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("[]"))
			return
		}
		h.returnError(w, err)
		return
	}

	if len(data) == 0 {
		data = []byte("[]")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func (h *Handler) PostPresets(w http.ResponseWriter, r *http.Request) {
	body := new(bytes.Buffer)
	if _, err := io.Copy(body, r.Body); err != nil {
		h.returnError(w, err)
		return
	}

	if err := presets.SaveRawForOwner(h.presetOwner(r), body.Bytes()); err != nil {
		h.returnError(w, err)
		return
	}

	h.returnAny(w, "success")
}

func (h *Handler) presetOwner(r *http.Request) string {
	if puuid := strings.TrimSpace(r.Header.Get("X-Riot-Puuid")); puuid != "" {
		return puuid
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.Val != nil && h.Val.Player != nil {
		return h.Val.Player.Uuid
	}
	return ""
}
