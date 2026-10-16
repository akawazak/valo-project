package tick

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/truearken/valclient/valclient"
)

func tickerLocalServer(t *testing.T, beforeUpgrade func(), connected chan<- *websocket.Conn) *valclient.ValClient {
	t.Helper()
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if beforeUpgrade != nil {
			beforeUpgrade()
		}
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		connected <- conn
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	t.Cleanup(server.Close)
	address, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return &valclient.ValClient{
		Player: &valclient.ValClientPlayer{Uuid: "synthetic-player"},
		Local:  &valclient.ValClientLocal{Port: address.Port(), Password: "synthetic", HttpClient: server.Client()},
	}
}

func waitTickerStopped(t *testing.T, ticker *Ticker) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ticker.mu.Lock()
		running := ticker.running
		ticker.mu.Unlock()
		if !running {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("ticker worker did not finish")
}

func waitTickerConnection(t *testing.T, connected <-chan *websocket.Conn) *websocket.Conn {
	t.Helper()
	select {
	case conn := <-connected:
		return conn
	case <-time.After(2 * time.Second):
		t.Fatal("ticker did not subscribe to the mock socket")
		return nil
	}
}

func TestTickerConcurrentStartStopAndRestart(t *testing.T) {
	connected := make(chan *websocket.Conn, 64)
	var attempts atomic.Int32
	ticker := NewTicker(tickerLocalServer(t, func() { attempts.Add(1) }, connected))
	defer ticker.Stop()
	for round := 0; round < 10; round++ {
		var starters sync.WaitGroup
		for range 32 {
			starters.Go(ticker.Start)
		}
		started := make(chan struct{})
		go func() { starters.Wait(); close(started) }()
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("Start blocked instead of starting a background worker")
		}
		waitTickerConnection(t, connected)
		if got := attempts.Load(); got != int32(round+1) {
			t.Fatalf("concurrent starts created %d connections after %d rounds", got, round+1)
		}
		var stoppers sync.WaitGroup
		for range 32 {
			stoppers.Go(ticker.Stop)
		}
		stoppers.Wait()
		waitTickerStopped(t, ticker)
	}
}

func TestTickerStopDuringStartupIsNotLost(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	connected := make(chan *websocket.Conn, 1)
	ticker := NewTicker(tickerLocalServer(t, func() { close(entered); <-release }, connected))
	defer ticker.Stop()
	ticker.Start()
	select {
	case <-entered:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("mock handshake did not start")
	}
	ticker.Stop()
	close(release)
	waitTickerStopped(t, ticker)
}

func TestTickerDisconnectReleasesWorkerForRetry(t *testing.T) {
	connected := make(chan *websocket.Conn, 2)
	ticker := NewTicker(tickerLocalServer(t, nil, connected))
	defer ticker.Stop()
	ticker.Start()
	_ = waitTickerConnection(t, connected).Close()
	waitTickerStopped(t, ticker)
	ticker.Start()
	waitTickerConnection(t, connected)
	ticker.Stop()
	waitTickerStopped(t, ticker)
}

func TestTickerStopDrainsPendingEventReader(t *testing.T) {
	connected := make(chan *websocket.Conn, 1)
	ticker := NewTicker(tickerLocalServer(t, nil, connected))
	callback := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	ticker.OnChatChanged = func() { once.Do(func() { close(callback); <-release }) }
	defer ticker.Stop()
	ticker.Start()
	conn := waitTickerConnection(t, connected)
	message := []any{8, "OnJsonApiEvent", map[string]any{"uri": "/chat/v1/messages", "data": map[string]any{"id": "mock"}}}
	if err := conn.WriteJSON(message); err != nil {
		t.Fatal(err)
	}
	select {
	case <-callback:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("mock chat callback did not run")
	}
	// A second event leaves valclient's reader waiting to send while the
	// callback holds the consumer. Stop must release both goroutines.
	if err := conn.WriteJSON(message); err != nil {
		close(release)
		t.Fatal(err)
	}
	ticker.Stop()
	close(release)
	waitTickerStopped(t, ticker)
}
