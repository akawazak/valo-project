package tracking

import "testing"

func TestNormalizeSeasonID(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"e7a3", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"},
		{"E7A3", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"},
		{"  e7a3  ", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"},
		{"v26a4", "4f0864e2-40af-28a4-de2c-0e9e64e75f23"},
		{"v25a1", "476b0893-4c2e-abd6-c5fe-708facff0772"},
		{"cb", "0df5adb9-4dcb-6899-1306-3e9860661dd3"},
		// Already a UUID — pass through.
		{"4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"},
		// Unknown short code — pass through unchanged.
		{"unknown", "unknown"},
		// Empty — pass through.
		{"", ""},
	}
	for _, c := range cases {
		got := NormalizeSeasonID(c.in)
		if got != c.want {
			t.Errorf("NormalizeSeasonID(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestResolveSeasonIDs(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"e7a3", []string{"e7a3", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"}},
		{"4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1", []string{"e7a3", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"}},
		{"v26a4", []string{"v26a4", "4f0864e2-40af-28a4-de2c-0e9e64e75f23"}},
		{"unknown", []string{"unknown"}},
		{"", nil},
		{"  E7A3  ", []string{"e7a3", "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1"}},
	}
	for _, c := range cases {
		got := ResolveSeasonIDs(c.in)
		if len(got) != len(c.want) {
			t.Errorf("ResolveSeasonIDs(%q) = %v, want %v", c.in, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("ResolveSeasonIDs(%q)[%d] = %q, want %q", c.in, i, got[i], c.want[i])
			}
		}
	}
}
