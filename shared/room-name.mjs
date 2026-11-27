export const ROOM_NAME_MAX_LENGTH = 48;

// Empty names use the room-code fallback. Reject controls and bidi overrides while allowing Unicode names and emoji.
export function normalizeRoomName(value = '') {
    if (typeof value !== 'string' || value.length > ROOM_NAME_MAX_LENGTH || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) return null;
    const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
    return name.length <= ROOM_NAME_MAX_LENGTH ? name : null;
}
