"use client";

import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';
type AccentTheme = 'valorant' | 'aqua' | 'violet' | 'gold';
export type InterfaceTheme = 'default' | 'protocol' | 'cinematic';
export type AppearanceSettings = {
    backgroundId: string;
    backgroundUrl: string;
    backgroundName: string;
    strength: number;
    blur: number;
    saturation: number;
    panelOpacity: number;
    position: 'left' | 'center' | 'right';
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
    backgroundId: '',
    backgroundUrl: '',
    backgroundName: '',
    strength: 38,
    blur: 0,
    saturation: 90,
    panelOpacity: 82,
    position: 'center',
};

type ThemeContextType = {
    theme: Theme;
    accentTheme: AccentTheme;
    interfaceTheme: InterfaceTheme;
    appearance: AppearanceSettings;
    toggleTheme: () => void;
	setTheme: (theme: Theme) => void;
    setAccentTheme: (accent: AccentTheme) => void;
    setInterfaceTheme: (theme: InterfaceTheme) => void;
    setAppearance: (settings: Partial<AppearanceSettings>) => void;
    resetAppearance: () => void;
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

function readStoredInterfaceTheme(): InterfaceTheme {
    if (typeof window === 'undefined') return 'default';
    const stored = localStorage.getItem('interface_theme');
    if (stored === 'agents') return 'cinematic';
    return stored === 'protocol' || stored === 'cinematic' ? stored : 'default';
}

function readStoredAppearance(): AppearanceSettings {
    if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
    try {
        return { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem('appearance_settings') || '{}') };
    } catch {
        return DEFAULT_APPEARANCE;
    }
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

function applyInterfaceTheme(theme: InterfaceTheme) {
    document.documentElement.setAttribute('data-interface', theme);
    localStorage.setItem('interface_theme', theme);
}

function applyAppearance(settings: AppearanceSettings) {
    const root = document.documentElement;
    const allowedUrl = settings.backgroundUrl.startsWith('/themes/');
    root.toggleAttribute('data-custom-background', allowedUrl);
    root.style.setProperty('--custom-background-image', allowedUrl ? `url("${settings.backgroundUrl}")` : 'none');
    root.style.setProperty('--custom-background-strength', String(settings.strength / 100));
    root.style.setProperty('--custom-background-blur', `${settings.blur}px`);
    root.style.setProperty('--custom-background-saturation', `${settings.saturation}%`);
    root.style.setProperty('--custom-panel-opacity', `${settings.panelOpacity / 100}`);
    root.style.setProperty('--custom-background-position', settings.position);
    localStorage.setItem('appearance_settings', JSON.stringify(settings));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(readStoredTheme);
    const [accentTheme, setAccentThemeState] = useState<AccentTheme>(readStoredAccent);
    const [interfaceTheme, setInterfaceThemeState] = useState<InterfaceTheme>(readStoredInterfaceTheme);
    const [appearance, setAppearanceState] = useState<AppearanceSettings>(readStoredAppearance);

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        applyAccent(accentTheme);
    }, [accentTheme]);

    useEffect(() => {
        applyInterfaceTheme(interfaceTheme);
    }, [interfaceTheme]);

    useEffect(() => {
        applyAppearance(appearance);
    }, [appearance]);

    const toggleTheme = useCallback(() => {
        setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
    }, []);
	const setThemeValue = useCallback((nextTheme: Theme) => setTheme(nextTheme), []);

    const setAccentTheme = useCallback((accent: AccentTheme) => {
        setAccentThemeState(accent);
    }, []);

    const setInterfaceTheme = useCallback((nextTheme: InterfaceTheme) => {
        setInterfaceThemeState(nextTheme);
    }, []);

    const setAppearance = useCallback((settings: Partial<AppearanceSettings>) => {
        setAppearanceState((current) => ({ ...current, ...settings }));
    }, []);

	const resetAppearance = useCallback(() => setAppearanceState(DEFAULT_APPEARANCE), []);

    return (
		<ThemeContext.Provider value={{ theme, accentTheme, interfaceTheme, appearance, toggleTheme, setTheme: setThemeValue, setAccentTheme, setInterfaceTheme, setAppearance, resetAppearance }}>
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
