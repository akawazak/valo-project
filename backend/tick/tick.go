package tick

import (
	"backend/presets"
	"backend/settings"
	"bytes"
	"encoding/json"
	"log/slog"
	"maps"
	"math/rand/v2"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/truearken/valclient/valclient"
)

const TICK_SPEED_SECONDS = 1

type Ticker struct {
	Val                  *valclient.ValClient
	stopCh               chan struct{}
	running              bool
	originalLoadout      *valclient.GetPlayerLoadoutRequest
	inactiveChecks       int
	OnProgressionChanged func()
	OnChatChanged        func()
	OnChatEvent          func(string, []byte)
	OnSocialChanged      func()
}

// Allow for temporary Riot API failures and the pregame-to-core-game handoff.
const inactiveChecksBeforeRestore = 8

type coreGamePlayer struct {
	MatchID string `json:"MatchID"`
}

func NewTicker(val *valclient.ValClient) *Ticker {
	return &Ticker{
		Val:     val,
		running: false,
		stopCh:  make(chan struct{}),
	}
}

func (t *Ticker) Start() {
	if t.running {
		return
	}

	slog.Info("ticker started")
	if snapshot, err := presets.LoadRestoreSnapshot(t.Val.Player.Uuid); err == nil {
		t.originalLoadout = snapshot
		slog.Info("recovered pending loadout restoration")
	} else if !os.IsNotExist(err) {
		slog.Error("unable to recover pending loadout restoration", "err", err)
	}

	ws, err := t.Val.GetLocalWebsocket()
	if err != nil {
		slog.Error("unable to get websocket", "err", err)
		return
	}
	defer ws.Close()

	if err := ws.SubscribeEvent("OnJsonApiEvent"); err != nil {
		slog.Error("unable to subscribe event", "err", err)
		return
	}

	events := make(chan *valclient.LocalWebsocketApiEvent)
	go func() {
		if err := ws.Read(events); err != nil {
			slog.Info("unable to read event", "err", err)
			return
		}
	}()

	t.stopCh = make(chan struct{})
	t.running = true

	fired := false
	phaseTicker := time.NewTicker(TICK_SPEED_SECONDS * time.Second)
	defer phaseTicker.Stop()
	for {
		select {
		case <-t.stopCh:
			t.restoreOriginalLoadout()
			return
		case <-phaseTicker.C:
			t.checkForMatchEnd()
		case event := <-events:
			if event.Payload.Data == nil {
				continue
			}

			dataBytes, err := json.Marshal(event.Payload.Data)
			if err != nil {
				slog.Error("error marshalling event payload", "err", err)
				continue
			}
			if t.OnProgressionChanged != nil && (bytes.Contains(dataBytes, []byte("daily-ticket")) || bytes.Contains(dataBytes, []byte("contracts")) || bytes.Contains(dataBytes, []byte("account-xp")) || bytes.Contains(dataBytes, []byte("match-details"))) {
				t.OnProgressionChanged()
			}
			chatURI := strings.ToLower(event.Payload.URI)
			if t.OnSocialChanged != nil && (strings.HasPrefix(chatURI, "/chat/v4/friends") || strings.HasPrefix(chatURI, "/chat/v4/presences") || strings.HasPrefix(chatURI, "/chat/v4/friendrequests")) {
				t.OnSocialChanged()
			}
			if strings.HasPrefix(chatURI, "/chat/") && (strings.Contains(chatURI, "/messages") || strings.Contains(chatURI, "/conversations")) {
				if t.OnChatChanged != nil {
					t.OnChatChanged()
				}
				if t.OnChatEvent != nil {
					t.OnChatEvent(event.Payload.URI, dataBytes)
				}
			}

			if !bytes.Contains(dataBytes, []byte("ares-pregame/pregame/v1/matches")) || fired {
				fired = false
				continue
			}

			fired = true

			match, err := t.Val.GetPreGameMatch()
			if err != nil {
				slog.Info("pregame over", "err", err)
				continue
			}

			slog.Info("pregame found")

			player, err := t.Val.GetPreGamePlayer()
			if err != nil {
				slog.Error("error when getting pre game player", "err", err)
				continue
			}

			agentUuid := ""
			locked := false
			for _, mp := range match.AllyTeam.Players {
				if mp.Subject != player.Subject {
					continue
				}
				if mp.CharacterSelectionState == valclient.CharacterSelectionStateLocked {
					locked = true
				}
				agentUuid = mp.CharacterID
				continue
			}

			if locked {
				continue
			}

			settings, err := settings.Get()
			if err != nil {
				slog.Error("error when getting settings", "err", err)
				continue
			}

			if !settings.AutoSelectAgent {
				continue
			}

			existingPresets, err := presets.GetForOwner(t.Val.Player.Uuid)
			if err != nil {
				slog.Error("error when getting presets", "err", err)
				continue
			}

			matchingPresets := make([]*presets.PresetV1, 0)
			for _, preset := range existingPresets {
				for _, agent := range preset.Agents {
					if agent == agentUuid {
						matchingPresets = append(matchingPresets, preset)
					}
				}
			}

			presetAmount := len(matchingPresets)
			if presetAmount == 0 {
				continue
			}
			slog.Info("found presets for agent", "amount", presetAmount)

			selectedPreset := matchingPresets[rand.IntN(presetAmount)]

			variants := make([]*presets.PresetV1, 0)
			if !selectedPreset.Disabled {
				variants = append(variants, selectedPreset)
			}

			for _, variant := range existingPresets {
				if variant.Disabled {
					continue
				}
				if variant.ParentUuid != selectedPreset.Uuid {
					continue
				}
				variants = append(variants, variant)
			}

			variantAmount := len(variants)

			if variantAmount == 0 {
				continue
			}

			slog.Info("found active variants for preset", "amount", variantAmount, "preset", selectedPreset.Name, "uuid", selectedPreset.Uuid)

			selectedVariant := variants[rand.IntN(variantAmount)]
			// Do not mutate the stored base preset while combining a variant.
			// Mutating it made later automatic selections inherit a previous
			// variant's guns instead of returning cleanly to the saved preset.
			loadout := maps.Clone(selectedPreset.Loadout)
			maps.Copy(loadout, selectedVariant.Loadout)

			var identity *presets.IdentityV1
			if selectedVariant.Identity != nil {
				identity = selectedVariant.Identity
			} else if selectedPreset.Identity != nil {
				identity = selectedPreset.Identity
			}

			var sprays []presets.SpraySlotV1
			if len(selectedVariant.Sprays) > 0 {
				sprays = selectedVariant.Sprays
			} else if len(selectedPreset.Sprays) > 0 {
				sprays = selectedPreset.Sprays
			}

			expressions := append([]presets.ExpressionSlotV1{}, selectedPreset.Expressions...)
			expressions = append(expressions, selectedPreset.Flexes...)
			if len(selectedVariant.Expressions) > 0 || len(selectedVariant.Flexes) > 0 {
				expressions = append([]presets.ExpressionSlotV1{}, selectedVariant.Expressions...)
				expressions = append(expressions, selectedVariant.Flexes...)
			}

			originalLoadout, err := t.Val.GetPlayerLoadout()
			if err != nil {
				slog.Error("error when saving original loadout", "err", err)
				continue
			}
			if t.originalLoadout == nil {
				if err := presets.SaveRestoreSnapshot(t.Val.Player.Uuid, originalLoadout); err != nil {
					slog.Error("error when persisting original loadout", "err", err)
					continue
				}
			}

			if err := presets.Apply(t.Val, loadout, identity, sprays, expressions); err != nil {
				slog.Error("error when applying", "err", err)
				if t.originalLoadout == nil {
					_ = presets.ClearRestoreSnapshot(t.Val.Player.Uuid)
				}
				continue
			}
			if t.originalLoadout == nil {
				t.originalLoadout = originalLoadout
			}
			t.inactiveChecks = 0

			slog.Info("applied preset with variant", "name", selectedPreset.Name, "uuid", selectedPreset.Uuid, "variant", selectedVariant.Name, "variantUuid", selectedVariant.Uuid)
		}
	}
}

