package main

import (
	"backend/handlers"
	"backend/riothttp"
	"backend/settings"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/truearken/valclient/valclient"
)

func main() {
	apiKey := strings.TrimSpace(os.Getenv("VANTAVAULT_API_KEY"))
	if apiKey == "" {
		log.Fatal("VANTAVAULT_API_KEY is required; start VantaVault with `npm.cmd run desktop` from the frontend directory instead of running the backend directly")
	}
	if err := runBackend(apiKey, true, ""); err != nil {
		log.Fatal(err)
	}
}

func runBackend(apiKey string, enableLocalClient bool, configDir string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("VANTAVAULT_API_KEY is required")
	}
	if configDir != "" {
		if err := os.Setenv("XDG_CONFIG_HOME", configDir); err != nil {
			return fmt.Errorf("unable to configure the mobile data directory: %w", err)
		}
		if err := os.Setenv("HOME", configDir); err != nil {
			return fmt.Errorf("unable to configure the mobile home directory: %w", err)
		}
	}
	// Set a global timeout on the default HTTP client so that valclient's
	// RunRequest (which uses http.DefaultClient internally) won't hang
	// forever when the Riot API or local client is unreachable.
	http.DefaultClient = &http.Client{
		Timeout:   10 * time.Second,
		Transport: riothttp.RemoteSessionTransport{Base: http.DefaultTransport},
	}
	if err := initLogger(); err != nil {
		return err
	}

	h := handlers.NewHandler(nil)

	if enableLocalClient {
		go func() {
			slog.Info("waiting for valorant to start locally")
			var local *valclient.ValClient
			failures := 0
			for {
				if local == nil {
					val, err := valclient.NewClient()
					if err == nil {
						local = val
						failures = 0
						slog.Info("valorant started locally")
						h.SetLocalClient(val)
						h.RestartTicker(val)
					}
					time.Sleep(10 * time.Second)
					continue
				}

				var auth valclient.AuthenticateResponse
				if err := local.RunLocalRequest(http.MethodGet, "/entitlements/v1/token", nil, &auth); err != nil {
					failures++
					if failures >= 3 {
						slog.Info("valorant local client disconnected")
						local.Close()
						local = nil
						failures = 0
						h.SetTicker(nil)
						h.SetLocalClient(nil)
					}
				} else {
					failures = 0
					if localClientAuthChanged(local, auth) {
						refreshed := refreshedLocalClient(local, auth)
						local = refreshed
						h.SetLocalClient(refreshed)
						h.RestartTicker(refreshed)
						slog.Info("valorant local credentials refreshed")
					}
				}

				time.Sleep(10 * time.Second)
			}
		}()
	}

	if _, err := settings.Get(); err != nil {
		return fmt.Errorf("unable to get settings: %w", err)
	}
	slog.Info("settings loaded")

	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/health", h.Health)

	mux.HandleFunc("GET /v1/presets", h.GetPresets)
	mux.HandleFunc("POST /v1/presets", h.PostPresets)
	mux.HandleFunc("GET /v1/owned-skins", h.GetOwnedSkins)
	mux.HandleFunc("GET /v1/owned-gun-buddies", h.GetOwnedGunBuddies)
	mux.HandleFunc("GET /v1/owned-agents", h.GetOwnedAgents)
	mux.HandleFunc("GET /v1/owned-sprays", h.GetOwnedSprays)
	mux.HandleFunc("GET /v1/owned-cards", h.GetOwnedCards)
	mux.HandleFunc("GET /v1/owned-titles", h.GetOwnedTitles)
	mux.HandleFunc("GET /v1/player-loadout", h.GetPlayerLoadout)
	mux.HandleFunc("POST /v1/apply-loadout", h.PostApplyLoadout)
	mux.HandleFunc("GET /v1/settings", h.GetSettings)
	mux.HandleFunc("POST /v1/settings", h.PostSettings)
	mux.HandleFunc("GET /v1/storage", h.GetStorageStatus)
	mux.HandleFunc("POST /v1/storage/clear", h.ClearStorage)
	mux.HandleFunc("GET /v1/accounts", h.GetAccounts)
	mux.HandleFunc("POST /v1/accounts", h.PostAccounts)
	mux.HandleFunc("GET /v1/accounts/local", h.GetLocalAccount)
	mux.HandleFunc("GET /v1/livematch", h.GetLiveMatch)
	mux.HandleFunc("POST /v1/livematch/ranks", h.RefreshLiveMatchRanks)
	mux.HandleFunc("POST /v1/livematch/likely-stacks", h.ScanLiveMatchLikelyStacks)

	mux.HandleFunc("GET /v1/auth/url", h.GetAuthUrl)
	mux.HandleFunc("POST /v1/auth/token", h.PostAuthToken)
	mux.HandleFunc("POST /v1/auth/ssid-reauth", h.PostSsidReauth)
	mux.HandleFunc("GET /v1/storefront", h.GetStorefront)
	mux.HandleFunc("GET /v1/wallet", h.GetWallet)
	mux.HandleFunc("GET /v1/missions", h.GetMissions)
	mux.HandleFunc("GET /v1/daily-ticket", h.GetDailyTicket)
	mux.HandleFunc("GET /v1/career/account-xp", h.GetAccountXP)
	mux.HandleFunc("GET /v1/contracts", h.GetContracts)
	mux.HandleFunc("GET /v1/item-upgrades", h.GetItemUpgrades)
	mux.HandleFunc("GET /v1/progression/events", h.ProgressionEvents)
	mux.HandleFunc("GET /v1/party", h.GetParty)
	mux.HandleFunc("GET /v1/live-loadouts", h.GetLiveLoadouts)
	mux.HandleFunc("GET /v1/social", h.GetSocialStatus)
	mux.HandleFunc("GET /v1/social/events", h.SocialEvents)
	mux.HandleFunc("POST /v1/social/requests", h.PostSocialFriendRequest)
	mux.HandleFunc("POST /v1/social/requests/{puuid}", h.PostSocialRequestAction)
	mux.HandleFunc("GET /v1/chat/conversations", h.GetChatConversations)
	mux.HandleFunc("GET /v1/chat/summary", h.ChatSummary)
	mux.HandleFunc("GET /v1/chat/conversations/{key}/messages", h.GetChatMessages)
	mux.HandleFunc("POST /v1/chat/conversations/{key}/snapshot", h.StartChatSnapshot)
	mux.HandleFunc("POST /v1/chat/messages", h.PostChatMessage)
	mux.HandleFunc("POST /v1/chat/conversations/{key}/read", h.PostChatRead)
	mux.HandleFunc("DELETE /v1/chat/history", h.DeleteChatHistory)
	mux.HandleFunc("GET /v1/chat/events", h.ChatEvents)
	mux.HandleFunc("GET /v1/account-health", h.GetAccountHealth)

	// /v1/profile/* — rank tracker + match history + sync control
	// (see valovault/.mavis/plans/tracking-design.md §2).
	mux.HandleFunc("GET /v1/profile/overview", h.GetProfileOverview)
	mux.HandleFunc("GET /v1/profile/player-card", h.GetProfilePlayerCard)
	mux.HandleFunc("GET /v1/profile/rr-history", h.GetRRHistory)
	mux.HandleFunc("GET /v1/profile/season-summary", h.GetSeasonSummary)
	mux.HandleFunc("GET /v1/profile/agent-stats", h.GetAgentStats)
	mux.HandleFunc("GET /v1/profile/map-stats", h.GetMapStats)
	mux.HandleFunc("GET /v1/profile/match-history", h.GetProfileMatchHistory)
	// Match details: ServeMux exact prefix + handler extracts match ID.
	mux.HandleFunc("GET /v1/profile/match-details/", h.GetProfileMatchDetails)
	mux.HandleFunc("POST /v1/profile/sync", h.PostProfileSync)
	mux.HandleFunc("GET /v1/profile/sync-status", h.GetProfileSyncStatus)
	mux.HandleFunc("GET /v1/profile/leaderboard", h.GetProfileLeaderboard)

	slog.Info("starting server")
	// CORS must handle trusted browser preflights before API authentication:
	// OPTIONS requests do not include the per-launch key. Actual API requests
	// still pass through apiKeyMiddleware and require the desktop secret.
	return serveBackendWithRetry(
		bootstrapProofHandler(apiKey, corsMiddleware(apiKeyMiddleware(apiKey, mux))),
		backendListenAddress(),
	)
}

