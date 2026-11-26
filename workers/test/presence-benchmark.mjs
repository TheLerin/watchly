import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { context } from './harness.mjs';
import { PresenceDirectory } from '../src/PresenceDirectory.mjs';
const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const results = [];
for (const [population, friendsPerAccount] of [[50, 10], [250, 10], [500, 10], [500, 150]]) {
  const ctx = context(); ctx.storage.ctx = ctx;
  let statements = 0, returnedRows = 0, notifications = 0;
  const original = ctx.storage.sql.exec;
  ctx.storage.sql.exec = (...args) => { statements++; const result = original(...args); returnedRows += result.toArray().length; return result; };
  const directory = new PresenceDirectory(ctx, { ROOMS: { idFromName: value => value, get: () => ({ fetch: async () => { notifications++; return Response.json({ ok: true }); } }) } });
  const started = performance.now();
  for (let offset = 0; offset < population; offset += 50) {
    const entries = Array.from({ length: 50 }, (_, index) => ({ id: `socket-${offset + index}`, accountId: id(offset + index + 1), expiresAt: Date.now() + 3600000,
      status: 'in_room', friends: Array.from({ length: friendsPerAccount }, (_, friend) => id((offset + index + friend + 1) % population + 1)) }));
    const response = await directory.fetch(new Request('https://internal/update', { method: 'POST', body: JSON.stringify({ objectName: `P${String(offset).padStart(6, '0')}`, entries, version: 1 }) })); assert.equal(response.status, 200);
  }
  for (let user = 1; user <= population; user++) {
    const response = await directory.fetch(new Request('https://internal/query', { method: 'POST', body: JSON.stringify({ friends: Array.from({ length: friendsPerAccount }, (_, friend) => id((user + friend) % population + 1)) }) }));
    const statuses = await response.json(); assert.equal(statuses.length, friendsPerAccount); assert.ok(statuses.every(value => value.status === 'in_room'));
  }
  const response = await directory.fetch(new Request('https://internal/update', { method: 'POST', body: JSON.stringify({ objectName: 'P000000', entries: [], version: 2 }) })); assert.equal(response.status, 200);
  ctx.storage.sql.exec('UPDATE notifications SET next_at=0'); await directory.alarm();
  assert.equal(directory.status(id(1)), 'offline'); assert.equal(directory.rows('SELECT * FROM notifications').length, 0);
  results.push({ population, friendsPerAccount, rooms: population / 50, elapsedMs: Math.round((performance.now() - started) * 100) / 100, statements, returnedRows, targetedNotifications: notifications });
}
await mkdir('.codex-runtime', { recursive: true });
await writeFile('.codex-runtime/presence-benchmark.json', JSON.stringify({ recordedAt: new Date().toISOString(), simulationOnly: true, results,
  limitations: 'Node SQLite and mocked room notification transport. Statement/returned-row counts do not measure Cloudflare billing or remote capacity.' }, null, 2) + '\n');
console.log(JSON.stringify(results));
