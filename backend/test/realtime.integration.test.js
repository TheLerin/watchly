const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { io } = require('../../frontend/node_modules/socket.io-client');

const port = 5600 + Math.floor(Math.random() * 300);
let server;
const clients = [];
const connect = () => new Promise((resolve, reject) => {
    const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    clients.push(client); client.once('connect', () => resolve(client)); client.once('connect_error', reject);
});
const emit = (client, event, payload) => new Promise(resolve => client.emit(event, payload, resolve));

test.before(async () => {
    server = fork(require.resolve('../server'), [], { env: {
        ...process.env, PORT: String(port), CORS_ORIGIN: '*', CONTROLLER_LEASE_MS: '300',
        TURN_URLS: 'turns:turn.example:443?transport=tcp', TURN_SHARED_SECRET: 'integration-secret'
    }, stdio: 'ignore' });
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error('Realtime test server did not start');
});
test.after(() => { clients.forEach(client => client.close()); server?.kill(); });

test('create, join, expiration error, readiness and controller-only playback', async () => {
    const host = await connect();
    const created = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    assert.equal(created.ok, true); assert.match(created.roomId, /^[A-Z0-9]{7}$/);
    assert.equal('resumeTokenHash' in created.user, false);
    assert.equal(created.snapshot.members.some(member => 'resumeTokenHash' in member), false);
    const mismatchClient = await connect();
    const mismatch = await emit(mismatchClient, 'room:join', { roomId: created.roomId, nickname: 'Old client', protocolVersion: 1 });
    assert.equal(mismatch.error.code, 'PROTOCOL_MISMATCH');
    const stranger = await connect();
    const missing = await emit(stranger, 'room:join', { roomId: 'ZZZZZZZ', nickname: 'Nope', protocolVersion: 2 });
    assert.equal(missing.error.code, 'ROOM_NOT_FOUND');
    const joined = await emit(stranger, 'room:join', { roomId: created.roomId, nickname: 'Viewer', protocolVersion: 2 });
    assert.equal(joined.ok, true);
    const forgedMessage = new Promise(resolve => host.once('receive_message', resolve));
    stranger.emit('send_message', { roomId: created.roomId, message: { id: 'chat_12345678', text: 'hello', nickname: 'Forged Host', role: 'Host' } });
    const receivedMessage = await forgedMessage;
    assert.equal(receivedMessage.nickname, 'Viewer');
    assert.equal(receivedMessage.role, 'Viewer');
    const mediaId = `sampled-sha256-v1:100:${'a'.repeat(64)}`;
    const declared = await emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId, fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Movie', sizeBytes: 100, durationMs: 10000 } });
    assert.equal(declared.ok, true);
    const forbidden = await emit(stranger, 'playback:command', { commandId: 'viewer_cmd_123', mediaId, action: 'PLAY' });
    assert.equal(forbidden.error.code, 'NOT_CONTROLLER');
    await emit(stranger, 'media:ready', { mediaId, status: 'READY', fingerprint: 'a'.repeat(64), size: 100, duration: 10 });
    const played = await emit(host, 'playback:command', { commandId: 'host_cmd_12345', mediaId, action: 'PLAY' });
    assert.equal(played.ok, true); assert.equal(played.playback.seq, 1);
    const duplicate = await emit(host, 'playback:command', { commandId: 'host_cmd_12345', mediaId, action: 'PLAY' });
    assert.equal(duplicate.duplicate, true);

    host.emit('promote_to_moderator', { roomId: created.roomId, targetId: stranger.id });
    await new Promise(resolve => setTimeout(resolve, 20));
    const moderatorWithoutControl = await emit(stranger, 'playback:command', { commandId: 'moderator_cmd_1', mediaId, action: 'PAUSE' });
    assert.equal(moderatorWithoutControl.error.code, 'NOT_CONTROLLER');
    assert.equal((await emit(stranger, 'control:request', {})).ok, true);
    assert.equal((await emit(host, 'control:request', {})).ok, true);

    const otherHost = await connect();
    const otherRoom = await emit(otherHost, 'room:create', { nickname: 'Other', protocolVersion: 2 });
    const staleReady = await emit(otherHost, 'media:ready', { mediaId, status: 'READY', fingerprint: 'a'.repeat(64), size: 100, duration: 10 });
    assert.equal(staleReady.error.code, 'STALE_MEDIA');
    let crossRoomSignal = false;
    otherHost.once('screen:offer', () => { crossRoomSignal = true; });
    host.emit('screen:offer', { targetSocketId: otherHost.id, offer: { type: 'offer', sdp: 'v=0' } });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(crossRoomSignal, false);
    assert.notEqual(otherRoom.roomId, created.roomId);

    const iceConfig = await emit(host, 'ice:config', {});
    assert.equal(iceConfig.ok, true);
    assert.equal(Array.isArray(iceConfig.iceServers), true);
    assert.equal(iceConfig.turnConfigured, true);
    assert.match(iceConfig.iceServers[1].username, new RegExp(created.memberId));
    const viewerIceConfig = await emit(stranger, 'ice:config', {});
    assert.notEqual(viewerIceConfig.iceServers[1].username, iceConfig.iceServers[1].username);
    const publicIceConfig = await fetch(`http://127.0.0.1:${port}/api/ice-config`).then(response => response.json());
    assert.equal(publicIceConfig.turnConfigured, false);
    assert.equal(publicIceConfig.iceServers.length, 1);

    const kicked = await connect();
    const kickedJoin = await emit(kicked, 'room:join', { roomId: created.roomId, nickname: 'Kicked', protocolVersion: 2 });
    host.emit('kick_user', { roomId: created.roomId, targetId: kicked.id });
    await new Promise(resolve => setTimeout(resolve, 20));
    kicked.close();
    const kickedResume = await connect();
    const banned = await emit(kickedResume, 'room:join', {
        roomId: created.roomId, nickname: 'Kicked', protocolVersion: 2, resumeToken: kickedJoin.resumeToken
    });
    assert.equal(banned.error.code, 'MEMBER_BANNED');

    const originalController = created.memberId;
    host.close();
    await new Promise(resolve => setTimeout(resolve, 20));
    const leaseBlocked = await emit(stranger, 'control:request', {});
    assert.equal(leaseBlocked.error.code, 'LEASE_ACTIVE');
    const resumed = await connect();
    const resumeResult = await emit(resumed, 'room:join', {
        roomId: created.roomId, nickname: 'Host', protocolVersion: 2, resumeToken: created.resumeToken
    });
    assert.equal(resumeResult.memberId, originalController);
    assert.equal(resumeResult.snapshot.controllerMemberId, originalController);

    resumed.close();
    await new Promise(resolve => setTimeout(resolve, 350));
    const postLease = await emit(stranger, 'room:snapshot', {});
    assert.equal(postLease.snapshot.controllerMemberId, joined.memberId);

    const hostAfterLease = await connect();
    await emit(hostAfterLease, 'room:join', {
        roomId: created.roomId, nickname: 'Host', protocolVersion: 2, resumeToken: created.resumeToken
    });
    hostAfterLease.emit('kick_user', { roomId: created.roomId, targetId: stranger.id });
    await new Promise(resolve => setTimeout(resolve, 20));
    const afterControllerKick = await emit(hostAfterLease, 'room:snapshot', {});
    assert.equal(afterControllerKick.snapshot.controllerMemberId, originalController);
});