func localClientAuthChanged(client *valclient.ValClient, auth valclient.AuthenticateResponse) bool {
	if client == nil || client.Player == nil {
		return true
	}
	return client.Player.Uuid != auth.Subject ||
		client.Header.Get("Authorization") != "Bearer "+auth.AccessToken ||
		client.Header.Get("X-Riot-Entitlements-JWT") != auth.Token
}

func refreshedLocalClient(client *valclient.ValClient, auth valclient.AuthenticateResponse) *valclient.ValClient {
	headers := client.Header.Clone()
	headers.Set("Authorization", "Bearer "+auth.AccessToken)
	headers.Set("X-Riot-Entitlements-JWT", auth.Token)
	return &valclient.ValClient{
		Shard:  client.Shard,
		Region: client.Region,
		Player: &valclient.ValClientPlayer{Uuid: auth.Subject},
		Local:  client.Local,
		Header: headers,
	}
}

// During an in-place update Windows can briefly leave the previous sidecar
// holding the loopback port while the new application starts. Retrying the
// bind lets the new installed copy take over as soon as the old process exits,
// rather than making the new app fail permanently on startup.
func backendListenAddress() string {
	port := strings.TrimSpace(os.Getenv("VANTAVAULT_PORT"))
	if port == "" {
		port = "31719"
	}
	for _, ch := range port {
		if ch < '0' || ch > '9' {
			return "127.0.0.1:31719"
		}
	}
	return net.JoinHostPort("127.0.0.1", port)
}

