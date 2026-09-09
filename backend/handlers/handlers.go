package handlers

import (
	"backend/presets"
	"backend/riothttp"
	"backend/tick"
	"backend/tracking"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/truearken/valclient/valclient"
)

var backendSecretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._~-]+`),
	regexp.MustCompile(`eyJ[A-Za-z0-9._~-]+`),
	regexp.MustCompile(`(?i)(ssid|clid|tdid)=[^;,\s\"]+`),
}

func safeBackendError(err error) string {
	message := err.Error()
	for _, pattern := range backendSecretPatterns {
		message = pattern.ReplaceAllString(message, "[redacted]")
	}
	if len(message) > 600 {
		message = message[:600] + "..."
	}
	return message
}

type Handler struct {
	Val           *valclient.ValClient
	Ticker        *tick.Ticker
	mu            sync.RWMutex // also used by remote.go
	oauthMu       sync.Mutex
	oauthAttempts map[string]oauthAttempt

	// trackingConn holds the lazy-initialized handle to the local
	// tracking DB (backend/tracking). The first call to
	// h.trackingDB() opens the DB; subsequent calls reuse the cached
	// handle. Protected by mu for safe concurrent access.
	//
	// trackingAppDir is the app config dir used by the tracking
	// package for raw-match JSON persistence.
	//
	// syncInFlight tracks puuids with an active background sync so
	// duplicate POST /v1/profile/sync calls return 202 even when
	// different SyncManager instances (we construct one per request
	// so the per-puuid Riot fetcher is request-scoped) are involved.
	syncInFlight   map[string]struct{}
	syncLastError  map[string]string
	syncRetryAt    map[string]int64
	trackingConn   *sql.DB
	trackingAppDir string

	namesCache map[string]string
	namesMu    sync.RWMutex

	// Equipped cards are normally included in VALORANT presence. Friends who
	// are offline or only using Riot Mobile do not expose that field, so Social
	// performs a small, cooldown-bound player-loadout lookup in the background.
	// These maps prevent the frequent presence poll from hammering Riot.
	socialCardLookupMu       sync.Mutex
	socialCardLookupAt       map[string]time.Time
	socialCardLookupInFlight map[string]struct{}

	// Party rank refreshes are a Riot-side request, not data returned by the
	// initial party snapshot. Keep a short per-party cooldown so live polling
	// can show ranks without repeatedly hitting the refresh endpoint.
	partyRankRefreshMu sync.Mutex
	partyRankRefreshAt map[string]time.Time

	progressionMu          sync.Mutex
	progressionSubscribers map[chan struct{}]struct{}
	socialMu               sync.Mutex
	socialSubscribers      map[chan struct{}]struct{}
	chatMu                 sync.Mutex
	chatSubscribers        map[chan struct{}]struct{}
	chatSnapshotMu         sync.Mutex
	chatSnapshots          map[string]struct{}
}

func NewHandler(Val *valclient.ValClient) *Handler {
	return &Handler{
		Val:                      Val,
		namesCache:               make(map[string]string),
		socialCardLookupAt:       make(map[string]time.Time),
		socialCardLookupInFlight: make(map[string]struct{}),
		partyRankRefreshAt:       make(map[string]time.Time),
		progressionSubscribers:   make(map[chan struct{}]struct{}),
		socialSubscribers:        make(map[chan struct{}]struct{}),
		chatSubscribers:          make(map[chan struct{}]struct{}),
		chatSnapshots:            make(map[string]struct{}),
		oauthAttempts:            make(map[string]oauthAttempt),
	}
}

func (h *Handler) SetTicker(ticker *tick.Ticker) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.Ticker != nil && h.Ticker != ticker {
		h.Ticker.Stop()
	}
	h.Ticker = ticker
}

func (h *Handler) RestartTicker(newVal *valclient.ValClient) {
	ticker := tick.NewTicker(newVal)
	ticker.OnProgressionChanged = h.NotifyProgressionChanged
	ticker.OnSocialChanged = h.NotifySocialChanged
	ticker.OnChatChanged = h.NotifyChatChanged
	ticker.OnChatEvent = func(uri string, data []byte) { go h.HandleLocalChatEvent(uri, data) }
	h.SetTicker(ticker)
	go ticker.Start()
}

