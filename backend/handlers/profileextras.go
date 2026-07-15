package handlers

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (h *Handler) GetProfileLeaderboard(w http.ResponseWriter, r *http.Request) {
	client, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	seasonID := strings.TrimSpace(r.URL.Query().Get("seasonId"))
	if seasonID == "" {
		if content, contentErr := client.GetContent(); contentErr == nil && content != nil {
			for _, season := range content.Seasons {
				if season.IsActive && strings.EqualFold(string(season.Type), "act") {
					seasonID = season.ID
					break
				}
			}
		}
	}
	if seasonID == "" {
		h.returnError(w, fmt.Errorf("active competitive season is unavailable"))
		return
	}
	size := leaderboardSize(r.URL.Query().Get("size"))
	startIndex := leaderboardStartIndex(r.URL.Query().Get("startIndex"))
	query := url.QueryEscape(strings.TrimSpace(r.URL.Query().Get("query")))
	affinity := client.Region
	if affinity == "" {
		affinity = "na"
	}
	endpoint := fmt.Sprintf("https://pd.%s.a.pvp.net/mmr/v1/leaderboards/affinity/%s/queue/competitive/season/%s?startIndex=%d&size=%d&query=%s",
		client.Shard, url.PathEscape(string(affinity)), url.PathEscape(seasonID), startIndex, size, query)
	var response map[string]any
	if err := runRiotJSON(http.MethodGet, endpoint, client.Header, nil, &response); err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, response)
}

func leaderboardStartIndex(raw string) int {
	start, _ := strconv.Atoi(raw)
	if start < 0 {
		return 0
	}
	return start
}

func leaderboardSize(raw string) int {
	size, _ := strconv.Atoi(raw)
	if size < 1 || size > 100 {
		return 25
	}
	return size
}
