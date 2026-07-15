//go:build windows

package handlers

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

func protectChatData(plain, entropy []byte) ([]byte, error) {
	in := windows.DataBlob{Size: uint32(len(plain))}
	if len(plain) > 0 {
		in.Data = &plain[0]
	}
	extra := windows.DataBlob{Size: uint32(len(entropy))}
	if len(entropy) > 0 {
		extra.Data = &entropy[0]
	}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, &extra, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("protect chat data: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

func unprotectChatData(ciphertext, entropy []byte) ([]byte, error) {
	in := windows.DataBlob{Size: uint32(len(ciphertext))}
	if len(ciphertext) > 0 {
		in.Data = &ciphertext[0]
	}
	extra := windows.DataBlob{Size: uint32(len(entropy))}
	if len(entropy) > 0 {
		extra.Data = &entropy[0]
	}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, &extra, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("unprotect chat data: %w", err)
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}
