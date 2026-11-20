//go:build !android

package handlers

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"path"
	"sort"
	"strings"
)

// ReplayUtility uses the recorded effect actor or an explicit use event.
// EndMs is absent for instantaneous events. Times are relative to the barrier drop.
type ReplayUtility struct {
	Name         string                 `json:"name"`
	Kind         string                 `json:"kind"`
	Subject      string                 `json:"subject,omitempty"`
	StartMs      int64                  `json:"startMs"`
	EndMs        *int64                 `json:"endMs,omitempty"`
	X            float32                `json:"x"`
	Y            float32                `json:"y"`
	Origin       *replayUtilityPoint    `json:"origin,omitempty"`
	Anchor       *replayUtilityPoint    `json:"anchor,omitempty"`
	Segment      *[2]replayUtilityPoint `json:"segment,omitempty"`
	ActivationMs *int64                 `json:"activationMs,omitempty"`
	Radius       float32                `json:"radius,omitempty"`
	State        string                 `json:"state,omitempty"`
	Path         []replayUtilitySample  `json:"path,omitempty"`
}

type replayUtilityPoint struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
}

type replayUtilitySample struct {
	Ms int64 `json:"ms"`
	replayUtilityPoint
}

type replayUtilitySpec struct{ Name, Kind string }

const (
	replayWirePrimary         = "GameObject_Gumshoe_4_TripWire"
	replayWireSecondary       = "GameObject_Gumshoe_4_TripWire_SecondWire"
	replayWireMarkerOne       = "SetTripWireLocation.HitResultMarker1"
	replayWireMarkerTwo       = "SetTripWireLocation.HitResultMarker2"
	replayActivationComponent = "/Game/Characters/States/ActivatableActorComponent.ActivatableActorComponent_C"
)

