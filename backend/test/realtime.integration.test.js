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
    for (let attempt = 0; attempt < 150; attempt += 1) {
        if (server.exitCode !== null) throw new Error(`Realtime test server exited with code ${server.exitCode}`);
        try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    throw new Error('Realtime test server did not start');
});
test.after(() => { clients.forEach(client => client.close()); server?.kill(); });

const receive = (client, event, matches = () => true) => new Promise((resolve, reject) => {
    const handler = payload => { if (!matches(payload)) return; clearTimeout(timer); client.off(event, handler); resolve(payload); };
    const timer = setTimeout(() => { client.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, 3000);
    client.on(event, handler);
});

test('existing membership events distinguish intentional departure from socket recovery', async () => {
    const host = await connect(), room = await emit(host, 'room:create', { nickname: 'Sound host', protocolVersion: 2 });
    const guest = await connect(), newMember = receive(host, 'user_joined');
    const joined = await emit(guest, 'room:join', { roomId: room.roomId, nickname: 'Sound guest', protocolVersion: 2 });
    assert.equal((await newMember).resumed, false);
    const left = () => new Promise(resolve => host.once('user_left', (socketId, details) => resolve({ socketId, ...details })));
    const disconnected = left(), oldId = guest.id; guest.disconnect();
    assert.deepEqual(await disconnected, { socketId: oldId, reason: 'disconnect', memberId: joined.memberId });
    const resumed = await connect();
    const recoveringMember = receive(host, 'user_joined');
    await emit(resumed, 'room:join', { roomId: room.roomId, nickname: 'Sound guest', protocolVersion: 2, resumeToken: joined.resumeToken, memberId: joined.memberId });
    assert.equal((await recoveringMember).resumed, true);
    const intentional = left(), resumedId = resumed.id; resumed.emit('leave_room', { roomId: room.roomId });
    assert.deepEqual(await intentional, { socketId: resumedId, reason: 'left', memberId: joined.memberId });
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.members.length, 1);
});

test('resume credentials keep one member and fence a superseded active socket', async () => {
    const host = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Resume host', protocolVersion: 2 });
    const viewer = await connect();
    const joined = await emit(viewer, 'room:join', { roomId: room.roomId, nickname: 'Resume viewer', protocolVersion: 2 });
    const replacement = await connect();
    const replaced = receive(viewer, 'room:error', error => error.code === 'SESSION_REPLACED');
    const resumed = await emit(replacement, 'room:join', { roomId: room.roomId, nickname: 'Resume viewer', protocolVersion: 2,
        resumeToken: joined.resumeToken, memberId: joined.memberId });
    assert.equal((await replaced).code, 'SESSION_REPLACED');
    assert.equal(resumed.memberId, joined.memberId);
    assert.equal(resumed.resumeToken, joined.resumeToken);
    assert.equal(resumed.snapshot.members.length, 2);
    assert.equal(resumed.snapshot.members.filter(member => member.userId === joined.memberId).length, 1);
    const invalid = await connect();
    const rejected = await emit(invalid, 'room:join', { roomId: room.roomId, nickname: 'Resume viewer', protocolVersion: 2,
        resumeToken: 'invalid'.repeat(12), memberId: joined.memberId });
    assert.equal(rejected.error.code, 'SESSION_INVALID');
    assert.equal((await emit(invalid, 'room:snapshot', {})).error.code, 'NOT_IN_ROOM');
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.members.length, 2);
});

test('source epochs fence delayed source commands across local and remote snapshots', async () => {
    const host = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Epoch host', protocolVersion: 2 });
    const changed = receive(host, 'video_changed');
    host.emit('change_video', { roomId: room.roomId, url: 'https://example.com/first.mp4' });
    const first = await changed;
    const mediaId = `sampled-sha256-v1:100:${'e'.repeat(64)}`;
    await emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId,
        fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Epoch movie', sizeBytes: 100, durationMs: 120000 } });
    const local = (await emit(host, 'room:snapshot', {})).snapshot;
    assert.ok(local.videoState.sourceEpoch > first.sourceEpoch);
    assert.equal(local.playback.sourceEpoch, local.videoState.sourceEpoch);
    assert.equal(local.playback.mediaId, mediaId);
    const declaredAt = local.media.declaredAtServerMs;
    assert.ok(Number.isFinite(declaredAt));
    const next = receive(host, 'video_changed');
    host.emit('change_video', { roomId: room.roomId, url: 'https://example.com/second.mp4' });
    const second = await next;
    assert.ok(second.sourceEpoch > local.videoState.sourceEpoch);
    host.emit('pause_video', { roomId: room.roomId, sourceId: first.sourceId, sourceEpoch: first.sourceEpoch, playedSeconds: 99 });
    const snapshot = (await emit(host, 'room:snapshot', {})).snapshot;
    assert.equal(snapshot.videoState.url, 'https://example.com/second.mp4');
    assert.equal(snapshot.videoState.isPlaying, true);
    assert.notEqual(snapshot.videoState.playedSeconds, 99);
    assert.equal(snapshot.media, null);
});

