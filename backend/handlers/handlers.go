package handlers

import (
	"backend/presets"
	"backend/tick"
	"encoding/json"
	"io"
	"net/http"
	"sync"

	"github.com/truearken/valclient/valclient"
)

type Handler struct {
	Val    *valclient.ValClient
	Ticker *tick.Ticker
	mu     sync.RWMutex // also used by remote.go
}

func NewHandler(Val *valclient.ValClient) *Handler {
	return &Handler{
		Val: Val,
	}
}

func (h *Handler) SetTicker(ticker *tick.Ticker) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.Ticker = ticker
}

func (h *Handler) RestartTicker(newVal *valclient.ValClient) {
	h.Ticker.Stop()
	h.Ticker.Start()
}

type OwnedSkinsResponse struct {
	LevelIds  []string
	ChromaIds []string
}

func (h *Handler) GetOwnedSkins(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedSkins, err := val.GetOwnedItems(valclient.ITEM_TYPE_SKINS)
	if err != nil {
		h.returnError(w, err)
		return
	}

	chromas, err := val.GetOwnedItems(valclient.ITEM_TYPE_SKIN_VARIANTS)
	if err != nil {
		h.returnError(w, err)
		return
	}

	levelIds := make([]string, 0, len(ownedSkins.Entitlements))
	for _, skin := range ownedSkins.Entitlements {
		levelIds = append(levelIds, skin.ItemID)
	}

	chromaIds := make([]string, 0, len(chromas.Entitlements))
	for _, chroma := range chromas.Entitlements {
		chromaIds = append(chromaIds, chroma.ItemID)
	}

	h.returnAny(w, &OwnedSkinsResponse{LevelIds: levelIds, ChromaIds: chromaIds})
}

type Buddy struct {
	LevelId string `json:"levelId"`
	Amount  int    `json:"amount"`
}

type OwnedGunBuddiesResponse struct {
	Buddies []*Buddy `json:"buddies"`
}

func (h *Handler) GetOwnedGunBuddies(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedBuddies, err := val.GetOwnedItems(valclient.ITEM_TYPE_GUN_BUDDIES)
	if err != nil {
		h.returnError(w, err)
		return
	}

	buddiesMap := map[string]int{}
	for _, b := range ownedBuddies.Entitlements {
		if c, ok := buddiesMap[b.ItemID]; ok {
			buddiesMap[b.ItemID] = c + 1
		} else {
			buddiesMap[b.ItemID] = 1
		}
	}

	buddies := make([]*Buddy, 0, len(buddiesMap))
	for id, amount := range buddiesMap {
		buddies = append(buddies, &Buddy{LevelId: id, Amount: amount})
	}

	h.returnAny(w, &OwnedGunBuddiesResponse{Buddies: buddies})
}

type OwnedAgentsResponse struct {
	AgentIds []string
}

func (h *Handler) GetOwnedAgents(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedAgents, err := val.GetOwnedItems(valclient.ITEM_TYPE_AGENTS)
	if err != nil {
		h.returnError(w, err)
		return
	}

	agents := make([]string, 0, len(ownedAgents.Entitlements))
	for _, b := range ownedAgents.Entitlements {
		agents = append(agents, b.ItemID)
	}

	h.returnAny(w, &OwnedAgentsResponse{AgentIds: agents})
}

func (h *Handler) GetPlayerLoadout(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	loadout, err := val.GetPlayerLoadout()
	if err != nil {
		h.returnError(w, err)
		return
	}

	type SpraySlotResp struct {
		EquipSlotID string `json:"equipSlotId"`
		SprayID     string `json:"sprayId"`
	}

	type PlayerLoadoutResp struct {
		Loadout  map[string]presets.LoadoutItemV1 `json:"loadout"`
		Sprays   []SpraySlotResp                    `json:"sprays"`
		Identity *presets.IdentityV1              `json:"identity,omitempty"`
	}

	resp := &PlayerLoadoutResp{
		Loadout: make(map[string]presets.LoadoutItemV1),
		Sprays:  make([]SpraySlotResp, 0),
	}

	for _, g := range loadout.Guns {
		resp.Loadout[g.ID] = presets.LoadoutItemV1{
			SkinID:       g.SkinID,
			SkinLevelID:  g.SkinLevelID,
			ChromaID:     g.ChromaID,
			CharmID:      g.CharmID,
			CharmLevelID: g.CharmLevelID,
		}
	}

	for _, expr := range loadout.ActiveExpressions {
		if expr.AssetID != "" {
			resp.Sprays = append(resp.Sprays, SpraySlotResp{
				EquipSlotID: expr.TypeID,
				SprayID:     expr.AssetID,
			})
		}
	}

	if loadout.Identity != nil {
		resp.Identity = &presets.IdentityV1{
			PlayerCardID:  loadout.Identity.PlayerCardID,
			PlayerTitleID: loadout.Identity.PlayerTitleID,
		}
	}

	h.returnAny(w, resp)
}

