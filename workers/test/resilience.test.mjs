import test from 'node:test';
import assert from 'node:assert/strict';
import { environment, connect, context } from './harness.mjs';
import { OutboundFlow } from '../src/OutboundFlow.mjs';
import { PresenceDirectory } from '../src/PresenceDirectory.mjs';

const drain = async ctx => { for (let seen = 0; seen < ctx.tasks.length;) { const batch = ctx.tasks.slice(seen); seen += batch.length; await Promise.all(batch); } };
const subject = '00000000-0000-4000-8000-000000000001';

test('slow receivers have bounded in-flight delivery, chunked snapshots drain in order, and future receipts fail', () => {
  const flow = new OutboundFlow();
  const ws = { readyState: 1, attachment: { deliveryEnabled: true }, messages: [], deserializeAttachment() { return structuredClone(this.attachment); }, serializeAttachment(value) { this.attachment = structuredClone(value); }, send(raw) { this.messages.push(JSON.parse(raw)); }, close(code) { this.closed = code; } };
  const original = { v: 1, event: 'room:snapshot', args: [{ queue: Array.from({ length: 500 }, (_, id) => ({ id, url: 'https://test.invalid/' + 'a'.repeat(3500) })) }] };
  flow.send(ws, original); assert.ok(flow.queuedBytes > 1000000);
  assert.ok(ws.attachment.delivery.pending.reduce((sum, item) => sum + item[1], 0) <= 128 * 1024);
  assert.equal(flow.receipt(ws, 9999999), false);
  let acknowledged = 0;
  while (acknowledged < ws.messages.length) { const frame = ws.messages[acknowledged++]; assert.equal(flow.receipt(ws, frame.deliveryId), true); }
  assert.equal(flow.queuedBytes, 0);
  assert.deepEqual(JSON.parse(ws.messages.map(frame => frame.data).join('')), original);
  assert.ok(JSON.stringify(ws.attachment).length < 2048);
  ws.bufferedAmount = 300000; flow.send(ws, { v: 1 }); assert.equal(ws.closed, 1013);
});

test('SQL failure quarantines mutated memory, delivers no success, and reconstruction restores committed state', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  await drain(item.ctx);
  const exec = item.ctx.storage.sql.exec; let failed = false;
  item.ctx.storage.sql.exec = (sql, ...args) => { if (!failed && /INSERT INTO queue_items/.test(sql)) { failed = true; throw new Error('injected write failure'); } return exec(sql, ...args); };
  const result = await host.send('add_to_queue', { roomId: 'ABCDEFG', url: 'https://test.invalid/movie.mp4' });
  assert.equal(result, undefined); assert.equal(item.object.quarantined, true); assert.equal(host.ws.closed.code, 1011);
  item.ctx.storage.sql.exec = exec;
  await setup.evict('ABCDEFG'); assert.equal(item.object.rooms.get('ABCDEFG').queue.length, 0);
});

test('presence update outbox survives reconstruction and source versions fence stale deliveries', async () => {
  const setup = environment(), item = await setup.room(); let failing = true;
  item.object.accounts.verify = async token => ({ id: subject, profile: null, token, expiresAt: Date.now() + 60000 });
  const binding = setup.env.PRESENCE;
  setup.env.PRESENCE = { idFromName: value => value, get: () => ({ fetch: request => failing ? Promise.resolve(new Response('{}', { status: 503 })) : binding.get().fetch(request) }) };
  const socket = await connect(item, 'fixture'); await drain(item.ctx);
  assert.ok(item.object.presenceState.job); assert.equal(item.object.presenceState.job.failures, 1);
  const version = item.object.presenceState.version;
  await setup.evict('ABCDEFG'); failing = false;
  item.object.presenceState.job.nextAt = Date.now() - 1; await item.object.commit(); await drain(item.ctx);
  assert.equal(item.object.presenceState.job, null);
  const posted = versionNumber => setup.directory.fetch(new Request('https://internal/update', { method: 'POST', body: JSON.stringify({ objectName: 'ABCDEFG', version: versionNumber, entries: [] }) }));
  assert.equal((await (await posted(version)).json()).duplicate, true);
  assert.equal(socket.ws.closed, undefined);
});

