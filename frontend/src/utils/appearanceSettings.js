export const APPEARANCE_STORAGE_KEY = 'watchly-appearance-settings';

export const CINEMA_PRESET_META = {
    luxe: { label: 'Luxe', description: 'Warm, immersive private cinema' },
    minimal: { label: 'Minimal', description: 'Pure black distraction-free theater' },
};

export const CINEMA_DEFAULTS = {
    luxe: {
        ambientLighting: true, roomBrightness: 35, aisleLights: true, sofa: true,
        wallDetails: true, autoHideControls: true, hideDelay: 3,
        dimWhilePlaying: true, screenExpansion: true, reduceMotion: false,
    },
    minimal: {
        ambientLighting: true, roomBrightness: 15, aisleLights: false, sofa: false,
        wallDetails: false, autoHideControls: true, hideDelay: 3,
        dimWhilePlaying: true, screenExpansion: true, reduceMotion: false,
    },
};

export const DEFAULT_APPEARANCE = {
    roomStyle: 'cinematic', uiTheme: 'glass-dark', cinemaPreset: 'luxe',
    ...CINEMA_DEFAULTS.luxe,
};

const uiTheme = value => ['light', 'light-glass', 'glass-light'].includes(value) ? 'glass-light' : 'glass-dark';

export function normalizeAppearance(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    const cinemaPreset = value.cinemaPreset === 'minimal' ? 'minimal' : 'luxe';
    const defaults = CINEMA_DEFAULTS[cinemaPreset];
    const result = {
        roomStyle: value.roomStyle === 'classic' ? 'classic' : 'cinematic',
        uiTheme: uiTheme(value.uiTheme), cinemaPreset, ...defaults,
    };
    for (const key of Object.keys(defaults)) {
        if (typeof defaults[key] === 'boolean' && typeof value[key] === 'boolean') result[key] = value[key];
    }
    if (typeof value.roomBrightness === 'number' && Number.isFinite(value.roomBrightness)) {
        result.roomBrightness = Math.round(Math.max(0, Math.min(100, value.roomBrightness)));
    }
    if ([2, 3, 5, 'never'].includes(value.hideDelay)) result.hideDelay = value.hideDelay;
    return result;
}

export function readAppearance(storage) {
    try {
        const saved = storage.getItem(APPEARANCE_STORAGE_KEY);
        if (saved) {
            const value = JSON.parse(saved);
            if (value && typeof value === 'object' && !Array.isArray(value)) return normalizeAppearance(value);
        }
    } catch { /* Recover from unavailable storage or malformed preferences. */ }
    try {
        const oldTheme = storage.getItem('watchly-theme');
        return normalizeAppearance({
            roomStyle: oldTheme === 'cinema-luxe' ? 'cinematic' : storage.getItem('watchly-room-appearance'),
            uiTheme: uiTheme(oldTheme), cinemaPreset: 'luxe',
        });
    } catch {
        return { ...DEFAULT_APPEARANCE };
    }
}

export function architecturalLight(brightness) {
    return brightness <= 35 ? 0.18 + brightness * 0.82 / 35 : 1 + (brightness - 35) * 0.75 / 65;
}
