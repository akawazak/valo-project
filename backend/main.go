package main

import (
	"backend/handlers"
	"backend/settings"
	"backend/tick"
	"log"
	"log/slog"
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
	// Set a global timeout on the default HTTP client so that valclient's
	// RunRequest (which uses http.DefaultClient internally) won't hang
	// forever when the Riot API or local client is unreachable.
	http.DefaultClient = &http.Client{
		Timeout: 10 * time.Second,
	}
	initLogger()

	h := handlers.NewHandler(nil)

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
					slog.Info("valorant started locally", "puuid", val.Player.Uuid)
					h.SetLocalClient(val)

					ticker := tick.NewTicker(val)
					h.SetTicker(ticker)
					go ticker.Start()
				}
				time.Sleep(10 * time.Second)
				continue
			}

			var auth valclient.AuthenticateResponse
			if err := local.RunLocalRequest(http.MethodGet, "/entitlements/v1/token", nil, &auth); err != nil {
				failures++
				if failures >= 3 {
					slog.Info("valorant local client disconnected", "err", err)
					local.Close()
					local = nil
					failures = 0
					h.SetTicker(nil)
					h.SetLocalClient(nil)
				}
			} else {
				failures = 0
			}

			time.Sleep(10 * time.Second)
		}
	}()

	settings, err := settings.Get()
	if err != nil {
		log.Fatalf("unable to get settings: %v", err)
	}
	slog.Info("found settings", "settings", settings)

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
	mux.HandleFunc("GET /v1/live/player-stats", h.GetLivePlayerStats)

	mux.HandleFunc("GET /v1/auth/url", h.GetAuthUrl)
	mux.HandleFunc("POST /v1/auth/token", h.PostAuthToken)
	mux.HandleFunc("POST /v1/auth/ssid-reauth", h.PostSsidReauth)
	mux.HandleFunc("GET /v1/storefront", h.GetStorefront)
	mux.HandleFunc("GET /v1/wallet", h.GetWallet)
	mux.HandleFunc("GET /v1/missions", h.GetMissions)
	mux.HandleFunc("GET /v1/contracts", h.GetContracts)
	mux.HandleFunc("GET /v1/party", h.GetParty)
	mux.HandleFunc("GET /v1/live-loadouts", h.GetLiveLoadouts)
	mux.HandleFunc("GET /v1/social", h.GetSocialStatus)
	mux.HandleFunc("GET /v1/account-health", h.GetAccountHealth)

	// /v1/profile/* — rank tracker + match history + sync control
	// (see valovault/.mavis/plans/tracking-design.md §2).
	mux.HandleFunc("GET /v1/profile/overview", h.GetProfileOverview)
	mux.HandleFunc("GET /v1/profile/rr-history", h.GetRRHistory)
	mux.HandleFunc("GET /v1/profile/season-summary", h.GetSeasonSummary)
	mux.HandleFunc("GET /v1/profile/agent-stats", h.GetAgentStats)
	mux.HandleFunc("GET /v1/profile/map-stats", h.GetMapStats)
	mux.HandleFunc("GET /v1/profile/match-history", h.GetProfileMatchHistory)
	// Match details: ServeMux exact prefix + handler extracts match ID.
	mux.HandleFunc("GET /v1/profile/match-details/", h.GetProfileMatchDetails)
	mux.HandleFunc("POST /v1/profile/sync", h.PostProfileSync)
	mux.HandleFunc("GET /v1/profile/sync-status", h.GetProfileSyncStatus)

	slog.Info("starting server")
	// CORS must handle trusted browser preflights before API authentication:
	// OPTIONS requests do not include the per-launch key. Actual API requests
	// still pass through apiKeyMiddleware and require the desktop secret.
	if err := http.ListenAndServe("127.0.0.1:31719", corsMiddleware(apiKeyMiddleware(apiKey, mux))); err != nil {
		panic(err)
	}
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

func initLogger() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("unable to get config dir: %v", err)
	}

	logDir := filepath.Join(configDir, "valovault/logs")

	if err := os.MkdirAll(logDir, 0755); err != nil {
		log.Fatalf("error opening file: %v", err)
	}

	logPath := filepath.Join(logDir, "valovault.log")
	cleanupLogs(logDir, logPath)
	flags := os.O_WRONLY | os.O_CREATE | os.O_APPEND
	if info, err := os.Stat(logPath); err == nil && info.Size() >= 1<<20 {
		flags = os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	}
	f, err := os.OpenFile(logPath, flags, 0666)
	if err != nil {
		log.Fatalf("error opening file: %v", err)
	}

	log.SetOutput(f)
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-VantaVault-Key, X-Riot-Access-Token, X-Riot-Entitlements-JWT, X-Riot-Puuid, X-Riot-Region")
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
