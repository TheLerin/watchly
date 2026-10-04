const express = require('express');
const crypto = require('node:crypto');
const { AccessToken, TrackSource } = require('livekit-server-sdk');
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

function registerLivekitVoice({ app, io, rooms, accounts, env = process.env }) {
    const router = express.Router(), issued = new Map();
    const cleanup = setInterval(() => { const now = Date.now(); for (const [id, bucket] of issued) if (now - bucket.startedAt >= 60000) issued.delete(id); }, 60000);
    cleanup.unref?.();
    router.use(express.json({ limit: '2kb' }));
    router.post('/', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            const initial = voiceMember({ io, rooms }, req.body);
            const authorization = req.get('authorization');
            let account = null;
            if (authorization) {
                const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
                if (!token || token.length > 16384) throw denied(401, 'Sign in again before joining voice.');
                try { account = await accounts.verify(token); }
                catch { throw denied(401, 'Your account could not be verified. Sign in again or retry.'); }
            }
            const check = () => {
                const current = voiceMember({ io, rooms }, req.body);
                if (current.member !== initial.member || current.room !== initial.room) throw denied(403, 'Your room changed. Join voice again.');
                if (current.member.accountId || account) {
                    if (!account || account.id !== current.member.accountId || !current.member.authenticated || current.socket.data.account?.id !== account.id) {
                        throw denied(401, 'Use the account that owns this room membership.');
                    }
                }
                return current.member;
            };
            const member = check(), config = livekitConfig(env);
            if (!config) throw denied(503, 'LiveKit voice is not configured on the backend yet.');
            const bucket = issued.get(member.userId), now = Date.now();
            if (bucket && now - bucket.startedAt < 60000 && bucket.count >= 8) {
                res.setHeader('Retry-After', Math.ceil((60000 - now + bucket.startedAt) / 1000));
                throw denied(429, 'Too many voice joins. Wait a moment and try again.');
            }
            issued.set(member.userId, bucket && now - bucket.startedAt < 60000 ? { ...bucket, count: bucket.count + 1 } : { startedAt: now, count: 1 });
            const token = new AccessToken(config.apiKey, config.apiSecret, {
                identity: voiceIdentity(member.userId), name: member.nickname, ttl: 120,
            });
            token.addGrant({ room: voiceRoomName(req.body.roomId), roomJoin: true, canPublish: true, canSubscribe: true,
                canPublishData: false, canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA] });
            const participantToken = await token.toJwt();
            check(); // Membership/account changes during async verification/signing fence this response.
            res.json({ serverUrl: config.serverUrl, participantToken });
        } catch (error) {
            res.status(error.status || 503).json({ error: error.status ? error.message : 'Voice could not connect. Please retry.' });
        }
    });
    router.use((_error, _req, res, _next) => res.status(400).set('Cache-Control', 'no-store').json({ error: 'Invalid voice request.' }));
    app.use('/api/livekit/token', router);
    return () => clearInterval(cleanup);
}

module.exports = { registerLivekitVoice, livekitConfig, voiceMember, voiceRoomName, voiceIdentity };
