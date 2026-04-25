import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();
export const useTheme = () => useContext(ThemeContext);

const THEME_VARS = {
    'glass-dark': {
        '--bg-base':            '#060612',
        '--bg-depth':           '#040410',
        '--orb-1-color':        'rgba(120,60,255,0.55)',
        '--orb-2-color':        'rgba(40,100,255,0.40)',
        '--orb-3-color':        'rgba(180,40,220,0.30)',
        '--orb-4-color':        'rgba(0,200,180,0.20)',
        '--glass-bg':           'rgba(255,255,255,0.07)',
        '--glass-bg-strong':    'rgba(255,255,255,0.12)',
        '--glass-hover':        'rgba(255,255,255,0.13)',
        '--glass-border':       'rgba(255,255,255,0.12)',
        '--glass-border-top':   'rgba(255,255,255,0.30)',
        '--glass-shadow':       '0 8px 32px rgba(0,0,0,0.50),0 2px 8px rgba(0,0,0,0.30)',
        '--glass-inner-shadow': 'inset 0 1px 0 rgba(255,255,255,0.18),inset 0 -1px 0 rgba(0,0,0,0.20)',
        '--blur':               '24px', '--saturate': '180%', '--noise-opacity': '0.035',
        '--text':               '#f2f2ff', '--text-sub': '#9090bb', '--text-muted': '#40405a',
        '--accent':             '#7c3aed', '--accent-2': '#4f46e5',
        '--accent-glow':        'rgba(124,58,237,0.45)', '--accent-soft': 'rgba(124,58,237,0.15)',
        '--accent-border':      'rgba(124,58,237,0.35)',
        '--bg-color':           '#060612', '--text-color': '#f2f2ff',
        '--panel-bg':           'rgba(255,255,255,0.07)', '--border-color': 'rgba(255,255,255,0.12)',
        '--glow-sm-purple':     '0 0 20px rgba(124,58,237,0.50)',
        '--glow-purple':        '0 0 40px rgba(124,58,237,0.40)',
    },
    'glass-light': {
        '--bg-base':            '#f0f0ff',
        '--bg-depth':           '#e8e8f8',
        '--orb-1-color':        'rgba(139,92,246,0.25)',
        '--orb-2-color':        'rgba(59,130,246,0.18)',
        '--orb-3-color':        'rgba(200,100,255,0.15)',
        '--orb-4-color':        'rgba(80,200,200,0.12)',
        '--glass-bg':           'rgba(255,255,255,0.55)',
        '--glass-bg-strong':    'rgba(255,255,255,0.75)',
        '--glass-hover':        'rgba(255,255,255,0.80)',
        '--glass-border':       'rgba(139,92,246,0.18)',
        '--glass-border-top':   'rgba(255,255,255,0.95)',
        '--glass-shadow':       '0 8px 32px rgba(99,102,241,0.14),0 2px 8px rgba(120,80,220,0.08)',
        '--glass-inner-shadow': 'inset 0 1px 0 rgba(255,255,255,0.90),inset 0 -1px 0 rgba(120,80,220,0.06)',
        '--blur':               '20px', '--saturate': '160%', '--noise-opacity': '0.020',
        '--text':               '#1a1040', '--text-sub': '#5040a0', '--text-muted': '#a090d0',
        '--accent':             '#7c3aed', '--accent-2': '#4f46e5',
        '--accent-glow':        'rgba(124,58,237,0.25)', '--accent-soft': 'rgba(124,58,237,0.10)',
        '--accent-border':      'rgba(124,58,237,0.30)',
        '--bg-color':           '#f0f0ff', '--text-color': '#1a1040',
        '--panel-bg':           'rgba(255,255,255,0.55)', '--border-color': 'rgba(139,92,246,0.18)',
        '--glow-sm-purple':     '0 0 16px rgba(124,58,237,0.30)',
        '--glow-purple':        '0 0 30px rgba(124,58,237,0.22)',
    },
    'midnight': {
        '--bg-base':            '#000005',
        '--bg-depth':           '#000000',
        '--orb-1-color':        'rgba(80,20,200,0.60)',
        '--orb-2-color':        'rgba(20,60,200,0.45)',
        '--orb-3-color':        'rgba(120,0,180,0.35)',
        '--orb-4-color':        'rgba(0,80,200,0.20)',
        '--glass-bg':           'rgba(255,255,255,0.03)',
        '--glass-bg-strong':    'rgba(255,255,255,0.07)',
        '--glass-hover':        'rgba(255,255,255,0.065)',
        '--glass-border':       'rgba(255,255,255,0.06)',
        '--glass-border-top':   'rgba(255,255,255,0.15)',
        '--glass-shadow':       '0 8px 40px rgba(0,0,0,0.80),0 2px 8px rgba(0,0,0,0.60)',
        '--glass-inner-shadow': 'inset 0 1px 0 rgba(255,255,255,0.08),inset 0 -1px 0 rgba(0,0,0,0.40)',
        '--blur':               '28px', '--saturate': '200%', '--noise-opacity': '0.045',
        '--text':               '#e8e8ff', '--text-sub': '#5a5a88', '--text-muted': '#28283a',
        '--accent':             '#7c3aed', '--accent-2': '#4f46e5',
        '--accent-glow':        'rgba(124,58,237,0.55)', '--accent-soft': 'rgba(124,58,237,0.12)',
        '--accent-border':      'rgba(124,58,237,0.40)',
        '--bg-color':           '#000005', '--text-color': '#e8e8ff',
        '--panel-bg':           'rgba(255,255,255,0.03)', '--border-color': 'rgba(255,255,255,0.06)',
        '--glow-sm-purple':     '0 0 24px rgba(124,58,237,0.60)',
        '--glow-purple':        '0 0 50px rgba(124,58,237,0.45)',
    },
    'aurora': {
        '--bg-base':            '#f8f4ff',
        '--bg-depth':           '#f0eaff',
        '--orb-1-color':        'rgba(100,200,255,0.35)',
        '--orb-2-color':        'rgba(150,80,255,0.28)',
        '--orb-3-color':        'rgba(50,230,200,0.25)',
        '--orb-4-color':        'rgba(255,120,150,0.20)',
        '--glass-bg':           'rgba(255,255,255,0.50)',
        '--glass-bg-strong':    'rgba(255,255,255,0.70)',
        '--glass-hover':        'rgba(255,255,255,0.75)',
        '--glass-border':       'rgba(100,150,255,0.20)',
        '--glass-border-top':   'rgba(255,255,255,0.90)',
        '--glass-shadow':       '0 8px 32px rgba(100,80,200,0.12),0 2px 8px rgba(80,120,200,0.08)',
        '--glass-inner-shadow': 'inset 0 1px 0 rgba(255,255,255,0.85),inset 0 -1px 0 rgba(80,120,200,0.05)',
        '--blur':               '18px', '--saturate': '150%', '--noise-opacity': '0.018',
        '--text':               '#1a103a', '--text-sub': '#5060a0', '--text-muted': '#9090c0',
        '--accent':             '#6d28d9', '--accent-2': '#4f46e5',
        '--accent-glow':        'rgba(109,40,217,0.25)', '--accent-soft': 'rgba(109,40,217,0.10)',
        '--accent-border':      'rgba(109,40,217,0.28)',
        '--bg-color':           '#f8f4ff', '--text-color': '#1a103a',
        '--panel-bg':           'rgba(255,255,255,0.50)', '--border-color': 'rgba(100,150,255,0.20)',
        '--glow-sm-purple':     '0 0 14px rgba(109,40,217,0.28)',
        '--glow-purple':        '0 0 28px rgba(109,40,217,0.20)',
    },
};

