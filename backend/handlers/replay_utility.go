//go:build !android

package handlers

import (
	"math"
	"path"
	"sort"
	"strings"
)

// ReplayUtility uses the recorded effect actor or an explicit use event.
// EndMs is absent for instantaneous events. Times are relative to the barrier drop.
type ReplayUtility struct {
	Name    string              `json:"name"`
	Kind    string              `json:"kind"`
	Subject string              `json:"subject,omitempty"`
	StartMs int64               `json:"startMs"`
	EndMs   *int64              `json:"endMs,omitempty"`
	X       float32             `json:"x"`
	Y       float32             `json:"y"`
	Origin  *replayUtilityPoint `json:"origin,omitempty"`
}

type replayUtilityPoint struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
}

type replayUtilitySpec struct{ Name, Kind string }

// These actors represent active effects or placed devices in the replay.
// Equippables, travelling projectiles, and fake teleport actors are excluded.
var replayUtilityClasses = map[string]replayUtilitySpec{
	"Patch_Sarge_Q_Molotov_Production":            {"Incendiary", "molly"},
	"Patch_Aggrobot_C_ExplodeyPatch":              {"Mosh Pit", "molly"},
	"GameObject_Sarge_4_Smoke_ProductionNEW":      {"Sky Smoke", "smoke"},
	"GameObject_Sarge_X_OrbitalStrike_Production": {"Orbital Strike", "molly"},
	"GameObject_Hunter_4_ExplosiveBolt_Explosion": {"Shock Bolt", "impact"},
	"GameObject_Clay_Q_Explosion":                 {"Blast Pack", "impact"},
	"GameObject_Smonk_Q_DecayExplosion":           {"Meddle", "impact"},
	"Patch_Phoenix_MolotovFire":                   {"Hot Hands", "molly"},
	"GameObject_Killjoy_4_BeeSwarm_Damage":        {"Nanoswarm", "molly"},
	"Patch_Thorne_4_SlowField_Production":         {"Slow Orb", "slow"},
	"Patch_Deadeye_E_Slow_Large":                  {"Trademark", "slow"},
	"GameObject_Wushu_4_SmokeZone":                {"Cloudburst", "smoke"},
	"GameObject_Smonk_NewSmoke":                   {"Ruse", "smoke"},
	"GameObject_Smonk_NewSmoke_PDS":               {"Ruse", "smoke"},
	"Zone_Gumshoe_Q_Cage":                         {"Cyber Cage", "smoke"},
	"GameObject_Guide_E_HawkFlash_FlashSource":    {"Guiding Light", "flash"},
	"GameObject_Vampire_4_NearsightAOE_Source":    {"Leer", "flash"},
	"Pawn_Killjoy_E_Turret":                       {"Turret", "device"},
	"Pawn_Killjoy_Q_StealthAlarmbot":              {"Alarmbot", "device"},
	"GameObject_Killjoy_X_Bomb":                   {"Lockdown", "device"},
	"GameObject_Deadeye_E_Teleporter_Tether":      {"Rendezvous", "teleport"},
}

func replayUtilityClass(group string) replayUtilitySpec {
	if !strings.HasPrefix(group, "/Game/Characters/") {
		return replayUtilitySpec{}
	}
	name, _, _ := strings.Cut(path.Base(group), ".")
	return replayUtilityClasses[name]
}

func replayDeployedUtility(actors []replayActor, fields []replayField, subjects map[uint32]string, moves map[string][]replayMove) []ReplayUtility {
	instigators := map[uint32]string{}
	uses := map[uint32][]int64{}
	for _, field := range fields {
		switch *field.Name {
		case "Instigator":
			if subject := subjects[uint32(*field.I64)]; subject != "" {
				instigators[field.Actor] = subject
			}
		case "TeleporterUsed":
			uses[field.Actor] = append(uses[field.Actor], int64(field.TimeMs))
		}
	}

	active := map[uint32]ReplayUtility{}
	var utility []ReplayUtility
	for _, actor := range actors {
		switch actor.Event {
		case "open":
			if actor.Class == nil || actor.X == nil || actor.Y == nil ||
				!finiteReplayCoordinate(*actor.X) || !finiteReplayCoordinate(*actor.Y) {
				continue
			}
			spec := replayUtilityClass(*actor.Class)
			if spec.Name == "" {
				continue
			}
			effect := ReplayUtility{
				Name: spec.Name, Kind: spec.Kind, StartMs: int64(actor.TimeMs),
				Subject: instigators[actor.Guid], X: *actor.X, Y: *actor.Y,
			}
			if spec.Kind == "impact" {
				utility = append(utility, effect)
			} else {
				active[actor.Guid] = effect
			}
		case "close":
			if ability, ok := active[actor.Guid]; ok {
				delete(active, actor.Guid)
				end := int64(actor.TimeMs)
				if ability.Kind == "teleport" {
					utility = appendReplayTeleportUses(utility, ability, uses[actor.Guid], moves[ability.Subject], end)
				} else if end > ability.StartMs {
					ability.EndMs = &end
					utility = append(utility, ability)
				}
			}
		}
	}
	// A partial recording can still confirm a teleport already used.
	for guid, ability := range active {
		if ability.Kind == "teleport" {
			utility = appendReplayTeleportUses(utility, ability, uses[guid], moves[ability.Subject], math.MaxInt64)
		}
	}
	sort.SliceStable(utility, func(i, j int) bool { return utility[i].StartMs < utility[j].StartMs })
	return utility
}

func appendReplayTeleportUses(out []ReplayUtility, ability ReplayUtility, uses []int64, moves []replayMove, end int64) []ReplayUtility {
	for _, at := range uses {
		if at < ability.StartMs || at > end {
			continue
		}
		event := ability
		event.StartMs = at
		event.Origin = replayTeleportOrigin(moves, at, event.X, event.Y)
		out = append(out, event)
	}
	return out
}

// The tether records its destination. Corroborate the jump with nearby
// character movement before drawing an origin-to-destination line.
func replayTeleportOrigin(moves []replayMove, at int64, x, y float32) *replayUtilityPoint {
	first := sort.Search(len(moves), func(i int) bool { return int64(moves[i].TimeMs) >= at-160 })
	distance := func(move replayMove) float64 {
		return math.Hypot(float64(move.X-x), float64(move.Y-y))
	}
	for i := max(1, first); i < len(moves) && int64(moves[i].TimeMs) <= at+160; i++ {
		before, after := moves[i-1], moves[i]
		if int64(before.TimeMs) >= at-200 && distance(before) > 100 && distance(after) < 60 {
			return &replayUtilityPoint{X: before.X, Y: before.Y}
		}
	}
	return nil
}

func finiteReplayCoordinate(value float32) bool {
	return !math.IsNaN(float64(value)) && !math.IsInf(float64(value), 0)
}