// Actors observed as live effects, devices, or projectiles in replay exports.
// Ability equipment and targeting previews do not establish a deployment.
var replayUtilityClasses = map[string]replayUtilitySpec{
	"Patch_Sarge_Q_Molotov_Production":                      {"Incendiary", "molly"},
	"Patch_Aggrobot_C_ExplodeyPatch":                        {"Mosh Pit", "molly"},
	"GameObject_Sarge_4_Smoke_ProductionNEW":                {"Sky Smoke", "smoke"},
	"GameObject_Sarge_X_OrbitalStrike_Production":           {"Orbital Strike", "molly"},
	"GameObject_Hunter_4_ExplosiveBolt_Explosion":           {"Shock Bolt", "impact"},
	"GameObject_Clay_Q_Explosion":                           {"Blast Pack", "impact"},
	"GameObject_Smonk_Q_DecayExplosion":                     {"Meddle", "impact"},
	"Patch_Phoenix_MolotovFire":                             {"Hot Hands", "molly"},
	"GameObject_Killjoy_4_BeeSwarm_Damage":                  {"Nanoswarm", "molly"},
	"Patch_Thorne_4_SlowField_Production":                   {"Slow Orb", "slow"},
	"Patch_Deadeye_E_Slow_Large":                            {"Trademark", "slow"},
	"GameObject_Wushu_4_SmokeZone":                          {"Cloudburst", "smoke"},
	"GameObject_Smonk_NewSmoke":                             {"Ruse", "smoke"},
	"GameObject_Smonk_NewSmoke_PDS":                         {"Ruse", "smoke"},
	"Zone_Gumshoe_Q_Cage":                                   {"Cyber Cage", "smoke"},
	"GameObject_Guide_E_HawkFlash_FlashSource":              {"Guiding Light", "flash"},
	"GameObject_Vampire_4_NearsightAOE_Source":              {"Leer", "flash"},
	"Pawn_Killjoy_E_Turret":                                 {"Turret", "device"},
	"Pawn_Killjoy_Q_StealthAlarmbot":                        {"Alarmbot", "device"},
	"GameObject_Killjoy_X_Bomb":                             {"Lockdown", "device"},
	"GameObject_Deadeye_E_Teleporter_Tether":                {"Rendezvous", "teleport"},
	"GameObject_Deadeye_E_Trap":                             {"Trademark", "device"},
	"Projectile_Killjoy_4_RemoteBees_MultiDetonate":         {"Nanoswarm", "landed"},
	"Patch_Pandemic_AcidMolotov_NewMolotov":                 {"Snake Bite", "molly"},
	replayWirePrimary:                                       {"Trapwire", "trap"},
	replayWireSecondary:                                     {"Trapwire", "trap"},
	"GameObject_Gumshoe_Q_CageTrap":                         {"Cyber Cage", "device"},
	"Pawn_Gumshoe_E_PossessableCamera":                      {"Spycam", "device"},
	"GameObject_Gumshoe_X_InterrogateHat":                   {"Neural Theft", "pulse"},
	"GameObject_Sarge_E_SpeedStim":                          {"Stim Beacon", "buff"},
	"GameObject_Phoenix_X_ResTarget_Production":             {"Run it Back", "device"},
	"GameObject_Phoenix_Q_FlameWallManager_Production":      {"Blaze", "wall"},
	"Projectile_Phoenix_E_FlareCurve_Synced":                {"Curveball", "projectile"},
	"Projectile_Phoenix_E_FlareCurve_Synced_Right":          {"Curveball", "projectile"},
	"GameObject_Thorne_E_Wall_Segment_Fortifying":           {"Barrier Orb", "wall"},
	"GameObject_Hunter_Q_SonarBolt":                         {"Recon Bolt", "device"},
	"GameObject_Hunter_Q_SonarPing":                         {"Recon Bolt", "pulse"},
	"Pawn_Hunter_E_Drone":                                   {"Owl Drone", "summon"},
	"Projectile_Wraith_Q_NearsightMissile":                  {"Paranoia", "projectile"},
	"Pawn_Clay_E_Boomba":                                    {"Boom Bot", "summon"},
	"Projectile_Clay_4_Projectile_Primary":                  {"Paint Shells", "projectile"},
	"Projectile_Clay_4_Projectile_Secondary":                {"Paint Shells", "projectile"},
	"Projectile_Clay_X_Rocket":                              {"Showstopper", "projectile"},
	"GameObject_Guide_4_Heal_AOE":                           {"Regrowth", "heal"},
	"Pawn_Guide_Q_PossessableScout":                         {"Trailblazer", "summon"},
	"Pawn_Guide_X_Pack":                                     {"Seekers", "summon"},
	"Pawn_Aggrobot_RollyPolly":                              {"Wingman", "summon"},
	"Pawn_Aggrobot_SeekerNade":                              {"Thrash", "summon"},
	"Projectile_E_Aggrobot_DiscTurret_PowerWave":            {"Dizzy", "projectile"},
	"GameObject_BountyHunter_E_LoSReveal_Source_Reactivate": {"Haunt", "device"},
	"GameObject_Q_BountyHunter_Tether_SphereExpansion":      {"Seize", "slow"},
	"Pawn_BountyHunter_4_WolfHound":                         {"Prowler", "summon"},
	"GameObject_BountyHunter_X_WaveForm":                    {"Nightfall", "pulse"},
	"GameObject_Breach_4_FusionBlast":                       {"Aftershock", "impact"},
	"GameObject_Breach_E_SweetSpotFissure":                  {"Fault Line", "pulse"},
	"GameObject_Breach_X_Shockwave":                         {"Rolling Thunder", "pulse"},
	"Projectile_Breach_Q_ThroughWalls_Flash":                {"Flashpoint", "projectile"},
	"GameObject_StealthingTrap_SoundSensor":                 {"Sonic Sensor", "device"},
	"GameObject_SoundSensor_SweetSpotFissure":               {"Sonic Sensor", "pulse"},
	"GameObject_CableJam_CableDeployer_Precomputed":         {"Barrier Mesh", "wall"},
	"Patch_Cable_4_NetToss":                                 {"GravNet", "slow"},
	"GameObject_FishingHook_CageSphere":                     {"Annihilation", "device"},
	"GameObject_Cashew_Q_ShellShockGrenade":                 {"Special Delivery", "pulse"},
	"Pawn_Cashew_4_Spider_LockOn":                           {"Stealth Drone", "summon"},
	"GameObject_Cashew_E_Explosion":                         {"Guided Salvo", "impact"},
	"GameObject_Cashew_X_Segment":                           {"Armageddon", "impact"},
	"Gameobject_Grenadier_E_SuppressionPulse":               {"ZERO/point", "pulse"},
	"Gameobject_Grenadier_X_UltPulse":                       {"NULL/cmd", "pulse"},
	"Projectile_C_Grenadier_Flash":                          {"FLASH/drive", "projectile"},
	"Projectile_C_Grenadier_Flash_Underhand":                {"FLASH/drive", "projectile"},
	"Projectile_Grenadier_Q_SemtexBasic":                    {"FRAG/ment", "projectile"},
	"GameObject_Iris_E_Smoke":                               {"Waveform", "smoke"},
	"GameObject_Iris_X_SonicWave":                           {"Bassquake", "pulse"},
	"GameObject_Thumper_Concuss":                            {"M-pulse", "slow"},
	"GameObject_Thumper_Heal":                               {"M-pulse", "heal"},
	"GameObject_Mage_E_WorldSmoke":                          {"Cove", "smoke"},
	"GameObject_Mage_Q_WallManager":                         {"High Tide", "wall"},
	"GameObject_Nox_StealthingTrap_Flash_2":                 {"Arc Rose", "device"},
	"GameObject_Nox_Wall":                                   {"Shear", "wall"},
	"GameObject_Nox_WallTrap":                               {"Shear", "device"},
	"Patch_Nox_BarbedWire":                                  {"Razorvine", "slow"},
	"Gameobject_Nox_DisarmPulse":                            {"Steel Garden", "pulse"},
	"GameObject_Rift_4_BlackHole":                           {"Gravity Well", "slow"},
	"GameObject_Rift_E_SmokeZone":                           {"Nebula", "smoke"},
	"GameObject_Rift_Q_FlashBurst":                          {"Nova Pulse", "pulse"},
	"GameObject_Rift_X_GlobalWall":                          {"Cosmic Divide", "wall"},
	"GameObject_Sequoia_4_MovingCover":                      {"Contingency", "wall"},
	"Projectile_Sequoia_Q_FragileMissile":                   {"Undercut", "projectile"},
	"GameObject_Sprinter_4_Tunnel":                          {"Fast Lane", "wall"},
	"GameObject_Sprinter_Q_ElectricSphere":                  {"Relay Bolt", "pulse"},
	"Pawn_Stealth_4_Decoy_V2":                               {"Fakeout", "summon"},
	"Projectile_Stealth_Q_BounceFlash":                      {"Blindside", "projectile"},
	"GameObject_Terra_C_TimeSlowGrenade_Explosion":          {"Saturate", "slow"},
	"GameObject_Terra_E_RewindTime_RewindTarget":            {"Refract", "device"},
	"GameObject_Terra_X_DelayedBeam_Beam":                   {"Convergent Paths", "pulse"},
	"GameObject_Paprika_E_RedirectPullArea":                 {"Displacement", "slow"},
	"Projectile_Paprika_Q_RedirectFlash":                    {"Flashbulb", "projectile"},
}

