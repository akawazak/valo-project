//go:build !android

package handlers

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/parquet-go/parquet-go"
)

func ptr[T any](value T) *T { return &value }

func writeReplayFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	manifest := `{"duration_ms": 60000, "replay_build": "++Ares-Core+release-13.06", "players": [
		{"subject": "AAAAAAAA-0000-0000-0000-000000000001", "character_net_guids": [11, 21]},
		{"subject": "aaaaaaaa-0000-0000-0000-000000000002", "character_net_guids": [12]}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	moves := []replayMove{
		{TimeMs: 9_000, Guid: 11, X: 100, Y: 200, Yaw: 90},
		{TimeMs: 15_000, Guid: 11, X: 300, Y: 400, Yaw: 180},
		{TimeMs: 21_900, Guid: 11, X: 450, Y: 560, Yaw: 90},
		{TimeMs: 22_030, Guid: 11, X: 150, Y: 260, Yaw: 90},
		{TimeMs: 9_500, Guid: 12, X: -50, Y: 60, Yaw: 10},
		{TimeMs: 41_000, Guid: 21, X: 700, Y: 800, Yaw: 270},
		{TimeMs: 12_000, Guid: 99, X: 1, Y: 1, Yaw: 1}, // not a player
	}
	if err := parquet.WriteFile(filepath.Join(dir, "movement.parquet"), moves); err != nil {
		t.Fatal(err)
	}
	events := []replayEvent{
		{Group: "characterDeath", Time1: ptr(uint32(20_000)), Word1: ptr(uint32(12))},
		{Group: "roundStarted", Time1: ptr(uint32(5_000)), Word1: nil},
	}
	if err := parquet.WriteFile(filepath.Join(dir, "events.parquet"), events); err != nil {
		t.Fatal(err)
	}
	actors := []replayActor{
		{Guid: 501, Class: ptr("/Game/Equippables/Guns/Sidearms/BasePistol/BasePistol.BasePistol_C")},
		{Guid: 502, Class: ptr("/Game/Characters/Wushu/S0/Ability_4/Ability_Wushu_4_Smoke.Ability_Wushu_4_Smoke_C")},
		{Guid: 503, Class: ptr("/Game/Equippables/Guns/Rifles/AK/AssaultRifle_AK.AssaultRifle_AK_C")},
		{Guid: 510, TimeMs: 11_000, Event: "open", Class: ptr("/Game/Characters/Wraith/S0/Ability_4/Projectile_Wraith_4_Smoke.Projectile_Wraith_4_Smoke_C"), X: ptr(float32(90)), Y: ptr(float32(99))},
		{Guid: 511, TimeMs: 13_200, Event: "open", Class: ptr(omenSmokeClass), X: ptr(float32(450)), Y: ptr(float32(-680))},
		{Guid: 510, TimeMs: 13_700, Event: "close"},
		{Guid: 511, TimeMs: 29_200, Event: "close"},
		{Guid: 512, TimeMs: 49_000, Event: "open", Class: ptr(omenSmokeClass), X: ptr(float32(500)), Y: ptr(float32(-700))},
		{Guid: 521, TimeMs: 16_000, Event: "open", Class: ptr("/Game/Characters/Phoenix/S0/Ability_4/Production/NewMolotov/Patch_Phoenix_MolotovFire.Patch_Phoenix_MolotovFire_C"), X: ptr(float32(-100)), Y: ptr(float32(250))},
		{Guid: 522, TimeMs: 17_000, Event: "open", Class: ptr("/Game/Characters/Deadeye/S0/Ability_E/GameObject_Deadeye_E_Teleporter_Tether.GameObject_Deadeye_E_Teleporter_Tether_C"), X: ptr(float32(150)), Y: ptr(float32(260))},
		{Guid: 521, TimeMs: 20_000, Event: "close"},
		{Guid: 522, TimeMs: 25_000, Event: "close"},
	}
	if err := parquet.WriteFile(filepath.Join(dir, "actors.parquet"), actors); err != nil {
		t.Fatal(err)
	}
	held := func(at, character uint32, equippable int64) replayField {
		return replayField{TimeMs: at, Actor: character, Name: ptr("CurrentEquippable"), I64: ptr(equippable)}
	}
	phase := func(at uint32, value int64) replayField {
		return replayField{TimeMs: at, Name: ptr("MulticastSetPhase.NewPhase"), I64: ptr(value)}
	}
	fields := []replayField{
		phase(5_000, 3), phase(10_000, 4), phase(30_000, 5),
		phase(35_000, 2), phase(35_100, 3), phase(40_000, 4), phase(55_000, 5),
		{TimeMs: 1, Name: ptr("Other"), I64: ptr(int64(4))},
		// Player one starts with a Classic, pulls an ability, then picks up a Vandal.
		held(4_000, 11, 501), held(12_000, 11, 502), held(14_000, 11, 503), held(14_100, 11, 503),
		held(13_000, 12, 999), // a class the export does not name
		{TimeMs: 13_200, Actor: 511, Group: omenSmokeClass, Name: ptr("Instigator"), I64: ptr(int64(11))},
		{TimeMs: 16_000, Actor: 521, Group: *actors[8].Class, Name: ptr("Instigator"), I64: ptr(int64(12))},
		{TimeMs: 17_000, Actor: 522, Group: *actors[9].Class, Name: ptr("Instigator"), I64: ptr(int64(11))},
		{TimeMs: 22_000, Actor: 522, Group: *actors[9].Class + "_ClassNetCache", Name: ptr("TeleporterUsed")},
	}
	if err := parquet.WriteFile(filepath.Join(dir, "fields.parquet"), fields); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestConvertReplayExportBuildsRounds(t *testing.T) {
	replay, err := convertReplayExport(writeReplayFixture(t), "match")
	if err != nil {
		t.Fatal(err)
	}
	if replay.Version != replayFormatVersion || replay.Build != "++Ares-Core+release-13.06" || len(replay.Subjects) != 2 {
		t.Fatalf("unexpected header: %+v", replay)
	}
	if replay.Subjects[0] != "aaaaaaaa-0000-0000-0000-000000000001" {
		t.Fatalf("subjects are not lower case: %v", replay.Subjects)
	}
	if len(replay.Rounds) != 2 {
		t.Fatalf("rounds = %d, want 2", len(replay.Rounds))
	}
	first, second := replay.Rounds[0], replay.Rounds[1]
	if first.BuyMs != 5_000 || first.StartMs != 10_000 || first.EndMs != 30_000 {
		t.Fatalf("first round phases: %+v", first)
	}
	// The whole buy phase, then until three seconds after the round.
	if first.FrameMs != -5_000 || first.Frames != int((33_000-5_000)/replaySampleMs)+1 {
		t.Fatalf("first round frames: from %d, %d frames", first.FrameMs, first.Frames)
	}
	// The second round stops at the end of the replay window, not past the next buy phase.
	if second.StartMs != 40_000 || second.EndMs != 55_000 {
		t.Fatalf("second round phases: %+v", second)
	}
	wantSmoke := ReplaySmoke{Subject: replay.Subjects[0], StartMs: 3_200, EndMs: 19_200, X: 450, Y: -680}
	if len(first.Smokes) != 1 || first.Smokes[0] != wantSmoke || len(second.Smokes) != 0 {
		t.Fatalf("deployed smokes = %+v and %+v, want just %+v", first.Smokes, second.Smokes, wantSmoke)
	}
	if len(first.Utility) != 2 || len(second.Utility) != 0 {
		t.Fatalf("recorded utility = %+v and %+v", first.Utility, second.Utility)
	}
	molly, teleport := first.Utility[0], first.Utility[1]
	if molly.Name != "Hot Hands" || molly.Kind != "molly" || molly.Subject != replay.Subjects[1] ||
		molly.StartMs != 6_000 || molly.EndMs == nil || *molly.EndMs != 10_000 || molly.X != -100 || molly.Y != 250 {
		t.Fatalf("activated molly = %+v", molly)
	}
	if teleport.Name != "Rendezvous" || teleport.StartMs != 12_000 || teleport.EndMs != nil ||
		teleport.X != 150 || teleport.Y != 260 || teleport.Subject != replay.Subjects[0] ||
		teleport.Origin == nil || *teleport.Origin != (replayUtilityPoint{X: 450, Y: 560}) {
		t.Fatalf("used teleport = %+v", teleport)
	}

	sample := func(track ReplayTrack, roundMs int64, round ReplayRound) [3]int32 {
		index := int((roundMs - round.FrameMs) / replaySampleMs)
		return [3]int32{track.Samples[index*3], track.Samples[index*3+1], track.Samples[index*3+2]}
	}
	one, two := first.Tracks[0], first.Tracks[1]
	if got := sample(one, -1_000, first); got != [3]int32{100, 200, 90} {
		t.Fatalf("player one before moving again: %v", got)
	}
	if got := sample(one, 6_000, first); got != [3]int32{300, 400, 180} {
		t.Fatalf("player one after the second move: %v", got)
	}
	if got := sample(two, -5_000, first); got != [3]int32{-50, 60, 10} {
		t.Fatalf("player two before moving should stand at the first pose, got %v", got)
	}
	if one.DeathMs != -1 || two.DeathMs != 10_000 {
		t.Fatalf("deaths: one %d, two %d", one.DeathMs, two.DeathMs)
	}
	wantHeld := []ReplayHeld{
		{Ms: -5_000, Item: "gun:29a0cfab-485b-f5d5-779a-b59f85e204a8"},
		{Ms: 2_000, Item: "ability:grenade"},
		{Ms: 4_000, Item: "gun:9c82e19d-4575-0200-1a81-3eacf00cf872"},
	}
	if len(one.Held) != len(wantHeld) {
		t.Fatalf("held = %+v", one.Held)
	}
	for index, want := range wantHeld {
		if one.Held[index] != want {
			t.Fatalf("held[%d] = %+v, want %+v", index, one.Held[index], want)
		}
	}
	if len(two.Held) != 0 {
		t.Fatalf("unknown classes should be left out: %+v", two.Held)
	}
	// A later spawn's character net GUID still belongs to player one.
	if got := sample(second.Tracks[0], 2_000, second); got != [3]int32{700, 800, 270} {
		t.Fatalf("player one in round two: %v", got)
	}
}

func TestReplayFileRoundTrip(t *testing.T) {
	replay, err := convertReplayExport(writeReplayFixture(t), "match")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "match.json.gz")
	if err := writeReplayFile(path, &ReplayFile{Version: 5, MatchID: "match"}); err != nil {
		t.Fatal(err)
	}
	if err := writeReplayFile(path, replay); err != nil {
		t.Fatal(err)
	}
	if version := replayFileVersion(path); version != replayFormatVersion {
		t.Fatalf("version = %d", version)
	}
}

func TestReplayUtilitySeparatesPlacementActivationAndTravel(t *testing.T) {
	class := func(name string) string { return "/Game/Characters/Agent/S0/Ability_4/" + name + "." + name + "_C" }
	open := func(guid, time uint32, ability string, x, y float32) replayActor {
		return replayActor{Guid: guid, TimeMs: time, Event: "open", Class: ptr(class(ability)), X: &x, Y: &y}
	}
	close := func(guid, time uint32) replayActor { return replayActor{Guid: guid, TimeMs: time, Event: "close"} }
	const nanoswarm = "Projectile_Killjoy_4_RemoteBees_MultiDetonate"
	const paranoia = "Projectile_Wraith_Q_NearsightMissile"
	wall := open(5, 3_000, "GameObject_Thorne_E_Wall_Segment_Fortifying", 400, 500)
	wall.Yaw = ptr(float32(90))
	actors := []replayActor{
		open(1, 1_000, replayWirePrimary, 100, 200), open(2, 1_000, replayWireSecondary, 100, 600),
		open(3, 2_000, nanoswarm, 50, 50), open(4, 2_400, paranoia, 400, 500),
		close(4, 2_900), wall, close(1, 4_000), close(2, 4_000), close(3, 4_100), close(5, 4_800),
	}
	move := func(guid, at uint32, ability, location string) replayField {
		return replayField{Actor: guid, TimeMs: at, Group: class(ability), Name: ptr("ReplicatedMovement"), Text: &location}
	}
	fields := []replayField{
		{Actor: 1, Group: class(replayWirePrimary), Name: ptr(replayWireMarkerOne), Raw: []byte{11}},
		{Actor: 1, Group: class(replayWirePrimary), Name: ptr(replayWireMarkerTwo), Raw: []byte{22}},
		{Actor: 2, Group: class(replayWireSecondary), Name: ptr(replayWireMarkerOne), Raw: []byte{22}},
		{Actor: 2, Group: class(replayWireSecondary), Name: ptr(replayWireMarkerTwo), Raw: []byte{11}},
		{Actor: 1, TimeMs: 3_850, Group: class(replayWirePrimary), Name: ptr("SetEnemyInTrap.PairedWire"), Raw: []byte{2, 0, 0}},
		move(3, 2_250, nanoswarm, `{"location":{"x":500,"y":550}}`),
		{Actor: 3, TimeMs: 2_300, Group: class(nanoswarm), Name: ptr("MulticastStopProjectile")},
		{Actor: 3, TimeMs: 3_800, Group: replayActivationComponent, Name: ptr("IsActivated"), Bool: ptr(true)},
		move(4, 2_500, paranoia, `{"location":{"x":600,"y":500}}`),
	}
	utility := replayDeployedUtility(actors, fields, nil, nil)
	if len(utility) != 4 {
		t.Fatalf("got %d effects, want a single wire, the landed device, the moving projectile and the wall", len(utility))
	}
	wire, placed, flying := utility[0], utility[1], utility[2]
	if wire.Anchor == nil || *wire.Anchor != (replayUtilityPoint{X: 100, Y: 600}) || wire.ActivationMs == nil || *wire.ActivationMs != 3_850 {
		t.Fatalf("wire = %+v", wire)
	}
	if placed.State != "placed" || placed.StartMs != 2_300 || placed.X != 500 || placed.Y != 550 || placed.ActivationMs == nil || *placed.ActivationMs != 3_800 {
		t.Fatalf("placed grenade = %+v", placed)
	}
	if len(flying.Path) != 1 || flying.Path[0].Ms != 2_500 || flying.Path[0].X != 600 {
		t.Fatalf("moving projectile = %+v", flying)
	}
	if wall := utility[3]; wall.Segment == nil || *wall.Segment != [2]replayUtilityPoint{{X: 530, Y: 500}, {X: 270, Y: 500}} {
		t.Fatalf("oriented wall = %+v", wall)
	}
}

func TestReplayIDPatternRejectsPaths(t *testing.T) {
	for _, id := range []string{"../x", "85a51a8d-9a60-4167-b4c7-3ab7933426b6/../x", "", "abc"} {
		if replayIDPattern.MatchString(id) {
			t.Fatalf("accepted %q", id)
		}
	}
	if !replayIDPattern.MatchString("85A51A8D-9a60-4167-b4c7-3ab7933426b6") {
		t.Fatal("rejected a match id")
	}
}
