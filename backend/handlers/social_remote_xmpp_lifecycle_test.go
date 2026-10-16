package handlers

import (
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type xmppLifecycleTransport func(*http.Request) (*http.Response, error)

func (f xmppLifecycleTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func mockXMPPTransport(t *testing.T, transport xmppLifecycleTransport) {
	t.Helper()
	previous := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previous })
}

func waitXMPPStopped(t *testing.T, session *xmppSocialSession) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		session.mu.RLock()
		running := session.running
		session.mu.RUnlock()
		if !running {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("forgotten XMPP worker did not finish")
}

func TestXMPPForgetCancelsRetryAndRejectsLateCallback(t *testing.T) {
	var requests atomic.Int32
	mockXMPPTransport(t, func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		return &http.Response{StatusCode: http.StatusForbidden, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("mock rejection")), Request: r}, nil
	})
	client, server := net.Pipe()
	defer server.Close()
	auth := remoteAuthHeaders{Puuid: "removed-account", Region: "eu", AccessToken: "synthetic-removed-token"}
	session := &xmppSocialSession{
		key: "removed-account:eu", state: "live", auth: auth, conn: client,
		messages:           map[string][]ChatMessage{"friend": {{Body: "synthetic message"}}},
		optimisticRequests: map[string]time.Time{"friend": time.Now()},
	}
	other := &xmppSocialSession{state: "live", auth: remoteAuthHeaders{Puuid: "other-account"}}
	hub := &xmppSocialHub{sessions: map[string]*xmppSocialSession{session.key: session, "other-account:eu": other}}
	session.fail(errors.New("synthetic disconnect"))
	timer := session.reconnectTimer
	if timer == nil {
		t.Fatal("failure did not schedule its retry")
	}
	defer timer.Stop()
	hub.forgetAccount("removed-account")
	if timer.Stop() {
		t.Fatal("forget left its reconnect timer active")
	}
	// Model a timer callback already queued when Stop ran. It must not
	// restore old auth, start another worker, or schedule another retry.
	session.retry()
	session.ensureRunning(auth)
	session.fail(errors.New("late read error"))
	session.appendMessage("friend", ChatMessage{Body: "late synthetic message"})
	if session.state != "closed" || session.auth != (remoteAuthHeaders{}) || session.running || session.reconnectTimer != nil || session.conn != nil || len(session.messages) != 0 || len(session.optimisticRequests) != 0 {
		t.Fatal("a forgotten session was restored by a late lifecycle callback")
	}
	if requests.Load() != 0 {
		t.Fatal("late callback made a mocked request with removed credentials")
	}
	if len(hub.sessions) != 1 || hub.sessions["other-account:eu"] != other || other.state != "live" {
		t.Fatal("forget affected another account")
	}
}

func TestXMPPForgetCancelsInFlightPASRequest(t *testing.T) {
	started := make(chan struct{})
	canceled := make(chan struct{})
	var requests atomic.Int32
	mockXMPPTransport(t, func(r *http.Request) (*http.Response, error) {
		requests.Add(1)
		if r.URL.Host != "riot-geo.pas.si.riotgames.com" {
			return nil, errors.New("unexpected synthetic request")
		}
		close(started)
		<-r.Context().Done()
		close(canceled)
		return nil, r.Context().Err()
	})
	auth := remoteAuthHeaders{Puuid: "removed-account", Region: "eu", AccessToken: "synthetic-token"}
	session := &xmppSocialSession{key: "removed-account:eu", state: "connecting"}
	hub := &xmppSocialHub{sessions: map[string]*xmppSocialSession{session.key: session}}
	defer hub.forgetAccount(auth.Puuid)
	session.ensureRunning(auth)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("mock PAS request did not start")
	}
	hub.forgetAccount(auth.Puuid)
	select {
	case <-canceled:
	case <-time.After(time.Second):
		t.Fatal("forget did not cancel the mocked PAS request")
	}
	waitXMPPStopped(t, session)
	if requests.Load() != 1 || session.auth != (remoteAuthHeaders{}) || session.state != "closed" || session.reconnectTimer != nil {
		t.Fatal("in-flight worker advanced or rescheduled after forget")
	}
}

func TestXMPPRetryKeepsCooldownAndUsesRenewedCredentials(t *testing.T) {
	requested := make(chan string, 1)
	mockXMPPTransport(t, func(r *http.Request) (*http.Response, error) {
		requested <- r.Header.Get("Authorization")
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	auth := remoteAuthHeaders{Puuid: "synthetic-account", Region: "eu", AccessToken: "old-synthetic-token"}
	session := &xmppSocialSession{key: "synthetic-account:eu", state: "live", auth: auth, lastAttempt: time.Now()}
	hub := &xmppSocialHub{sessions: map[string]*xmppSocialSession{session.key: session}}
	defer hub.forgetAccount(auth.Puuid)
	session.fail(errors.New("synthetic disconnect"))
	timer := session.reconnectTimer
	auth.AccessToken = "renewed-synthetic-token"
	session.ensureRunning(auth)
	if session.running || session.reconnectTimer != timer || session.cancel != nil {
		t.Fatal("a cooldown poll replaced the scheduled retry or allocated a worker")
	}
	session.lastAttempt = time.Now().Add(-time.Minute)
	session.retry()
	select {
	case got := <-requested:
		if got != "Bearer renewed-synthetic-token" {
			t.Fatal("retry used credentials captured before renewal")
		}
	case <-time.After(time.Second):
		t.Fatal("retry did not start the mocked PAS request")
	}
	hub.forgetAccount(auth.Puuid)
	waitXMPPStopped(t, session)
}