test('local seek timestamps synchronize receivers, preserve intent and reject invalid metadata', async () => {
    const host = await connect(), viewer = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Seek host', protocolVersion: 2 });
    await emit(viewer, 'room:join', { roomId: room.roomId, nickname: 'Seek viewer', protocolVersion: 2 });
    const fingerprint = 'b'.repeat(64);
    const mediaId = `sampled-sha256-v1:100:${fingerprint}`;
    await emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId, fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Seek movie', sizeBytes: 100, durationMs: 100000 } });
    await emit(viewer, 'media:ready', { mediaId, status: 'READY', fingerprint, size: 100, duration: 100 });
    await emit(host, 'playback:command', { commandId: 'seek_test_play', mediaId, action: 'PLAY' });
    const request = { commandId: 'optimistic_seek_1', mediaId, action: 'SEEK', positionSec: 40, requestedAtServerMs: Date.now() - 500 };
    const received = receive(viewer, 'playback:state', state => state.commandId === request.commandId);
    const result = await emit(host, 'playback:command', request);
    assert.equal(result.ok, true);
    assert.equal(result.playback.status, 'playing');
    assert.ok(result.playback.positionSec >= 40.75, JSON.stringify({ playback: result.playback, request }));
    const serverReceivedAt = result.playback.effectiveAtServerMs - 750;
    const boundedRequestTime = Math.min(serverReceivedAt, Math.max(request.requestedAtServerMs, serverReceivedAt - 10000));
    assert.equal(result.playback.positionSec, 40 + (result.playback.effectiveAtServerMs - boundedRequestTime) / 1000);
    assert.deepEqual(await received, result.playback);
    assert.equal((await emit(host, 'playback:command', request)).duplicate, true);
    await emit(host, 'playback:command', { commandId: 'seek_test_pause', mediaId, action: 'PAUSE' });
    const paused = await emit(host, 'playback:command', { ...request, commandId: 'optimistic_seek_2', positionSec: 5 });
    assert.equal(paused.playback.status, 'paused');
    assert.equal(paused.playback.positionSec, 5);
    const invalid = await emit(host, 'playback:command', { ...request, commandId: 'optimistic_bad_time', requestedAtServerMs: 'invalid' });
    assert.equal(invalid.error.code, 'INVALID_COMMAND');
});

