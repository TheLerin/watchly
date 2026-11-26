import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, connect } from './harness.mjs';


const create = async () => {
  const setup = environment(), item = await setup.room();
  const host = await connect(item), room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  assert.equal(room?.ok, true); return { setup, item, host, room };
};
const snapshot = async client => (await client.send('room:snapshot')).snapshot;

test('native room creation, join, guest identity, room isolation and permissions', async () => {
  const { setup, item, host, room } = await create();
  const viewer = await connect(item), joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', role: 'Host', protocolVersion: 2 });
  assert.equal(joined.user.role, 'Viewer');
  await viewer.send('change_video', { roomId: room.roomId, url: 'https://example.test/forged.mp4' });
  assert.equal((await snapshot(host)).videoState.url, '');
  await host.send('change_video', { roomId: room.roomId, url: 'https://example.test/movie.mp4' });
  assert.equal((await snapshot(viewer)).videoState.url, 'https://example.test/movie.mp4');
  assert.equal((await viewer.send('room:join', { roomId: 'ZZZZZZZ', nickname: 'Wrong room', protocolVersion: 2 })).error.code, 'FORBIDDEN');
  const other = await setup.room('HIJKLMN'); other.code = 'HIJKLMN'; const outsider = await connect(other);
  assert.equal((await outsider.send('room:join', { roomId: 'HIJKLMN', nickname: 'Missing', protocolVersion: 2 })).error.code, 'ROOM_NOT_FOUND');
});

test('chat, queue, moderator controls, duplicate frames and stale sequence rejection', async () => {
  const { item, host, room } = await create(); const viewer = await connect(item);
  const joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
  const id = crypto.randomUUID();
  await viewer.send('send_message', { roomId: room.roomId, message: { text: 'Hello <b>room</b>' } }, { id });
  const seq = viewer.seq;
  await viewer.send('send_message', { roomId: room.roomId, message: { text: 'Duplicate' } }, { id, seq });
  await viewer.send('send_message', { roomId: room.roomId, message: { text: 'Duplicate with a higher sequence' } }, { id });
  assert.equal((await snapshot(host)).chatHistory.length, 1);
  await host.send('promote_to_moderator', { roomId: room.roomId, targetId: viewer.id });
  await viewer.send('add_to_queue', { roomId: room.roomId, url: 'https://example.test/next.mp4', label: 'Next' });
  assert.equal((await snapshot(host)).queue.length, 1);
  assert.equal((await viewer.send('room:snapshot', {}, { seq: 1 })).error.code, 'REPLAY');
});

test('SQLite and socket attachments restore state, roles, snapshots and resume tokens after eviction', async () => {
  const { setup, item, host, room } = await create();
  await host.send('change_video', { roomId: room.roomId, url: 'https://example.test/restored.mp4' });
  await setup.evict(room.roomId);
  assert.equal((await snapshot(host)).videoState.url, 'https://example.test/restored.mp4');
  assert.equal((await snapshot(host)).members[0].role, 'Host');
  await host.close();
  await setup.evict(room.roomId);
  const resumed = await connect(item);
  const result = await resumed.send('room:join', { ...room, nickname: 'Host', protocolVersion: 2 });
  assert.equal(result.ok, true); assert.equal(result.memberId, room.memberId);
  assert.equal(result.snapshot.members.length, 1);
  assert.equal(result.snapshot.videoState.url, 'https://example.test/restored.mp4');
});

