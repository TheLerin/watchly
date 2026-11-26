import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, connect } from './harness.mjs';
const entry = (client, code, nickname, creating = false) => client.send(creating ? 'room:create' : 'room:join', { roomId: code, nickname, protocolVersion: 2 });

test('peer-to-peer voice and screen signaling relay only between authorized room peers', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item), room = await entry(host, 'ABCDEFG', 'Host', true);
  const viewer = await connect(item); await entry(viewer, room.roomId, 'Viewer');
  assert.equal((await host.send('join_voice', { roomId: room.roomId })).ok, true);
  assert.equal((await viewer.send('join_voice', { roomId: room.roomId })).ok, true);
  await host.send('webrtc_offer', { targetSocketId: viewer.id, offer: { type: 'offer', sdp: 'test-sdp' } });
  assert.ok(viewer.ws.messages.some(frame => frame.event === 'webrtc_offer'));
  const screen = await host.send('screen:started'); assert.equal(screen.ok, true); assert.equal(screen.viewers.length, 1);
  await host.send('screen:offer', { targetSocketId: viewer.id, offer: { type: 'offer', sdp: 'screen-sdp' } });
  assert.ok(viewer.ws.messages.some(frame => frame.event === 'screen:offer'));
  assert.equal((await viewer.send('screen:started')).ok, false);
  await host.send('screen:stopped'); assert.ok(viewer.ws.messages.some(frame => frame.event === 'screen:stopped'));
});

test('late screen viewers receive authorized offers within the three-viewer cap and departures notify the sharer', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  await entry(host, 'ABCDEFG', 'Host', true); await host.send('screen:started');
  const viewers = [];
  for (let index = 0; index < 4; index++) { const viewer = await connect(item); await entry(viewer, 'ABCDEFG', `Viewer ${index}`); viewers.push(viewer); }
  assert.equal(host.ws.messages.filter(frame => frame.event === 'screen:viewer-added').length, 3);
  assert.ok(viewers[3].ws.messages.some(frame => frame.event === 'screen:unavailable'));
  await host.send('screen:offer', { targetSocketId: viewers[0].id, offer: { type: 'offer', sdp: 'late-viewer' } });
  assert.ok(viewers[0].ws.messages.some(frame => frame.event === 'screen:offer'));
  await viewers[0].close(); assert.ok(host.ws.messages.some(frame => frame.event === 'screen:viewer-left' && frame.args[0].socketId === viewers[0].id));
});

test('negotiated queue deltas are ordered and legacy clients retain whole-queue compatibility', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  await entry(host, 'ABCDEFG', 'Host', true);
  const viewer = await connect(item); await entry(viewer, 'ABCDEFG', 'Viewer');
  item.object.io.sockets.sockets.get(host.id).data.queueDeltas = true;
  await host.send('add_to_queue', { roomId: 'ABCDEFG', url: 'https://example.test/one.mp4' });
  const first = host.ws.messages.findLast(frame => frame.event === 'queue:delta').args[0];
  assert.equal(first.baseRevision, 0); assert.equal(first.revision, 1); assert.equal(first.op, 'add');
  assert.ok(viewer.ws.messages.some(frame => frame.event === 'queue_updated'));
  await host.send('remove_from_queue', { roomId: 'ABCDEFG', itemId: first.item.id });
  const second = host.ws.messages.findLast(frame => frame.event === 'queue:delta').args[0];
  assert.equal(second.baseRevision, 1); assert.equal(second.revision, 2); assert.equal(second.itemId, first.item.id);
  assert.equal((await host.send('room:snapshot')).snapshot.queueRevision, 2);
});

