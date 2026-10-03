const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountService } = require('../accounts');
const id = '00000000-0000-4000-8000-000000000001';
const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000)+3600, sub: 'forged-id', role: 'Host' })).toString('base64url')}.signature`;
test('official Auth verification supplies identity; decoded/client claims do not', async () => {
    const requests = [];
    const service = createAccountService({ url: 'https://account-test.supabase.co', key: 'public-test-key', fetcher: async (url, options) => {
        requests.push({ url: String(url), headers: options.headers });
        return new Response(JSON.stringify(String(url).includes('/auth/v1/user') ? { id, email: 'private@example.test' } : [{ id, username: 'alice', display_name: 'Alice', avatar_url: null }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
    const account = await service.verify(token);
    assert.equal(account.id, id); assert.equal(account.email, undefined); assert.equal(account.profile.username, 'alice');
    assert.ok(requests.some(request => request.url.includes('/auth/v1/user')));
    assert.ok(requests.some(request => request.url.includes(`id=eq.${id}`)));
    assert.equal(JSON.stringify(account.profile).includes('private@example.test'), false);
});
test('invalid credentials fail closed; missing configuration leaves accounts disabled', async () => {
    const disabled = createAccountService({ url: '', key: '' }); assert.equal(disabled.configured, false);
    await assert.rejects(disabled.verify(token), { code: 'ACCOUNT_UNAVAILABLE' });
    assert.equal(createAccountService({ url: 'invalid-url', key: 'public-test-key' }).configured, false);
    const denied = createAccountService({ url: 'https://account-test.supabase.co', key: 'public-test-key', fetcher: async () => new Response(JSON.stringify({ message: 'bad token' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) });
    await assert.rejects(denied.verify(token), { code: 'AUTH_REQUIRED' });
});
