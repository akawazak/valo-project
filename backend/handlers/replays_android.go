//go:build android

package handlers

import "net/http"

// Round replays are a PC feature: VALORANT only writes .vrf files on Windows.
func replaysUnavailable(w http.ResponseWriter) {
	http.Error(w, `{"error":"replays are only available on PC"}`, http.StatusNotFound)
}

func (h *Handler) GetReplays(w http.ResponseWriter, _ *http.Request)       { replaysUnavailable(w) }
func (h *Handler) GetReplay(w http.ResponseWriter, _ *http.Request)        { replaysUnavailable(w) }
func (h *Handler) PostReplayImport(w http.ResponseWriter, _ *http.Request) { replaysUnavailable(w) }
func (h *Handler) DeleteReplay(w http.ResponseWriter, _ *http.Request)     { replaysUnavailable(w) }
