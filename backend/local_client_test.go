package main

import (
	"backend/riothttp"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalDiscoverySurvivesStartupAndCredentialRotation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	lockPath := filepath.Join(root, "Riot Games", "Riot Client", "Config", "lockfile")
	logPath := filepath.Join(root, "VALORANT", "Saved", "Logs", "ShooterGame.log")
	for _, path := range []string{lockPath, logPath} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path, data string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	password, access, subject := "first-password", "first-access", "player-one"
	ready := false
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, _ := r.BasicAuth()
		if r.URL.Path != "/entitlements/v1/token" || user != "riot" || pass != password {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !ready {
			fmt.Fprint(w, `{}`)
			return
		}
		fmt.Fprintf(w, `{"subject":%q,"accessToken":%q,"token":"entitlement"}`, subject, access)
	}))
	defer server.Close()
	address, _ := url.Parse(server.URL)
	write(logPath, "CI server version: release-13.02-shipping-7-5092570\nhttps://glz-na-1.na.a.pvp.net\nhttps://glz-eu-1.eu.a.pvp.net")
	for _, malformed := range []string{"", "riot:123", "riot:123:0:secret:https", "riot:123:99999:secret:https", "riot:123:443::https", "riot:123:443:secret:http"} {
		write(lockPath, malformed)
		if _, err := discoverLocalClient(nil); err == nil {
			t.Fatalf("accepted malformed lockfile %q", malformed)
		}
	}
	setLock := func() { write(lockPath, "riot:123:"+address.Port()+":"+password+":https\n") }
	setLock()
	if _, err := discoverLocalClient(nil); err == nil {
		t.Fatal("published incomplete sign-in")
	}
	ready = true
	first, err := discoverLocalClient(nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Player.Uuid != subject || first.Shard != "eu" || first.Header.Get(riothttp.RemoteSessionHeader) != "1" {
		t.Fatal("wrong connection metadata")
	}
	unchanged, err := discoverLocalClient(first)
	if err != nil || unchanged != first {
		t.Fatalf("unchanged session replaced: %v", err)
	}
	password, access = "rotated-password", "rotated-access"
	// A 401 must remain retryable; the next snapshot reads the new password.
	if _, err := discoverLocalClient(first); err == nil {
		t.Fatal("accepted stale lockfile password")
	}
	setLock()
	second, err := discoverLocalClient(first)
	if err != nil {
		t.Fatal(err)
	}
	if second == first || second.Local == first.Local || second.Local.Password != password || second.Header.Get("Authorization") != "Bearer "+access {
		t.Fatal("did not replace rotated credentials")
	}
	if first.Local.Password != "first-password" || first.Header.Get("Authorization") != "Bearer first-access" {
		t.Fatal("mutated in-flight connection")
	}
	subject = "player-two"
	write(logPath, "CI server version: release-13.03-shipping-1-123\nhttps://glz-ap-1.ap.a.pvp.net")
	third, err := discoverLocalClient(second)
	if err != nil || third.Player.Uuid != subject || third.Region != "ap" {
		t.Fatalf("account switch kept old routes: %v", err)
	}
}
