package handlers

import "net/http"

type dailyTicketProgress struct {
	RemainingLifetimeSeconds int `json:"RemainingLifetimeSeconds"`
	BonusMilestonesPending   int `json:"BonusMilestonesPending"`
	Milestones               []struct {
		Progress     int  `json:"Progress"`
		BonusApplied bool `json:"BonusApplied"`
	} `json:"Milestones"`
}

type dailyTicketResponse struct {
	DailyRewards dailyTicketProgress `json:"DailyRewards"`
}

// GetDailyTicket returns Riot's read-only daily checkpoint state. We avoid the
// /renew mutation: viewing progress must not change the player's Riot state.
func (h *Handler) GetDailyTicket(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}

	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/daily-ticket/v1/{puuid}")
	var response dailyTicketResponse
	if err := runRiotJSON(http.MethodGet, url, val.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response.DailyRewards)
}
