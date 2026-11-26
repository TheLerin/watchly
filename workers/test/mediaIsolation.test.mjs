import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveKitProvider, signJwt } from '../src/media.mjs';
import mediaIdentity from '../../backend/livekitIdentity.js';
import { environment } from './harness.mjs';
import app from '../src/index.mjs';
const config = { LIVEKIT_URL: 'wss://media-test.livekit.cloud', LIVEKIT_API_KEY: 'test-api', LIVEKIT_API_SECRET: 'test-secret-fixture' };

test('staging, production and legacy share no room names, and removal grants/body name only their own namespace', async () => {
  const names = new Set();
  for (const namespace of ['staging', 'production']) {
    const env = { ...config, NODE_ENV: 'production', LIVEKIT_ROOM_NAMESPACE: namespace }; let removal;
    const provider = new LiveKitProvider(env, async (_url, options) => { removal = options; return Response.json({}); });
    const { participantToken } = await provider.token('ABCDEFG', { userId: 'member', nickname: 'Member' });
    const claims = JSON.parse(Buffer.from(participantToken.split('.')[1], 'base64url')); names.add(claims.video.room);
    assert.equal(claims.video.room, `watchly-${namespace}-voice-ABCDEFG`);
    await provider.remove('ABCDEFG', 'member');
    assert.equal(JSON.parse(removal.body).room, claims.video.room);
    const admin = JSON.parse(Buffer.from(removal.headers.Authorization.slice(7).split('.')[1], 'base64url'));
    assert.equal(admin.video.room, claims.video.room); assert.equal(admin.video.roomAdmin, true);
  }
  names.add(mediaIdentity.voiceRoomName('ABCDEFG', { LIVEKIT_ROOM_NAMESPACE: 'legacy-render' })); assert.equal(names.size, 3);
  assert.throws(() => new LiveKitProvider({ ...config, NODE_ENV: 'production' }), /namespace/);
});

test('signed foreign/unscoped webhooks are ignored before allocating a room or touching any removal job', async () => {
  const setup = environment({ ...config, LIVEKIT_ROOM_NAMESPACE: 'staging' });
  for (const name of ['watchly-production-voice-ABCDEFG', 'watchly-legacy-render-voice-ABCDEFG', 'watchly-voice-ABCDEFG']) {
    const raw = JSON.stringify({ id: name, event: 'participant_joined', room: { name }, participant: { identity: 'watchly-shared-account' } });
    const token = await signJwt(config.LIVEKIT_API_SECRET, { iss: config.LIVEKIT_API_KEY, exp: Math.floor(Date.now() / 1000) + 60,
      sha256: Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('base64') });
    const response = await app.fetch(new Request('https://watchly.test/api/livekit/webhook', { method: 'POST', headers: { Authorization: token }, body: raw }), setup.env);
    assert.equal(response.status, 200); assert.equal(setup.rooms.size, 0);
  }
  const item = await setup.room();
  const foreign = await item.object.fetch(new Request('https://internal/media-event', { method: 'POST', body: JSON.stringify({ event: 'participant_joined', room: { name: 'watchly-production-voice-ABCDEFG' }, participant: { identity: 'watchly-shared-account' } }) }));
  assert.equal((await foreign.json()).ignored, true); assert.equal(item.object.mediaRemovals.size, 0);
});

test('old unscoped or foreign persisted removal jobs never call the provider after reconstruction', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    const setup = environment({ ...config, LIVEKIT_ROOM_NAMESPACE: 'staging' }), item = await setup.room();
    item.object.mediaRemovals.set('foreign', { roomId: 'ABCDEFG', memberId: 'foreign', namespace: 'production', nextAt: 0, failures: 0 });
    item.object.mediaRemovals.set('old', { roomId: 'ABCDEFG', memberId: 'old', nextAt: 0, failures: 0 });
    await item.object.commit(); await setup.evict('ABCDEFG'); await item.object.alarm(); await Promise.all(item.ctx.tasks);
    assert.equal(calls, 0); assert.equal(item.object.mediaRemovals.get('foreign').terminal, true); assert.equal(item.object.mediaRemovals.get('old').terminal, true);
  } finally { globalThis.fetch = original; }
});

test('queued media removals wait for provider capacity and run when a slot opens', { timeout: 3000 }, async () => {
  const original = globalThis.fetch;
  const requests = [];
  const firstWave = Promise.withResolvers();
  const lastRequest = Promise.withResolvers();
  globalThis.fetch = () => new Promise(resolve => {
    requests.push(() => resolve(Response.json({})));
    if (requests.length === 4) firstWave.resolve();
    if (requests.length === 5) lastRequest.resolve();
  });
  try {
    const setup = environment({ ...config, LIVEKIT_ROOM_NAMESPACE: 'staging' }), item = await setup.room();
    for (let i = 0; i < 5; i++) item.object.queueMediaRemoval('ABCDEFG', `member-${i}`);
    await item.object.commit();
    await item.object.alarm();
    assert.equal(item.object.mediaInFlight.size, 4);
    await firstWave.promise;
    assert.ok(item.ctx.alarmAt > Date.now(), 'the full queue should keep its watchdog alarm');

    requests[0]();
    await Promise.race(item.ctx.tasks);
    assert.ok(item.ctx.alarmAt <= Date.now(), 'releasing a slot should wake the waiting job');
    await item.object.alarm();
    await lastRequest.promise;
    assert.equal(item.object.mediaInFlight.size, 4);
    requests.slice(1).forEach(resolve => resolve());
    await Promise.all(item.ctx.tasks);
    assert.equal(item.object.mediaRemovals.size, 0);
  } finally {
    globalThis.fetch = original;
    requests.forEach(resolve => resolve());
  }
});
