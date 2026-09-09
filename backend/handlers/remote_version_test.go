package handlers

import "testing"

func TestParseLocalRiotClientVersion(t *testing.T) {
	log := []byte("old\nCI server version: release-13.00-shipping-28-4928912\nCI server version: release-13.00-shipping-32-4990475\n")
	if got := parseLocalRiotClientVersion(log); got != "release-13.00-shipping-32-4990475" {
		t.Fatalf("parseLocalRiotClientVersion() = %q", got)
	}
}

func TestNewerRiotClientVersion(t *testing.T) {
	tests := []struct {
		name      string
		candidate string
		floor     string
		want      string
	}{
		{
			name:      "stale catalog cannot downgrade live patch",
			candidate: "release-13.01-shipping-11-5090349",
			floor:     "release-13.02-shipping-7-5092570",
			want:      "release-13.02-shipping-7-5092570",
		},
		{
			name:      "newer feed wins",
			candidate: "release-13.03-shipping-1-5100000",
			floor:     "release-13.02-shipping-7-5092570",
			want:      "release-13.03-shipping-1-5100000",
		},
		{
			name:      "same patch keeps feed build",
			candidate: "release-13.02-shipping-9-5099999",
			floor:     "release-13.02-shipping-7-5092570",
			want:      "release-13.02-shipping-9-5099999",
		},
		{
			name:      "empty candidate uses floor",
			candidate: "",
			floor:     "release-13.02-shipping-7-5092570",
			want:      "release-13.02-shipping-7-5092570",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := newerRiotClientVersion(tt.candidate, tt.floor); got != tt.want {
				t.Fatalf("newerRiotClientVersion() = %q, want %q", got, tt.want)
			}
		})
	}
}
