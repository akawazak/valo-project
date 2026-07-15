package handlers

import "testing"

func TestLeaderboardSize(t *testing.T) {
	for raw, want := range map[string]int{"": 25, "0": 25, "101": 25, "oops": 25, "1": 1, "100": 100, "25": 25} {
		if got := leaderboardSize(raw); got != want {
			t.Fatalf("leaderboardSize(%q) = %d, want %d", raw, got, want)
		}
	}
}

func TestLeaderboardStartIndex(t *testing.T) {
	for raw, want := range map[string]int{"": 0, "-1": 0, "oops": 0, "0": 0, "25": 25} {
		if got := leaderboardStartIndex(raw); got != want {
			t.Fatalf("leaderboardStartIndex(%q) = %d, want %d", raw, got, want)
		}
	}
}
