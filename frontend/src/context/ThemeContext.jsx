import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

export const THEME_META = {
    'glass-dark':  { label: 'Dark Glass',   emoji: '🌙', orb: ['#333','#111'] },
    'glass-light': { label: 'Light Glass',  emoji: '☀️', orb: ['#eee','#ccc'] },
};

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(() => {
        const s = localStorage.getItem('watchsync-theme');
        if (s === 'light' || s === 'glass-light') return 'glass-light';
        return 'glass-dark'; // default
    });

    const setTheme = (t) => {
        if (!THEME_META[t]) t = 'glass-dark';
        setThemeState(t);
        localStorage.setItem('watchsync-theme', t);
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
        <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
};
