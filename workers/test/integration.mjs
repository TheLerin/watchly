import assert from 'node:assert/strict';
import { localServer } from './local-server.mjs';
import { client } from './client.mjs';
const server = await localServer(), clients = [];
const connect = async room => { const value = await client(server.base, room); clients.push(value); return value; };
try {
  const code = crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
  const host = await connect(code), room = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  assert.equal(room.ok, true); assert.equal(room.roomId, code);
  const viewer = await connect(code), joined = await viewer.send('room:join', { roomId: code, nickname: 'Viewer', protocolVersion: 2 });
  assert.equal(joined.user.role, 'Viewer');
  await viewer.send('send_message', { roomId: code, message: { id: 'hello', text: 'Hello from native WebSocket' } });
  await host.send('change_video', { roomId: code, url: 'https://example.test/movie.mp4' });
  await host.send('add_to_queue', { roomId: code, url: 'https://example.test/next.mp4' });
  const snap = (await viewer.send('room:snapshot')).snapshot;
  assert.equal(snap.chatHistory.length, 1); assert.equal(snap.queue.length, 1);
  assert.equal(snap.videoState.url, 'https://example.test/movie.mp4');
  await viewer.send('change_video', { roomId: code, url: 'https://example.test/forged.mp4' });
  assert.equal((await host.send('room:snapshot')).snapshot.videoState.url, snap.videoState.url);
  await host.send('kick_user', { roomId: code, targetId: joined.memberId });
  assert.equal((await viewer.send('room:join', { roomId: code, nickname: 'Viewer', protocolVersion: 2, resumeToken: joined.resumeToken, memberId: joined.memberId })).error.code, 'MEMBER_BANNED');
  assert.equal((await fetch(server.base + '/room/ABCDEFG', { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await fetch(server.base + '/api/proxy/gdrive?id=abcdefghijk&roomId=' + code)).status, 401);
  assert.equal((await fetch(server.base + '/api/health', { headers: { Origin: 'https://evil.test' } })).status, 403);
  console.log('PASS real Wrangler/workerd: native room, chat, queue, source, host-only authorization, kick, media authorization, SPA and Origin checks.');
} finally { clients.forEach(value => value.close()); server.stop(); }
