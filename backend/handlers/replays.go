//go:build !android

package handlers

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/parquet-go/parquet-go"
)

// Round replays come from the .vrf files VALORANT writes when a player presses
// "Download replay" on a match. The app only looks when asked (no folder
// watcher) and converts it with vrfkit (Apache-2.0) into a small per-round
// file (about 150 KB a match) that it keeps, so VALORANT clearing old replays
// after a patch does not lose it. The 10-80 MB original is not copied.

// Version 2: rounds start at the beginning of the buy phase instead of its last 5 seconds.
// Version 3: players who stand still at spawn are shown there before their first move.
// Version 4: what each player is holding.
// Version 5: deployed Omen smokes.
// Version 6: additional deployed utility and recorded teleport events.
const replayFormatVersion = 6

// replaySampleMs is the stored position step: 8 per second is smooth once the
// player interpolates, and keeps a whole match near one megabyte.
const replaySampleMs = 125

var replayIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type replayJob struct {
	status string // processing, failed
	err    string
}

var replayJobs = struct {
	sync.Mutex
	byID map[string]replayJob
}{byID: map[string]replayJob{}}

var replayConvertLock sync.Mutex

var replayCache = struct {
	sync.Mutex
	id   string
	data *ReplayFile
}{}

type ReplayListEntry struct {
	MatchID    string `json:"matchId"`
	SizeBytes  int64  `json:"sizeBytes"`
	ModifiedAt int64  `json:"modifiedAt"`
	InGame     bool   `json:"inGame"`
	Saved      bool   `json:"saved"`  // the converted replay is kept by the app
	Status     string `json:"status"` // new, processing, ready, failed
	Error      string `json:"error,omitempty"`
}

type ReplayListResponse struct {
	FolderFound bool              `json:"folderFound"`
	ParserReady bool              `json:"parserReady"`
	SavedBytes  int64             `json:"savedBytes"`
	Replays     []ReplayListEntry `json:"replays"`
}

type ReplayRound struct {
	Index   int             `json:"index"`
	BuyMs   int64           `json:"buyMs"`
	StartMs int64           `json:"startMs"`
	EndMs   int64           `json:"endMs"`
	FrameMs int64           `json:"frameMs"` // first frame, relative to StartMs (negative in the buy phase)
	Frames  int             `json:"frames"`  // samples per player
	Tracks  []ReplayTrack   `json:"tracks,omitempty"`
	Smokes  []ReplaySmoke   `json:"smokes,omitempty"`
	Utility []ReplayUtility `json:"utility,omitempty"`
}

