const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const net = require('node:net');
const { io } = require('../../frontend/node_modules/socket.io-client');
const { playlistSource, resolvePlaylist } = require('../youtubePlaylist');
const list = 'PLBCF2DAC6FFB574DE';
const videos = ['GvgqDSnpRQM', 'V4DDt30Aat4', 'dQw4w9WgXcQ', 'M7lc1UVf-VE', 'ysz5S6PUM-U', 'jNQXAC9IVRw', 'aqz-KE-bpKQ', '9bZkp7q19f0'];
let port, server; const clients = [];
const emit = (client, event, payload) => new Promise((resolve, reject) => client.timeout(3000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
const receive = (client, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(event)), 3000); client.once(event, state => { clearTimeout(timer); resolve(state); }); });
const connect = () => new Promise((resolve, reject) => { const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false }); clients.push(client); client.once('connect', () => resolve(client)); client.once('connect_error', reject); });
const state = async client => (await emit(client, 'room:snapshot', {})).snapshot.videoState;
const identity = value => ({ sourceId: value.sourceId, sourceRevision: value.sourceRevision, playlistId: value.playlistId, playlistIndex: value.playlistIndex, currentVideoId: value.currentVideoId });
const update = (client, roomId, value, action, options = {}) => emit(client, 'playlist_update', { roomId, ...identity(value), action, ...options });
const change = async (host, roomId, url = `https://youtube.com/playlist?list=${list}`) => { const received = receive(host, 'video_changed'); host.emit('change_video', { roomId, url }); return received; };
const create = async () => { const host = await connect(), viewer = await connect(); const room = await emit(host, 'room:create', { nickname: 'Playlist host', protocolVersion: 2 }); const joined = await emit(viewer, 'room:join', { roomId: room.roomId, nickname: 'Playlist viewer', protocolVersion: 2 }); return { host, viewer, roomId: room.roomId, joined }; };
const control = async (host, roomId, value, event, options = {}) => { host.emit(event, { roomId, ...identity(value), ...options }); await new Promise(resolve => setTimeout(resolve, 25)); return state(host); };

test.before(async () => {
    port = await new Promise(resolve => { const listener = net.createServer(); listener.listen(0, '127.0.0.1', () => { const selected = listener.address().port; listener.close(() => resolve(selected)); }); });
    server = fork(require.resolve('../server'), [], { env: { ...process.env, PORT: String(port), CORS_ORIGIN: '*' }, stdio: 'ignore' });
    for (let count = 0; count < 100; count++) { try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
    throw new Error('server did not start');
});
test.after(() => { clients.forEach(client => client.close()); server.kill(); });

test('index normalization honors selected video, duplicate index, invalid index and complete order', () => {
    for (const [url, items, index] of [
        [`https://youtube.com/playlist?list=${list}&index=5`, videos, 4],
        [`https://youtu.be/${videos[2]}?list=${list}&index=5`, videos, 2],
        [`https://youtube.com/playlist?list=${list}&index=9999`, videos, 0],
        [`https://youtu.be/${videos[0]}?list=${list}&index=3`, [videos[0], videos[1], videos[0]], 2],
    ]) { const value = playlistSource(url); assert.equal(resolvePlaylist(value, items), true); assert.equal(value.playlistIndex, index); assert.equal(value.currentVideoId, items[index]); assert.deepEqual(value.playlistItems, items); }
});

test('coordinator discovery, role-authorized navigation, real readiness and malformed payload validation', async () => {
    const { host, viewer, roomId } = await create(); let value = await change(host, roomId);
    assert.equal(value.sourceType, 'youtube-playlist'); assert.equal(value.isPlaying, false);
    assert.equal((await update(viewer, roomId, value, 'RESOLVE', { items: videos })).error.code, 'NOT_CONTROLLER');
    assert.equal((await update(host, roomId, value, 'RESOLVE', { items: ['invalid'] })).error.code, 'INVALID_PLAYLIST');
    assert.equal((await update(host, roomId, { ...value, sourceRevision: '0' }, 'RESOLVE', { items: videos })).error.code, 'STALE_PLAYLIST');
    value = (await update(host, roomId, value, 'RESOLVE', { items: videos })).videoState;
    assert.equal((await control(host, roomId, value, 'play_video')).isPlaying, false, 'receiving the source does not prove player readiness');
    assert.equal((await update(viewer, roomId, value, 'NEXT')).error.code, 'FORBIDDEN');
    await update(host, roomId, value, 'READY', { title: 'Actual iframe title' });
    await update(viewer, roomId, value, 'READY', { title: 'Cannot overwrite host title' });
    assert.equal((await state(host)).playlistTitles[videos[0]], 'Actual iframe title');
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.readiness.readyCount, 2);
    assert.equal((await control(host, roomId, value, 'play_video')).isPlaying, true);
});

