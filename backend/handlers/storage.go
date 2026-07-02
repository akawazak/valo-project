package handlers

import (
	"backend/tracking"
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
)

type StorageStatusResponse struct {
	MatchCacheBytes int64 `json:"matchCacheBytes"`
	LogBytes        int64 `json:"logBytes"`
	CachedMatches   int   `json:"cachedMatches"`
}

func (h *Handler) GetStorageStatus(w http.ResponseWriter, r *http.Request) {
	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, err)
		return
	}
	count, err := tracking.CountCachedMatches(db)
	if err != nil {
		h.returnError(w, err)
		return
	}
	h.returnAny(w, StorageStatusResponse{
		MatchCacheBytes: directorySize(filepath.Join(h.trackingAppDir, "valovault")),
		LogBytes:        directorySize(filepath.Join(h.trackingAppDir, "logs")),
		CachedMatches:   count,
	})
}

func (h *Handler) ClearStorage(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&request); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}
	if request.Target != "matches" {
		http.Error(w, `{"error":"unsupported storage target"}`, http.StatusBadRequest)
		return
	}
	db, err := h.trackingDB()
	if err != nil {
		h.returnError(w, err)
		return
	}
	if err := tracking.ClearMatchCache(db); err != nil {
		h.returnError(w, err)
		return
	}
	h.GetStorageStatus(w, r)
}

func directorySize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		if info, infoErr := os.Stat(path); infoErr == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}
