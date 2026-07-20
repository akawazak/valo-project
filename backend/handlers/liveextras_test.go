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
	if len(got[0].Items) != 1 || got[0].Items[0].WeaponID != "weapon-1" {
		t.Fatalf("weapon relationship was not preserved: %#v", got[0].Items)
	}
	structuredIDs := make(map[string]bool, len(got[0].Items[0].ItemIDs))
	for _, id := range got[0].Items[0].ItemIDs {
		structuredIDs[id] = true
	}
	if !structuredIDs["skin-level-1"] || !structuredIDs["chroma-1"] {
		t.Fatalf("nested cosmetics were not kept with their weapon: %#v", got[0].Items[0])
	}
}

func TestNormalizeLoadoutPlayersKeepsCosmeticsWithTheirOwnWeapon(t *testing.T) {
	got := normalizeLoadoutPlayers(map[string]any{
		"Loadouts": []any{map[string]any{
			"Subject": "player-structured",
			"Items": map[string]any{
				"weapon-b": map[string]any{"ID": "level-b", "Sockets": map[string]any{"buddy": map[string]any{"Item": map[string]any{"ID": "buddy-b"}}}},
				"weapon-a": map[string]any{"ID": "level-a", "Sockets": map[string]any{"chroma": map[string]any{"Item": map[string]any{"ID": "chroma-a"}}}},
			},
		}},
	})

	if len(got) != 1 || len(got[0].Items) != 2 {
		t.Fatalf("unexpected structured loadout: %#v", got)
	}
	if got[0].Items[0].WeaponID != "weapon-a" || got[0].Items[1].WeaponID != "weapon-b" {
		t.Fatalf("structured loadout should have stable weapon order: %#v", got[0].Items)
	}
	if containsString(got[0].Items[0].ItemIDs, "buddy-b") || containsString(got[0].Items[1].ItemIDs, "chroma-a") {
		t.Fatalf("cosmetics leaked between weapon slots: %#v", got[0].Items)
	}
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
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

func TestNormalizeLoadoutPlayersKeepsOuterSubjectForNestedLoadout(t *testing.T) {
	got := normalizeLoadoutPlayers(map[string]any{
		"Loadouts": []any{map[string]any{
			"Subject": "player-3",
			"Loadout": map[string]any{
				"Items": map[string]any{
					"weapon-3": map[string]any{"ID": "skin-level-3"},
				},
			},
		}},
	})

	if len(got) != 1 || got[0].Puuid != "player-3" || got[0].GunCount != 1 ||
		len(got[0].SkinIDs) != 1 || got[0].SkinIDs[0] != "skin-level-3" {
		t.Fatalf("unexpected nested loadout with outer subject: %#v", got)
	}
}
