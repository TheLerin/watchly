import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }) => {
    // Determine initial theme from localStorage or default to 'dark'
    const [theme, setTheme] = useState(() => {
        const savedTheme = localStorage.getItem('watchsync-theme');
        return savedTheme || 'dark'; // 'dark', 'light', 'amoled'
    });

    // Apply theme classes to the document body
    useEffect(() => {
        const root = document.documentElement;

        // Remove old theme classes
        root.classList.remove('theme-dark', 'theme-light', 'theme-amoled');

        // Add current theme class
        root.classList.add(`theme-${theme}`);

        // Save to localStorage
        localStorage.setItem('watchsync-theme', theme);

        // Apply CSS variables based on theme
        if (theme === 'light') {
            root.style.setProperty('--bg-color', '#ffffff');
            root.style.setProperty('--text-color', '#121212');
            root.style.setProperty('--panel-bg', 'rgba(240, 240, 240, 0.8)');
            root.style.setProperty('--border-color', 'rgba(0, 0, 0, 0.1)');
        } else if (theme === 'amoled') {
            root.style.setProperty('--bg-color', '#000000');
            root.style.setProperty('--text-color', '#ececec');
            root.style.setProperty('--panel-bg', 'rgba(10, 10, 10, 0.9)');
            root.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.05)');
        } else {
            // Default dark (zinc-950)
            root.style.setProperty('--bg-color', '#09090b');
            root.style.setProperty('--text-color', '#f4f4f5');
            root.style.setProperty('--panel-bg', 'rgba(24, 24, 27, 0.5)'); // zinc-900/50
            root.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.1)');
        }

    }, [theme]);

    const value = {
        theme,
        setTheme
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
};
