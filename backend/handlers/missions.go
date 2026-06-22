package handlers

import (
	"net/http"
)

type RiotMissionsResponse struct {
	Missions []struct {
		ID             string         `json:"ID"`
		Objectives     map[string]int `json:"Objectives"`
		Complete       bool           `json:"Complete"`
		ExpirationTime string         `json:"ExpirationTime"`
	} `json:"Missions"`
	MissionMetadata struct {
		WeeklyRefillTime string `json:"WeeklyRefillTime"`
	} `json:"MissionMetadata"`
}

func (h *Handler) GetMissions(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}

	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/contracts/v1/contracts/{puuid}")
	resp := new(RiotMissionsResponse)
	if err := val.RunRequest(http.MethodGet, url, nil, resp); err != nil {
		h.returnError(w, err)
		return
	}

	h.returnAny(w, resp)
}