test('Next/Previous preserve intent, old seek/end/echo cannot double-skip, full completion stays stopped', async () => {
    const { host, viewer, roomId } = await create();
    let value = (await update(host, roomId, await change(host, roomId), 'RESOLVE', { items: videos.slice(0, 3) })).videoState;
    const old = value;
    value = (await update(host, roomId, value, 'NEXT')).videoState;
    assert.equal(value.playlistIndex, 1); assert.equal(value.isPlaying, false);
    assert.equal((await update(host, roomId, old, 'NEXT')).error.code, 'STALE_PLAYLIST');
    await control(host, roomId, old, 'seek_video', { playedSeconds: 150 });
    assert.equal((await state(host)).playedSeconds, 0);
    value = (await update(host, roomId, value, 'PREVIOUS')).videoState; assert.equal(value.playlistIndex, 0);
    await update(host, roomId, value, 'READY'); value = await control(host, roomId, value, 'play_video');
    value = (await update(host, roomId, value, 'NEXT')).videoState; assert.equal(value.playlistIndex, 1); assert.equal(value.isPlaying, true);
    value = await control(host, roomId, value, 'seek_video', { playedSeconds: 12 });
    value = (await update(host, roomId, value, 'PREVIOUS')).videoState; assert.equal(value.playlistIndex, 1); assert.ok(value.playedSeconds < 1);
    assert.equal((await state(viewer)).currentVideoId, value.currentVideoId);
    const ended = value;
    await control(viewer, roomId, value, 'video_ended'); assert.equal((await state(host)).playlistIndex, 1);
    value = await control(host, roomId, value, 'video_ended'); assert.equal(value.playlistIndex, 2);
    await control(host, roomId, ended, 'video_ended'); assert.equal((await state(host)).playlistIndex, 2);
    value = await control(host, roomId, value, 'video_ended'); assert.equal(value.playlistStatus, 'finished'); assert.equal(value.isPlaying, false); assert.equal(value.playlistIndex, 2);
    await control(host, roomId, value, 'video_ended'); assert.equal((await state(host)).playlistStatus, 'finished');
});

test('Host and Moderator can navigate without takeover; stale coordinators and forged Viewer permissions cannot publish', async () => {
    const { host, viewer, roomId } = await create();
    const moderator = await connect();
    const joined = await emit(moderator, 'room:join', { roomId, nickname: 'Playlist moderator', protocolVersion: 2 });
    const promoted = receive(moderator, 'role_updated');
    host.emit('promote_to_moderator', { roomId, targetId: moderator.id });
    assert.equal((await promoted).member.permissions.canChangeSource, true);
    let value = await change(moderator, roomId);
    value = (await update(moderator, roomId, value, 'RESOLVE', { items: videos.slice(0, 3) })).videoState;
    assert.equal((await update(host, roomId, value, 'RESOLVE', { items: videos })).error.code, 'NOT_CONTROLLER');
    const forged = await update(viewer, roomId, value, 'NEXT', { role: 'Host', permissions: { canChangeSource: true } });
    assert.equal(forged.error.code, 'FORBIDDEN');
    value = (await update(host, roomId, value, 'NEXT')).videoState;
    assert.equal(value.playlistIndex, 1);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.controllerMemberId, (await emit(host, 'room:snapshot', {})).snapshot.memberId);
    value = (await update(moderator, roomId, value, 'PREVIOUS')).videoState;
    assert.equal(value.playlistIndex, 0);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.controllerMemberId, joined.memberId);
    await control(host, roomId, value, 'sync_progress', { playedSeconds: 70 });
    assert.equal((await state(host)).playedSeconds, 0, 'old coordinator telemetry cannot overwrite the new coordinator');
    const demoted = receive(moderator, 'role_updated');
    host.emit('demote_to_viewer', { roomId, targetId: moderator.id });
    assert.equal((await demoted).member.permissions.canChangeSource, false);
    assert.equal((await update(moderator, roomId, value, 'NEXT')).error.code, 'FORBIDDEN');
});

