/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createSoundEffects, DEFAULT_SOUND_SETTINGS, readSoundSettings, SOUND_SETTINGS_KEY } from '../utils/soundEffects';

const SoundEffectsContext = createContext(null);
export const useSoundEffects = () => useContext(SoundEffectsContext);

export function SoundEffectsProvider({ children }) {
    const [settings, setSettings] = useState(() => { try { return readSoundSettings(localStorage); } catch { return { ...DEFAULT_SOUND_SETTINGS }; } });
    const [engine] = useState(() => createSoundEffects({ settings }));
    useEffect(() => {
        engine.preload();
        const unlock = event => { if (event.isTrusted) engine.unlock(); };
        const storage = event => { if (event.key === SOUND_SETTINGS_KEY || event.key === null) { try { setSettings(engine.configure(readSoundSettings(localStorage))); } catch { /* Storage may be blocked. */ } } };
        document.addEventListener('pointerdown', unlock, true); document.addEventListener('pointerup', unlock, true); document.addEventListener('keydown', unlock, true);
        window.addEventListener('storage', storage);
        return () => { document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('pointerup', unlock, true); document.removeEventListener('keydown', unlock, true); window.removeEventListener('storage', storage); engine.dispose(); };
    }, [engine]);
    const updateSoundSettings = useCallback(patch => {
        const next = engine.configure({ ...engine.getSettings(), ...patch }); setSettings(next);
        try { localStorage.setItem(SOUND_SETTINGS_KEY, JSON.stringify(next)); } catch { /* Keep in-memory preferences when storage is unavailable. */ }
    }, [engine]);
    const playSound = useCallback(name => engine.play(name), [engine]);
    return <SoundEffectsContext.Provider value={{ settings, updateSoundSettings, playSound }}>{children}</SoundEffectsContext.Provider>;
}
