package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/truearken/valclient/valclient"
)

type PartyResponse struct {
	Phase   string         `json:"phase"`
	PartyID string         `json:"partyId,omitempty"`
	QueueID string         `json:"queueId,omitempty"`
	Members []*PartyMember `json:"members,omitempty"`
	Source  string         `json:"source,omitempty"`
	Error   string         `json:"error,omitempty"`
}

type PartyMember struct {
	Puuid           string `json:"puuid"`
	Name            string `json:"name"`
	IsLocal         bool   `json:"isLocal"`
	IsOwner         bool   `json:"isOwner"`
	IsReady         bool   `json:"isReady"`
	AccountLevel    int    `json:"accountLevel"`
	CardID          string `json:"cardId"`
	CompetitiveTier int    `json:"competitiveTier"`
}

type currentPartyPlayerResponse struct {
	CurrentPartyID string `json:"CurrentPartyID"`
}

type partyDetailsResponse struct {
	ID              string `json:"ID"`
	PartyID         string `json:"PartyID"`
	QueueID         string `json:"QueueID"`
	State           string `json:"State"`
	PreviousState   string `json:"PreviousState"`
	MatchmakingData struct {
		QueueID string `json:"QueueID"`
	} `json:"MatchmakingData"`
	Members []struct {
		Subject         string `json:"Subject"`
		CompetitiveTier int    `json:"CompetitiveTier"`
		IsOwner         bool   `json:"IsOwner"`
		IsReady         bool   `json:"IsReady"`
		PlayerIdentity  struct {
			Subject      string `json:"Subject"`
			PlayerCardID string `json:"PlayerCardID"`
			AccountLevel int    `json:"AccountLevel"`
			Incognito    bool   `json:"Incognito"`
		} `json:"PlayerIdentity"`
	} `json:"Members"`
}

func (h *Handler) GetParty(w http.ResponseWriter, r *http.Request) {
	val, source, err := h.getPartyClient(r)
	if err != nil || val == nil {
		h.returnAny(w, PartyResponse{Phase: "error", Error: errString(err)})
		return
	}

	current, err := getCurrentParty(val)
	if err != nil {
		if isExpectedNoPartyError(err) {
			h.returnAny(w, PartyResponse{Phase: "none", Source: source})
			return
		}
		h.returnAny(w, PartyResponse{Phase: "error", Source: source, Error: err.Error()})
		return
	}
	if current == nil || current.CurrentPartyID == "" {
		h.returnAny(w, PartyResponse{Phase: "none", Source: source})
		return
	}

	details, err := getPartyDetails(val, current.CurrentPartyID)
	if err != nil {
		h.returnAny(w, PartyResponse{Phase: "error", PartyID: current.CurrentPartyID, Source: source, Error: err.Error()})
		return
	}

	h.returnAny(w, h.buildPartyResponse(val, source, details))
}

func (h *Handler) getPartyClient(r *http.Request) (*valclient.ValClient, string, error) {
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		return nil, "", err
	}
	if hasRemoteAuth {
		shard := getShardFromRegion(remoteAuth.Region)
		region := strings.ToLower(remoteAuth.Region)
		if region == "" {
			region = shard
		}
		return &valclient.ValClient{
			Shard:  valclient.Shard(shard),
			Region: valclient.Region(region),
			Player: &valclient.ValClientPlayer{Uuid: remoteAuth.Puuid},
			Header: buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken),
		}, "remote", nil
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.Val != nil {
		return h.Val, "local", nil
	}
	return nil, "", fmt.Errorf("authentication required: please log in first")
}

func getCurrentParty(val *valclient.ValClient) (*currentPartyPlayerResponse, error) {
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/parties/v1/players/{puuid}")
	resp := new(currentPartyPlayerResponse)
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func getPartyDetails(val *valclient.ValClient, partyID string) (*partyDetailsResponse, error) {
	apiURL := val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/parties/v1/parties/{partyId}", "{partyId}", partyID)
	resp := new(partyDetailsResponse)
	if err := runRiotJSON(http.MethodGet, apiURL, val.Header, nil, resp); err != nil {
		return nil, err
	}
	return resp, nil
}

func (h *Handler) buildPartyResponse(val *valclient.ValClient, source string, details *partyDetailsResponse) PartyResponse {
	phase := partyPhase(details.State)
	localPuuid := ""
	if val.Player != nil {
		localPuuid = val.Player.Uuid
	}
	partyID := details.ID
	if partyID == "" {
		partyID = details.PartyID
	}
	resp := PartyResponse{
		Phase:   phase,
		PartyID: partyID,
		QueueID: details.MatchmakingData.QueueID,
		Source:  source,
		Members: make([]*PartyMember, 0, len(details.Members)),
	}

	for _, member := range details.Members {
		name := "Player"
		if !member.PlayerIdentity.Incognito {
			name = h.getPlayerNameCached(val, member.Subject)
		}
		accountLevel := member.PlayerIdentity.AccountLevel
		cardID := member.PlayerIdentity.PlayerCardID
		if accountLevel == 0 && member.Subject != "" && member.PlayerIdentity.Subject == "" {
			accountLevel = 0
		}
		resp.Members = append(resp.Members, &PartyMember{
			Puuid:           member.Subject,
			Name:            name,
			IsLocal:         member.Subject == localPuuid,
			IsOwner:         member.IsOwner,
			IsReady:         member.IsReady,
			AccountLevel:    accountLevel,
			CardID:          cardID,
			CompetitiveTier: member.CompetitiveTier,
		})
	}
	return resp
}

func partyPhase(state string) string {
	switch strings.ToUpper(state) {
	case "MATCHMAKING":
		return "matchmaking"
	case "PREGAME":
		return "pregame"
	case "INGAME", "COREGAME":
		return "coregame"
	case "", "DEFAULT", "CUSTOM_GAME_SETUP":
		return "party"
	default:
		return "party"
	}
}

func isExpectedNoPartyError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "resource not found") ||
		strings.Contains(text, "not found") ||
		strings.Contains(text, "404") ||
		strings.Contains(text, "player not in party")
}
