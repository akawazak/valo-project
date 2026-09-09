package handlers

import (
	"net/http/httptest"
	"testing"
)

func TestStoreClientAcceptsSelectedRemoteAccountHeaders(t *testing.T) {
	h := NewHandler(nil)
	r := httptest.NewRequest("GET", "/v1/storefront", nil)
	r.Header.Set("X-Riot-Access-Token", "remote-access")
	r.Header.Set("X-Riot-Entitlements-JWT", "remote-entitlement")
	r.Header.Set("X-Riot-Puuid", "player")
	r.Header.Set("X-Riot-Region", "eu")

	client, err := h.getClient(r)
	if err != nil {
		t.Fatalf("selected remote store account was rejected: %v", err)
	}
	if client.Player == nil || client.Player.Uuid != "player" || string(client.Region) != "eu" {
		t.Fatalf("unexpected selected remote client: %+v", client)
	}
}

func TestStoreClientStillRequiresAuthenticationWithoutLocalSession(t *testing.T) {
	h := NewHandler(nil)
	r := httptest.NewRequest("GET", "/v1/storefront", nil)

	if _, err := h.getClient(r); err == nil {
		t.Fatal("missing authentication was accepted")
	}
}
