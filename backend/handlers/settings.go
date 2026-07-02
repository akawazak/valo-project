package handlers

import (
	"backend/settings"
	"backend/tracking"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	data, err := settings.GetRaw()
	if err != nil {
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

func (h *Handler) PostSettings(w http.ResponseWriter, r *http.Request) {
	body := new(bytes.Buffer)
	if _, err := io.Copy(body, r.Body); err != nil {
		h.returnError(w, err)
		return
	}

	previous, _ := settings.Get()
	if err := settings.SaveRaw(body.Bytes()); err != nil {
		h.returnError(w, err)
		return
	}
	var saved settings.Settings
	if err := json.Unmarshal(body.Bytes(), &saved); err == nil &&
		saved.MatchRetentionDays > 0 &&
		(previous == nil || previous.MatchRetentionDays != saved.MatchRetentionDays) {
		if db, dbErr := h.trackingDB(); dbErr == nil {
			cutoff := time.Now().AddDate(0, 0, -saved.MatchRetentionDays).UnixMilli()
			if _, pruneErr := tracking.PruneMatchesBefore(db, cutoff); pruneErr != nil {
				h.returnError(w, pruneErr)
				return
			}
		}
	}

	h.returnAny(w, "success")
}
