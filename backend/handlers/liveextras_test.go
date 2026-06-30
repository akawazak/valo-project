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
	ids := make(map[string]bool, len(got[0].SkinIDs))
	for _, id := range got[0].SkinIDs {
		ids[id] = true
	}
	if len(ids) != 2 || !ids["skin-level-1"] || !ids["chroma-1"] {
		t.Fatalf("unexpected item ids: %#v", got[0].SkinIDs)
	}
}

func TestNormalizeLoadoutPlayersUsesDocumentedPregameLoadout(t *testing.T) {
	got := normalizeLoadoutPlayers(map[string]any{
		"Loadouts": []any{map[string]any{
			"Subject": "player-2",
			"Items": map[string]any{
				"weapon-2": map[string]any{"ID": "skin-level-2"},
			},
		}},
	})

	if len(got) != 1 || got[0].Puuid != "player-2" || got[0].GunCount != 1 ||
		len(got[0].SkinIDs) != 1 || got[0].SkinIDs[0] != "skin-level-2" {
		t.Fatalf("unexpected pregame loadout: %#v", got)
	}
}
