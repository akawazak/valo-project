package accounts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetRawDistinguishesMissingAndSavedEmptyAccounts(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	got, err := GetRaw()
	if err != nil || got != nil {
		t.Fatalf("missing accounts = %q, %v; want nil, nil", got, err)
	}
	if err := SaveRaw([]byte("[]")); err != nil {
		t.Fatal(err)
	}
	got, err = GetRaw()
	if err != nil || string(got) != "[]" {
		t.Fatalf("saved empty accounts = %q, %v; want [], nil", got, err)
	}
}

func TestGetRawRejectsInvalidExistingAccountsWithoutChangingFile(t *testing.T) {
	config := t.TempDir()
	t.Setenv("APPDATA", config)
	t.Setenv("XDG_CONFIG_HOME", config)
	path, err := getPath()
	if err != nil {
		t.Fatal(err)
	}
	for _, data := range []string{"", " ", "invalid json", "[", "null", "{}", `{"accounts":[]}`} {
		t.Run(data, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := GetRaw(); err == nil {
				t.Fatalf("GetRaw accepted invalid existing accounts %q", data)
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != data {
				t.Fatalf("existing accounts changed: %q, %v; want %q", got, err, data)
			}
		})
	}
}

func TestWriteFileAtomicallyReplacesCompleteAccountSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.json")
	if err := os.WriteFile(path, []byte(`[{"puuid":"old"}]`), 0600); err != nil {
		t.Fatal(err)
	}

	want := []byte(`[{"puuid":"new","ssid":"ssid=value"}]`)
	if err := writeFileAtomically(path, want); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("got %q, want %q", got, want)
	}

	matches, err := filepath.Glob(filepath.Join(filepath.Dir(path), "accounts-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary account files were not cleaned up: %v", matches)
	}
}

func TestStripSecretsPreservesAccountMetadata(t *testing.T) {
	got, err := stripSecrets([]byte(`[{
		"puuid":"player",
		"accessToken":"access",
		"entitlementsToken":"entitlements",
		"ssid":"ssid=value",
		"favorite":true
	}]`))
	if err != nil {
		t.Fatal(err)
	}
	want := `[{"favorite":true,"puuid":"player"}]`
	if string(got) != want {
		t.Fatalf("got %s, want %s", got, want)
	}
}