test('YouTube playlists retain discovery, item identity, queue separation and navigation', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item), room = await entry(host, 'ABCDEFG', 'Host', true);
  await host.send('change_video', { roomId: room.roomId, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLtest123456789' });
  let state = (await host.send('room:snapshot')).snapshot.videoState;
  const payload = () => ({ roomId: room.roomId, sourceId: state.sourceId, sourceRevision: state.sourceRevision, playlistId: state.playlistId, playlistIndex: state.playlistIndex, currentVideoId: state.currentVideoId });
  const resolution = await host.send('playlist_update', { ...payload(), action: 'RESOLVE', items: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] });
  assert.equal(resolution.ok, true);
  state = (await host.send('room:snapshot')).snapshot.videoState;
  assert.equal(state.currentVideoId, 'aaaaaaaaaaa');
  assert.equal((await host.send('playlist_update', { ...payload(), action: 'NEXT' })).ok, true);
  state = (await host.send('room:snapshot')).snapshot.videoState; assert.equal(state.currentVideoId, 'bbbbbbbbbbb');
  await setup.evict(room.roomId); assert.equal((await host.send('room:snapshot')).snapshot.videoState.currentVideoId, 'bbbbbbbbbbb');
});

test('host leases and empty-room cleanup restore their deadlines after eviction', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item), room = await entry(host, 'ABCDEFG', 'Host', true);
  const viewer = await connect(item), joined = await entry(viewer, room.roomId, 'Viewer');
  await host.close();
  item.object.rooms.get(room.roomId).controllerLeaseUntil = Date.now() - 1; await item.object.commit();
  await setup.evict(room.roomId); await item.object.alarm();
  assert.equal((await viewer.send('room:snapshot')).snapshot.controllerMemberId, joined.memberId);
  await viewer.close(); item.object.rooms.get(room.roomId).lastActiveAt = Date.now() - 301000; await item.object.commit();
  await setup.evict(room.roomId); await item.object.alarm(); assert.equal(item.object.rooms.size, 0);
  assert.equal(item.ctx.storage.sql.exec('SELECT id FROM room_meta').toArray().length, 0);
});

test('auth rejects forged handshakes, restores verified identities and expires privileges', async () => {
  const setup = environment(), item = await setup.room();
  const id = '00000000-0000-4000-8000-000000000001';
  item.object.accounts.verify = async token => {
    if (token !== 'verified') throw Object.assign(new Error('invalid'), { code: 'AUTH_REQUIRED' });
    return { id, token, expiresAt: Date.now() + 60000, profile: { id, username: 'alice', display_name: 'Alice', avatar_url: null } };
  };
  const invalid = await connect(item, 'forged'); assert.equal(invalid.ws.closed.code, 1011); assert.equal(invalid.ws.messages.at(-1).error.code, 'AUTH_REQUIRED');
  const host = await connect(item, 'verified'), room = await entry(host, 'ABCDEFG', 'Fake name', true);
  assert.equal(room.user.nickname, 'Alice'); assert.equal(room.user.userId, id);
  await setup.evict(room.roomId);
  item.object.io.sockets.sockets.get(host.id).data.account.expiresAt = Date.now() - 1;
  await host.send('network_ping');
  assert.equal(item.object.io.sockets.sockets.get(host.id).data.account, null);
  assert.ok(host.ws.messages.some(frame => frame.event === 'account:expired'));
});

test('read-only network/clock traffic does not rewrite authoritative room state', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item); await entry(host, 'ABCDEFG', 'Host', true);
  const before = item.object.store.rowsWritten;
  for (let index = 0; index < 5; index++) { await host.send('network_ping'); await host.send('clock:ping', { clientSendMs: Date.now() }); }
  const after = item.object.store.rowsWritten;
  assert.equal(after, before); assert.equal(item.ctx.autoResponse.request, '__watchly_ping__');
});

test('slow account verification on another socket does not block an active room snapshot', { timeout: 2000 }, async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  await entry(host, 'ABCDEFG', 'Host', true);
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  item.object.accounts.verify = token => { began(); return new Promise(resolve => { release = () => resolve({ token, id: '00000000-0000-4000-8000-000000000001', expiresAt: Date.now() + 60000, profile: null }); }); };
  const joining = connect(item, 'delayed-token'); await started;
  const snapshot = await host.send('room:snapshot'); assert.equal(snapshot.ok, true);
  release(); await joining;
});
