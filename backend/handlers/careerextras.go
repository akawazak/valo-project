package handlers

import (
	"net/http"
)

// Read-only views of the signed-in player's own 13.06 career data. These use
// the same undocumented client endpoints the game calls; keep them
// user-initiated (no polling) until Riot confirms the features.

// lifetimeSeasonID is the key Riot uses for lifetime accolade records.
const lifetimeSeasonID = "00000000-0000-0000-0000-000000000000"

// Riot ships the goldstars payload with obfuscated field names ("tempX").
// They were mapped against live data on 13.06 and may change in a patch.
type goldStarDefinition struct {
	ID        string  `json:"id"`
	Threshold float64 `json:"tempT"`
}

type goldStarsPlayer struct {
	Matches []struct {
		ID        string `json:"id"`
		StartedAt int64  `json:"tempG"`
		// Keyed by puuid and covers everyone in the match; only the
		// signed-in player's entry leaves the backend.
		Players map[string]struct {
			Accolades map[string]struct {
				ID     string  `json:"id"`
				Earned bool    `json:"tempB"`
				Value  float64 `json:"tempV"`
			} `json:"tempA"`
		} `json:"tempP"`
	} `json:"tempM"`
	Seasons map[string]struct {
		Accolades map[string]struct {
			ID    string  `json:"id"`
			Best  float64 `json:"tempB"`
			Count float64 `json:"tempC"`
		} `json:"tempA"`
	} `json:"tempS"`
}

type accoladeRecord struct {
	ID    string  `json:"id"`
	Best  float64 `json:"best"`
	Count float64 `json:"count"`
}

type accoladeMatchValue struct {
	ID     string  `json:"id"`
	Earned bool    `json:"earned"`
	Value  float64 `json:"value"`
}

type accoladeMatch struct {
	MatchID   string               `json:"matchId"`
	StartedAt int64                `json:"startedAt"`
	Accolades []accoladeMatchValue `json:"accolades"`
}

type accoladesResponse struct {
	Definitions []goldStarDefinition `json:"definitions"`
	Lifetime    []accoladeRecord     `json:"lifetime"`
	// Acts maps a season (act) UUID to that act's records.
	Acts    map[string][]accoladeRecord `json:"acts"`
	Matches []accoladeMatch             `json:"matches"`
}

// GetAccolades returns the signed-in player's accolades and Riot's accolade thresholds.
func (h *Handler) GetAccolades(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}
	var player goldStarsPlayer
	if err := runRiotJSON(http.MethodGet, val.BuildUrl("https://pd.{shard}.a.pvp.net/goldstars/v1/players/{puuid}"), val.Header, nil, &player); err != nil {
		h.returnError(w, err)
		return
	}
	var definitions []goldStarDefinition
	if err := runRiotJSON(http.MethodGet, val.BuildUrl("https://pd.{shard}.a.pvp.net/goldstars/v1/goldstars"), val.Header, nil, &definitions); err != nil {
		h.returnError(w, err)
		return
	}

	response := accoladesResponse{Definitions: definitions, Lifetime: []accoladeRecord{}, Acts: map[string][]accoladeRecord{}, Matches: []accoladeMatch{}}
	for seasonID, season := range player.Seasons {
		records := make([]accoladeRecord, 0, len(season.Accolades))
		for id, record := range season.Accolades {
			records = append(records, accoladeRecord{ID: id, Best: record.Best, Count: record.Count})
		}
		if seasonID == lifetimeSeasonID {
			response.Lifetime = records
		} else {
			response.Acts[seasonID] = records
		}
	}
	if val.Player != nil {
		for _, match := range player.Matches {
			own, ok := match.Players[val.Player.Uuid]
			if !ok {
				continue
			}
			values := make([]accoladeMatchValue, 0, len(own.Accolades))
			for id, value := range own.Accolades {
				values = append(values, accoladeMatchValue{ID: id, Earned: value.Earned, Value: value.Value})
			}
			response.Matches = append(response.Matches, accoladeMatch{MatchID: match.ID, StartedAt: match.StartedAt, Accolades: values})
		}
	}
	h.returnAny(w, response)
}

// GetFavorites returns the items the player starred as favourites in the game.
func (h *Handler) GetFavorites(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}
	var response any
	if err := runRiotJSON(http.MethodGet, val.BuildUrl("https://pd.{shard}.a.pvp.net/favorites/v1/players/{puuid}/favorites"), val.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response)
}

// GetPremierPlayer returns the player's Premier status, including their roster ID.
func (h *Handler) GetPremierPlayer(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil || val == nil {
		h.returnError(w, err)
		return
	}
	var response any
	if err := runRiotJSON(http.MethodGet, val.BuildUrl("https://pd.{shard}.a.pvp.net/premier/v2/players/{puuid}"), val.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response)
}
