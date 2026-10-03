const KEY = 'watchly-recent-rooms';
export function readRecentRooms(storage) {
    try { const value = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.filter(room => /^[A-Z0-9]{7}$/.test(room.code) && Number.isFinite(room.visitedAt)).slice(0, 10) : []; } catch { return []; }
}
export function rememberRoom(storage, code, now = Date.now()) {
    if (!/^[A-Z0-9]{7}$/.test(code)) return;
    try { storage.setItem(KEY, JSON.stringify([{ code, visitedAt: now }, ...readRecentRooms(storage).filter(room => room.code !== code)].slice(0, 10))); } catch { /* Local history is optional. */ }
}