export const THEME_META = {
    'glass-dark':  { label: 'Dark Glass',   emoji: '🌙', orb: ['#7c3aed','#3b82f6'] },
    'glass-light': { label: 'Light Glass',  emoji: '☀️', orb: ['#a78bfa','#93c5fd'] },
    'midnight':    { label: 'Midnight',     emoji: '⭐', orb: ['#5014c8','#1e3fa0'] },
    'aurora':      { label: 'Aurora',       emoji: '🌈', orb: ['#64c8ff','#9650ff'] },
};

export const ThemeProvider = ({ children }) => {
    const [theme, setThemeState] = useState(() => {
        const s = localStorage.getItem('watchsync-theme');
        if (s === 'dark' || s === 'amoled') return 'glass-dark';
        if (s === 'light') return 'glass-light';
        return THEME_VARS[s] ? s : 'glass-dark';
    });

    const setTheme = (t) => {
        setThemeState(t);
        localStorage.setItem('watchsync-theme', t);
    };

    useEffect(() => {
        const root = document.documentElement;
        // Remove all theme classes
        ['glass-dark','glass-light','midnight','aurora','theme-dark','theme-light','theme-amoled',
         'theme-glass-dark','theme-glass-light','theme-midnight','theme-aurora']
            .forEach(c => root.classList.remove(c));
        // Apply new class
        root.classList.add(`theme-${theme}`);
        // Apply all CSS vars
        const vars = THEME_VARS[theme] || THEME_VARS['glass-dark'];
        Object.entries(vars).forEach(([p, v]) => root.style.setProperty(p, v));
    }, [theme]);

    const isDark = theme === 'glass-dark' || theme === 'midnight';

    return (
        <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
            {children}
        </ThemeContext.Provider>
    );
};
