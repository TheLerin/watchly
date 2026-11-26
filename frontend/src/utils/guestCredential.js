export function guestCredential(storage = globalThis.sessionStorage) {
    try {
        const previous = storage.getItem('watchlyGuestCredential');
        if (/^[a-f0-9]{64}$/.test(previous || '')) return previous;
        const value = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        storage.setItem('watchlyGuestCredential', value); return value;
    } catch { return null; }
}
