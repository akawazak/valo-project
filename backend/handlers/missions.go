package handlers

import (
	"encoding/json"
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

type RiotContractsResponse struct {
	Version               int    `json:"Version"`
	Subject               string `json:"Subject"`
	ActiveSpecialContract string `json:"ActiveSpecialContract"`
	Contracts             []struct {
		ContractDefinitionID string         `json:"ContractDefinitionID"`
		ContractProgression  map[string]any `json:"ContractProgression"`
	} `json:"Contracts"`
}

type PlayerContractSummary struct {
	ID                            string `json:"id"`
	TotalProgressionEarned        int    `json:"totalProgressionEarned"`
	TotalProgressionEarnedVersion int    `json:"totalProgressionEarnedVersion"`
	HighestRewardedLevel          int    `json:"highestRewardedLevel"`
	ProgressionLevelReached       int    `json:"progressionLevelReached"`
	ProgressionTowardsNextLevel   int    `json:"progressionTowardsNextLevel"`
}

type PlayerContractsResponse struct {
	Version               int                     `json:"version"`
	Subject               string                  `json:"subject"`
	ActiveSpecialContract string                  `json:"activeSpecialContract"`
	Contracts             []PlayerContractSummary `json:"contracts"`
}

func (h *Handler) GetContracts(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}

	url := val.BuildUrl("https://pd.{shard}.a.pvp.net/contracts/v1/contracts/{puuid}")
	resp := new(RiotContractsResponse)
	if err := val.RunRequest(http.MethodGet, url, nil, resp); err != nil {
		h.returnError(w, err)
		return
	}

	out := PlayerContractsResponse{
		Version:               resp.Version,
		Subject:               resp.Subject,
		ActiveSpecialContract: resp.ActiveSpecialContract,
		Contracts:             make([]PlayerContractSummary, 0, len(resp.Contracts)),
	}
	for _, contract := range resp.Contracts {
		if contract.ContractDefinitionID == "" {
			continue
		}
		out.Contracts = append(out.Contracts, PlayerContractSummary{
			ID:                            contract.ContractDefinitionID,
			TotalProgressionEarned:        numberFromMap(contract.ContractProgression, "TotalProgressionEarned", "totalProgressionEarned"),
			TotalProgressionEarnedVersion: numberFromMap(contract.ContractProgression, "TotalProgressionEarnedVersion", "totalProgressionEarnedVersion"),
			HighestRewardedLevel:          numberFromMap(contract.ContractProgression, "HighestRewardedLevel", "highestRewardedLevel", "LevelReached", "levelReached"),
			ProgressionLevelReached:       numberFromMap(contract.ContractProgression, "ProgressionLevelReached", "progressionLevelReached", "LevelReached", "levelReached"),
			ProgressionTowardsNextLevel:   numberFromMap(contract.ContractProgression, "ProgressionTowardsNextLevel", "progressionTowardsNextLevel"),
		})
	}

	h.returnAny(w, out)
}

func numberFromMap(m map[string]any, keys ...string) int {
	for _, key := range keys {
		switch v := m[key].(type) {
		case float64:
			return int(v)
		case int:
			return v
		case json.Number:
			if n, err := v.Int64(); err == nil {
				return int(n)
			}
		case map[string]any:
			if n := numberFromMap(v, "Level", "level", "LevelReached", "levelReached", "ProgressionLevelReached", "progressionLevelReached"); n > 0 {
				return n
			}
		}
	}
	return 0
}
