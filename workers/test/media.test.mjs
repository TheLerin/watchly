import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { LiveKitProvider, buildIceConfig, signJwt, mediaProvider } from '../src/media.mjs';
import { verifyTicket, streamDrive, validDriveUrl } from '../src/drive.mjs';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { TokenVerifier } = require('livekit-server-sdk');
const env = { LIVEKIT_URL: 'wss://media-test.livekit.cloud', LIVEKIT_API_KEY: 'test-api', LIVEKIT_API_SECRET: 'test-secret-fixture' };

test('Worker WebCrypto tokens are verified by the existing LiveKit SDK and have matching grants', async () => {
  const provider = new LiveKitProvider(env), issued = await provider.token('ABCDEFG', { userId: 'member1', nickname: 'Member' });
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(issued.participantToken);
  assert.equal(claims.sub, 'watchly-member1'); assert.equal(claims.video.room, 'watchly-voice-ABCDEFG');
  assert.deepEqual(claims.video.canPublishSources, ['microphone', 'camera']); assert.equal(claims.video.canPublishData, false);
  assert.ok(claims.exp - claims.nbf <= 125);
});
test('moderation uses a scoped server-only RoomService token and never leaks credentials', async () => {
  let request;
  const provider = new LiveKitProvider(env, async (url, options) => { request = { url, options }; return new Response('{}'); });
  await provider.remove('ABCDEFG', 'member1');
  assert.equal(request.url.pathname, '/twirp/livekit.RoomService/RemoveParticipant');
  assert.deepEqual(JSON.parse(request.options.body), { room: 'watchly-voice-ABCDEFG', identity: 'watchly-member1' });
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(request.options.headers.Authorization.slice(7));
  assert.equal(claims.video.roomAdmin, true); assert.equal(claims.video.roomJoin, undefined);
  assert.throws(() => mediaProvider({ MEDIA_PROVIDER: 'cloudflare' }), /not enabled/);
});

test('provider room creation applies and verifies a hard participant cap without exposing the administration grant', async () => {
  let request;
  const provider = new LiveKitProvider(env, async (url, options) => { request = { url, options }; return Response.json({ maxParticipants: 6 }); });
  await provider.ensureRoom('ABCDEFG');
  assert.equal(JSON.parse(request.options.body).max_participants, 6);
  const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(request.options.headers.Authorization.slice(7));
  assert.equal(claims.video.roomCreate, true); assert.equal(claims.video.roomJoin, undefined);
  await assert.rejects(new LiveKitProvider(env, async () => Response.json({ maxParticipants: 0 })).ensureRoom('ABCDEFG'), /needs to empty/);
});
test('webhook signatures, body hashes, media-cookie signatures and expiry fail closed', async () => {
  const provider = new LiveKitProvider(env), raw = JSON.stringify({ event: 'participant_joined' });
  const sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('base64');
  const token = await signJwt(env.LIVEKIT_API_SECRET, { iss: env.LIVEKIT_API_KEY, exp: Math.floor(Date.now() / 1000) + 60, sha256 });
  assert.equal((await provider.verifyWebhook(raw, token)).event, 'participant_joined');
  await assert.rejects(provider.verifyWebhook(raw + ' ', token));
  await assert.rejects(verifyTicket('secret', await signJwt('secret', { exp: 1 })));
  const ticket = await signJwt('secret', { exp: Math.floor(Date.now() / 1000) + 60, roomId: 'ABCDEFG' });
  assert.equal((await verifyTicket('secret', ticket)).roomId, 'ABCDEFG'); await assert.rejects(verifyTicket('other', ticket));
});
test('Drive preserves Range, 206, HEAD and 416 without buffering the media body', async () => {
  const seen = [], fetcher = async (_url, init) => { seen.push(init); return new Response(new Uint8Array([1, 2]), { status: 206, headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/100', 'Content-Length': '2' } }); };
  const result = await streamDrive(new Request('https://watchly.test/api/proxy/gdrive?id=abcdefghijk', { headers: { Range: 'bytes=0-1' } }), {}, fetcher);
  assert.equal(result.status, 206); assert.equal(result.headers.get('Content-Range'), 'bytes 0-1/100'); assert.equal(seen[0].headers.Range, 'bytes=0-1');
  const head = await streamDrive(new Request('https://watchly.test/api/proxy/gdrive?id=abcdefghijk', { method: 'HEAD' }), {}, fetcher); assert.equal(head.body, null);
  const rangeError = await streamDrive(new Request('https://watchly.test/api/proxy/gdrive?id=abcdefghijk'), {}, async () => new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */100' } }));
  assert.equal(rangeError.status, 416);
});
test('Drive validates every redirect and cannot become an open SSRF proxy', async () => {
  for (const url of ['http://drive.google.com/file', 'https://127.0.0.1/', 'https://drive.google.com.evil.test/', 'https://drive.google.com:8443/', 'https://a@drive.google.com/']) assert.equal(validDriveUrl(url), false);
  let count = 0;
  const response = await streamDrive(new Request('https://watchly.test/api/proxy/gdrive?id=abcdefghijk'), {}, async () => { count++; return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data' } }); });
  assert.equal(count, 1); assert.equal(response.status, 502);
  assert.equal(buildIceConfig({ TURN_URLS: 'turns:turn.test:443', TURN_SHARED_SECRET: 'secret' }).iceServers.length, 1);
});