func bootstrapProof(apiKey, nonce string) string {
	sum := sha256.Sum256([]byte(apiKey + ":" + nonce))
	return hex.EncodeToString(sum[:])
}

func validBootstrapNonce(nonce string) bool {
	if len(nonce) < 16 || len(nonce) > 128 {
		return false
	}
	for _, ch := range nonce {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func bootstrapProofHandler(apiKey string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/bootstrap-proof" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		nonce := r.URL.Query().Get("nonce")
		if !validBootstrapNonce(nonce) {
			http.Error(w, "invalid nonce", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(bootstrapProof(apiKey, nonce)))
	})
}

func serveBackendWithRetry(handler http.Handler, address string) error {
	var listener net.Listener
	var err error
	for attempt := 1; attempt <= 30; attempt++ {
		listener, err = net.Listen("tcp", address)
		if err == nil {
			return http.Serve(listener, handler)
		}
		slog.Warn("backend port is in use; waiting for prior sidecar", "attempt", attempt)
		time.Sleep(time.Second)
	}
	return fmt.Errorf("could not bind backend on %s after waiting for a prior sidecar: %w", address, err)
}

func apiKeyMiddleware(expected string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if expected == "" || r.Header.Get("X-VantaVault-Key") != expected {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func initLogger() error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("unable to get config dir: %w", err)
	}

	logDir := filepath.Join(configDir, "valovault/logs")

	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("error creating log directory: %w", err)
	}

	logPath := filepath.Join(logDir, "valovault.log")
	cleanupLogs(logDir, logPath)
	flags := os.O_WRONLY | os.O_CREATE | os.O_APPEND
	if info, err := os.Stat(logPath); err == nil && info.Size() >= 1<<20 {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	f, err := os.OpenFile(logPath, flags, 0666)
	if err != nil {
		return fmt.Errorf("error opening log file: %w", err)
	}

	log.SetOutput(f)
	slog.SetDefault(slog.New(slog.NewTextHandler(f, nil)))
	return nil
}

func cleanupLogs(dir, keep string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".log" {
			continue
		}
		if filepath.Join(dir, entry.Name()) != keep {
			_ = os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !isAllowedOrigin(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-VantaVault-Key, X-Riot-Access-Token, X-Riot-Entitlements-JWT, X-Riot-Puuid, X-Riot-Region, X-Riot-Selected-Puuid")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isAllowedOrigin(origin string) bool {
	switch strings.TrimSuffix(origin, "/") {
	case "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
		"http://localhost:3000", "http://127.0.0.1:3000":
		return true
	default:
		return false
	}
}
