import test from 'node:test';
import assert from 'node:assert/strict';
import { context, environment, connect } from './harness.mjs';
import { RoomStorage } from '../src/RoomStorage.mjs';
import { encode } from '../src/runtime.mjs';

async function fixture() {
  const setup = environment(), item = await setup.room(), host = await connect(item);
  const joined = await host.send('room:create', { nickname: 'Host', protocolVersion: 2 });
  await host.send('add_to_queue', { roomId: joined.roomId, url: 'https://example.test/one.mp4' });
  return { setup, item, host, joined };
}
test('version 1 single-row migration preserves state, strips secrets and commits atomically', async () => {
  const { item, host } = await fixture(), saved = item.object.store.load();
  saved.connections.get(host.id).account = { id: 'account', profile: null, token: 'private-access-token', expiresAt: Date.now() + 60000 };
  saved.frames.set(host.id, { id: 'ack', result: { ok: true, resumeToken: 'private-resume-token' } });
  const ctx = context(); ctx.storage.ctx = ctx;
  ctx.storage.sql.exec('CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const legacy = encode(saved); ctx.storage.sql.exec('INSERT INTO state VALUES(1,?)', legacy);
  const original = ctx.storage.sql.exec; let failOnce = true;
  ctx.storage.sql.exec = (sql, ...args) => {
    if (failOnce && sql.startsWith('INSERT INTO storage_schema')) { failOnce = false; throw new Error('interrupted migration'); }
    return original(sql, ...args);
  };
  assert.throws(() => new RoomStorage(ctx.storage), /interrupted/);
  assert.equal(ctx.storage.sql.exec('SELECT value FROM state').toArray()[0].value, legacy);
  assert.equal(ctx.storage.sql.exec('SELECT id FROM memberships').toArray().length, 0);
  const store = new RoomStorage(ctx.storage), restored = store.load();
  assert.equal(restored.rooms.get('ABCDEFG').queue.length, 1);
  assert.equal(restored.rooms.get('ABCDEFG').users[0].role, 'Host');
  const bytes = encode(restored);
  assert.equal(bytes.includes('private-access-token'), false); assert.equal(bytes.includes('private-resume-token'), false);
  assert.equal(ctx.storage.sql.exec('SELECT value FROM state').toArray().length, 0);
});
test('corrupt and unknown schemas fail closed without deleting recoverable bytes', () => {
  const ctx = context(); ctx.storage.ctx = ctx;
  ctx.storage.sql.exec('CREATE TABLE state (id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
  ctx.storage.sql.exec('INSERT INTO state VALUES(1,?)', 'corrupt');
  assert.throws(() => new RoomStorage(ctx.storage));
  assert.equal(ctx.storage.sql.exec('SELECT value FROM state').toArray()[0].value, 'corrupt');
  ctx.storage.sql.exec('INSERT INTO storage_schema VALUES(1,999)');
  assert.throws(() => new RoomStorage(ctx.storage), /Unsupported/);
});

test('schema 2 upgrades to 3 while preserving granular records and preventing unsafe old-worker rollback', async () => {
  const { item } = await fixture();
  const before = item.ctx.storage.sql.exec('SELECT * FROM queue_items').toArray();
  item.ctx.storage.sql.exec('UPDATE storage_schema SET version=2');
  const upgraded = new RoomStorage(item.ctx.storage);
  assert.equal(item.ctx.storage.sql.exec('SELECT version FROM storage_schema').toArray()[0].version, 3);
  assert.deepEqual(item.ctx.storage.sql.exec('SELECT * FROM queue_items').toArray(), before);
  assert.equal(upgraded.load().rooms.get('ABCDEFG').users[0].role, 'Host');
});
test('read-only, rejected and ephemeral events perform zero row writes; chat does not rewrite queue or video', async () => {
  const { item, host, joined } = await fixture();
  const viewer = await connect(item); await viewer.send('room:join', { roomId: joined.roomId, nickname: 'Viewer', protocolVersion: 2 });
  const tables = ['queue_items', 'video_state', 'memberships'];
  const before = tables.map(table => item.ctx.storage.sql.exec(`SELECT * FROM ${table}`).toArray());
  const writes = item.object.store.rowsWritten, revision = item.object.revision;
  await host.send('room:snapshot'); await host.send('clock:ping'); await host.send('network_ping');
  await viewer.send('change_video', { roomId: joined.roomId, url: 'https://example.test/forged.mp4' });
  await viewer.send('webrtc_ice_candidate', { targetSocketId: 'nonmember', candidate: { candidate: 'ignored' } });
  assert.equal(item.object.store.rowsWritten, writes); assert.equal(item.object.revision, revision);
  await host.send('send_message', { roomId: joined.roomId, message: { text: 'hello' } });
  for (let i = 0; i < tables.length; i++) assert.deepEqual(item.ctx.storage.sql.exec(`SELECT * FROM ${tables[i]}`).toArray(), before[i]);
  assert.ok(item.object.store.bytes() < 20000);
});