func replayUtilityClass(group string) replayUtilitySpec {
	if !strings.HasPrefix(group, "/Game/Characters/") {
		return replayUtilitySpec{}
	}
	return replayUtilityClasses[replayUtilityClassName(group)]
}

func replayUtilityClassName(group string) string {
	name, _, _ := strings.Cut(path.Base(group), ".")
	return name
}

type replayUtilityFields struct {
	owner                        string
	uses                         []int64
	path                         []replayUtilitySample
	landed, activated, triggered *int64
	wireMarkers                  [2]string
	radius                       float32
}

func collectReplayUtilityFields(fields []replayField, subjects map[uint32]string) map[uint32]*replayUtilityFields {
	byActor := map[uint32]*replayUtilityFields{}
	for _, field := range fields {
		if field.Name == nil || (replayUtilityClass(field.Group).Name == "" && field.Group != replayActivationComponent) {
			continue
		}
		data := byActor[field.Actor]
		if data == nil {
			data = &replayUtilityFields{}
			byActor[field.Actor] = data
		}
		at := int64(field.TimeMs)
		switch *field.Name {
		case "Instigator":
			if field.I64 != nil && subjects[uint32(*field.I64)] != "" {
				data.owner = subjects[uint32(*field.I64)]
			}
		case "TeleporterUsed":
			data.uses = append(data.uses, at)
		case "ReplicatedMovement":
			if field.Text != nil {
				var movement struct{ Location *struct{ X, Y *float32 } }
				if json.Unmarshal([]byte(*field.Text), &movement) == nil && movement.Location != nil &&
					movement.Location.X != nil && movement.Location.Y != nil {
					x, y := *movement.Location.X, *movement.Location.Y
					if finiteReplayCoordinate(x) && finiteReplayCoordinate(y) {
						data.path = append(data.path, replayUtilitySample{Ms: at, replayUtilityPoint: replayUtilityPoint{X: x, Y: y}})
					}
				}
			}
		case "MulticastStopProjectile":
			if data.landed == nil {
				data.landed = &at
			}
		case "IsActivated":
			if data.activated == nil && field.Bool != nil && *field.Bool {
				data.activated = &at
			}
		case replayWireMarkerOne:
			if data.wireMarkers[0] == "" {
				data.wireMarkers[0] = string(field.Raw)
			}
		case replayWireMarkerTwo:
			if data.wireMarkers[1] == "" {
				data.wireMarkers[1] = string(field.Raw)
			}
		case "SetEnemyInTrap.PairedWire":
			if data.triggered == nil && len(field.Raw) == 3 && binary.LittleEndian.Uint16(field.Raw[:2]) != 0 {
				data.triggered = &at
			}
		case "RuntimeRadius":
			if data.radius == 0 && len(field.Raw) == 4 {
				radius := math.Float32frombits(binary.LittleEndian.Uint32(field.Raw))
				if radius > 20 && radius < 10_000 {
					data.radius = radius
				}
			}
		}
	}
	for _, data := range byActor {
		sort.SliceStable(data.path, func(i, j int) bool { return data.path[i].Ms < data.path[j].Ms })
	}
	return byActor
}