test('presence notification races preserve newer versions; retries terminate and expire', async () => {
  const ctx = context(); ctx.storage.ctx = ctx; let release, failures = false;
  const env = { ROOMS: { idFromName: value => value, get: () => ({ fetch: () => failures ? Promise.resolve(new Response('{}', { status: 503 })) : new Promise(resolve => { release = resolve; }) }) } };
  const directory = new PresenceDirectory(ctx, env);
  ctx.storage.sql.exec('INSERT INTO subscriptions VALUES(?,?)', subject, 'ABCDEFG');
  directory.notify([subject]); ctx.storage.sql.exec('UPDATE notifications SET next_at=0');
  const pending = directory.alarm(); directory.notify([subject]); release(new Response('{}')); await pending;
  assert.equal(directory.rows('SELECT version FROM notifications')[0].version, 2);
  failures = true;
  for (let attempt = 0; attempt < 6; attempt++) { ctx.storage.sql.exec('UPDATE notifications SET next_at=0'); await directory.alarm(); }
  assert.equal(directory.rows('SELECT attempts FROM notifications')[0].attempts, 6);
  assert.ok(directory.rows('SELECT terminal_until FROM notifications')[0].terminal_until > Date.now());
  ctx.storage.sql.exec('UPDATE notifications SET next_at=0'); await directory.alarm();
  assert.equal(directory.rows('SELECT * FROM notifications').length, 0);
});

test('resume credentials rotate between sockets, fence the old media proof, and recover a disconnected lost ACK within grace', async () => {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  const joined = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 }); await host.close();
  const next = await connect(item);
  const resumed = await next.send('room:join', { roomId: 'ABCDEFG', nickname: 'Host', protocolVersion: 2, memberId: joined.memberId, resumeToken: joined.resumeToken });
  assert.equal(resumed.ok, true); assert.notEqual(resumed.resumeToken, joined.resumeToken);
  const stale = await connect(item);
  assert.equal((await stale.send('room:join', { roomId: 'ABCDEFG', nickname: 'Stale', protocolVersion: 2, memberId: joined.memberId, resumeToken: joined.resumeToken })).error.code, 'SESSION_INVALID');
  await next.close();
  assert.equal((await stale.send('room:join', { roomId: 'ABCDEFG', nickname: 'Recovered', protocolVersion: 2, memberId: joined.memberId, resumeToken: joined.resumeToken })).ok, true);
});

test('a revoked account loses action permissions while retaining its recoverable public-room role', async () => {
  const setup = environment(), item = await setup.room();
  item.object.accounts.verify = async token => ({ id: subject, profile: { id: subject, username: 'host', display_name: 'Host' }, token, expiresAt: Date.now() + 60000 });
  const host = await connect(item, 'verified'); await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  item.object.accounts.sessionActive = async () => { throw new Error('Revoked'); };
  item.object.io.sockets.sockets.get(host.id).data.account.sessionCheckedAt = 0;
  const result = await host.send('change_video', { roomId: 'ABCDEFG', url: 'https://example.test/forged.mp4' });
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  const snapshot = (await host.send('room:snapshot')).snapshot;
  assert.equal(snapshot.videoState.url, ''); assert.equal(snapshot.members[0].role, 'Host');
  assert.equal(snapshot.members[0].permissions.canControlPlayback, false);
});

test('slow friend invitation RPC runs outside the room queue and rechecks permissions after completion', async () => {
  const setup = environment(), item = await setup.room(); let release, started;
  item.object.accounts.verify = async token => ({ id: subject, profile: { id: subject, username: 'host', display_name: 'Host' }, token, expiresAt: Date.now() + 60000 });
  const host = await connect(item, 'verified'); await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  const viewer = await connect(item); await viewer.send('room:join', { roomId: 'ABCDEFG', nickname: 'Viewer', protocolVersion: 2 });
  const waiting = new Promise(resolve => { started = resolve; });
  item.object.accounts.invite = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const invitation = host.send('social:invite', { targetId: '00000000-0000-4000-8000-000000000002' }); await waiting;
  assert.equal((await viewer.send('room:snapshot')).ok, true);
  item.object.rooms.get('ABCDEFG').users.find(member => member.id === host.id).role = 'Viewer';
  release('invitation-id'); assert.equal((await invitation).ok, false);
});
