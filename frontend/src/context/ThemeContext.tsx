"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';
type AccentTheme = 'valorant' | 'aqua' | 'violet' | 'gold';

type ThemeContextType = {
    theme: Theme;
    accentTheme: AccentTheme;
    toggleTheme: () => void;
    setAccentTheme: (accent: AccentTheme) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredTheme(): Theme {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem('theme');
    return stored === 'light' ? 'light' : 'dark';
}

function readStoredAccent(): AccentTheme {
    if (typeof window === 'undefined') return 'valorant';
    const stored = localStorage.getItem('accent_theme');
    return stored === 'aqua' || stored === 'violet' || stored === 'gold' ? stored : 'valorant';
}

function applyTheme(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('theme', theme);
}

function applyAccent(accentTheme: AccentTheme) {
    document.documentElement.setAttribute('data-accent', accentTheme);
    localStorage.setItem('accent_theme', accentTheme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(readStoredTheme);
    const [accentTheme, setAccentThemeState] = useState<AccentTheme>(readStoredAccent);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        applyAccent(accentTheme);
    }, [accentTheme]);

    const toggleTheme = () => {
        setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
    };

    const setAccentTheme = (accent: AccentTheme) => {
        setAccentThemeState(accent);
    };

    return (
        <ThemeContext.Provider value={{ theme, accentTheme, toggleTheme, setAccentTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
