package handlers

import "net/http"

// GetAccountXP returns Riot's authenticated account-level progression payload,
// including the current level/XP, first-win timer, and per-match XP sources.
func (h *Handler) GetAccountXP(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}

	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/account-xp/v1/players/{puuid}")
	var response map[string]any
	if err := runRiotJSON(http.MethodGet, url, val.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response)
}
