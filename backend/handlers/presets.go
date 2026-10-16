package handlers

import (
	"backend/presets"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
)

func (h *Handler) GetPresets(w http.ResponseWriter, r *http.Request) {
	owner := h.presetOwner(r)
	if !h.validatePresetOwner(w, r, owner) {
		return
	}
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
	owner := h.presetOwner(r)
	if !h.validatePresetOwner(w, r, owner) {
		return
	}
	body := new(bytes.Buffer)
	if _, err := io.Copy(body, r.Body); err != nil {
		h.returnError(w, err)
		return
	}

	if err := presets.SaveRawForOwner(owner, body.Bytes()); err != nil {
		h.returnError(w, err)
		return
	}

	h.returnAny(w, "success")
}

func (h *Handler) presetOwner(r *http.Request) string {
	if puuid := selectedAccountPuuid(r); puuid != "" {
		return puuid
	}
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

func (h *Handler) validatePresetOwner(w http.ResponseWriter, r *http.Request, owner string) bool {
	if _, present := r.Header[http.CanonicalHeaderKey("X-Riot-Expected-Puuid")]; !present {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Riot-Expected-Puuid")), strings.TrimSpace(owner)) {
		return true
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	_ = json.NewEncoder(w).Encode(struct {
		HTTPStatus int    `json:"httpStatus"`
		ErrorCode  string `json:"errorCode"`
		Message    string `json:"message"`
	}{http.StatusConflict, "ACCOUNT_CHANGED", "The selected account changed. Reload its presets before continuing."})
	return false
}