test('local media stays metadata-only, readiness and ordered play/pause/seek survive eviction', async () => {
  const { setup, item, host, room } = await create();
  const descriptor = { sourceType: 'local-file', mediaId: `sampled-sha256-v1:1000:${'a'.repeat(64)}`, fingerprintVersion: 'sampled-sha256-v1', displayTitle: 'Local', sizeBytes: 1000, durationMs: 120000 };
  const declared = await host.send('media:declare', { descriptor }); assert.equal(declared.ok, true);
  const command = action => ({ commandId: crypto.randomUUID(), mediaId: descriptor.mediaId, action, positionSec: 20, startAnyway: true });
  assert.equal((await host.send('playback:command', command('PLAY'))).ok, true);
  assert.equal((await host.send('playback:command', command('SEEK'))).ok, true);
  assert.equal((await host.send('playback:command', command('PAUSE'))).ok, true);
  const before = (await snapshot(host)).playback;
  await setup.evict(room.roomId);
  const restored = await snapshot(host); assert.equal(restored.playback.seq, before.seq); assert.equal(restored.media.mediaId, descriptor.mediaId);
  assert.equal(restored.playback.status, 'paused');
  assert.equal(item.object.store.load().rooms.get(room.roomId).media.sizeBytes, 1000);
  assert.equal(item.ctx.storage.sql.exec('SELECT value FROM state').toArray().length, 0);
});

test('server-side kick persists a media removal job, fences media tokens and resume', async () => {
  const { setup, item, host, room } = await create(); const viewer = await connect(item);
  const joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
  await host.send('kick_user', { roomId: room.roomId, targetId: joined.memberId });
  assert.equal(item.object.mediaRemovals.has(joined.memberId), true);
  const proof = new Request('https://internal/authorize', { method: 'POST', body: JSON.stringify({ roomId: room.roomId, socketId: viewer.id, resumeToken: joined.resumeToken }) });
  assert.equal((await item.object.fetch(proof)).status, 403);
  await setup.evict(room.roomId); assert.equal(item.object.mediaRemovals.has(joined.memberId), true);
  assert.equal((await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2, resumeToken: joined.resumeToken, memberId: joined.memberId })).error.code, 'MEMBER_BANNED');
});

test('cross-room WebRTC signaling, oversized frames and invalid protocols are rejected', async () => {
  const { item, host, room } = await create(), viewer = await connect(item);
  await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
  await host.send('webrtc_offer', { targetSocketId: 'foreign', offer: { type: 'offer', sdp: 'invalid' } });
  assert.equal(viewer.ws.messages.some(message => message.event === 'webrtc_offer'), false);
  await item.object.webSocketMessage(viewer.ws, 'x'.repeat(256 * 1024 + 1)); assert.equal(viewer.ws.closed.code, 1009);
  const invalid = await connect(item); await item.object.webSocketMessage(invalid.ws, JSON.stringify({ v: 99 })); assert.equal(invalid.ws.closed.code, 1008);
  let authCalls = 0; item.object.accounts.verify = async () => { authCalls++; throw new Error('Should not verify oversized input'); };
  const unicode = await connect(item);
  await item.object.webSocketMessage(unicode.ws, JSON.stringify({ v: 1, type: 'hello', accessToken: 'token', padding: '€'.repeat(100000) }));
  assert.equal(unicode.ws.closed.code, 1009); assert.equal(authCalls, 0);
});

test('native payload validation rejects null, scalars and arrays without losing membership', async () => {
  const { item, host } = await create();
  for (const payload of [null, [], 1, 'text', true]) {
    assert.equal((await host.send('room:join', payload)).error.code, 'INVALID_PAYLOAD');
  }
  assert.equal((await host.send('room:snapshot')).ok, true);
  assert.equal(item.object.rooms.get('ABCDEFG').users.length, 1);
});

test('signed media-event delivery is idempotent and does not reset failed removal attempts', async () => {
  const setup = environment(), empty = await setup.room('HIJKLMN');
  await empty.object.fetch(new Request('https://internal/media-event', { method: 'POST', body: JSON.stringify({ id: 'unknown-room-event', event: 'participant_joined', room: { name: 'watchly-development-voice-HIJKLMN' }, participant: { identity: 'watchly-stale-member' } }) }));
  assert.equal(empty.object.mediaRemovals.get('stale-member').roomId, 'HIJKLMN');
  const { item } = await create();
  const event = { id: 'test-event-1', event: 'participant_joined', room: { name: 'watchly-development-voice-ABCDEFG' }, participant: { identity: 'watchly-removed-member' } };
  const deliver = () => item.object.fetch(new Request('https://internal/media-event', { method: 'POST', body: JSON.stringify(event) }));
  assert.equal((await deliver()).ok, true);
  item.object.mediaRemovals.get('removed-member').failures = 5;
  const duplicate = await (await deliver()).json(); assert.equal(duplicate.duplicate, true);
  assert.equal(item.object.mediaRemovals.get('removed-member').failures, 5);
});

