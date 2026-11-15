package handlers

import (
	"backend/accounts"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/truearken/valclient/valclient"
)

func (h *Handler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	data, err := accounts.GetRaw()
	if err != nil {
		h.returnError(w, err)
		return
	}

	if data == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func (h *Handler) PostAccounts(w http.ResponseWriter, r *http.Request) {
	body := new(bytes.Buffer)
	if _, err := io.Copy(body, r.Body); err != nil {
		h.returnError(w, err)
		return
	}

	data := body.Bytes()
	if !json.Valid(data) {
		h.returnError(w, errors.New("invalid accounts JSON"))
		return
	}

	if err := accounts.SaveRaw(data); err != nil {
		h.returnError(w, err)
		return
	}

	h.returnAny(w, "success")
}

type LocalAccountResponse struct {
	Puuid    string `json:"puuid"`
	Region   string `json:"region"`
	GameName string `json:"game_name"`
	TagLine  string `json:"tag_line"`
}

func (h *Handler) GetLocalAccount(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	val := h.Val
	h.mu.RUnlock()

	if val == nil || val.Player == nil || val.Local == nil {
		h.returnError(w, fmt.Errorf("local Valorant client is not running"))
		return
	}

	result := LocalAccountResponse{
		Puuid:  val.Player.Uuid,
		Region: string(val.Region),
	}
	var session struct {
		Puuid    string `json:"puuid"`
		GameName string `json:"game_name"`
		TagLine  string `json:"game_tag"`
	}
	local := *val.Local
	// RunLocalRequest may refresh lockfile fields. Use a private snapshot.
	probe := &valclient.ValClient{Local: &local}
	if err := probe.RunLocalRequest(http.MethodGet, "/chat/v1/session", nil, &session); err == nil {
		if session.Puuid != "" && !strings.EqualFold(session.Puuid, result.Puuid) {
			http.Error(w, "Riot Client is switching accounts", http.StatusConflict)
			return
		}
		if strings.EqualFold(session.Puuid, result.Puuid) && session.GameName != "" && session.TagLine != "" {
			result.GameName, result.TagLine = session.GameName, session.TagLine
			h.returnAny(w, result)
			return
		}
	}
	names, err := val.GetNames([]string{result.Puuid})
	if err != nil || len(names) == 0 || names[0] == nil {
		h.returnError(w, errors.New("local Riot account details are still loading"))
		return
	}
	result.GameName, result.TagLine = names[0].GameName, names[0].TagLine
	h.returnAny(w, result)
}
