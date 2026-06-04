package handlers

import (
	"backend/accounts"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

func (h *Handler) GetAccounts(w http.ResponseWriter, r *http.Request) {
	data, err := accounts.GetRaw()
	if err != nil {
		h.returnError(w, err)
		return
	}

	if !json.Valid(data) {
		data = []byte("[]")
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

	if val == nil {
		h.returnError(w, fmt.Errorf("local Valorant client is not running"))
		return
	}

	names, err := val.GetNames([]string{val.Player.Uuid})
	if err != nil || len(names) == 0 {
		h.returnError(w, fmt.Errorf("failed to get local player details: %v", err))
		return
	}

	h.returnAny(w, &LocalAccountResponse{
		Puuid:    val.Player.Uuid,
		Region:   string(val.Region),
		GameName: names[0].GameName,
		TagLine:  names[0].TagLine,
	})
}