type replayWireKey struct {
	start   uint32
	markers [2]string
}

// The two wire actors mirror the same hit-marker payloads and each spawns at
// its own wall anchor. Match the recorded pair instead of approximating reach.
func replayWireAnchors(actors []replayActor, fields map[uint32]*replayUtilityFields) map[replayWireKey]replayUtilityPoint {
	anchors := map[replayWireKey]replayUtilityPoint{}
	for _, actor := range actors {
		data := fields[actor.Guid]
		if actor.Event == "open" && actor.Class != nil && replayUtilityClassName(*actor.Class) == replayWireSecondary &&
			actor.X != nil && actor.Y != nil && finiteReplayCoordinate(*actor.X) && finiteReplayCoordinate(*actor.Y) &&
			data != nil && data.wireMarkers[0] != "" && data.wireMarkers[1] != "" {
			key := replayWireKey{actor.TimeMs, [2]string{data.wireMarkers[1], data.wireMarkers[0]}}
			anchors[key] = replayUtilityPoint{X: *actor.X, Y: *actor.Y}
		}
	}
	return anchors
}

func replayUtilityPositionNear(track []replayUtilitySample, at int64) (replayUtilityPoint, bool) {
	index := sort.Search(len(track), func(i int) bool { return track[i].Ms >= at })
	if index > 0 && (index == len(track) || at-track[index-1].Ms < track[index].Ms-at) {
		index--
	}
	if index >= len(track) || math.Abs(float64(track[index].Ms-at)) > 180 {
		return replayUtilityPoint{}, false
	}
	return track[index].replayUtilityPoint, true
}

