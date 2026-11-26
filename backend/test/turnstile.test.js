const test = require('node:test');
const assert = require('node:assert/strict');
const { createLegacyCreationGate } = require('../turnstile');
test('legacy anonymous creation enforces the same mandatory verification and one-use policy', async () => {
    const env = { NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'public-key', TURNSTILE_SECRET_KEY: 'secret', ANON_CREATE_CHALLENGE_AFTER: '0' };
    const gate = createLegacyCreationGate({ env, address: () => 'actor', hostname: () => 'watchly.test', fetcher: async () => Response.json({ success: true, hostname: 'watchly.test', action: 'room_create', challenge_ts: new Date().toISOString() }) });
    const socket = { data: { account: null } };
    assert.equal((await gate(socket, {})).error.code, 'TURNSTILE_REQUIRED');
    assert.equal((await gate(socket, { turnstileToken: 'valid' })).ok, true);
    assert.equal((await gate(socket, { turnstileToken: 'valid' })).error.code, 'TURNSTILE_FAILED');
});
