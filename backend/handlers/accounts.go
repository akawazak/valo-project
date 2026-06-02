package handlers

import (
	"backend/accounts"
	"bytes"
	"encoding/json"
	"errors"
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
