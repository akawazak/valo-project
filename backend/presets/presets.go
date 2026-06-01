package presets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/truearken/valclient/valclient"
)

type IdentityV1 struct {
	PlayerCardID  string `json:"playerCardId"`
	PlayerTitleID string `json:"playerTitleId"`
}

type SpraySlotV1 struct {
	EquipSlotID string `json:"equipSlotId"`
	SprayID     string `json:"sprayId"`
}

type PresetV1 struct {
	Uuid       string                   `json:"uuid"`
	ParentUuid string                   `json:"parentUuid"`
	Disabled   bool                     `json:"disabled"`
	Name       string                   `json:"name"`
	Loadout    map[string]LoadoutItemV1 `json:"loadout"`
	Agents     []string                 `json:"agents"`
	Identity   *IdentityV1              `json:"identity,omitempty"`
	Sprays     []SpraySlotV1            `json:"sprays,omitempty"`
}

type LoadoutItemV1 struct {
	SkinID       string `json:"skinId"`
	SkinLevelID  string `json:"skinLevelId"`
	ChromaID     string `json:"chromaId"`
	CharmID      string `json:"charmID,omitempty"`
	CharmLevelID string `json:"charmLevelID,omitempty"`
}

func Get() ([]*PresetV1, error) {
	data, err := GetRaw()
	if err != nil {
		return nil, err
	}

	presets := make([]*PresetV1, 0)
	if err := json.Unmarshal(data, &presets); err != nil {
		return nil, err
	}

	return presets, nil
}

func GetRaw() ([]byte, error) {
	path, err := getPath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	return data, nil
}

func SaveRaw(bytes []byte) error {
	path, err := getPath()
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, bytes, 0644); err != nil {
		return err
	}

	return nil
}

func Apply(val *valclient.ValClient, newLoadout map[string]LoadoutItemV1, identity *IdentityV1, sprays []SpraySlotV1) error {
	loadout, err := val.GetPlayerLoadout()
	if err != nil {
		return err
	}

	ownedBuddies, err := val.GetOwnedItems(valclient.ITEM_TYPE_GUN_BUDDIES)
	if err != nil {
		return err
	}

	usedInstances := map[*string]bool{}
	for _, gun := range loadout.Guns {
		item, ok := newLoadout[gun.ID]
		if !ok {
			continue
		}
		gun.SkinID = item.SkinID
		gun.SkinLevelID = item.SkinLevelID
		gun.ChromaID = item.ChromaID
		gun.CharmID = ""
		gun.CharmLevelID = ""
		gun.CharmInstanceID = ""

		for _, buddy := range ownedBuddies.Entitlements {
			if buddy.ItemID != item.CharmLevelID {
				continue
			}
			if _, used := usedInstances[buddy.InstanceID]; used {
				continue
			}
			gun.CharmID = item.CharmID
			gun.CharmLevelID = item.CharmLevelID
			gun.CharmInstanceID = *buddy.InstanceID

			usedInstances[buddy.InstanceID] = true
			break
		}
	}

	if identity != nil {
		if loadout.Identity == nil {
			loadout.Identity = &valclient.Identity{}
		}
		if identity.PlayerCardID != "" {
			loadout.Identity.PlayerCardID = identity.PlayerCardID
		}
		if identity.PlayerTitleID != "" {
			loadout.Identity.PlayerTitleID = identity.PlayerTitleID
		}
	}

	if len(sprays) > 0 {
		for _, sp := range sprays {
			if sp.SprayID == "" || sp.EquipSlotID == "" {
				continue
			}
			found := false
			for _, expr := range loadout.ActiveExpressions {
				if strings.EqualFold(expr.TypeID, sp.EquipSlotID) {
					expr.AssetID = sp.SprayID
					found = true
					break
				}
			}
			if !found {
				loadout.ActiveExpressions = append(loadout.ActiveExpressions, &valclient.ActiveExpressions{
					TypeID:  sp.EquipSlotID,
					AssetID: sp.SprayID,
				})
			}
		}
	}

	if _, err := val.SetPlayerLoadout(&valclient.SetPlayerLoadoutRequest{
		Guns:              loadout.Guns,
		ActiveExpressions: loadout.ActiveExpressions,
		Identity:          loadout.Identity,
		Incognito:         loadout.Incognito,
	}); err != nil {
		return err
	}

	return nil
}

func getPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	valovaultDir := filepath.Join(configDir, "valovault/presets")
	if err := os.MkdirAll(valovaultDir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(valovaultDir, "presets_v1.json"), nil
}

