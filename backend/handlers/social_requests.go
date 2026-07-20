package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type socialRequestActionInput struct {
	Action   string `json:"action"`
	GameName string `json:"gameName"`
	GameTag  string `json:"gameTag"`
}

func (h *Handler) PostSocialFriendRequest(w http.ResponseWriter, r *http.Request) {
	var input socialRequestActionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "valid Riot ID is required", http.StatusBadRequest)
		return
	}
	auth, ok, err := getRemoteAuthHeaders(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	if ok {
		name := friendDisplayName(strings.TrimSpace(input.GameName), strings.TrimPrefix(strings.TrimSpace(input.GameTag), "#"), "")
		peer := "riot-id:" + strings.ToLower(strings.TrimSpace(input.GameName)) + "#" + strings.ToLower(strings.TrimPrefix(strings.TrimSpace(input.GameTag), "#"))
		confirmed, sendErr := remoteSocialHub.ensure(auth).sendFriendRequestByRiotID(input.GameName, input.GameTag)
		if sendErr != nil {
			http.Error(w, fmt.Sprintf("Riot friend request failed: %s", sendErr), http.StatusConflict)
			return
		}
		h.recordSocialRequestAction(auth.Puuid, peer, name, "outgoing", "request_sent")
		h.NotifySocialChanged()
		writeSocialRequestActionResponse(w, confirmed)
		return
	}
	selected := selectedAccountPuuid(r)
	if selected != "" && !localChatMatchesAccount(selected) {
		http.Error(w, "the selected Riot account is not connected remotely; refresh or reconnect it", http.StatusConflict)
		return
	}
	if err := localSendFriendRequest(input.GameName, input.GameTag); err != nil {
		http.Error(w, fmt.Sprintf("Riot friend request failed: %s", err), http.StatusConflict)
		return
	}
	h.NotifySocialChanged()
	writeSocialRequestActionResponse(w, true)
}

type socialRequestActionResponse struct {
	Status    string `json:"status"`
	Confirmed bool   `json:"confirmed"`
}

// PostSocialRequestAction performs an explicit user-selected action on an
// observed remote Riot request or reconnects to a previously known PUUID.
func (h *Handler) PostSocialRequestAction(w http.ResponseWriter, r *http.Request) {
	peer := strings.ToLower(strings.TrimSpace(r.PathValue("puuid")))
	if peer == "" {
		http.Error(w, "friend request target is required", http.StatusBadRequest)
		return
	}
	var input socialRequestActionInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "valid friend request action is required", http.StatusBadRequest)
		return
	}
	auth, ok, err := getRemoteAuthHeaders(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	action := strings.ToLower(strings.TrimSpace(input.Action))
	if !ok {
		if action != "cancel" || (selectedAccountPuuid(r) != "" && !localChatMatchesAccount(selectedAccountPuuid(r))) {
			http.Error(w, "a connected remote Riot account is required", http.StatusConflict)
			return
		}
		if err := localCancelFriendRequest(peer); err != nil {
			// Riot may remove the request just before our DELETE reaches the local
			// client. Confirm its absence before treating that race as an error.
			status, statusErr := h.fetchLocalSocialStatus()
			stillPending := statusErr != nil
			if statusErr == nil {
				for _, request := range status.Requests {
					if strings.EqualFold(request.Puuid, peer) {
						stillPending = true
						break
					}
				}
			}
			if stillPending {
				http.Error(w, fmt.Sprintf("Riot friend request action failed: %s", err), http.StatusConflict)
				return
			}
		}
		h.NotifySocialChanged()
		writeSocialRequestActionResponse(w, true)
		return
	}
	session := remoteSocialHub.ensure(auth)
	session.mu.RLock()
	requestBeforeAction := session.requests[peer]
	session.mu.RUnlock()
	var confirmed bool
	if action == "send" {
		db, dbErr := h.trackingDB()
		if dbErr != nil {
			h.returnError(w, dbErr)
			return
		}
		var state, displayName string
		if dbErr = db.QueryRow(`SELECT state,displayName FROM social_contacts WHERE accountPuuid=? AND peerPuuid=?`, strings.ToLower(auth.Puuid), peer).Scan(&state, &displayName); dbErr != nil || state != "former" {
			http.Error(w, "outgoing remote requests are limited to previously observed former friends", http.StatusConflict)
			return
		}
		requestBeforeAction.Name = displayName
		confirmed, err = session.sendFriendRequest(peer)
	} else if action == "cancel" {
		confirmed, err = session.actOnFriendRequest(peer, action)
	} else {
		confirmed, err = session.actOnFriendRequest(peer, action)
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("Riot friend request action failed: %s", err), http.StatusConflict)
		return
	}
	if action == "send" {
		h.recordSocialRequestAction(auth.Puuid, peer, firstNonEmpty(requestBeforeAction.Name, input.GameName), "outgoing", "request_sent")
	} else if action == "cancel" && confirmed {
		h.recordSocialRequestAction(auth.Puuid, peer, requestBeforeAction.Name, "outgoing", "request_cancelled")
	}
	h.NotifySocialChanged()
	writeSocialRequestActionResponse(w, confirmed)
}

func localSendFriendRequest(gameName, gameTag string) error {
	gameName = strings.TrimSpace(gameName)
	gameTag = strings.TrimSpace(gameTag)
	if gameName == "" || gameTag == "" {
		return fmt.Errorf("valid Riot ID is required")
	}
	return localChatJSON(http.MethodPost, "/chat/v4/friendrequests", map[string]string{"game_name": gameName, "game_tag": gameTag}, nil)
}

func localCancelFriendRequest(peer string) error {
	peer = strings.ToLower(strings.TrimSpace(peer))
	if peer == "" {
		return fmt.Errorf("friend request target is required")
	}
	return localChatJSON(http.MethodDelete, "/chat/v4/friendrequests", map[string]string{"puuid": peer}, nil)
}

func writeSocialRequestActionResponse(w http.ResponseWriter, confirmed bool) {
	statusCode := http.StatusOK
	if !confirmed {
		statusCode = http.StatusAccepted
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(socialRequestActionResponse{Status: map[bool]string{true: "confirmed", false: "pending"}[confirmed], Confirmed: confirmed})
}
