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

// GetDailyTicket mirrors Riot's DailyRewards_RENEW initialization request. The
// endpoint returns the active ticket unchanged or rolls an expired one forward.
func (h *Handler) GetDailyTicket(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}

	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/daily-ticket/v1/{puuid}/renew")
	var response dailyTicketResponse
	if err := runRiotJSON(http.MethodPost, url, val.Header, map[string]any{}, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response.DailyRewards)
}
