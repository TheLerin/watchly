/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { APPEARANCE_STORAGE_KEY, CINEMA_DEFAULTS, DEFAULT_APPEARANCE, normalizeAppearance, readAppearance } from '../utils/appearanceSettings';

const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

export const THEME_META = {
    'glass-dark':  { label: 'Dark Glass',  orb: ['#333','#111'] },
    'glass-light': { label: 'Light Glass', orb: ['#eee','#ccc'] },
};

export const ROOM_APPEARANCE_META = {
    cinematic: {
        label: 'Cinematic',
        description: 'Immersive theater room',
    },
    classic: {
        label: 'Classic',
        description: 'Original dashboard room',
    },
};

export const ThemeProvider = ({ children }) => {
    const [appearanceSettings, setAppearanceSettings] = useState(() => readAppearance(localStorage));
    const theme = appearanceSettings.uiTheme;
    const roomAppearance = appearanceSettings.roomStyle;

    const updateAppearance = (patch) => {
        setAppearanceSettings(current => normalizeAppearance({ ...current, ...patch }));
    };

    const setTheme = (t) => {
        // Keep the legacy internal selection usable without exposing it as a UI theme.
        if (t === 'cinema-luxe') {
            updateAppearance({ roomStyle: 'cinematic', uiTheme: 'glass-dark', cinemaPreset: 'luxe', ...CINEMA_DEFAULTS.luxe });
        } else updateAppearance({ uiTheme: THEME_META[t] ? t : 'glass-dark' });
    };

    const setRoomAppearance = (appearance) => {
        updateAppearance({ roomStyle: ROOM_APPEARANCE_META[appearance] ? appearance : 'cinematic' });
    };

    const setCinemaPreset = (preset) => {
        if (CINEMA_DEFAULTS[preset]) updateAppearance({ cinemaPreset: preset, ...CINEMA_DEFAULTS[preset] });
    };

    const resetAppearance = () => setAppearanceSettings({ ...DEFAULT_APPEARANCE });

    useEffect(() => {
        try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearanceSettings)); }
        catch { /* Preferences still work for this session when storage is unavailable. */ }
    }, [appearanceSettings]);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('theme-glass-light', 'theme-cinema-luxe');
        root.classList.toggle('theme-glass-light', theme === 'glass-light');
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, roomAppearance, setRoomAppearance,
            appearanceSettings, updateAppearance, setCinemaPreset, resetAppearance }}>
            {children}
        </ThemeContext.Provider>
    );
};
