/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

export const THEME_META = {
    'glass-dark':  { label: 'Dark Glass',   emoji: '🌙', orb: ['#333','#111'] },
    'glass-light': { label: 'Light Glass',  emoji: '☀️', orb: ['#eee','#ccc'] },
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

const ROOM_APPEARANCE_STORAGE_KEY = 'watchly-room-appearance';

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(() => {
        const s = localStorage.getItem('watchly-theme');
        if (s === 'light' || s === 'glass-light') return 'glass-light';
        return 'glass-dark'; // default
    });

    const [roomAppearance, setRoomAppearanceState] = useState(() => {
        const savedAppearance = localStorage.getItem(ROOM_APPEARANCE_STORAGE_KEY);
        return ROOM_APPEARANCE_META[savedAppearance] ? savedAppearance : 'cinematic';
    });

    const setTheme = (t) => {
        if (!THEME_META[t]) t = 'glass-dark';
        setThemeState(t);
        localStorage.setItem('watchly-theme', t);
    };

    const setRoomAppearance = (appearance) => {
        const nextAppearance = ROOM_APPEARANCE_META[appearance] ? appearance : 'cinematic';
        setRoomAppearanceState(nextAppearance);
        localStorage.setItem(ROOM_APPEARANCE_STORAGE_KEY, nextAppearance);
    };

    useEffect(() => {
        const root = document.documentElement;
        // Clean up any old classes
        root.className = '';
        if (theme !== 'glass-dark') {
            root.classList.add(`theme-${theme}`);
        }
        // We removed JS injection of CSS variables; index.css handles them now via classes.
    }, [theme]);

    const isDark = theme === 'glass-dark';

    return (
        <ThemeContext.Provider value={{ theme, setTheme, isDark, roomAppearance, setRoomAppearance }}>
            {children}
        </ThemeContext.Provider>
    );
};