// trackingDB returns the lazily-initialized tracking DB handle. The
// DB lives at <os.UserConfigDir()>/valovault/tracking.db per the
// design doc §0. On first call it creates the dir + opens the DB.
// Concurrent callers all block on the mutex; subsequent calls reuse
// the cached handle.
func (h *Handler) trackingDB() (*sql.DB, error) {
	h.mu.RLock()
	if h.trackingConn != nil {
		defer h.mu.RUnlock()
		return h.trackingConn, nil
	}
	h.mu.RUnlock()

	h.mu.Lock()
	defer h.mu.Unlock()
	// Double-check after acquiring the write lock.
	if h.trackingConn != nil {
		return h.trackingConn, nil
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	appDir := filepath.Join(configDir, "valovault")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		return nil, err
	}
	if err := migrateNestedTrackingDB(appDir); err != nil {
		return nil, err
	}

	db, err := tracking.OpenTrackingDB(configDir)
	if err != nil {
		return nil, err
	}
	h.trackingConn = db
	h.trackingAppDir = appDir
	log.Printf("tracking: opened database")
	return h.trackingConn, nil
}

func migrateNestedTrackingDB(appDir string) error {
	legacyDir := filepath.Join(appDir, "valovault")
	source := filepath.Join(legacyDir, "tracking.db")
	target := filepath.Join(appDir, "tracking.db")
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	if _, err := os.Stat(source); os.IsNotExist(err) {
		return nil
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		oldPath, newPath := source+suffix, target+suffix
		if _, err := os.Stat(oldPath); err == nil {
			if err := os.Rename(oldPath, newPath); err != nil {
				return fmt.Errorf("migrate tracking database: %w", err)
			}
		}
	}
	_ = os.Remove(legacyDir)
	return nil
}

// trackingSyncManager returns the lazily-initialized SyncManager
// bound to the same DB returned by trackingDB(). The fetcher is
// created on demand from the per-request auth headers — the
// SyncManager is per-request, not per-process, because the Riot
// fetcher must carry the calling user's tokens. The per-puuid mutex
// inside the manager still prevents the same user from triggering
// two concurrent syncs (e.g. from double-clicking the Sync button).
func (h *Handler) trackingSyncManagerForRequest(r *http.Request) (*tracking.SyncManager, error) {
	db, err := h.trackingDB()
	if err != nil {
		return nil, err
	}
	remoteAuth, hasRemoteAuth, err := getRemoteAuthHeaders(r)
	if err != nil {
		return nil, err
	}
	if hasRemoteAuth {
		return tracking.NewSyncManager(db, tracking.NewRiotFetcher(buildRiotHeaders(remoteAuth.AccessToken, remoteAuth.EntitlementsToken)), h.trackingAppDir), nil
	}

	client, err := h.getClient(r)
	if err != nil {
		return nil, err
	}
	headers := client.Header
	return tracking.NewSyncManager(db, tracking.NewRiotFetcher(headers), h.trackingAppDir), nil
}

// isSyncInFlight reports whether a background sync is currently
// running for the given puuid. Backed by a per-process map so the
// answer is consistent across requests (and across per-request
// SyncManager instances).
func (h *Handler) isSyncInFlight(puuid string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.syncInFlight == nil {
		return false
	}
	_, ok := h.syncInFlight[puuid]
	return ok
}

// markSyncInFlight records that a sync is running for the given
// puuid. Returns true if the puuid was not previously in flight
// (caller may proceed); false if it was already in flight.
func (h *Handler) markSyncInFlight(puuid string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.syncInFlight == nil {
		h.syncInFlight = map[string]struct{}{}
	}
	if _, ok := h.syncInFlight[puuid]; ok {
		return false
	}
	h.syncInFlight[puuid] = struct{}{}
	if h.syncLastError != nil {
		delete(h.syncLastError, puuid)
	}
	if h.syncRetryAt != nil {
		delete(h.syncRetryAt, puuid)
	}
	return true
}

// unmarkSyncInFlight clears the in-flight flag for the given puuid.
// Called from a goroutine that monitors the SyncManager's run.
func (h *Handler) unmarkSyncInFlight(puuid string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.syncInFlight, puuid)
}

func (h *Handler) setSyncLastError(puuid string, err error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.syncLastError == nil {
		h.syncLastError = map[string]string{}
	}
	if err == nil {
		delete(h.syncLastError, puuid)
		delete(h.syncRetryAt, puuid)
		return
	}
	h.syncLastError[puuid] = err.Error()
	var apiErr *riothttp.APIError
	if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
		if h.syncRetryAt == nil {
			h.syncRetryAt = map[string]int64{}
		}
		h.syncRetryAt[puuid] = time.Now().Add(apiErr.RetryAfter).UnixMilli()
	}
}

