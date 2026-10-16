package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Riot Client keeps each installed game's official icon under
// %ProgramData%\Riot Games\Metadata\<product>.live\<product>.live.ico. The
// friends panel shows these next to friends playing other Riot games.
var gameIconProducts = map[string]string{
	"lol":      "league_of_legends",
	"tft":      "teamfighttactics",
	"valorant": "valorant",
	"lor":      "bacon",
	"2xko":     "lion",
}

var gameIconCache struct {
	sync.Once
	icons map[string]string
}

// GetGameIcons returns data URLs for the game icons available on this PC.
func (h *Handler) GetGameIcons(w http.ResponseWriter, r *http.Request) {
	gameIconCache.Do(func() {
		gameIconCache.icons = loadGameIcons(filepath.Join(os.Getenv("ProgramData"), "Riot Games", "Metadata"))
	})
	h.returnAny(w, map[string]any{"icons": gameIconCache.icons})
}

func loadGameIcons(root string) map[string]string {
	out := map[string]string{}
	if root == "" {
		return out
	}
	for key, product := range gameIconProducts {
		raw, err := os.ReadFile(filepath.Join(root, product+".live", product+".live.ico"))
		if err != nil {
			continue
		}
		encoded := icoPNG(raw, 64)
		if encoded == nil {
			encoded = icoBitmapPNG(raw, 64)
		}
		if encoded != nil {
			out[key] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(encoded)
		}
	}
	return out
}

// icoPNG returns the PNG-encoded entry closest to target pixels (preferring
// one at least that large), or nil when the icon holds only bitmap entries.
func icoPNG(raw []byte, target int) []byte {
	if len(raw) < 6 || binary.LittleEndian.Uint16(raw[2:4]) != 1 {
		return nil
	}
	count := int(binary.LittleEndian.Uint16(raw[4:6]))
	pngSig := []byte{0x89, 'P', 'N', 'G'}
	var best []byte
	bestSize := 0
	for i := 0; i < count; i++ {
		entry := 6 + i*16
		if entry+16 > len(raw) {
			break
		}
		size := int(raw[entry])
		if size == 0 {
			size = 256
		}
		length := int(binary.LittleEndian.Uint32(raw[entry+8 : entry+12]))
		offset := int(binary.LittleEndian.Uint32(raw[entry+12 : entry+16]))
		if offset < 0 || length <= 0 || offset+length > len(raw) || !bytes.HasPrefix(raw[offset:offset+length], pngSig) {
			continue
		}
		better := best == nil ||
			(size >= target && (bestSize < target || size < bestSize)) ||
			(size < target && bestSize < target && size > bestSize)
		if better {
			best, bestSize = raw[offset:offset+length], size
		}
	}
	return best
}

// icoBitmapPNG converts the 32-bit bitmap entry closest to target pixels into
// a PNG. League and TFT ship bitmap-only icons, which are far too large to
// send whole.
func icoBitmapPNG(raw []byte, target int) []byte {
	if len(raw) < 6 || binary.LittleEndian.Uint16(raw[2:4]) != 1 {
		return nil
	}
	count := int(binary.LittleEndian.Uint16(raw[4:6]))
	bestOffset, bestLength, bestSize := -1, 0, 0
	for i := 0; i < count; i++ {
		entry := 6 + i*16
		if entry+16 > len(raw) {
			break
		}
		size := int(raw[entry])
		if size == 0 {
			size = 256
		}
		length := int(binary.LittleEndian.Uint32(raw[entry+8 : entry+12]))
		offset := int(binary.LittleEndian.Uint32(raw[entry+12 : entry+16]))
		if offset < 0 || offset+40 > len(raw) || offset+length > len(raw) || binary.LittleEndian.Uint16(raw[offset+14:offset+16]) != 32 {
			continue
		}
		better := bestOffset < 0 ||
			(size >= target && (bestSize < target || size < bestSize)) ||
			(size < target && bestSize < target && size > bestSize)
		if better {
			bestOffset, bestLength, bestSize = offset, length, size
		}
	}
	if bestOffset < 0 {
		return nil
	}
	data := raw[bestOffset : bestOffset+bestLength]
	headerSize := int(binary.LittleEndian.Uint32(data[0:4]))
	width := int(int32(binary.LittleEndian.Uint32(data[4:8])))
	height := int(int32(binary.LittleEndian.Uint32(data[8:12]))) / 2 // XOR + AND masks
	pixels := headerSize
	if width <= 0 || height <= 0 || pixels+width*height*4 > len(data) {
		return nil
	}
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		row := pixels + (height-1-y)*width*4 // bottom-up rows
		for x := 0; x < width; x++ {
			p := row + x*4
			img.SetNRGBA(x, y, color.NRGBA{R: data[p+2], G: data[p+1], B: data[p], A: data[p+3]})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil
	}
	return buf.Bytes()
}
