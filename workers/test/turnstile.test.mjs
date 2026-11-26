import test from 'node:test';
import assert from 'node:assert/strict';
import { context, environment, connect } from './harness.mjs';
import { AbuseGuard, actorKey } from '../src/AbuseGuard.mjs';
import { checkAnonymousCreation } from '../src/turnstile.mjs';
import turnstile from '../../backend/turnstile.js';

function guardedEnvironment(overrides = {}) {
  const guards = new Map();
  const env = { NODE_ENV: 'development', TURNSTILE_ENFORCE_ANONYMOUS: 'true', TURNSTILE_SITE_KEY: 'public-test-site-key', TURNSTILE_SECRET_KEY: 'private-test-secret', ...overrides };
  env.ABUSE = { idFromName: name => name, get(name) {
    if (!guards.has(name)) { const ctx = context(); ctx.storage.ctx = ctx; guards.set(name, new AbuseGuard(ctx, env)); }
    return { fetch: request => guards.get(name).fetch(request) };
  } };
  return { env, guards };
}
const success = extras => Response.json({ success: true, hostname: 'watchly.test', action: 'room_create', challenge_ts: new Date().toISOString(), ...extras });

test('anonymous risk follows the actor across rooms; required challenges are server-verified and replay-fenced', async () => {
  const { env, guards } = guardedEnvironment(), actor = await actorKey('anonymous-fixture'); let calls = 0;
  const input = { actor, hostname: 'watchly.test', account: null, suspicious: false };
  const verify = async (_url, init) => { calls++; assert.equal(JSON.parse(init.body).secret, env.TURNSTILE_SECRET_KEY); return success(); };
  assert.equal((await checkAnonymousCreation(env, input, verify)).ok, true);
  assert.equal((await checkAnonymousCreation(env, input, verify)).ok, true);
  assert.equal((await checkAnonymousCreation(env, input, verify)).error.code, 'TURNSTILE_REQUIRED'); assert.equal(calls, 0);
  assert.equal((await checkAnonymousCreation(env, { ...input, token: 'valid-once' }, verify)).ok, true);
  // Even two eventually consistent successful Siteverify responses must not admit a replay.
  assert.equal((await checkAnonymousCreation(env, { ...input, token: 'valid-once' }, verify)).error.code, 'TURNSTILE_FAILED');
  assert.equal(JSON.stringify([...guards.values()].map(guard => guard.sql.exec('SELECT * FROM budgets').toArray())).includes('valid-once'), false);
});

test('suspicious guests verify immediately; authenticated profiles preserve normal creation and secrets fail closed', async () => {
  const { env } = guardedEnvironment();
  const input = { actor: await actorKey('suspicious'), hostname: 'watchly.test', suspicious: true };
  assert.equal((await checkAnonymousCreation(env, input)).error.code, 'TURNSTILE_REQUIRED');
  assert.equal((await checkAnonymousCreation(env, { ...input, account: { profile: { id: 'verified' }, expiresAt: Date.now() + 60000 } })).ok, true);
  assert.equal((await checkAnonymousCreation({ ...env, TURNSTILE_SECRET_KEY: '' }, { ...input, token: 'anything' })).error.code, 'TURNSTILE_UNAVAILABLE');
});

test('Siteverify rejects failure, hostname/action mismatch, expired/future tokens, malformed response and outages', async () => {
  const { env } = guardedEnvironment(), input = { env, token: 'fixture-token', hostname: 'watchly.test' };
  for (const override of [{ success: false }, { hostname: 'evil.test' }, { action: 'login' }, { challenge_ts: new Date(Date.now() - 300001).toISOString() }, { challenge_ts: new Date(Date.now() + 60000).toISOString() }, { challenge_ts: 'invalid' }]) {
    assert.equal((await turnstile.verifyCreationChallenge({ ...input, fetcher: async () => success(override) })).ok, false);
  }
  assert.equal((await turnstile.verifyCreationChallenge({ ...input, fetcher: async () => { throw new Error('offline'); } })).error.code, 'TURNSTILE_UNAVAILABLE');
  assert.equal((await turnstile.verifyCreationChallenge({ ...input, token: 'x'.repeat(2049) })).error.code, 'TURNSTILE_REQUIRED');
});

test('challenged native creation cannot allocate authoritative room state without verified proof and survives a fresh socket', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const { env } = guardedEnvironment({ ANON_CREATE_CHALLENGE_AFTER: '0' }), setup = environment(env), actor = await actorKey('native-guest');
    globalThis.fetch = async () => success();
    const item = await setup.room(), guest = await connect(item);
    const attachment = guest.ws.deserializeAttachment(); attachment.actor = actor; guest.ws.serializeAttachment(attachment);
    const denied = await guest.send('room:create', { nickname: 'Guest', protocolVersion: 2 });
    assert.equal(denied.error.code, 'TURNSTILE_REQUIRED'); assert.equal(item.object.rooms.size, 0);
    const created = await guest.send('room:create', { nickname: 'Guest', protocolVersion: 2, turnstileToken: 'native-token-once' });
    assert.equal(created.ok, true);
    assert.equal(JSON.stringify(item.object.store.load()).includes('native-token-once'), false);
    const second = await setup.room('HIJKLMN'); second.code = 'HIJKLMN'; const other = await connect(second);
    const next = other.ws.deserializeAttachment(); next.actor = actor; other.ws.serializeAttachment(next);
    const replayed = await other.send('room:create', { nickname: 'Guest', protocolVersion: 2, turnstileToken: 'native-token-once' });
    assert.equal(replayed.error.code, 'TURNSTILE_FAILED'); assert.equal(second.object.rooms.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});
