"use client";

import { useEffect, useState, type CSSProperties } from "react";

/** The two player colours used by Duos and Compare: "you" and "the other player". */
export const PLAYER_PALETTES = [
    { id: "mint", name: "Mint and violet", you: "#34e3b8", them: "#a47bff" },
    { id: "lime", name: "Lime and indigo", you: "#c4f04a", them: "#7a7dff" },
    { id: "cyan", name: "Cyan and magenta", you: "#3fd8ff", them: "#e45cff" },
    { id: "gold", name: "Gold and blue", you: "#ffb547", them: "#4f8bff" },
] as const;

export type PlayerPaletteId = (typeof PLAYER_PALETTES)[number]["id"];

const STORAGE_KEY = "vantavault:player-colours";
const CHANGE_EVENT = "vantavault:player-colours";

function readPalette(): PlayerPaletteId {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (PLAYER_PALETTES.some((palette) => palette.id === saved)) return saved as PlayerPaletteId;
    } catch { /* Storage can be unavailable; fall back to the default. */ }
    return "mint";
}

/** The chosen palette, kept in sync across every open screen, plus the CSS variables to apply it. */
export function usePlayerColours() {
    const [id, setId] = useState<PlayerPaletteId>("mint");
    useEffect(() => {
        const sync = () => setId(readPalette());
        sync();
        window.addEventListener(CHANGE_EVENT, sync);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener(CHANGE_EVENT, sync);
            window.removeEventListener("storage", sync);
        };
    }, []);
    const palette = PLAYER_PALETTES.find((item) => item.id === id) ?? PLAYER_PALETTES[0];
    const choose = (next: PlayerPaletteId) => {
        try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Still applies for this session. */ }
        setId(next);
        window.dispatchEvent(new Event(CHANGE_EVENT));
    };
    return { palette, choose, style: { "--you": palette.you, "--them": palette.them } as CSSProperties };
}
