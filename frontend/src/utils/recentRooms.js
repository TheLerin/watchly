import { normalizeRoomName } from '../../../shared/room-name.mjs';

const KEY = 'watchly-recent-rooms';
const entry = (code, visitedAt, name) => ({ code, visitedAt, ...(normalizeRoomName(name) ? { name: normalizeRoomName(name) } : {}) });
export function readRecentRooms(storage) {
    try { const value = JSON.parse(storage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.filter(room => room && /^[A-Z0-9]{7}$/.test(room.code) && Number.isFinite(room.visitedAt)).slice(0, 10).map(room => entry(room.code, room.visitedAt, room.name)) : []; } catch { return []; }
}
export function rememberRoom(storage, code, now = Date.now(), name) {
    if (!/^[A-Z0-9]{7}$/.test(code)) return;
    try {
        const rooms = readRecentRooms(storage), previous = rooms.find(room => room.code === code);
        storage.setItem(KEY, JSON.stringify([entry(code, now, name === undefined ? previous?.name : name), ...rooms.filter(room => room.code !== code)].slice(0, 10)));
    } catch { /* Local history is optional. */ }
}

export function updateRecentRoomName(storage, code, name) {
    if (normalizeRoomName(name) === null) return;
    try {
        const rooms = readRecentRooms(storage);
        if (rooms.some(room => room.code === code)) storage.setItem(KEY, JSON.stringify(rooms.map(room => room.code === code ? entry(code, room.visitedAt, name) : room)));
    } catch { /* Local history is optional. */ }
}