test('Host and Moderator share direct controls, queue management and local initiation; Viewer claims cannot grant rights', async () => {
    const host = await connect(), moderator = await connect(), viewer = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Permission host', protocolVersion: 2 });
    const mod = await emit(moderator, 'room:join', { roomId: room.roomId, nickname: 'Permission mod', protocolVersion: 2 });
    await emit(viewer, 'room:join', { roomId: room.roomId, nickname: 'Permission viewer', protocolVersion: 2 });
    const promoted = receive(moderator, 'role_updated'); host.emit('promote_to_moderator', { roomId: room.roomId, targetId: moderator.id });
    assert.equal((await promoted).member.permissions.canControlPlayback, true);
    let changed = receive(host, 'video_changed'); moderator.emit('change_video', { roomId: room.roomId, url: 'https://example.com/mod.mp4' });
    let state = await changed; assert.equal(state.isPlaying, true);
    for (const actor of [host, moderator]) {
        let received = receive(viewer, 'video_paused'); actor.emit('pause_video', { roomId: room.roomId, sourceEpoch: state.sourceEpoch, playedSeconds: 10 });
        state = await received; assert.equal(state.isPlaying, false);
        received = receive(viewer, 'video_seeked'); actor.emit('seek_video', { roomId: room.roomId, sourceEpoch: state.sourceEpoch, playedSeconds: 90 });
        state = await received; assert.equal(state.playedSeconds, 90);
        received = receive(viewer, 'video_played'); actor.emit('play_video', { roomId: room.roomId, sourceEpoch: state.sourceEpoch });
        state = await received; assert.equal(state.isPlaying, true);
    }
    const before = (await emit(host, 'room:snapshot', {})).snapshot;
    for (const event of ['pause_video', 'seek_video', 'change_video', 'add_to_queue']) viewer.emit(event, { roomId: room.roomId, role: 'Host', permissions: { canControlPlayback: true }, sourceEpoch: state.sourceEpoch, playedSeconds: 150, url: 'https://example.com/forged.mp4' });
    const after = (await emit(viewer, 'room:snapshot', {})).snapshot;
    assert.equal(after.videoState.url, before.videoState.url); assert.equal(after.videoState.isPlaying, true);
    assert.equal(after.videoState.seekVersion, before.videoState.seekVersion); assert.equal(after.queue.length, 0);
    assert.equal(after.members.find(member => member.id === viewer.id).permissions.canControlPlayback, false);
    for (const label of ['first', 'second']) {
        const queued = receive(host, 'queue_updated'); moderator.emit('add_to_queue', { roomId: room.roomId, url: `https://example.com/${label}.mp4`, label }); await queued;
    }
    let queue = (await emit(host, 'room:snapshot', {})).snapshot.queue;
    let updated = receive(host, 'queue_updated'); moderator.emit('reorder_queue', { roomId: room.roomId, itemId: queue[1].id, direction: 'up' });
    queue = await updated; assert.equal(queue[0].label, 'second');
    updated = receive(host, 'queue_updated'); moderator.emit('remove_from_queue', { roomId: room.roomId, itemId: queue[1].id });
    assert.equal((await updated).length, 1);
    changed = receive(viewer, 'video_changed'); moderator.emit('play_next', { roomId: room.roomId });
    assert.equal((await changed).url, 'https://example.com/second.mp4');
    moderator.emit('kick_user', { roomId: room.roomId, targetId: host.id });
    moderator.emit('transfer_host', { roomId: room.roomId, targetId: moderator.id });
    moderator.emit('promote_to_moderator', { roomId: room.roomId, targetId: viewer.id });
    let snapshot = (await emit(moderator, 'room:snapshot', {})).snapshot;
    assert.equal(snapshot.members.find(member => member.id === host.id).role, 'Host');
    assert.equal(snapshot.members.find(member => member.id === viewer.id).role, 'Viewer');
    const mediaId = `sampled-sha256-v1:100:${'f'.repeat(64)}`;
    assert.equal((await emit(moderator, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId,
        fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Moderator local movie', sizeBytes: 100, durationMs: 120000 } })).ok, true);
    for (const actor of [host, viewer]) await emit(actor, 'media:ready', { mediaId, status: 'READY', fingerprint: 'f'.repeat(64), size: 100, duration: 120 });
    for (const actor of [host, moderator]) for (const action of ['PLAY', 'PAUSE', 'SEEK']) {
        const result = await emit(actor, 'playback:command', { commandId: `role_${actor.id}_${action}`, mediaId, action, positionSec: 90 });
        assert.equal(result.ok, true); if (action === 'SEEK') assert.equal(result.playback.positionSec, 90);
    }
    assert.equal((await emit(viewer, 'playback:command', { commandId: 'forged_viewer_play', mediaId, action: 'PLAY', role: 'Moderator' })).error.code, 'FORBIDDEN');
    const demoted = receive(moderator, 'role_updated'); host.emit('demote_to_viewer', { roomId: room.roomId, targetId: moderator.id });
    assert.equal((await demoted).member.permissions.canControlPlayback, false);
    assert.equal((await emit(moderator, 'playback:command', { commandId: 'demoted_mod_play', mediaId, action: 'PLAY' })).error.code, 'FORBIDDEN');
    snapshot = (await emit(host, 'room:snapshot', {})).snapshot;
    assert.equal(snapshot.members.find(member => member.userId === mod.memberId).role, 'Viewer');
});

test('one socket cannot create ghost rooms or join multiple rooms at once', async () => {
    const host = await connect();
    const original = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const duplicate = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    assert.equal(duplicate.error.code, 'ALREADY_IN_ROOM');
    const other = await connect();
    const otherRoom = await emit(other, 'room:create', { nickname: 'Other', protocolVersion: 2 });
    const crossed = await emit(host, 'room:join', { roomId: otherRoom.roomId, nickname: 'Host', protocolVersion: 2 });
    assert.equal(crossed.error.code, 'ALREADY_IN_ROOM');
    assert.equal((await emit(other, 'room:snapshot', {})).snapshot.members.length, 1);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.memberId, original.memberId);
});

test('demoting the active moderator returns control to the host', async () => {
    const host = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const moderator = await connect();
    await emit(moderator, 'room:join', { roomId: room.roomId, nickname: 'Mod', protocolVersion: 2 });
    const promoted = receive(moderator, 'role_updated');
    host.emit('promote_to_moderator', { roomId: room.roomId, targetId: moderator.id });
    await promoted;
    assert.equal((await emit(moderator, 'control:request', {})).ok, true);
    const changed = receive(host, 'control:changed');
    host.emit('demote_to_viewer', { roomId: room.roomId, targetId: moderator.id });
    assert.equal((await changed).controllerMemberId, room.memberId);
    assert.equal((await emit(moderator, 'control:request', {})).error.code, 'FORBIDDEN');
});

test('an old reconnect lease cannot override an explicit host transfer', async () => {
    const host = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const moderator = await connect();
    await emit(moderator, 'room:join', { roomId: room.roomId, nickname: 'Mod', protocolVersion: 2 });
    const viewer = await connect();
    const joined = await emit(viewer, 'room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    const promoted = receive(moderator, 'role_updated');
    host.emit('promote_to_moderator', { roomId: room.roomId, targetId: moderator.id });
    await promoted;
    const controlRequestedForViewer = receive(viewer, 'control:changed');
    await emit(moderator, 'control:request', {});
    assert.equal((await controlRequestedForViewer).reason, 'CONTROL_REQUESTED');
    const grace = receive(host, 'control:changed');
    const graceForViewer = receive(viewer, 'control:changed');
    moderator.close();
    assert.equal((await grace).reason, 'HOST_RECONNECT_GRACE');
    assert.equal((await graceForViewer).reason, 'HOST_RECONNECT_GRACE');
    const transferred = receive(viewer, 'control:changed');
    host.emit('transfer_host', { roomId: room.roomId, targetId: viewer.id });
    assert.equal((await transferred).controllerMemberId, joined.memberId);
    await new Promise(resolve => setTimeout(resolve, 400));
    const result = await emit(viewer, 'room:snapshot', {});
    assert.equal(result.snapshot.controllerMemberId, joined.memberId);
    assert.equal(result.snapshot.controllerLeaseUntil, null);
});

test('a lone controller disconnect pauses playback before resuming the room', async () => {
    const host = await connect();
    const room = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const mediaId = `sampled-sha256-v1:100:${'c'.repeat(64)}`;
    await emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId,
        fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Movie', sizeBytes: 100, durationMs: 120000 } });
    await emit(host, 'playback:command', { commandId: 'solo_play_12345', mediaId, action: 'PLAY' });
    const repeated = await emit(host, 'room:join', { roomId: room.roomId, nickname: 'Host', protocolVersion: 2, resumeToken: room.resumeToken });
    assert.equal(repeated.snapshot.readiness.readyCount, 1);
    host.close();
    await new Promise(resolve => setTimeout(resolve, 30));
    const resumed = await connect();
    const result = await emit(resumed, 'room:join', { roomId: room.roomId, nickname: 'Host', protocolVersion: 2, resumeToken: room.resumeToken });
    assert.equal(result.snapshot.playback.status, 'paused');
    assert.equal(result.snapshot.controllerMemberId, room.memberId);
});

test('link playback, local-to-link switching, queue switching and late joins share the active source', async () => {
    const host = await connect();
    const created = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const viewer = await connect();
    await emit(viewer, 'room:join', { roomId: created.roomId, nickname: 'Viewer', protocolVersion: 2 });
    const roomId = created.roomId;
    const mediaId = `sampled-sha256-v1:100:${'b'.repeat(64)}`;
    const declare = () => emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId,
        fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Movie', sizeBytes: 100, durationMs: 120000 } });
    await declare();
    const localSnapshot = await emit(host, 'room:snapshot', {});
    assert.equal(localSnapshot.snapshot.members.find(member => member.userId === created.memberId).localReady, true);
    // A delayed URL progress report must not mutate local playback.
    host.emit('sync_progress', { roomId, playedSeconds: 99 });
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.playback.positionSec, 0);
    const changed = receive(viewer, 'video_changed');
    host.emit('change_video', { roomId, url: 'https://example.com/movie.mp4' });
    assert.equal((await changed).sourceType, 'remote');
    const remoteSnapshot = (await emit(host, 'room:snapshot', {})).snapshot;
    assert.equal(remoteSnapshot.media, null);
    assert.equal(remoteSnapshot.readiness.mediaSessionId, null);
    assert.equal(remoteSnapshot.readiness.readyCount, 0);
    const stale = await emit(host, 'playback:command', { commandId: 'stale_local_play_123', mediaId, action: 'PLAY' });
    assert.equal(stale.ok, false);
    const paused = receive(viewer, 'video_paused');
    host.emit('pause_video', { roomId, playedSeconds: 12 });
    assert.equal((await paused).isPlaying, false);
    const sought = receive(viewer, 'video_seeked');
    host.emit('seek_video', { roomId, playedSeconds: 35 });
    assert.equal((await sought).playedSeconds, 35);
    const played = receive(viewer, 'video_played');
    host.emit('play_video', { roomId });
    assert.equal((await played).isPlaying, true);
    const late = await connect();
    const joinedEvent = receive(late, 'room_joined');
    await emit(late, 'room:join', { roomId, nickname: 'Late', protocolVersion: 2 });
    const joined = await joinedEvent;
    assert.equal(joined.snapshot.media, null);
    assert.equal(joined.videoState.url, 'https://example.com/movie.mp4');
    assert.ok(joined.videoState.playedSeconds >= 35);
    await declare();
    const queued = receive(host, 'queue_updated');
    host.emit('add_to_queue', { roomId, url: 'https://example.com/next.mp4' });
    await queued;
    const next = receive(viewer, 'video_changed');
    host.emit('play_next', { roomId });
    assert.equal((await next).url, 'https://example.com/next.mp4');
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.media, null);
});

test('a finished link advances the queue once and leaves the last item paused', async () => {
    const host = await connect();
    const created = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const roomId = created.roomId;
    const viewer = await connect();
    await emit(viewer, 'room:join', { roomId, nickname: 'Viewer', protocolVersion: 2 });
    const firstSource = receive(viewer, 'video_changed');
    host.emit('change_video', { roomId, url: 'https://example.com/first.mp4' });
    const first = await firstSource;
    assert.ok(first.sourceId);
    for (const url of ['https://example.com/second.mp4', 'https://example.com/third.mp4']) {
        const updated = receive(viewer, 'queue_updated');
        host.emit('add_to_queue', { roomId, url });
        await updated;
    }
    const pausedBeforeEnd = receive(viewer, 'video_paused');
    host.emit('pause_video', { roomId, playedSeconds: 12 });
    await pausedBeforeEnd;
    const secondSource = receive(viewer, 'video_changed');
    host.emit('video_ended', { roomId, sourceId: first.sourceId, playedSeconds: 12 });
    const second = await secondSource;
    assert.equal(second.url, 'https://example.com/second.mp4');
    assert.equal(second.isPlaying, true);
    host.emit('video_ended', { roomId, sourceId: first.sourceId, playedSeconds: 12 });
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 1);
    const thirdSource = receive(viewer, 'video_changed');
    host.emit('video_ended', { roomId, sourceId: second.sourceId, playedSeconds: 12 });
    const third = await thirdSource;
    assert.equal(third.url, 'https://example.com/third.mp4');
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 0);
    const paused = receive(viewer, 'video_paused');
    host.emit('video_ended', { roomId, sourceId: third.sourceId, playedSeconds: 12 });
    assert.equal((await paused).isPlaying, false);
    const newQueue = receive(viewer, 'queue_updated');
    host.emit('add_to_queue', { roomId, url: 'https://example.com/fourth.mp4' });
    await newQueue;
    host.emit('video_ended', { roomId, sourceId: third.sourceId, playedSeconds: 12 });
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 1);
    const replayed = receive(viewer, 'video_played');
    host.emit('play_video', { roomId });
    await replayed;
    const fourthSource = receive(viewer, 'video_changed');
    host.emit('video_ended', { roomId, sourceId: third.sourceId, playedSeconds: 12 });
    assert.equal((await fourthSource).url, 'https://example.com/fourth.mp4');
});

