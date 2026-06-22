package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type RiotAccount struct {
	Puuid             string `json:"puuid"`
	AccessToken       string `json:"accessToken"`
	EntitlementsToken string `json:"entitlementsToken"`
	Region            string `json:"region"`
	GameName          string `json:"gameName"`
	TagLine           string `json:"tagLine"`
}

type NameResponse struct {
	Subject  string `json:"Subject"`
	GameName string `json:"GameName"`
	TagLine  string `json:"TagLine"`
}

const clientPlatform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"

func getClientVersion() string {
	resp, err := http.Get("https://valorant-api.com/v1/version")
	if err != nil {
		return "release-08.10-shipping-23-2512128"
	}
	defer resp.Body.Close()
	var result struct {
		Data struct {
			RiotClientVersion string `json:"riotClientVersion"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "release-08.10-shipping-23-2512128"
	}
	return result.Data.RiotClientVersion
}

func shardForRegion(region string) string {
	switch strings.ToLower(region) {
	case "na", "latam", "br":
		return "na"
	case "eu":
		return "eu"
	case "ap":
		return "ap"
	case "kr":
		return "kr"
	default:
		return "na"
	}
}

func main() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("Failed to get config dir: %v", err)
	}

	accountsPath := filepath.Join(configDir, "valovault", "accounts", "accounts.json")
	dbPath := filepath.Join(configDir, "valovault", "valovault", "tracking.db")

	fmt.Printf("Reading accounts from: %s\n", accountsPath)
	fmt.Printf("Opening database at: %s\n", dbPath)

	// Read accounts
	accData, err := os.ReadFile(accountsPath)
	if err != nil {
		log.Fatalf("Failed to read accounts.json: %v", err)
	}

	var accounts []RiotAccount
	if err := json.Unmarshal(accData, &accounts); err != nil {
		log.Fatalf("Failed to parse accounts.json: %v", err)
	}

	if len(accounts) == 0 {
		log.Fatalf("No accounts found in accounts.json")
	}

	fmt.Printf("Found %d account(s).\n", len(accounts))

	// Open DB
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open DB: %v", err)
	}
	defer db.Close()

	// Get empty player count
	var emptyCount int
	err = db.QueryRow("SELECT COUNT(*) FROM match_players WHERE gameName = '' OR gameName IS NULL").Scan(&emptyCount)
	if err != nil {
		log.Fatalf("Failed to count empty names: %v", err)
	}

	fmt.Printf("Total players with empty names in DB: %d\n", emptyCount)
	if emptyCount == 0 {
		fmt.Println("All player names are already resolved!")
		return
	}

	clientVersion := getClientVersion()
	fmt.Printf("Using Riot Client Version: %s\n", clientVersion)

	client := &http.Client{Timeout: 30 * time.Second}
	resolvedCount := 0

	// Find an account that has valid credentials
	var activeAcc *RiotAccount
	for i, a := range accounts {
		if a.AccessToken == "" || a.EntitlementsToken == "" {
			continue
		}
		// Test this account on a single puuid first
		fmt.Printf("[%d/%d] Testing account %s#%s (%s)...\n", i+1, len(accounts), a.GameName, a.TagLine, a.Puuid)
		
		shard := shardForRegion(a.Region)
		nameURL := fmt.Sprintf("https://pd.%s.a.pvp.net/name-service/v2/players", shard)
		reqBody, _ := json.Marshal([]string{a.Puuid})
		
		req, err := http.NewRequest("PUT", nameURL, bytes.NewBuffer(reqBody))
		if err != nil {
			continue
		}
		req.Header.Set("Authorization", "Bearer "+a.AccessToken)
		req.Header.Set("X-Riot-Entitlements-JWT", a.EntitlementsToken)
		req.Header.Set("X-Riot-ClientPlatform", clientPlatform)
		req.Header.Set("X-Riot-ClientVersion", clientVersion)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("  -> Connection error: %v\n", err)
			continue
		}
		
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			fmt.Printf("  -> Success! Account credentials are valid.\n")
			activeAcc = &accounts[i]
			break
		} else {
			fmt.Printf("  -> Status %d: %s\n", resp.StatusCode, strings.TrimSpace(string(body)))
		}
	}

	if activeAcc == nil {
		log.Fatalf("None of the %d accounts have valid/active Riot Client tokens. Please open Valorant or reconnect your account in the UI.", len(accounts))
	}

	fmt.Printf("\nStarting resolution using account: %s#%s\n", activeAcc.GameName, activeAcc.TagLine)

	for {
		// Fetch next batch of 100 missing subjects
		rows, err := db.Query("SELECT DISTINCT subject FROM match_players WHERE gameName = '' OR gameName IS NULL LIMIT 100")
		if err != nil {
			log.Fatalf("DB query failed: %v", err)
		}

		var subjects []string
		for rows.Next() {
			var sub string
			if err := rows.Scan(&sub); err == nil && sub != "" {
				subjects = append(subjects, sub)
			}
		}
		rows.Close()

		if len(subjects) == 0 {
			break
		}

		fmt.Printf("Resolving batch of %d players...\n", len(subjects))

		shard := shardForRegion(activeAcc.Region)
		nameURL := fmt.Sprintf("https://pd.%s.a.pvp.net/name-service/v2/players", shard)

		reqBody, _ := json.Marshal(subjects)
		req, err := http.NewRequest("PUT", nameURL, bytes.NewBuffer(reqBody))
		if err != nil {
			log.Fatalf("Failed to create request: %v", err)
		}

		req.Header.Set("Authorization", "Bearer "+activeAcc.AccessToken)
		req.Header.Set("X-Riot-Entitlements-JWT", activeAcc.EntitlementsToken)
		req.Header.Set("X-Riot-ClientPlatform", clientPlatform)
		req.Header.Set("X-Riot-ClientVersion", clientVersion)
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			log.Fatalf("HTTP request failed: %v", err)
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Fatalf("Failed to read response body: %v", err)
		}

		if resp.StatusCode != http.StatusOK {
			log.Fatalf("Riot API returned status %d: %s", resp.StatusCode, string(body))
		}

		var nameResp []NameResponse
		if err := json.Unmarshal(body, &nameResp); err != nil {
			log.Fatalf("Failed to unmarshal response: %v", err)
		}

		// Update database
		tx, err := db.Begin()
		if err != nil {
			log.Fatalf("Failed to begin transaction: %v", err)
		}

		stmt, err := tx.Prepare("UPDATE match_players SET gameName = ?, tagLine = ? WHERE subject = ?")
		if err != nil {
			tx.Rollback()
			log.Fatalf("Failed to prepare statement: %v", err)
		}

		for _, r := range nameResp {
			_, err = stmt.Exec(r.GameName, r.TagLine, strings.ToLower(r.Subject))
			if err != nil {
				fmt.Printf("Failed to update player %s: %v\n", r.Subject, err)
			} else {
				resolvedCount++
			}
		}

		stmt.Close()
		if err := tx.Commit(); err != nil {
			log.Fatalf("Failed to commit transaction: %v", err)
		}

		fmt.Printf("Successfully updated %d names in this batch.\n", len(nameResp))
		time.Sleep(100 * time.Millisecond) // brief pause between requests
	}

	fmt.Printf("\nDone! Resolved a total of %d player usernames in the local database.\n", resolvedCount)
}