func replayDeployedUtility(actors []replayActor, fields []replayField, subjects map[uint32]string, moves map[string][]replayMove) []ReplayUtility {
	byActor := collectReplayUtilityFields(fields, subjects)
	anchors := replayWireAnchors(actors, byActor)

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
			if spec.Name == "" || replayUtilityClassName(*actor.Class) == replayWireSecondary {
				continue
			}
			data := byActor[actor.Guid]
			if data == nil {
				data = &replayUtilityFields{}
			}
			effect := ReplayUtility{
				Name: spec.Name, Kind: spec.Kind, StartMs: int64(actor.TimeMs),
				Subject: data.owner, X: *actor.X, Y: *actor.Y, Radius: data.radius,
			}
			switch spec.Kind {
			case "trap":
				if end, ok := anchors[replayWireKey{actor.TimeMs, data.wireMarkers}]; ok && (end.X != effect.X || end.Y != effect.Y) {
					effect.Anchor = &end
				}
				effect.ActivationMs = data.triggered
			case "landed":
				if data.landed == nil {
					continue
				}
				landing, observed := replayUtilityPositionNear(data.path, *data.landed)
				if !observed {
					continue
				}
				effect.Kind, effect.State = "device", "placed"
				effect.StartMs, effect.X, effect.Y = *data.landed, landing.X, landing.Y
				effect.ActivationMs = data.activated
			case "projectile", "summon":
				effect.Path = data.path
			case "wall":
				if effect.Name == "Barrier Orb" && actor.Yaw != nil && finiteReplayCoordinate(*actor.Yaw) {
					// The four Barrier Orb actors are centered 260 units apart,
					// perpendicular to their recorded facing, even when mirrored.
					angle := (float64(*actor.Yaw) + 90) * math.Pi / 180
					dx, dy := float32(130*math.Cos(angle)), float32(130*math.Sin(angle))
					effect.Segment = &[2]replayUtilityPoint{{X: effect.X - dx, Y: effect.Y - dy}, {X: effect.X + dx, Y: effect.Y + dy}}
				}
			}
			if effect.Kind == "device" && effect.Name == "Cyber Cage" {
				effect.State = "placed"
			}
			if effect.Kind == "molly" && effect.Name == "Nanoswarm" {
				effect.State = "damage"
			}
			if effect.Kind == "impact" || effect.Kind == "pulse" {
				utility = append(utility, effect)
			} else {
				active[actor.Guid] = effect
			}
		case "close":
			if ability, ok := active[actor.Guid]; ok {
				delete(active, actor.Guid)
				end := int64(actor.TimeMs)
				if ability.Kind == "teleport" {
					if data := byActor[actor.Guid]; data != nil {
						utility = appendReplayTeleportUses(utility, ability, data.uses, moves[ability.Subject], end)
					}
				} else if end > ability.StartMs {
					ability.EndMs = &end
					utility = append(utility, ability)
				}
			}
		}
	}
	// A partial recording can still confirm a teleport already used.
	for guid, ability := range active {
		if data := byActor[guid]; ability.Kind == "teleport" && data != nil {
			utility = appendReplayTeleportUses(utility, ability, data.uses, moves[ability.Subject], math.MaxInt64)
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
