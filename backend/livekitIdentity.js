const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const process = require('node:process');
const { validRoomCode } = require('./validators');

const denied = (status, message) => Object.assign(new Error(message), { status });
const voiceRoomName = roomCode => `watchly-voice-${roomCode}`;
const voiceIdentity = memberId => `watchly-${memberId}`;

function livekitConfig(env = process.env) {
    try {
        const url = new URL(env.LIVEKIT_URL);
        const local = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) || url.username || url.password || url.search || url.hash) return null;
        if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;
        return { serverUrl: url.href.replace(/\/$/, ''), apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
    } catch { return null; }
}

// The room code, nickname and socket ID alone are never credentials. The
// private resume token proves ownership of the exact, currently bound member.
function voiceMember({ rooms, io }, { roomId, socketId, resumeToken } = {}) {
    if (typeof roomId !== 'string' || !validRoomCode(roomId) || typeof socketId !== 'string' || socketId.length > 100 ||
        typeof resumeToken !== 'string' || resumeToken.length < 32 || resumeToken.length > 128) {
        throw denied(400, 'Join a Watchly room before joining voice.');
    }
    const room = rooms.get(roomId), socket = io.sockets.sockets.get(socketId);
    const member = room?.users.find(user => user.id === socketId && user.connected);
    if (!room || !member || !socket?.connected || socket.data.roomId !== roomId || socket.data.memberId !== member.userId || room.kickedUserIds.has(member.userId)) {
        throw denied(403, 'You must be an active member of this Watchly room.');
    }
    const actual = crypto.createHash('sha256').update(resumeToken).digest();
    const expected = Buffer.from(member.resumeTokenHash || '', 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(actual, expected)) throw denied(403, 'Your room membership could not be verified.');
    return { room, socket, member };
}

module.exports = { livekitConfig, voiceMember, voiceRoomName, voiceIdentity };
