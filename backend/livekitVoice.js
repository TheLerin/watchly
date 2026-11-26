const express = require('express');
const { AccessToken, TrackSource, RoomServiceClient } = require('livekit-server-sdk');
const { livekitConfig, voiceMember, voiceRoomName, voiceIdentity } = require('./livekitIdentity');
const denied = (status, message) => Object.assign(new Error(message), { status });

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
            token.roomConfig = { maxParticipants: Math.min(6, Math.max(2, Number(env.LIVEKIT_MAX_PARTICIPANTS) || 6)), emptyTimeout: 120, departureTimeout: 30 };
            if (env.NODE_ENV === 'production' || env.LIVEKIT_ENFORCE_ROOM_LIMITS === 'true') {
                const provider = new RoomServiceClient(config.serverUrl.replace(/^ws/, 'http'), config.apiKey, config.apiSecret);
                const created = await provider.createRoom({ name: voiceRoomName(req.body.roomId), maxParticipants: token.roomConfig.maxParticipants, emptyTimeout: 120, departureTimeout: 30 });
                if (!created.maxParticipants || created.maxParticipants > token.roomConfig.maxParticipants) throw denied(503, 'This call room needs to empty before the participant limit can apply.');
            }
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
    const dispose = () => clearInterval(cleanup);
    dispose.removeMember = async (roomId, memberId) => {
        const config = livekitConfig(env);
        if (!config) return;
        const client = new RoomServiceClient(config.serverUrl.replace(/^ws/, 'http'), config.apiKey, config.apiSecret);
        try { await client.removeParticipant(voiceRoomName(roomId), voiceIdentity(memberId)); }
        catch (error) { if (error.status !== 404 && error.code !== 'not_found') throw error; }
    };
    return dispose;
}

module.exports = { registerLivekitVoice, livekitConfig, voiceMember, voiceRoomName, voiceIdentity };