test('failed server media removal remains durable and retries after eviction', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: calls === 1 ? 503 : 200 }); };
  try {
    const setup = environment({ LIVEKIT_URL: 'wss://media-fixture.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: 'test-secret' });
    const item = await setup.room(), host = await connect(item), room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
    const viewer = await connect(item), joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    await host.send('kick_user', { roomId: room.roomId, targetId: joined.memberId }); await item.object.alarm();
    await Promise.all(item.ctx.tasks);
    assert.equal(calls, 1); assert.equal(item.object.mediaRemovals.get(joined.memberId).failures, 1);
    item.object.mediaRemovals.get(joined.memberId).nextAt = Date.now() - 1; await item.object.commit();
    await setup.evict(room.roomId); await item.object.alarm();
    await Promise.all(item.ctx.tasks);
    assert.equal(calls, 2); assert.equal(item.object.mediaRemovals.size, 0); assert.equal(item.object.rooms.get(room.roomId).kickedUserIds.has(joined.memberId), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('media removal retries past twelve failures, then expires its terminal record without dropping the ban', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 503 }); };
  try {
    const setup = environment({ LIVEKIT_URL: 'wss://media-fixture.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' });
    const item = await setup.room(), host = await connect(item), room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
    const viewer = await connect(item), joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    await host.send('kick_user', { roomId: room.roomId, targetId: joined.memberId });
    for (let attempt = 0; attempt < 12; attempt++) {
      await item.object.serial(async () => { item.object.mediaRemovals.get(joined.memberId).nextAt = Date.now() - 1; await item.object.removeMediaParticipants(); await item.object.commit(); });
      await Promise.all(item.ctx.tasks);
    }
    assert.equal(calls, 12); assert.equal(item.object.mediaRemovals.get(joined.memberId).terminal, false);
    item.object.mediaRemovals.get(joined.memberId).createdAt = Date.now() - 86400001;
    item.object.mediaRemovals.get(joined.memberId).nextAt = Date.now() - 1;
    await item.object.serial(async () => { await item.object.removeMediaParticipants(); await item.object.commit(); });
    await Promise.all(item.ctx.tasks);
    assert.equal(calls, 13); assert.equal(item.object.mediaRemovals.get(joined.memberId).terminal, true);
    item.object.mediaRemovals.get(joined.memberId).nextAt = Date.now() - 1;
    await item.object.serial(async () => { await item.object.removeMediaParticipants(); await item.object.commit(); });
    assert.equal(calls, 13); assert.equal(item.object.mediaRemovals.size, 0);
    assert.equal(item.object.rooms.get(room.roomId).kickedUserIds.has(joined.memberId), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('slow media administration does not hold active room snapshots or restore kicked privileges', { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch; let release, began;
  const started = new Promise(resolve => { began = resolve; });
  globalThis.fetch = () => new Promise(resolve => { release = () => resolve(new Response('{}')); began(); });
  try {
    const setup = environment({ LIVEKIT_URL: 'wss://media-fixture.livekit.cloud', LIVEKIT_API_KEY: 'key', LIVEKIT_API_SECRET: 'secret' });
    const item = await setup.room(), host = await connect(item), room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
    const viewer = await connect(item), joined = await viewer.send('room:join', { roomId: room.roomId, nickname: 'Viewer', protocolVersion: 2 });
    await host.send('kick_user', { roomId: room.roomId, targetId: joined.memberId }); await item.object.alarm();
    await started;
    assert.equal((await host.send('room:snapshot')).ok, true);
    assert.equal(item.object.rooms.get(room.roomId).kickedUserIds.has(joined.memberId), true);
    release(); await Promise.all(item.ctx.tasks);
  } finally { globalThis.fetch = originalFetch; }
});