func (h *Handler) syncLastErrorFor(puuid string) string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.syncLastError == nil {
		return ""
	}
	return h.syncLastError[puuid]
}

func (h *Handler) syncRetryAtFor(puuid string) int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.syncRetryAt[puuid]
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

	type ExpressionSlotResp struct {
		TypeID  string `json:"typeId"`
		AssetID string `json:"assetId"`
	}

	type PlayerLoadoutResp struct {
		Loadout     map[string]presets.LoadoutItemV1 `json:"loadout"`
		Sprays      []SpraySlotResp                  `json:"sprays"`
		Expressions []ExpressionSlotResp             `json:"expressions"`
		Identity    *presets.IdentityV1              `json:"identity,omitempty"`
	}

	resp := &PlayerLoadoutResp{
		Loadout:     make(map[string]presets.LoadoutItemV1),
		Sprays:      make([]SpraySlotResp, 0),
		Expressions: make([]ExpressionSlotResp, 0),
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
			resp.Expressions = append(resp.Expressions, ExpressionSlotResp{
				TypeID:  expr.TypeID,
				AssetID: expr.AssetID,
			})
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
			AccountLevel:  loadout.Identity.AccountLevel,
		}
	}

	h.returnAny(w, resp)
}

type ApplyLoadoutRequest struct {
	Loadout     map[string]presets.LoadoutItemV1 `json:"loadout"`
	Identity    *presets.IdentityV1              `json:"identity,omitempty"`
	Sprays      []presets.SpraySlotV1            `json:"sprays,omitempty"`
	Flexes      []presets.ExpressionSlotV1       `json:"flexes,omitempty"`
	Expressions []presets.ExpressionSlotV1       `json:"expressions,omitempty"`
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
		expressions := append([]presets.ExpressionSlotV1{}, req.Expressions...)
		expressions = append(expressions, req.Flexes...)
		if err := presets.Apply(val, req.Loadout, req.Identity, req.Sprays, expressions); err != nil {
			h.returnError(w, err)
			return
		}
	} else {
		var oldLoadout map[string]presets.LoadoutItemV1
		if err := json.Unmarshal(bodyBytes, &oldLoadout); err != nil {
			h.returnError(w, err)
			return
		}
		if err := presets.Apply(val, oldLoadout, nil, nil, nil); err != nil {
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
	status := http.StatusInternalServerError
	payload := struct {
		HTTPStatus int    `json:"httpStatus,omitempty"`
		ErrorCode  string `json:"errorCode"`
		Message    string `json:"message"`
	}{
		ErrorCode: "VV-BACKEND",
		Message:   "The request could not be completed.",
	}
	if strings.Contains(strings.ToLower(err.Error()), "authentication required") {
		status = http.StatusUnauthorized
		payload.HTTPStatus = http.StatusUnauthorized
		payload.ErrorCode = "AUTH_REQUIRED"
		payload.Message = "Connect or renew the selected Riot account to continue."
	}

	// valclient currently prefixes every non-200 Riot response with
	// "Is VALORANT running? ... local request", including remote PD requests.
	// Recover Riot's structured error so the frontend can distinguish an
	// expired entitlement from a genuinely unavailable local client.
	if start := strings.Index(err.Error(), "{"); start >= 0 {
		var upstream struct {
			HTTPStatus int    `json:"httpStatus"`
			ErrorCode  string `json:"errorCode"`
			Error      string `json:"error"`
			Message    string `json:"message"`
		}
		if json.Unmarshal([]byte(err.Error()[start:]), &upstream) == nil {
			if upstream.ErrorCode == "" {
				upstream.ErrorCode = upstream.Error
			}
			if upstream.ErrorCode == "BAD_CLAIMS" && upstream.HTTPStatus == 0 {
				upstream.HTTPStatus = http.StatusUnauthorized
			}
			if upstream.ErrorCode != "" {
				if upstream.HTTPStatus >= 400 && upstream.HTTPStatus <= 599 {
					status = upstream.HTTPStatus
				}
				payload.HTTPStatus = upstream.HTTPStatus
				payload.ErrorCode = upstream.ErrorCode
				payload.Message = upstream.Message
			}
		}
	}

	if payload.ErrorCode == "VV-BACKEND" {
		log.Printf("request failed: status=%d code=%s reason=%q", payload.HTTPStatus, payload.ErrorCode, safeBackendError(err))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
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