test('late join and resume retain playlist identity and synchronized item time', async () => {
    const { host, viewer, roomId, joined } = await create();
    let value = (await update(host, roomId, await change(host, roomId, `https://youtube.com/playlist?list=${list}&index=7`), 'RESOLVE', { items: videos })).videoState;
    assert.equal(value.playlistIndex, 6);
    await update(host, roomId, value, 'READY'); value = await control(host, roomId, value, 'play_video');
    value = await control(host, roomId, value, 'seek_video', { playedSeconds: 102 });
    const late = await connect(); const result = await emit(late, 'room:join', { roomId, nickname: 'Late', protocolVersion: 2 });
    assert.equal(result.videoState.currentVideoId, videos[6]); assert.equal(result.videoState.playlistIndex, 6); assert.ok(result.videoState.playedSeconds >= 102); assert.equal(result.videoState.isPlaying, true);
    viewer.close(); const resumed = await connect();
    const restored = await emit(resumed, 'room:join', { roomId, nickname: 'Playlist viewer', memberId: joined.memberId, resumeToken: joined.resumeToken, protocolVersion: 2 });
    assert.equal(restored.videoState.playlistIndex, 6); assert.equal(restored.videoState.currentVideoId, videos[6]); assert.ok(restored.videoState.playedSeconds >= 102);
});

test('unavailable items skip finitely and queue remains separate until playlist completion', async () => {
    const { host, viewer, roomId } = await create();
    let value = (await update(host, roomId, await change(host, roomId), 'RESOLVE', { items: videos.slice(0, 3) })).videoState;
    assert.equal((await update(viewer, roomId, value, 'ERROR')).error.code, 'NOT_CONTROLLER');
    for (let index = 0; index < 3; index++) {
        const old = value; value = (await update(host, roomId, value, 'ERROR')).videoState;
        assert.equal((await update(host, roomId, old, 'ERROR')).error.code, 'STALE_PLAYLIST');
    }
    assert.equal(value.playlistStatus, 'error'); assert.equal(value.isPlaying, false); assert.equal(value.unavailableIndexes.length, 3);
    value = (await update(host, roomId, await change(host, roomId), 'RESOLVE', { items: videos.slice(0, 2) })).videoState;
    host.emit('add_to_queue', { roomId, url: 'https://cdn.example/next.mp4', label: 'Room queue source' });
    await update(host, roomId, value, 'READY'); value = await control(host, roomId, value, 'play_video');
    value = await control(host, roomId, value, 'video_ended'); assert.equal(value.playlistIndex, 1);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 1);
    value = await control(host, roomId, value, 'video_ended'); assert.equal(value.sourceType, 'remote'); assert.equal(value.url, 'https://cdn.example/next.mp4'); assert.equal(value.isPlaying, true);
    assert.equal((await emit(host, 'room:snapshot', {})).snapshot.queue.length, 0);
});

test('old playlist events cannot overwrite a replacement playlist or a queued single video', async () => {
    const { host, roomId } = await create();
    const old = (await update(host, roomId, await change(host, roomId), 'RESOLVE', { items: videos })).videoState;
    let value = await change(host, roomId, `https://youtube.com/playlist?list=${list}&index=5`);
    await control(host, roomId, old, 'seek_video', { playedSeconds: 90 });
    assert.equal((await state(host)).playedSeconds, 0);
    assert.equal((await update(host, roomId, old, 'NEXT')).error.code, 'STALE_PLAYLIST');
    value = await change(host, roomId, 'https://youtu.be/dQw4w9WgXcQ');
    await control(host, roomId, old, 'pause_video', { playedSeconds: 90 });
    value = await state(host);
    assert.equal(value.isPlaying, true);
    assert.ok(value.playedSeconds < 1);
});
