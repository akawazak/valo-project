package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type RiotAccount struct {
	Puuid    string `json:"puuid"`
	GameName string `json:"gameName"`
	TagLine  string `json:"tagLine"`
}

func main() {
	configDir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("failed to get config dir: %v", err)
	}
	dbPath := filepath.Join(configDir, "valovault", "valovault", "tracking.db")
	fmt.Printf("Opening DB at %s\n", dbPath)

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("failed to open db: %v", err)
	}
	defer db.Close()

	// 1. Check unique isLocal players
	rows, err := db.Query("SELECT DISTINCT subject, gameName, tagLine FROM match_players WHERE isLocal = 1")
	if err == nil {
		fmt.Println("\nUnique isLocal players in match_players:")
		for rows.Next() {
			var subject, name, tag string
			if err := rows.Scan(&subject, &name, &tag); err == nil {
				fmt.Printf("PUUID: %s | Name: %s#%s\n", subject, name, tag)
			}
		}
		rows.Close()
	}

	// 2. Check unique accountPuuid in matches
	rows, err = db.Query("SELECT DISTINCT accountPuuid FROM matches")
	if err == nil {
		fmt.Println("\nUnique accountPuuid in matches:")
		for rows.Next() {
			var apuid string
			if err := rows.Scan(&apuid); err == nil {
				fmt.Printf("PUUID: %s\n", apuid)
			}
		}
		rows.Close()
	}

	// 3. Print accounts.json accounts
	accountsPath := filepath.Join(configDir, "valovault", "accounts", "accounts.json")
	accData, err := ioutil.ReadFile(accountsPath)
	if err == nil {
		var accounts []RiotAccount
		if err := json.Unmarshal(accData, &accounts); err == nil {
			fmt.Println("\nAccounts in accounts.json:")
			for _, acc := range accounts {
				fmt.Printf("PUUID: %s | Name: %s#%s\n", acc.Puuid, acc.GameName, acc.TagLine)
			}
		}
	}
}
