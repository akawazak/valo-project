//go:build windows

package accounts

import (
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

func replaceFile(from, to string) error {
	// MoveFileEx replaces an existing destination on Windows. Retry briefly
	// because antivirus/indexers can hold a newly changed config file open.
	var err error
	for attempt := 0; attempt < 8; attempt++ {
		err = windows.Rename(from, to)
		if err == nil {
			return nil
		}
		if !errors.Is(err, windows.ERROR_ACCESS_DENIED) && !errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return err
		}
		if info, statErr := os.Stat(to); statErr == nil && info.Mode().Perm()&0o200 == 0 {
			_ = os.Chmod(to, 0o600)
		}
		time.Sleep(time.Duration(attempt+1) * 25 * time.Millisecond)
	}
	return err
}
