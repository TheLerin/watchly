import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.mjs';
import { environment, connect } from './harness.mjs';

test('same-origin API routing enforces Origin, body size, room proof, media access and unknown API 404s', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  const room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  const request = (path, init = {}) => app.fetch(new Request('https://watchly.test' + path, init), setup.env);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/api/missing')).status, 404);
  assert.equal((await request('/api/livekit/token', { method: 'POST', body: JSON.stringify({ roomId: room.roomId, socketId: host.id, resumeToken: 'wrong'.repeat(10) }) })).status, 403);
  assert.equal((await request('/api/livekit/token', { method: 'POST', body: 'x'.repeat(4097) })).status, 413);
  assert.equal((await request('/api/livekit/token', { method: 'POST', body: '{invalid' })).status, 400);
  for (const body of ['null', '[]', '"text"', '123']) assert.equal((await request('/api/livekit/token', { method: 'POST', body })).status, 400);
  assert.equal((await request('/api/proxy/gdrive?id=abcdefghijk&roomId=ABCDEFG')).status, 401);
  assert.equal((await request('/ws/rooms/ABCDEFG', { headers: { Upgrade: 'websocket' } })).status, 403);
});
test('room previews use the current deployment origin and retain Vite scripts', async () => {
  const setup = environment(); setup.env.ASSETS = { fetch: async () => new Response('<head><title>Watchly</title><meta property="og:url" content="https://old.test"></head><body><script src="/assets/app.js"></script></body>') };
  const response = await app.fetch(new Request('https://watchly.test/room/ABCDEFG'), setup.env);
  const html = await response.text(); assert.ok(html.includes('https://watchly.test/room/ABCDEFG')); assert.ok(html.includes('/assets/app.js'));
});
