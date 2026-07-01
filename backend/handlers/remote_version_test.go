package handlers

import "testing"

func TestParseLocalRiotClientVersion(t *testing.T) {
	log := []byte("old\nCI server version: release-13.00-shipping-28-4928912\nCI server version: release-13.00-shipping-32-4990475\n")
	if got := parseLocalRiotClientVersion(log); got != "release-13.00-shipping-32-4990475" {
		t.Fatalf("parseLocalRiotClientVersion() = %q", got)
	}
}
