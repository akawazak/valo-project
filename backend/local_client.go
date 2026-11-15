package main

import (
	"backend/riothttp"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/truearken/valclient/valclient"
)

// Riot Client uses a self-signed certificate on loopback. This transport is
// used only with the fixed 127.0.0.1 URL below, never with remote services.
var localProbeHTTP = &http.Client{
	Timeout:       3 * time.Second,
	Transport:     &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

var localRoutePattern = regexp.MustCompile(`https://glz-([a-z0-9-]+)-1\.([a-z0-9-]+)\.a\.pvp\.net`)
var localVersionPattern = regexp.MustCompile(`CI server version:\s+(release-\S+)`)

func discoverLocalClient(previous *valclient.ValClient) (*valclient.ValClient, error) {
	data, err := os.ReadFile(filepath.Join(os.Getenv("LOCALAPPDATA"), "Riot Games", "Riot Client", "Config", "lockfile"))
	if err != nil {
		return nil, fmt.Errorf("local Riot lockfile unavailable")
	}
	parts := strings.Split(strings.TrimSpace(string(data)), ":")
	if len(parts) != 5 || parts[3] == "" || parts[4] != "https" {
		return nil, fmt.Errorf("local Riot lockfile is not ready")
	}
	port, err := strconv.Atoi(parts[2])
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("local Riot lockfile port is invalid")
	}
	// Probe a new snapshot rather than letting valclient mutate credentials
	// that concurrent inventory, health and event requests are still using.
	local := &valclient.ValClientLocal{Port: strconv.Itoa(port), Password: parts[3], HttpClient: localProbeHTTP}
	req, err := http.NewRequest(http.MethodGet, "https://127.0.0.1:"+local.Port+"/entitlements/v1/token", nil)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth("riot", local.Password)
	resp, err := localProbeHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("local Riot client unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("local Riot session is not ready (HTTP %d)", resp.StatusCode)
	}
	var auth valclient.AuthenticateResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&auth); err != nil {
		return nil, fmt.Errorf("local Riot session response is invalid")
	}
	if strings.TrimSpace(auth.Subject) == "" || strings.TrimSpace(auth.AccessToken) == "" || strings.TrimSpace(auth.Token) == "" {
		return nil, fmt.Errorf("local Riot session is still signing in")
	}
	if previous != nil && previous.Local != nil && previous.Local.Port == local.Port && previous.Local.Password == local.Password && !localClientAuthChanged(previous, auth) {
		return previous, nil
	}

	var fresh *valclient.ValClient
	if previous != nil && previous.Player != nil && previous.Player.Uuid == auth.Subject {
		fresh = refreshedLocalClient(previous, auth)
	} else {
		logData, err := os.ReadFile(filepath.Join(os.Getenv("LOCALAPPDATA"), "VALORANT", "Saved", "Logs", "ShooterGame.log"))
		if err != nil {
			return nil, fmt.Errorf("VALORANT connection details are not ready")
		}
		routes := localRoutePattern.FindAllSubmatch(logData, -1)
		versions := localVersionPattern.FindAllSubmatch(logData, -1)
		if len(routes) == 0 || len(versions) == 0 {
			return nil, fmt.Errorf("VALORANT connection details are still loading")
		}
		route := routes[len(routes)-1]
		fresh = &valclient.ValClient{
			Region: valclient.Region(route[1]), Shard: valclient.Shard(route[2]),
			Player: &valclient.ValClientPlayer{Uuid: auth.Subject},
			Header: http.Header{},
		}
		fresh.Header.Set("Authorization", "Bearer "+auth.AccessToken)
		fresh.Header.Set("X-Riot-Entitlements-JWT", auth.Token)
		fresh.Header.Set("X-Riot-ClientPlatform", valclient.CLIENT_PLATFORM_B64)
		fresh.Header.Set("X-Riot-ClientVersion", string(versions[len(versions)-1][1]))
	}
	fresh.Local = local
	// Auth is refreshed by the monitor. Disable the dependency's recursive
	// BAD_CLAIMS reauthentication, which mutates shared headers and can loop.
	fresh.Header.Set(riothttp.RemoteSessionHeader, "1")
	return fresh, nil
}