type ApplyLoadoutRequest struct {
	Loadout  map[string]presets.LoadoutItemV1 `json:"loadout"`
	Identity *presets.IdentityV1              `json:"identity,omitempty"`
	Sprays   []presets.SpraySlotV1            `json:"sprays,omitempty"`
}

func (h *Handler) PostApplyLoadout(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		h.returnError(w, err)
		return
	}

	var req ApplyLoadoutRequest
	if err := json.Unmarshal(bodyBytes, &req); err == nil && req.Loadout != nil {
		if err := presets.Apply(val, req.Loadout, req.Identity, req.Sprays); err != nil {
			h.returnError(w, err)
			return
		}
	} else {
		var oldLoadout map[string]presets.LoadoutItemV1
		if err := json.Unmarshal(bodyBytes, &oldLoadout); err != nil {
			h.returnError(w, err)
			return
		}
		if err := presets.Apply(val, oldLoadout, nil, nil); err != nil {
			h.returnError(w, err)
			return
		}
	}

	h.returnAny(w, nil)
}

type OwnedSpraysResponse struct {
	SprayIds []string `json:"sprayIds"`
}

func (h *Handler) GetOwnedSprays(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedSprays, err := val.GetOwnedItems(valclient.ITEM_TYPE_SPRAYS)
	if err != nil {
		h.returnError(w, err)
		return
	}

	sprayIds := make([]string, 0, len(ownedSprays.Entitlements))
	for _, entitlement := range ownedSprays.Entitlements {
		sprayIds = append(sprayIds, entitlement.ItemID)
	}

	h.returnAny(w, &OwnedSpraysResponse{SprayIds: sprayIds})
}

type OwnedCardsResponse struct {
	CardIds []string `json:"cardIds"`
}

func (h *Handler) GetOwnedCards(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedCards, err := val.GetOwnedItems(valclient.ITEM_TYPE_CARDS)
	if err != nil {
		h.returnError(w, err)
		return
	}

	cardIds := make([]string, 0, len(ownedCards.Entitlements))
	for _, entitlement := range ownedCards.Entitlements {
		cardIds = append(cardIds, entitlement.ItemID)
	}

	h.returnAny(w, &OwnedCardsResponse{CardIds: cardIds})
}

type OwnedTitlesResponse struct {
	TitleIds []string `json:"titleIds"`
}

func (h *Handler) GetOwnedTitles(w http.ResponseWriter, r *http.Request) {
	val, err := h.getClient(r)
	if err != nil {
		h.returnError(w, err)
		return
	}
	ownedTitles, err := val.GetOwnedItems(valclient.ITEM_TYPE_TITLES)
	if err != nil {
		h.returnError(w, err)
		return
	}

	titleIds := make([]string, 0, len(ownedTitles.Entitlements))
	for _, entitlement := range ownedTitles.Entitlements {
		titleIds = append(titleIds, entitlement.ItemID)
	}

	h.returnAny(w, &OwnedTitlesResponse{TitleIds: titleIds})
}

func (h *Handler) returnError(w http.ResponseWriter, err error) {
	w.WriteHeader(http.StatusInternalServerError)
	msg := "an error occured" + err.Error()
	w.Write([]byte(msg))
}

func (h *Handler) returnAny(w http.ResponseWriter, response any) {
	bytes := []byte{}
	if response != nil {
		var err error
		bytes, err = json.Marshal(response)
		if err != nil {
			h.returnError(w, err)
			return
		}
	} else {
		bytes = []byte("success")
	}

	w.WriteHeader(http.StatusOK)
	w.Write(bytes)
}
