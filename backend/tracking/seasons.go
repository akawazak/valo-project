package tracking

import "strings"

// Season ID normalization.
//
// Riot's PVP APIs (match-details, MMR, etc.) emit `SeasonID` as a SHORT
// internal code — e.g. `e7a3` for "Episode 7 Act III" — derived from the
// in-engine asset path `ShooterGame/Content/Seasons/Season_Episode7_Act3_DataAsset`.
//
// In contrast, the unofficial valorant-api.com `/v1/seasons` endpoint
// returns each act with a FULL UUID (`4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1`).
//
// We store match data using Riot's short codes (which is what the live API
// gives us) but we want to expose them to the UI in UUID form so the
// frontend's valorant-api.com metadata lookup actually matches.
//
// Map shape: shortCode (lowercase) → full UUID (lowercase). If we ever see
// an unknown code we keep it as-is so we don't silently break the data.

var seasonShortToUUID = map[string]string{
	// Closed Beta
	"cb": "0df5adb9-4dcb-6899-1306-3e9860661dd3",

	// Episode 1 — Ignition
	"e1a1": "3f61c772-4560-cd3f-5d3f-a7ab5abda6b3",
	"e1a2": "0530b9c4-4980-f2ee-df5d-09864cd00542",
	"e1a3": "46ea6166-4573-1128-9cea-60a15640059b",

	// Episode 2 — Formation
	"e2a1": "97b6e739-44cc-ffa7-49ad-398ba502ceb0",
	"e2a2": "ab57ef51-4e59-da91-cc8d-51a5a2b9b8ff",
	"e2a3": "52e9749a-429b-7060-99fe-4595426a0cf7",

	// Episode 3 — Reflection
	"e3a1": "2a27e5d2-4d30-c9e2-b15a-93b8909a442c",
	"e3a2": "4cb622e1-4244-6da3-7276-8daaf1c01be2",
	"e3a3": "a16955a5-4ad0-f761-5e9e-389df1c892fb",

	// Episode 4 — Disruption
	"e4a1": "573f53ac-41a5-3a7d-d9ce-d6a6298e5704",
	"e4a2": "d929bc38-4ab6-7da4-94f0-ee84f8ac141e",
	"e4a3": "3e47230a-463c-a301-eb7d-67bb60357d4f",

	// Episode 5 — Dimension
	"e5a1": "67e373c7-48f7-b422-641b-079ace30b427",
	"e5a2": "7a85de9a-4032-61a9-61d8-f4aa2b4a84b6",
	"e5a3": "aca29595-40e4-01f5-3f35-b1b3d304c96e",

	// Episode 6 — Revelation
	"e6a1": "9c91a445-4f78-1baa-a3ea-8f8aadf4914d",
	"e6a2": "34093c29-4306-43de-452f-3f944bde22be",
	"e6a3": "2de5423b-4aad-02ad-8d9b-c0a931958861",

	// Episode 7 — Evolution
	"e7a1": "0981a882-4e7d-371a-70c4-c3b4f46c504a",
	"e7a2": "03dfd004-45d4-ebfd-ab0a-948ce780dac4",
	"e7a3": "4401f9fd-4170-2e4c-4bc3-f3b4d7d150d1",

	// Episode 8 — DEFIANCE
	"e8a1": "ec876e6c-43e8-fa63-ffc1-2e8d4db25525",
	"e8a2": "22d10d66-4d2a-a340-6c54-408c7bd53807",
	"e8a3": "4539cac3-47ae-90e5-3d01-b3812ca3274e",

	// Episode 9 — COLLISION
	"e9a1": "52ca6698-41c1-e7de-4008-8994d2221209",
	"e9a2": "292f58db-4c17-89a7-b1c0-ba988f0e9d98",
	"e9a3": "dcde7346-4085-de4f-c463-2489ed47983b",

	// V25 Acts 1-3
	"v25a1": "476b0893-4c2e-abd6-c5fe-708facff0772",
	"v25a2": "16118998-4705-5813-86dd-0292a2439d90",
	"v25a3": "aef237a0-494d-3a14-a1c8-ec8de84e309c",

	// V25 Acts 4-6
	"v25a4": "ac12e9b3-47e6-9599-8fa1-0bb473e5efc7",
	"v25a5": "5adc33fa-4f30-2899-f131-6fba64c5dd3a",
	"v25a6": "4c4b8cff-43eb-13d3-8f14-96b783c90cd2",

	// V26 Acts 1-3
	"v26a1": "3ea2b318-423b-cf86-25da-7cbb0eefbe2d",
	"v26a2": "9d85c932-4820-c060-09c3-668636d4df1b",
	"v26a3": "ce2783e8-44fc-dd48-3da3-33b5ba6c4a22",

	// V26 Acts 4-6
	"v26a4": "4f0864e2-40af-28a4-de2c-0e9e64e75f23",
	"v26a5": "8102cd81-43a0-d0d7-bd59-47b8fe9bed1b",
	"v26a6": "d816f426-48ea-f052-117f-9697a155b319",
}

// NormalizeSeasonID converts a Riot short season code (e.g. "e7a3") to a
// full UUID ("4401f9fd-...") so the frontend's valorant-api.com metadata
// lookup can match. Returns the input unchanged (lowercased) if the code
// is already a UUID or unknown — we never want to drop data, only enrich it.
func NormalizeSeasonID(id string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return id
	}
	// Already a UUID-shaped value? Don't touch it.
	if len(id) == 36 && strings.Count(id, "-") == 4 {
		return id
	}
	if uuid, ok := seasonShortToUUID[id]; ok {
		return uuid
	}
	return id
}

// ResolveSeasonIDs returns every known equivalent form of the given season
// ID — both the short code AND the UUID. Use this when querying the
// database, since we store Riot's short codes but the API surface uses
// UUIDs after NormalizeSeasonID. The returned slice is deduplicated and
// stable-ordered (short code first, UUID second).
func ResolveSeasonIDs(id string) []string {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return nil
	}
	if uuid, ok := seasonShortToUUID[id]; ok {
		return []string{id, uuid}
	}
	// Input might be a UUID — find the matching short code.
	for short, uuid := range seasonShortToUUID {
		if uuid == id {
			return []string{short, id}
		}
	}
	// Unknown — return as-is so we don't lose data.
	return []string{id}
}
