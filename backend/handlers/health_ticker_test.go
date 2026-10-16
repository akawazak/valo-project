package handlers

import (
	"backend/tick"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/truearken/valclient/valclient"
)

func TestHealthReturnsWhileRestartedTickerKeepsRunning(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	subscribed := make(chan struct{}, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/help" {
			_, _ = w.Write([]byte(`{"Events":{},"Functions":{},"Types":{}}`))
			return
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		subscribed <- struct{}{}
		_, _, _ = conn.ReadMessage()
	}))
	defer server.Close()
	address, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	val := &valclient.ValClient{
		Player: &valclient.ValClientPlayer{Uuid: "synthetic-player"},
		Local:  &valclient.ValClientLocal{Port: address.Port(), Password: "synthetic", HttpClient: server.Client()},
	}
	ticker := tick.NewTicker(val)
	defer ticker.Stop()
	h := &Handler{Val: val, Ticker: ticker}
	w := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() { h.Health(w, httptest.NewRequest(http.MethodGet, "/health", nil)); close(finished) }()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("Health blocked on the restarted ticker loop")
	}
	if w.Code != http.StatusOK {
		t.Fatalf("Health returned %d %s", w.Code, w.Body.String())
	}
	select {
	case <-subscribed:
	case <-time.After(time.Second):
		t.Fatal("Health did not start the mock local ticker")
	}
}
