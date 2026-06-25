package handlers

import (
	"encoding/json"
	"net/http"
)

// RiotMissionsResponse is the full payload from
// https://pd.{shard}.a.pvp.net/contracts/v1/contracts/{puuid}.
//
// The endpoint actually returns both Contracts (battlepass, event
// progression, agent unlocks) and Missions (daily / weekly / BTE)
// in one shot. We expose both so the frontend doesn't need two
// round trips and so the "Progress Center" can render every kind of
// XP-earning track — daily checkpoints, weekly missions, the
// active battlepass, and limited-time event contracts — from one
// response.
//
// Field names mirror Riot's PascalCase JSON schema.
type RiotMissionsResponse struct {
	Version               int                       `json:"Version"`
	Subject               string                    `json:"Subject"`
	ActiveSpecialContract string                    `json:"ActiveSpecialContract"`
	Contracts             []RiotContractProgress    `json:"Contracts"`
	Missions              []RiotMissionProgress     `json:"Missions"`
	MissionMetadata       RiotMissionMetadata       `json:"MissionMetadata"`
}

// RiotContractProgress is one row of the user's tracked contracts.
// `ContractDefinitionID` matches the uuid field from
// valorant-api.com /v1/contracts (battlepass, event contracts,
// agent unlocks).
//
// Note from the Riot API docs: ProgressionLevelReached and
// ProgressionTowardsNextLevel are TOP-LEVEL fields on the contract
// item, NOT nested inside ContractProgression. HighestRewardedLevel
// is a map keyed by season (legacy), so the frontend / api.ts
// code is responsible for picking the right entry.
type RiotContractProgress struct {
	ContractDefinitionID       string         `json:"ContractDefinitionID"`
	ContractProgression        map[string]any `json:"ContractProgression"`
	ProgressionLevelReached    int            `json:"ProgressionLevelReached"`
	ProgressionTowardsNextLevel int           `json:"ProgressionTowardsNextLevel"`
}

// RiotMissionProgress is one daily/weekly/BTE mission. The ID maps
// to the uuid field from valorant-api.com /v1/missions.
type RiotMissionProgress struct {
	ID             string         `json:"ID"`
	Objectives     map[string]int `json:"Objectives"`
	Complete       bool           `json:"Complete"`
	ExpirationTime string         `json:"ExpirationTime"`
}

// RiotMissionMetadata carries the refill schedule. Per the Riot
// contracts endpoint schema (valapidocs.techchrism.me/endpoint/contracts),
// the only fields exposed are NPECompleted, WeeklyCheckpoint, and
// WeeklyRefillTime. There's no DailyRefillTime — daily missions
// just refresh 24h after they're issued.
type RiotMissionMetadata struct {
	NPECompleted     bool   `json:"NPECompleted"`
	WeeklyCheckpoint string `json:"WeeklyCheckpoint"`
	WeeklyRefillTime string `json:"WeeklyRefillTime"`
}

// GetMissions returns the full contracts payload — both the
// Missions[] (daily / weekly / BTE) and Contracts[] (battlepass /
// event contracts) so the frontend can render every XP-earning
// track in one place.
//
// Both /v1/missions and /v1/contracts hit the same Riot endpoint,
// so this handler is also used as the data source for the
// contracts-only call sites. See normalizeContractsResponse below
// for the trimmed view that the legacy /v1/contracts endpoint
// serves for backward compatibility.
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
		ContractDefinitionID        string         `json:"ContractDefinitionID"`
		ContractProgression         map[string]any `json:"ContractProgression"`
		ProgressionLevelReached     int            `json:"ProgressionLevelReached"`
		ProgressionTowardsNextLevel int            `json:"ProgressionTowardsNextLevel"`
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

// GetContracts keeps the legacy /v1/contracts endpoint shape so
// older clients don't break, but pulls from the same source.
// `ActiveSpecialContract` is preserved so the frontend can keep
// tagging the active battlepass.
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
			ProgressionLevelReached:       contract.ProgressionLevelReached,
			ProgressionTowardsNextLevel:   contract.ProgressionTowardsNextLevel,
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