test('Start anyway bypasses only this start; verified buffering stays ready and local ending advances the queue', async () => {
    const host = await connect();
    const created = await emit(host, 'room:create', { nickname: 'Host', protocolVersion: 2 });
    const roomId = created.roomId;
    const viewer = await connect();
    const joined = await emit(viewer, 'room:join', { roomId, nickname: 'Viewer', protocolVersion: 2 });
    const mediaId = `sampled-sha256-v1:100:${'d'.repeat(64)}`;
    await emit(host, 'media:declare', { descriptor: { sourceType: 'local-file', mediaId,
        fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Movie', sizeBytes: 100, durationMs: 10000 } });
    const blocked = await emit(host, 'playback:command', { commandId: 'queue_ready_block_1', mediaId, action: 'PLAY' });
    assert.equal(blocked.error.code, 'NOT_ALL_READY');
    const started = await emit(host, 'playback:command', { commandId: 'queue_start_anyway_1', mediaId, action: 'PLAY', startAnyway: true });
    assert.equal(started.ok, true);
    assert.equal(started.playback.seq, 1);
    assert.equal((await emit(host, 'playback:command', { commandId: 'queue_start_anyway_1', mediaId, action: 'PLAY', startAnyway: true })).duplicate, true);
    assert.equal((await emit(host, 'playback:command', { commandId: 'queue_start_anyway_2', mediaId, action: 'PLAY', startAnyway: true })).duplicate, true);
    await emit(host, 'playback:command', { commandId: 'queue_pause_again_1', mediaId, action: 'PAUSE' });
    assert.equal((await emit(host, 'playback:command', { commandId: 'queue_ready_block_2', mediaId, action: 'PLAY' })).error.code, 'NOT_ALL_READY');
    await emit(viewer, 'media:ready', { mediaId, status: 'READY', fingerprint: 'd'.repeat(64), size: 100, duration: 10 });
    await emit(viewer, 'media:ready', { mediaId, status: 'BUFFERING', reason: 'Local player is buffering' });
    const readiness = (await emit(host, 'room:snapshot', {})).snapshot.readiness;
    assert.equal(readiness.readyCount, 2);
    assert.equal(readiness.statuses[joined.memberId].status, 'BUFFERING');
    const queued = receive(viewer, 'queue_updated');
    host.emit('add_to_queue', { roomId, url: 'https://example.com/after-local.mp4' });
    await queued;
    await emit(host, 'playback:command', { commandId: 'queue_seek_end_123', mediaId, action: 'SEEK', positionSec: 9.5 });
    const nextSource = receive(viewer, 'video_changed');
    const ended = await emit(host, 'playback:command', { commandId: 'queue_local_ended_1', mediaId, action: 'ENDED' });
    assert.equal(ended.ok, true);
    const next = await nextSource;
    assert.equal(next.url, 'https://example.com/after-local.mp4');
    assert.equal(next.isPlaying, true);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 0);
});

test('create, join, expiration error, readiness and role-authorized playback', async () => {
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
    assert.equal(forbidden.error.code, 'FORBIDDEN');
    await emit(stranger, 'media:ready', { mediaId, status: 'READY', fingerprint: 'a'.repeat(64), size: 100, duration: 10 });
    const played = await emit(host, 'playback:command', { commandId: 'host_cmd_12345', mediaId, action: 'PLAY' });
    assert.equal(played.ok, true); assert.equal(played.playback.seq, 1);
    const duplicate = await emit(host, 'playback:command', { commandId: 'host_cmd_12345', mediaId, action: 'PLAY' });
    assert.equal(duplicate.duplicate, true);

    host.emit('promote_to_moderator', { roomId: created.roomId, targetId: stranger.id });
    await new Promise(resolve => setTimeout(resolve, 20));
    const moderatorWithoutControl = await emit(stranger, 'playback:command', { commandId: 'moderator_cmd_1', mediaId, action: 'PAUSE' });
    assert.equal(moderatorWithoutControl.ok, true);
    assert.equal((await emit(stranger, 'control:request', {})).ok, true);
    assert.equal((await emit(host, 'control:request', {})).ok, true);

    const otherHost = await connect();
    const otherRoom = await emit(otherHost, 'room:create', { nickname: 'Other', protocolVersion: 2 });
    const noMediaCommand = await emit(otherHost, 'playback:command', {
        commandId: 'no_media_command_1', action: 'PAUSE'
    });
    assert.equal(noMediaCommand.error.code, 'INVALID_COMMAND');
    assert.equal((await emit(otherHost, 'room:snapshot', {})).ok, true);
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
    let wrongSourcePause = false;
    stranger.once('video_paused', () => { wrongSourcePause = true; });
    const disconnectPause = receive(stranger, 'playback:state');
    const disconnectReadiness = receive(stranger, 'media:readiness');
    host.close();
    assert.equal((await disconnectPause).status, 'paused');
    assert.equal((await disconnectReadiness).totalCount, 1);
    assert.equal(wrongSourcePause, false);
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
