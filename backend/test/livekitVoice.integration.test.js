const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), express = require('express');
const { Server } = require('socket.io');
const { io: connectSocket } = require('../../frontend/node_modules/socket.io-client');
const { TokenVerifier } = require('livekit-server-sdk');
const registerRealtime = require('../realtime');
const { registerLivekitVoice, livekitConfig, voiceRoomName, voiceIdentity } = require('../livekitVoice');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const config = { LIVEKIT_URL: 'wss://voice-test.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret-for-local-signature-checks-only' };
let server, io, base, closeVoice, delayedVerification;
const clients = [];
const accounts = {
    async verify(token) {
        if (token === 'delayed') return delayedVerification();
        const id = token === 'alice' ? A : token === 'bob' ? B : null;
        if (!id) throw new Error('Invalid account');
        return { id, token, expiresAt: Date.now() + 60000, profile: { id, display_name: token, username: token } };
    },
    async friendIds() { return []; },
};
const connect = token => new Promise((resolve, reject) => { const socket = connectSocket(base, { auth: token ? { accessToken: token } : {}, transports: ['websocket'], reconnection: false }); clients.push(socket); socket.once('connect', () => resolve(socket)); socket.once('connect_error', reject); });
const call = (socket, event, payload = {}) => new Promise((resolve, reject) => socket.timeout(3000).emit(event, payload, (error, value) => error ? reject(error) : resolve(value)));
const create = async token => { const socket = await connect(token), room = await call(socket, 'room:create', { nickname: 'Guest nickname', protocolVersion: 2 }); assert.equal(room.ok, true); return { socket, room }; };
const body = ({ socket, room }) => ({ roomId: room.roomId, socketId: socket.id, resumeToken: room.resumeToken });
const request = (payload, token) => fetch(`${base}/api/livekit/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
const decode = async response => { assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); const value = await response.json(); assert.deepEqual(Object.keys(value).sort(), ['participantToken', 'serverUrl']); assert.equal(value.serverUrl, config.LIVEKIT_URL); const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET); return verifier.verify(value.participantToken); };
test.before(async () => {
    const app = express(), rooms = new Map(); server = http.createServer(app); io = new Server(server);
    registerRealtime({ io, rooms, accounts }); closeVoice = registerLivekitVoice({ app, io, rooms, accounts, env: config });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { closeVoice(); clients.forEach(socket => socket.close()); await new Promise(resolve => io.close(resolve)); });

test('active guest credentials mint a scoped microphone and camera JWT without changing Watchly roles or voice signaling', async () => {
    const host = await create(), viewer = await connect(); const joined = await call(viewer, 'room:join', { roomId: host.room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    const claims = await decode(await request({ ...body(host), identity: 'forged', room: 'another-room', role: 'admin' }));
    assert.equal(claims.sub, voiceIdentity(host.room.memberId)); assert.notEqual(claims.sub, host.socket.id); assert.notEqual(claims.sub, 'Guest nickname');
    assert.equal(claims.name, 'Guest nickname'); assert.equal(claims.video.room, voiceRoomName(host.room.roomId));
    assert.equal(claims.video.roomJoin, true); assert.equal(claims.video.canPublish, true); assert.equal(claims.video.canSubscribe, true); assert.equal(claims.video.canPublishData, false);
    assert.deepEqual(claims.video.canPublishSources, ['microphone', 'camera']); assert.equal(claims.video.roomAdmin, undefined); assert.ok(claims.exp - claims.nbf <= 120);
    await decode(await request(body({ socket: viewer, room: joined })));
    const snapshot = (await call(host.socket, 'room:snapshot')).snapshot;
    assert.deepEqual(snapshot.members.map(member => member.role), ['Host', 'Viewer']); assert.ok(snapshot.members.every(member => !member.isVoiceActive));
});
test('room code/socket ID without the private membership credential, cross-room credentials and nonmembers are denied', async () => {
    const a = await create(), b = await create();
    for (const invalid of [{ ...body(a), resumeToken: 'x'.repeat(43) }, { ...body(a), roomId: b.room.roomId }, { ...body(a), socketId: 'not-connected' }]) assert.equal((await request(invalid)).status, 403);
    for (const invalid of [{}, { ...body(a), roomId: '../room' }, { ...body(a), resumeToken: 'short' }]) assert.equal((await request(invalid)).status, 400);
    const malformed = await fetch(`${base}/api/livekit/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'Invalid voice request.' });
});
test('account memberships require freshly verified matching Supabase identity, never guest downgrade', async () => {
    const account = await create('alice');
    for (const token of [undefined, 'invalid', 'bob']) assert.equal((await request(body(account), token)).status, 401);
    assert.equal((await decode(await request(body(account), 'alice'))).sub, voiceIdentity(A));
    const guest = await create(); assert.equal((await request(body(guest), 'alice')).status, 401);
});
test('participant identity survives guest resume while the superseded socket can no longer mint tokens', async () => {
    const initial = await create(), originalBody = body(initial), before = await decode(await request(originalBody));
    const socket = await connect(); const resumed = await call(socket, 'room:join', { roomId: initial.room.roomId, resumeToken: initial.room.resumeToken, memberId: initial.room.memberId, nickname: 'Renamed guest', protocolVersion: 2 });
    const after = await decode(await request(body({ socket, room: resumed }))); assert.equal(after.sub, before.sub);
    assert.equal((await request(originalBody)).status, 403);
});
test('left and kicked members cannot obtain a voice token', async () => {
    const host = await create(), viewer = await connect(); const joined = await call(viewer, 'room:join', { roomId: host.room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    host.socket.emit('kick_user', { roomId: host.room.roomId, targetId: viewer.id }); await call(host.socket, 'room:snapshot');
    assert.equal((await request(body({ socket: viewer, room: joined }))).status, 403);
    const saved = body(host); host.socket.emit('leave_room', { roomId: host.room.roomId }); await call(host.socket, 'room:snapshot'); assert.equal((await request(saved)).status, 403);
});
test('membership is rechecked after asynchronous account verification', async () => {
    const owner = await create('alice'); let finish, started;
    const ready = new Promise(resolve => { started = resolve; }); delayedVerification = () => { started(); return new Promise(resolve => { finish = resolve; }); };
    const response = request(body(owner), 'delayed'); await ready;
    owner.socket.emit('leave_room', { roomId: owner.room.roomId }); await call(owner.socket, 'room:snapshot');
    finish(await accounts.verify('alice')); assert.equal((await response).status, 403);
});
test('token minting is bounded per actual member', async () => {
    const host = await create(); for (let i = 0; i < 8; i++) assert.equal((await request(body(host))).status, 200);
    const rejected = await request(body(host)); assert.equal(rejected.status, 429); assert.ok(Number(rejected.headers.get('retry-after')) > 0);
});
test('configuration stays backend-only and insecure/non-LiveKit URLs fail closed', () => {
    assert.equal(livekitConfig({}), null); assert.equal(livekitConfig({ ...config, LIVEKIT_URL: 'https://example.com' }), null);
    assert.equal(livekitConfig({ ...config, LIVEKIT_URL: 'wss://secret@example.com' }), null);
    assert.equal(livekitConfig({ ...config, NODE_ENV: 'production', LIVEKIT_URL: 'ws://localhost:7880' }), null);
    assert.ok(livekitConfig({ ...config, NODE_ENV: 'development', LIVEKIT_URL: 'ws://127.0.0.1:7880' }));
});
