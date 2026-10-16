package handlers

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// icoWith builds an icon directory whose entries are PNG (true) or bitmap
// (false) payloads of the given pixel sizes.
func icoWith(entries map[int]bool) []byte {
	var header, body bytes.Buffer
	header.Write([]byte{0, 0, 1, 0})
	_ = binary.Write(&header, binary.LittleEndian, uint16(len(entries)))
	offset := 6 + 16*len(entries)
	for _, size := range []int{16, 32, 64, 128, 256} {
		png, ok := entries[size]
		if !ok {
			continue
		}
		payload := []byte{'B', 'M', byte(size)}
		if png {
			payload = []byte{0x89, 'P', 'N', 'G', byte(size)}
		}
		dim := byte(size)
		if size == 256 {
			dim = 0
		}
		header.Write([]byte{dim, dim, 0, 0, 1, 0, 32, 0})
		_ = binary.Write(&header, binary.LittleEndian, uint32(len(payload)))
		_ = binary.Write(&header, binary.LittleEndian, uint32(offset))
		body.Write(payload)
		offset += len(payload)
	}
	return append(header.Bytes(), body.Bytes()...)
}

func TestIcoPNGPicksSmallestPNGAtLeastTarget(t *testing.T) {
	if got := icoPNG(icoWith(map[int]bool{16: true, 64: true, 256: true}), 64); got == nil || got[4] != 64 {
		t.Fatalf("got %v, want the 64px PNG", got)
	}
	if got := icoPNG(icoWith(map[int]bool{32: false, 128: true, 256: true}), 64); got == nil || got[4] != 128 {
		t.Fatalf("got %v, want the 128px PNG", got)
	}
	if got := icoPNG(icoWith(map[int]bool{16: true, 32: true}), 64); got == nil || got[4] != 32 {
		t.Fatalf("got %v, want the largest small PNG", got)
	}
	if got := icoPNG(icoWith(map[int]bool{32: false, 64: false}), 64); got != nil {
		t.Fatalf("bitmap-only icon returned %v", got)
	}
}

func TestLoadGameIconsFromRiotMetadata(t *testing.T) {
	icons := loadGameIcons(`C:\ProgramData\Riot Games\Metadata`)
	if len(icons) == 0 {
		t.Skip("Riot Client metadata not installed on this machine")
	}
	for key, icon := range icons {
		t.Logf("%s: %d bytes (%s)", key, len(icon), icon[:22])
	}
}