func (t *Ticker) checkForMatchEnd() {
	if t.originalLoadout == nil {
		return
	}

	// Pregame disappears when the match starts, so only restore after both the
	// pregame and core-game endpoints agree the player is no longer in a match.
	active := false
	if _, err := t.Val.GetPreGamePlayer(); err == nil || t.inCoreGame() {
		active = true
	}
	if t.recordMatchActivity(active) {
		t.restoreOriginalLoadout()
	}
}

func (t *Ticker) recordMatchActivity(active bool) bool {
	if active {
		t.inactiveChecks = 0
		return false
	}
	t.inactiveChecks++
	return t.inactiveChecks >= inactiveChecksBeforeRestore
}

func (t *Ticker) inCoreGame() bool {
	player := new(coreGamePlayer)
	url := t.Val.BuildUrl("https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/players/{puuid}")
	if err := t.Val.RunRequest(http.MethodGet, url, nil, player); err != nil {
		return false
	}
	return player.MatchID != ""
}

func (t *Ticker) restoreOriginalLoadout() {
	if t.originalLoadout == nil {
		return
	}
	if err := presets.Restore(t.Val, t.originalLoadout); err != nil {
		slog.Error("error when restoring original loadout", "err", err)
		return
	}
	slog.Info("restored original loadout after match")
	if err := presets.ClearRestoreSnapshot(t.Val.Player.Uuid); err != nil {
		slog.Error("unable to clear restored loadout snapshot", "err", err)
	}
	t.originalLoadout = nil
	t.inactiveChecks = 0
}

func (t *Ticker) Stop() {
	if !t.running {
		return
	}
	close(t.stopCh)
	t.running = false
	slog.Info("ticker stopped")
}