// ReplaySmoke is a deployed Dark Cover zone, timed relative to the barrier drop.
type ReplaySmoke struct {
	Subject string  `json:"subject,omitempty"`
	StartMs int64   `json:"startMs"`
	EndMs   int64   `json:"endMs"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
}

// ReplayTrack holds one player's samples for a round: x, y in game units and
// yaw in degrees, flattened as [x0, y0, yaw0, x1, ...]. DeathMs is relative to
// the round start; -1 when the player survived.
type ReplayTrack struct {
	Subject string       `json:"subject"`
	Samples []int32      `json:"samples"`
	DeathMs int64        `json:"deathMs"`
	Held    []ReplayHeld `json:"held,omitempty"`
}

// ReplayHeld is what a player switched to in their hands, from Ms (relative to
// the round start): "gun:<weapon uuid>", "ability:<slot>", "melee", "spike" or "defuser".
type ReplayHeld struct {
	Ms   int64  `json:"ms"`
	Item string `json:"item"`
}

type ReplayFile struct {
	Version    int           `json:"version"`
	MatchID    string        `json:"matchId"`
	Build      string        `json:"build"`
	DurationMs int64         `json:"durationMs"`
	Subjects   []string      `json:"subjects"`
	Rounds     []ReplayRound `json:"rounds"`
}

func replayDemosDir() string {
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		return filepath.Join(localAppData, "VALORANT", "Saved", "Demos")
	}
	return ""
}

func replaySavedDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(configDir, "valovault", "replays")
	return dir, os.MkdirAll(dir, 0o755)
}

// replayParserPath finds vrfkit next to the backend: the installed name, or
// the target-triple name Tauri uses in development.
func replayParserPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	dir := filepath.Dir(exe)
	for _, name := range []string{"vrfkit.exe", "vrfkit-x86_64-pc-windows-msvc.exe"} {
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func (h *Handler) GetReplays(w http.ResponseWriter, r *http.Request) {
	saved, err := replaySavedDir()
	if err != nil {
		h.returnError(w, err)
		return
	}
	entries := map[string]*ReplayListEntry{}
	entry := func(id string) *ReplayListEntry {
		id = strings.ToLower(id)
		if entries[id] == nil {
			entries[id] = &ReplayListEntry{MatchID: id, Status: "new"}
		}
		return entries[id]
	}
	response := ReplayListResponse{ParserReady: replayParserPath() != "", Replays: []ReplayListEntry{}}
	if demos := replayDemosDir(); demos != "" {
		if files, err := os.ReadDir(demos); err == nil {
			response.FolderFound = true
			for _, file := range files {
				id, ok := strings.CutSuffix(file.Name(), ".vrf")
				if !ok || !replayIDPattern.MatchString(id) {
					continue
				}
				info, err := file.Info()
				if err != nil {
					continue
				}
				e := entry(id)
				e.InGame = true
				e.SizeBytes = info.Size()
				e.ModifiedAt = info.ModTime().UnixMilli()
			}
		}
	}
	if files, err := os.ReadDir(saved); err == nil {
		for _, file := range files {
			info, err := file.Info()
			if err != nil {
				continue
			}
			response.SavedBytes += info.Size()
			name := file.Name()
			if id, ok := strings.CutSuffix(name, ".json.gz"); ok && replayIDPattern.MatchString(id) {
				version := replayFileVersion(filepath.Join(saved, name))
				if version >= 4 && version <= replayFormatVersion {
					e := entry(id)
					e.Saved = true
					if version == replayFormatVersion || !e.InGame || !response.ParserReady {
						e.Status = "ready"
					}
					if e.ModifiedAt == 0 {
						e.ModifiedAt = info.ModTime().UnixMilli()
					}
				}
			}
		}
	}
	replayJobs.Lock()
	for id, job := range replayJobs.byID {
		if e, ok := entries[id]; ok && e.Status != "ready" {
			e.Status = job.status
			if e.Saved && job.status == "failed" {
				e.Status = "ready"
			}
			e.Error = job.err
			if e.Saved && job.status == "failed" {
				e.Status = "ready"
			}
		}
	}
	replayJobs.Unlock()
	for _, e := range entries {
		response.Replays = append(response.Replays, *e)
	}
	sort.Slice(response.Replays, func(i, j int) bool { return response.Replays[i].ModifiedAt > response.Replays[j].ModifiedAt })
	h.returnAny(w, response)
}

// replayFileVersion reads only the version field, so a stale conversion is
// redone after a format change.
func replayFileVersion(path string) int {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		return 0
	}
	defer reader.Close()
	var head struct {
		Version int `json:"version"`
	}
	if err := json.NewDecoder(reader).Decode(&head); err != nil {
		return 0
	}
	return head.Version
}

func (h *Handler) PostReplayImport(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(r.PathValue("matchId"))
	if !replayIDPattern.MatchString(id) {
		http.Error(w, `{"error":"invalid match id"}`, http.StatusBadRequest)
		return
	}
	parser := replayParserPath()
	if parser == "" {
		http.Error(w, `{"error":"the replay reader is not installed"}`, http.StatusServiceUnavailable)
		return
	}
	saved, err := replaySavedDir()
	if err != nil {
		h.returnError(w, err)
		return
	}
	replayJobs.Lock()
	if job, ok := replayJobs.byID[id]; ok && job.status == "processing" {
		replayJobs.Unlock()
		h.returnAny(w, map[string]string{"status": "processing"})
		return
	}
	replayJobs.byID[id] = replayJob{status: "processing"}
	replayJobs.Unlock()

	go func() {
		// One conversion at a time: each runs the parser over a 10-80 MB file.
		replayConvertLock.Lock()
		started := time.Now()
		err := importReplay(parser, saved, id)
		replayConvertLock.Unlock()
		replayJobs.Lock()
		defer replayJobs.Unlock()
		if err != nil {
			log.Printf("replay: import failed after %s: %v", time.Since(started).Round(time.Millisecond), err)
			replayJobs.byID[id] = replayJob{status: "failed", err: replayErrorMessage(err)}
			return
		}
		log.Printf("replay: imported in %s", time.Since(started).Round(time.Millisecond))
		delete(replayJobs.byID, id)
	}()
	h.returnAny(w, map[string]string{"status": "processing"})
}

var errReplayUnsupported = errors.New("unsupported replay build")

func replayErrorMessage(err error) string {
	switch {
	case errors.Is(err, errReplayUnsupported):
		return "This replay is from a VALORANT patch the replay reader does not know yet."
	case errors.Is(err, os.ErrNotExist):
		return "The replay file is gone. Download it again in VALORANT."
	default:
		return "The replay could not be read."
	}
}

func importReplay(parser, saved, id string) error {
	vrf := filepath.Join(replayDemosDir(), id+".vrf")
	if _, err := os.Stat(vrf); err != nil {
		return err
	}
	work, err := os.MkdirTemp("", "vv-replay-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	out := filepath.Join(work, "export")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	command := exec.CommandContext(ctx, parser, "export", vrf, "--out", out)
	hideReplayParserWindow(command)
	if output, err := command.CombinedOutput(); err != nil {
		text := strings.ToLower(string(output))
		if strings.Contains(text, "unsupported") || strings.Contains(text, "unknown build") || strings.Contains(text, "transform") {
			return errReplayUnsupported
		}
		return fmt.Errorf("parser exited: %w (%d bytes of output)", err, len(output))
	}
	replay, err := convertReplayExport(out, id)
	if err != nil {
		return err
	}
	replayCache.Lock()
	defer replayCache.Unlock()
	if err := writeReplayFile(filepath.Join(saved, id+".json.gz"), replay); err != nil {
		return err
	}
	if replayCache.id == id {
		replayCache.data = nil
	}
	return nil
}

func writeReplayFile(path string, replay *ReplayFile) error {
	temp := path + ".part"
	file, err := os.Create(temp)
	if err != nil {
		return err
	}
	writer := gzip.NewWriter(file)
	encodeErr := json.NewEncoder(writer).Encode(replay)
	closeErr := writer.Close()
	fileErr := file.Close()
	if err := errors.Join(encodeErr, closeErr, fileErr); err != nil {
		os.Remove(temp)
		return err
	}
	return os.Rename(temp, path)
}

type replayMove struct {
	TimeMs uint32  `parquet:"time_ms"`
	Guid   uint32  `parquet:"character_net_guid"`
	X      float32 `parquet:"pos_x"`
	Y      float32 `parquet:"pos_y"`
	Yaw    float32 `parquet:"yaw"`
}

type replayEvent struct {
	Group string  `parquet:"group"`
	Time1 *uint32 `parquet:"time1"`
	Word1 *uint32 `parquet:"word1"`
}

type replayField struct {
	TimeMs uint32  `parquet:"time_ms"`
	Actor  uint32  `parquet:"actor_net_guid"`
	Name   *string `parquet:"field_name"`
	Group  string  `parquet:"group_path"`
	I64    *int64  `parquet:"value_i64"`
}

type replayActor struct {
	Guid   uint32   `parquet:"actor_net_guid"`
	Class  *string  `parquet:"class_path"`
	TimeMs uint32   `parquet:"time_ms"`
	Event  string   `parquet:"event"`
	X      *float32 `parquet:"spawn_x"`
	Y      *float32 `parquet:"spawn_y"`
}

type replayHeldChange struct {
	at   int64
	item string
}

// replayGunFolders maps a gun's asset folder under /Game/Equippables/ to its
// weapon id in Riot's content (the same ids valorant-api.com serves).
var replayGunFolders = map[string]string{
	"guns/hvymachineguns/hmg":        "63e6c2b6-4a8e-869c-3d4c-e38355226584", // Odin
	"guns/hvymachineguns/lmg":        "55d8a0f4-4274-ca67-fe2c-06ab45efdf58", // Ares
	"guns/rifles/ak":                 "9c82e19d-4575-0200-1a81-3eacf00cf872", // Vandal
	"guns/rifles/battlerifle":        "8db0a1bf-4a50-832a-4566-faaaa6d250ca", // Warden
	"guns/rifles/burst":              "ae3de142-4d85-2547-dd26-4e90bed35cf7", // Bulldog
	"guns/rifles/carbine":            "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", // Phantom
	"guns/shotguns/autoshotgun":      "ec845bf4-4f79-ddda-a3da-0db3774b2794", // Judge
	"guns/shotguns/pumpshotgun":      "910be174-449b-c412-ab22-d0873436b21b", // Bucky
	"guns/sidearms/autopistol":       "44d4e95c-4157-0037-81b2-17841bf2e8e3", // Frenzy
	"guns/sidearms/basepistol":       "29a0cfab-485b-f5d5-779a-b59f85e204a8", // Classic
	"guns/sidearms/compact":          "410b2e0b-4ceb-1321-1727-20858f7f3477", // Bandit
	"guns/sidearms/luger":            "1baa85b4-4c70-1284-64bb-6481dfc3bb4e", // Ghost
	"guns/sidearms/revolver":         "e336c6b8-418d-9340-d77f-7a9e4cfe0702", // Sheriff
	"guns/sidearms/slim":             "42da8ccc-40d5-affc-beec-15aa47b42eda", // Shorty
	"guns/sniperrifles/boltsniper":   "a03b24d3-4319-996d-0f8c-94bbfba1dfc7", // Operator
	"guns/sniperrifles/dmr":          "4ade7faa-4cf1-8376-95ef-39884480959b", // Guardian
	"guns/sniperrifles/doublesniper": "5f0aaf7a-4289-3998-d5ff-eb9a5cf7ef5c", // Outlaw
	"guns/sniperrifles/leversniper":  "c4883e50-4494-202c-3ec3-6b8a9284f00b", // Marshal
	"guns/submachineguns/mp5":        "462080d1-4035-2937-7c09-27aa2a5c27a7", // Spectre
	"guns/submachineguns/vector":     "f7e1b454-4ad4-1063-ec0a-159e56b58941", // Stinger
}

var replayAbilitySlots = map[string]string{"q": "ability1", "e": "ability2", "4": "grenade", "c": "grenade", "x": "ultimate"}

// replayHeldItem names an equippable from its class path, or "" when it is
// not something worth showing (unarmed, passives, unknown classes).
func replayHeldItem(classPath string) string {
	path := strings.ToLower(classPath)
	switch {
	case strings.Contains(path, "/equippables/bomb/bomb_defuser"):
		return "defuser"
	case strings.Contains(path, "/equippables/bomb/"):
		return "spike"
	case strings.Contains(path, "melee"):
		return "melee"
	}
	if rest, ok := strings.CutPrefix(path, "/game/equippables/"); ok {
		if slash := strings.LastIndex(rest, "/"); slash > 0 {
			if id := replayGunFolders[rest[:slash]]; id != "" {
				return "gun:" + id
			}
		}
		return ""
	}
	// Agent abilities live under /Game/Characters/<Agent>/S0/Ability_<Q|E|4|X>/.
	if strings.HasPrefix(path, "/game/characters/") {
		if _, after, ok := strings.Cut(path, "/ability_"); ok {
			if slash := strings.Index(after, "/"); slash > 0 {
				if slot := replayAbilitySlots[after[:slash]]; slot != "" {
					return "ability:" + slot
				}
			}
		}
	}
	return ""
}

// readReplayRows streams a table in batches and keeps the rows it needs. The
// movement and fields tables run to hundreds of thousands of rows a match, and
// reading them whole took about half a gigabyte.
func readReplayRows[T any](path string, keep func(*T) bool) ([]T, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := parquet.NewGenericReader[T](file)
	defer reader.Close()
	var kept []T
	batch := make([]T, 4096)
	for {
		count, err := reader.Read(batch)
		for index := range batch[:count] {
			if keep(&batch[index]) {
				kept = append(kept, batch[index])
			}
		}
		if errors.Is(err, io.EOF) {
			return kept, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

const omenSmokeClass = "/Game/Characters/Wraith/S0/Ability_4/Zone_Wraith_4_Smoke.Zone_Wraith_4_Smoke_C"

// readReplayFields keeps phases, equipment, and the fields used for deployed utility.
func readReplayFields(path string) ([]replayField, error) {
	return readReplayRows(path, func(field *replayField) bool {
		if field.Name == nil {
			return false
		}
		switch *field.Name {
		case "Instigator":
			return field.I64 != nil && (field.Group == omenSmokeClass || replayUtilityClass(field.Group).Name != "")
		case "TeleporterUsed":
			return replayUtilityClass(field.Group).Kind == "teleport"
		case "MulticastSetPhase.NewPhase", "CurrentEquippable", "NewCurrentEquippable":
			return field.I64 != nil
		}
		return false
	})
}

// replayHeldBySubject reads AresInventory's current equippable on each player's
// character, in time order.
func replayHeldBySubject(actors []replayActor, fields []replayField, subjectByGuid map[uint32]string) map[string][]replayHeldChange {
	class := map[uint32]string{}
	for _, actor := range actors {
		if actor.Class != nil {
			class[actor.Guid] = *actor.Class
		}
	}
	held := map[string][]replayHeldChange{}
	for _, field := range fields {
		if field.Name == nil || field.I64 == nil {
			continue
		}
		if *field.Name != "CurrentEquippable" && *field.Name != "NewCurrentEquippable" {
			continue
		}
		subject := subjectByGuid[field.Actor]
		item := replayHeldItem(class[uint32(*field.I64)])
		if subject == "" || item == "" {
			continue
		}
		held[subject] = append(held[subject], replayHeldChange{at: int64(field.TimeMs), item: item})
	}
	for _, list := range held {
		sort.SliceStable(list, func(i, j int) bool { return list[i].at < list[j].at })
	}
	return held
}

// roundHeld is what a player held through one round window: what they had at
// its start, then each switch.
func roundHeld(list []replayHeldChange, from, to, startMs int64) []ReplayHeld {
	var out []ReplayHeld
	push := func(at int64, item string) {
		if len(out) > 0 && out[len(out)-1].Item == item {
			return
		}
		out = append(out, ReplayHeld{Ms: at - startMs, Item: item})
	}
	cursor := sort.Search(len(list), func(i int) bool { return list[i].at > from })
	if cursor > 0 {
		push(from, list[cursor-1].item)
	}
	for ; cursor < len(list) && list[cursor].at <= to; cursor++ {
		push(list[cursor].at, list[cursor].item)
	}
	return out
}

// replayOmenSmokes uses the zone actor, whose open event follows the traveling
// projectile. A replay that ends before the zone closes has no full interval.
func replayOmenSmokes(actors []replayActor, fields []replayField, subjectByGuid map[uint32]string) []ReplaySmoke {
	instigators := map[uint32]string{}
	for _, field := range fields {
		if field.Group == omenSmokeClass && field.Name != nil && *field.Name == "Instigator" && field.I64 != nil {
			if subject := subjectByGuid[uint32(*field.I64)]; subject != "" {
				instigators[field.Actor] = subject
			}
		}
	}
	open := map[uint32]ReplaySmoke{}
	var smokes []ReplaySmoke
	for _, actor := range actors {
		switch actor.Event {
		case "open":
			if actor.Class == nil || *actor.Class != omenSmokeClass || actor.X == nil || actor.Y == nil ||
				math.IsNaN(float64(*actor.X)) || math.IsNaN(float64(*actor.Y)) ||
				math.IsInf(float64(*actor.X), 0) || math.IsInf(float64(*actor.Y), 0) {
				continue
			}
			open[actor.Guid] = ReplaySmoke{Subject: instigators[actor.Guid], StartMs: int64(actor.TimeMs), X: *actor.X, Y: *actor.Y}
		case "close":
			if smoke, ok := open[actor.Guid]; ok {
				delete(open, actor.Guid)
				if smoke.EndMs = int64(actor.TimeMs); smoke.EndMs > smoke.StartMs {
					smokes = append(smokes, smoke)
				}
			}
		}
	}
	sort.SliceStable(smokes, func(i, j int) bool { return smokes[i].StartMs < smokes[j].StartMs })
	return smokes
}

type replayManifest struct {
	DurationMs int64  `json:"duration_ms"`
	Branch     string `json:"replay_build"`
	Players    []struct {
		Subject string   `json:"subject"`
		Guids   []uint32 `json:"character_net_guids"`
	} `json:"players"`
}

// convertReplayExport turns a vrfkit export into rounds of fixed-step tracks.
// Round phases come from MulticastSetPhase: 3 buy phase, 4 barrier down (Riot's
// round time 0), 5 round over, 2 reset for the next round.
func convertReplayExport(dir, id string) (*ReplayFile, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	var manifest replayManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	events, err := parquet.ReadFile[replayEvent](filepath.Join(dir, "events.parquet"))
	if err != nil {
		return nil, err
	}
	fields, err := readReplayFields(filepath.Join(dir, "fields.parquet"))
	if err != nil {
		return nil, err
	}

	subjectByGuid := map[uint32]string{}
	replay := &ReplayFile{Version: replayFormatVersion, MatchID: id, Build: manifest.Branch, DurationMs: manifest.DurationMs}
	for _, player := range manifest.Players {
		subject := strings.ToLower(player.Subject)
		replay.Subjects = append(replay.Subjects, subject)
		for _, guid := range player.Guids {
			subjectByGuid[guid] = subject
		}
	}
	movesBySubject := map[string][]replayMove{}
	if _, err := readReplayRows(filepath.Join(dir, "movement.parquet"), func(move *replayMove) bool {
		if subject := subjectByGuid[move.Guid]; subject != "" {
			movesBySubject[subject] = append(movesBySubject[subject], *move)
		}
		return false
	}); err != nil {
		return nil, err
	}
	for _, list := range movesBySubject {
		sort.SliceStable(list, func(i, j int) bool { return list[i].TimeMs < list[j].TimeMs })
	}
	// Older exports without an actors table can still supply player movement.
	actors, _ := parquet.ReadFile[replayActor](filepath.Join(dir, "actors.parquet"))
	heldBySubject := replayHeldBySubject(actors, fields, subjectByGuid)
	smokes := replayOmenSmokes(actors, fields, subjectByGuid)
	utility := replayDeployedUtility(actors, fields, subjectByGuid, movesBySubject)

	var rounds []ReplayRound
	for _, field := range fields {
		if field.Name == nil || *field.Name != "MulticastSetPhase.NewPhase" || field.I64 == nil {
			continue
		}
		at := int64(field.TimeMs)
		switch *field.I64 {
		case 3:
			rounds = append(rounds, ReplayRound{BuyMs: at, StartMs: -1, EndMs: -1})
		case 4:
			if len(rounds) == 0 {
				rounds = append(rounds, ReplayRound{BuyMs: -1, EndMs: -1})
			}
			if last := &rounds[len(rounds)-1]; last.StartMs < 0 || last.StartMs == 0 {
				last.StartMs = at
			}
		case 5:
			if len(rounds) > 0 && rounds[len(rounds)-1].EndMs < 0 {
				rounds[len(rounds)-1].EndMs = at
			}
		}
	}
	// A replay that starts mid buy phase has no phase 3 for the first round.
	played := rounds[:0]
	for _, round := range rounds {
		if round.StartMs <= 0 {
			continue
		}
		if round.BuyMs < 0 {
			round.BuyMs = max(0, round.StartMs-30_000)
		}
		if round.EndMs < 0 {
			round.EndMs = manifest.DurationMs
		}
		played = append(played, round)
	}
	if len(played) == 0 {
		return nil, errors.New("no rounds found")
	}

	deaths := map[string][]int64{}
	for _, event := range events {
		if event.Group == "characterDeath" && event.Time1 != nil && event.Word1 != nil {
			if subject := subjectByGuid[*event.Word1]; subject != "" {
				deaths[subject] = append(deaths[subject], int64(*event.Time1))
			}
		}
	}

	for index := range played {
		round := &played[index]
		round.Index = index
		// The whole buy phase, so the round plays from its very start, and a
		// few seconds after it ends.
		from := round.BuyMs
		to := round.EndMs + 3_000
		nextBuy := int64(math.MaxInt64)
		if index+1 < len(played) {
			nextBuy = played[index+1].BuyMs
			to = min(to, nextBuy)
		}
		round.FrameMs = from - round.StartMs
		round.Frames = int((to-from)/replaySampleMs) + 1
		lastFrame := from + int64(round.Frames-1)*replaySampleMs
		for _, smoke := range smokes {
			if smoke.StartMs >= from && smoke.StartMs <= lastFrame {
				smoke.StartMs -= round.StartMs
				smoke.EndMs -= round.StartMs
				round.Smokes = append(round.Smokes, smoke)
			}
		}
		for _, ability := range utility {
			if ability.StartMs >= from && ability.StartMs <= lastFrame && ability.StartMs < nextBuy {
				ability.StartMs -= round.StartMs
				if ability.EndMs != nil {
					end := *ability.EndMs - round.StartMs
					ability.EndMs = &end
				}
				round.Utility = append(round.Utility, ability)
			}
		}
		for _, subject := range replay.Subjects {
			list := movesBySubject[subject]
			deathMs := int64(-1)
			for _, at := range deaths[subject] {
				if at >= round.BuyMs && at <= to {
					deathMs = at - round.StartMs
					break
				}
			}
			track := ReplayTrack{Subject: subject, DeathMs: deathMs, Samples: make([]int32, 0, round.Frames*3), Held: roundHeld(heldBySubject[subject], from, to, round.StartMs)}
			cursor := sort.Search(len(list), func(i int) bool { return int64(list[i].TimeMs) >= round.BuyMs })
			var last *replayMove
			for frame := 0; frame < round.Frames; frame++ {
				at := from + int64(frame)*replaySampleMs
				for cursor < len(list) && int64(list[cursor].TimeMs) <= at {
					last = &list[cursor]
					cursor++
				}
				if last == nil {
					track.Samples = append(track.Samples, 0, 0, -1)
					continue
				}
				track.Samples = append(track.Samples, int32(last.X), int32(last.Y), int32(last.Yaw))
			}
			// The server only sends a player's movement once they move, so
			// before that they are still where they spawned: their first pose.
			fillLeadingUnknown(track.Samples)
			round.Tracks = append(round.Tracks, track)
		}
	}
	replay.Rounds = played
	return replay, nil
}

func fillLeadingUnknown(samples []int32) {
	first := -1
	for index := 2; index < len(samples); index += 3 {
		if samples[index] >= 0 {
			first = index - 2
			break
		}
	}
	for index := 0; first > 0 && index < first; index += 3 {
		copy(samples[index:index+3], samples[first:first+3])
	}
}

func loadReplay(id string) (*ReplayFile, error) {
	replayCache.Lock()
	defer replayCache.Unlock()
	if replayCache.id == id && replayCache.data != nil {
		return replayCache.data, nil
	}
	saved, err := replaySavedDir()
	if err != nil {
		return nil, err
	}
	file, err := os.Open(filepath.Join(saved, id+".json.gz"))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader, err := gzip.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	var replay ReplayFile
	if err := json.NewDecoder(reader).Decode(&replay); err != nil {
		return nil, err
	}
	replayCache.id, replayCache.data = id, &replay
	return &replay, nil
}

// GetReplay returns the round list, or one round's tracks with ?round=N.
func (h *Handler) GetReplay(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(r.PathValue("matchId"))
	if !replayIDPattern.MatchString(id) {
		http.Error(w, `{"error":"invalid match id"}`, http.StatusBadRequest)
		return
	}
	replay, err := loadReplay(id)
	if errors.Is(err, os.ErrNotExist) {
		http.Error(w, `{"error":"no replay saved for this match"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		h.returnError(w, err)
		return
	}
	if value := r.URL.Query().Get("round"); value != "" {
		index, err := strconv.Atoi(value)
		if err != nil || index < 0 || index >= len(replay.Rounds) {
			http.Error(w, `{"error":"invalid round"}`, http.StatusBadRequest)
			return
		}
		h.returnAny(w, replay.Rounds[index])
		return
	}
	summary := *replay
	summary.Rounds = make([]ReplayRound, len(replay.Rounds))
	for index, round := range replay.Rounds {
		round.Tracks = nil
		round.Smokes = nil
		round.Utility = nil
		summary.Rounds[index] = round
	}
	h.returnAny(w, summary)
}

func (h *Handler) DeleteReplay(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(r.PathValue("matchId"))
	if !replayIDPattern.MatchString(id) {
		http.Error(w, `{"error":"invalid match id"}`, http.StatusBadRequest)
		return
	}
	saved, err := replaySavedDir()
	if err != nil {
		h.returnError(w, err)
		return
	}
	for _, name := range []string{id + ".json.gz"} {
		if err := os.Remove(filepath.Join(saved, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			h.returnError(w, err)
			return
		}
	}
	replayCache.Lock()
	if replayCache.id == id {
		replayCache.id, replayCache.data = "", nil
	}
	replayCache.Unlock()
	h.returnAny(w, map[string]bool{"deleted": true})
}
