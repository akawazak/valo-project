//go:build !windows

package accounts

import "os"

func replaceFile(from, to string) error {
	return os.Rename(from, to)
}
