export const CONSENT_KEY = 'watchly-consent-v1';
export const CONSENT_MAX_AGE = 180 * 24 * 60 * 60 * 1000;
export function readConsent(storage, now = Date.now()) {
    try {
        const value = JSON.parse(storage.getItem(CONSENT_KEY));
        if (value?.version === 1 && typeof value.externalMedia === 'boolean' && Number.isFinite(value.updatedAt) && value.updatedAt <= now && now - value.updatedAt < CONSENT_MAX_AGE) return value;
    } catch { /* Unavailable or invalid storage starts with optional media off. */ }
    return null;
}
export const consentChoice = (externalMedia, now = Date.now()) => ({ version: 1, externalMedia: externalMedia === true, updatedAt: now });
