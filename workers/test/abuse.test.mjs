import test from 'node:test';
import assert from 'node:assert/strict';
import { context, environment } from './harness.mjs';
import { AbuseGuard, actorKey, consume, reserveBudget } from '../src/AbuseGuard.mjs';
import app from '../src/index.mjs';

test('cross-room budgets share fixed shards and expire without raw IP storage', async () => {
  const ctx = context(); ctx.storage.ctx = ctx;
  const guard = new AbuseGuard(ctx), names = new Set();
  const env = { NODE_ENV: 'production', ABUSE: { idFromName: value => { names.add(value); return value; }, get: () => ({ fetch: request => guard.fetch(request) }) } };
  const actor = await actorKey('test-ip');
  for (let i = 0; i < 6; i++) assert.equal(await consume(env, actor, 'create'), true);
  assert.equal(await consume(env, actor, 'create'), false); assert.equal(names.size, 1);
  assert.equal(await consume(env, await actorKey('other-ip'), 'create'), true);
  ctx.storage.sql.exec('UPDATE budgets SET expires=0'); await guard.alarm();
  assert.equal(await consume(env, actor, 'create'), true);
  assert.equal(JSON.stringify(ctx.storage.sql.exec('SELECT * FROM budgets').toArray()).includes('test-ip'), false);
});
test('ingress denies abuse before allocating attacker-controlled room names and ignores forwarding headers', async () => {
  const setup = environment({ NODE_ENV: 'production', ABUSE: { idFromName: value => value, get: () => ({ fetch: async () => new Response(null, { status: 429 }) }) } });
  const request = headers => app.fetch(new Request('https://watchly.test/ws/rooms/ABCDEFG', { headers: { Upgrade: 'websocket', Origin: 'https://watchly.test', ...headers } }), setup.env);
  assert.equal((await request({ 'X-Forwarded-For': 'forged' })).status, 503);
  assert.equal((await request({ 'CF-Connecting-IP': '192.0.2.1' })).status, 429);
  assert.equal(setup.rooms.size, 0);
});

test('daily application admission budgets stop new work, keep counters private and expire old days', async () => {
  const ctx = context(); ctx.storage.ctx = ctx;
  const config = { DAILY_NEW_ROOM_BUDGET: '2', DAILY_MEDIA_JOIN_BUDGET: '0' }, guard = new AbuseGuard(ctx, config);
  const env = { NODE_ENV: 'production', ABUSE: { idFromName: value => value, get: () => ({ fetch: request => guard.fetch(request) }) } };
  assert.equal(await reserveBudget(env, 'rooms'), true); assert.equal(await reserveBudget(env, 'rooms'), true);
  assert.equal(await reserveBudget(env, 'rooms'), false); assert.equal(await reserveBudget(env, 'media'), false);
  assert.deepEqual(Object.keys(ctx.storage.sql.exec('SELECT * FROM daily_usage').toArray()[0]).sort(), ['count','day','kind']);
  ctx.storage.sql.exec('UPDATE daily_usage SET day=0'); await guard.alarm();
  assert.equal(await reserveBudget(env, 'rooms'), true);
});
