package handlers

import "testing"

func TestNormalizeLoadoutPlayersUsesDocumentedNestedLoadout(t *testing.T) {
	got := normalizeLoadoutPlayers(map[string]any{
		"Loadouts": []any{map[string]any{
			"Loadout": map[string]any{
				"Subject": "player-1",
				"Items": map[string]any{
					"weapon-1": map[string]any{
						"ID": "skin-level-1",
						"Sockets": map[string]any{
							"chroma": map[string]any{"Item": map[string]any{"ID": "chroma-1"}},
						},
					},
				},
			},
		}},
	})

	if len(got) != 1 || got[0].Puuid != "player-1" || got[0].GunCount != 1 {
		t.Fatalf("unexpected normalized player: %#v", got)
	}
	if len(got[0].SkinIDs) != 2 || got[0].SkinIDs[0] != "skin-level-1" || got[0].SkinIDs[1] != "chroma-1" {
		t.Fatalf("unexpected item ids: %#v", got[0].SkinIDs)
	}
}
