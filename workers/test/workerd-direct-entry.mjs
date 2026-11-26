// Workerd's native test handler uses in-process service bindings; no TCP listener or provider credentials are needed.
import worker from '../src/index.mjs';
import access from '../../backend/roomAccess.js';
import { WatchRoom as BaseWatchRoom } from '../src/index.mjs';
import { createFrameReceiver } from '../../frontend/src/utils/frameReceiver.js';
export { PresenceDirectory, AbuseGuard } from '../src/index.mjs';
let roomConstructions = 0;
export class WatchRoom extends BaseWatchRoom { constructor(ctx, env) { super(ctx, env); roomConstructions++; } }
const check = (condition, message) => { if (!condition) throw new Error(message); };

async function connect(env, ctx, code) {
  const response = await worker.fetch(new Request(`https://watchly.test/ws/rooms/${code}`, { headers: { Upgrade: 'websocket', Origin: 'https://watchly.test' } }), env, ctx);
  check(response.status === 101, `WebSocket rejected: ${response.status}`);
  const ws = response.webSocket, pending = new Map(); let seq = 0, welcome;
  const connected = new Promise(resolve => { welcome = resolve; });
  const receiver = createFrameReceiver({ receipt: seq => ws.send(JSON.stringify({ v: 1, type: 'delivery-ack', seq })), fail: () => { throw new Error('Snapshot transfer failed'); } });
  ws.accept();
  ws.addEventListener('message', message => {
    const frame = receiver.accept(JSON.parse(message.data)); if (!frame) return;
    if (frame.type === 'welcome') welcome(frame.id);
    if (frame.ack && pending.has(frame.ack)) { const call = pending.get(frame.ack); pending.delete(frame.ack); call(frame.result); }
  });
  ws.send(JSON.stringify({ v: 1, type: 'hello', features: ['delivery-ack-v1'] }));
  const id = await connected;
  return { ws, id, send(event, payload = {}) {
    const id = crypto.randomUUID();
    return new Promise(resolve => { pending.set(id, resolve); ws.send(JSON.stringify({ v: 1, id, seq: ++seq, event, args: [payload], ack: true })); });
  } };
}

export const cryptoCompatibility = { async test() {
  const record = await access.passwordRecord('workerd-password-123');
  check(record.iterations === 600000, 'Password KDF strength changed');
  check(await access.verifyPassword(record, 'workerd-password-123'), 'WebCrypto password verification failed');
  check(!await access.verifyPassword(record, 'wrong-password'), 'Incorrect password accepted');
  console.log('PASS workerd WebCrypto PBKDF2 600000 iterations.');
} };

export default { async test(_ctrl, env, ctx) {
  const code = crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
  const host = await connect(env, ctx, code), viewer = await connect(env, ctx, code);
  try {
    const created = await host.send('room:create', { nickname: 'Runtime Host', protocolVersion: 2 }); check(created.ok, 'Room creation failed');
    const joined = await viewer.send('room:join', { roomId: code, nickname: 'Runtime Viewer', protocolVersion: 2 }); check(joined.ok && joined.user.role === 'Viewer', 'Room join failed');
    await host.send('add_to_queue', { roomId: code, url: 'https://example.test/video.mp4' });
    await viewer.send('send_message', { roomId: code, message: { id: 'runtime-message', text: 'Real workerd' } });
    await viewer.send('change_video', { roomId: code, url: 'https://example.test/forged.mp4' });
    const snapshot = (await host.send('room:snapshot')).snapshot;
    check(snapshot.queue.length === 1 && snapshot.chatHistory.length === 1, 'SQLite domain records failed');
    check(snapshot.videoState.url === '', 'Viewer gained source permissions');
    const accessState = await host.send('room:access-get');
    const locked = await host.send('room:access-update', { revision: accessState.access.policy.revision, locked: true }); check(locked.ok, 'Access update failed');
    const newcomer = await connect(env, ctx, code);
    check((await newcomer.send('room:join', { roomId: code, nickname: 'Newcomer', protocolVersion: 2 })).error.code === 'ROOM_LOCKED', 'Locked room accepted a newcomer');
    newcomer.ws.close(1000);
    await host.send('kick_user', { roomId: code, targetId: joined.memberId });
    check((await host.send('room:snapshot')).snapshot.members.length === 1, 'Moderation did not remove member');
    console.log('PASS workerd native WebSockets, SQLite Durable Objects, permissions, chat, queue, access policy and moderation.');
    for (let index = 0; index < 20; index++) await host.send('add_to_queue', { roomId: code, url: `https://example.test/${index}/` + 'v'.repeat(3000) + '.mp4' });
    check((await host.send('room:snapshot')).snapshot.queue.length === 21, 'Large snapshot delivery failed');
    console.log('PASS workerd negotiated delivery receipts and chunked large-snapshot reassembly.');
    const before = roomConstructions;
    await new Promise(resolve => setTimeout(resolve, 25000));
    const restored = (await host.send('room:snapshot')).snapshot;
    check(roomConstructions > before, 'Workerd did not reconstruct the idle Durable Object');
    check(restored.queue.length === 21 && restored.chatHistory.length === 1 && restored.members[0].role === 'Host' && restored.access.policy.locked, 'Idle reconstruction lost durable room state');
    console.log('PASS workerd actual idle eviction and hibernating WebSocket reconstruction with SQLite state, access policy and Host authority.');
  } finally { host.ws.close(1000); viewer.ws.close(1000); }
} };
