package main

import (
	"backend/tracking"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

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

	// Find all unique subjects
	rows, err := db.Query("SELECT DISTINCT subject FROM match_players")
	if err != nil {
		log.Fatalf("failed to query unique subjects: %v", err)
	}
	defer rows.Close()

	var subjects []string
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err == nil && sub != "" {
			subjects = append(subjects, sub)
		}
	}

	fmt.Printf("Recomputing aggregates for %d unique players...\n", len(subjects))

	count := 0
	for _, sub := range subjects {
		if err := tracking.RecomputeAggregates(db, sub); err != nil {
			fmt.Printf("Warning: failed to recompute aggregates for %s: %v\n", sub, err)
		} else {
			count++
		}
	}

	fmt.Printf("Successfully recomputed aggregates for %d/%d players.\n", count, len(subjects))
}
