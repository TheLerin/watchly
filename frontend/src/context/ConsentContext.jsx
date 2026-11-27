/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { CONSENT_KEY, readConsent, consentChoice } from '../utils/consent';
const Context = createContext(null);
export const useConsent = () => useContext(Context);
export function ConsentProvider({ children }) {
    const [choice, setChoice] = useState(() => { try { return readConsent(localStorage); } catch { return null; } });
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const allowed = useRef(choice?.externalMedia === true);
    const saveChoice = useCallback(externalMedia => {
        const next = consentChoice(externalMedia); allowed.current = next.externalMedia; setChoice(next); setPreferencesOpen(false);
        try { localStorage.setItem(CONSENT_KEY, JSON.stringify(next)); } catch { /* Keep the decision for this tab. */ }
    }, []);
    const canLoadExternalMedia = useCallback(() => allowed.current, []);
    useEffect(() => {
        const changed = event => {
            if (event.key !== CONSENT_KEY && event.key !== null) return;
            const next = readConsent(localStorage); allowed.current = next?.externalMedia === true; setChoice(next);
        };
        window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
    }, []);
    return <Context.Provider value={{ choice, externalMediaAllowed: choice?.externalMedia === true, canLoadExternalMedia,
        preferencesOpen, openPreferences: () => setPreferencesOpen(true), closePreferences: () => setPreferencesOpen(false), saveChoice }}>{children}</Context.Provider>;
}
