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
	initLogger()

	h := handlers.NewHandler(nil)

	go func() {
		slog.Info("waiting for valorant to start locally")
		for {
			val, err := valclient.NewClient()
			if err == nil {
				slog.Info("valorant started locally")
				h.SetLocalClient(val)

				ticker := tick.NewTicker(val)
				h.SetTicker(ticker)
				go ticker.Start()
				break
			}
			time.Sleep(5 * time.Second)
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
	mux.HandleFunc("GET /v1/accounts", h.GetAccounts)
	mux.HandleFunc("POST /v1/accounts", h.PostAccounts)

	mux.HandleFunc("GET /v1/auth/url", h.GetAuthUrl)
	mux.HandleFunc("POST /v1/auth/token", h.PostAuthToken)
	mux.HandleFunc("GET /v1/storefront", h.GetStorefront)
	mux.HandleFunc("GET /v1/wallet", h.GetWallet)

	slog.Info("starting server")
	if err := http.ListenAndServe(":31719", logMiddleware(corsMiddleware(mux))); err != nil {
		panic(err)
	}
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

	f, err := os.OpenFile(filepath.Join(logDir, time.Now().Format("2006-01-02")+".log"), os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("error opening file: %v", err)
	}

	log.SetOutput(f)
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.String(), "/health") {
			slog.Info("request received", "path", r.Method+" "+r.URL.String())
		}
		next.ServeHTTP(w, r)
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "tauri://localhost" ||
			strings.HasPrefix(origin, "http://localhost:") ||
			strings.HasPrefix(origin, "http://127.0.0.1:") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Riot-Access-Token, X-Riot-Entitlements-JWT, X-Riot-Puuid, X-Riot-Region")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
