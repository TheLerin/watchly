import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountRecovery } from '../src/utils/accountRecovery.js';

const denied = { data: { code: 'AUTH_REQUIRED' } };
const session = (id = 'alice', token = 'old') => ({ user: { id }, access_token: token });
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };
function fixture(refresh) {
    let current = session(), refreshes = 0, reconnects = 0;
    const signouts = [];
    const auth = { refreshSession: () => { refreshes++; return refresh(); }, signOut: async args => { signouts.push(args); } };
    const recovery = createAccountRecovery({ auth, getSession: () => current, reconnect: () => { reconnects++; } });
    return { recovery, setSession: value => { current = value; }, signouts, refreshes: () => refreshes, reconnects: () => reconnects };
}

test('auth handshake rejection refreshes once, coalesces expiry, and reconnects using the resulting session', async () => {
    const response = deferred(), f = fixture(() => response.promise);
    const waiting = f.recovery.connectionError(denied);
    const duplicate = f.recovery.refresh();
    await Promise.resolve(); assert.equal(f.refreshes(), 1);
    f.setSession(session('alice', 'fresh')); response.resolve({ data: { session: session('alice', 'fresh') }, error: null });
    await Promise.all([waiting, duplicate]); assert.equal(f.reconnects(), 1);
    await f.recovery.connectionError(denied); assert.equal(f.refreshes(), 1, 'a rejected fresh token must not create an endless refresh loop');
    f.recovery.authenticated();
    await f.recovery.connectionError(denied); assert.equal(f.refreshes(), 2, 'a later expiry can refresh after server verification succeeds');
    f.recovery.dispose();
});

test('invalid refresh credentials sign out locally; outages and account-service failures preserve the session', async () => {
    const invalid = fixture(async () => ({ error: { code: 'refresh_token_not_found', status: 400 } }));
    await invalid.recovery.connectionError(denied); assert.deepEqual(invalid.signouts, [{ scope: 'local' }]);
    for (const error of [{ name: 'AuthRetryableFetchError', status: 503 }, new TypeError('Failed to fetch'), { code: 'unexpected_failure', status: 500 }]) {
        const f = fixture(async () => ({ error })); await f.recovery.connectionError(denied);
        assert.equal(f.signouts.length, 0); assert.equal(f.reconnects(), 0); f.recovery.dispose();
    }
    const service = fixture(async () => { throw new Error('must not refresh'); });
    await service.recovery.connectionError({ data: { code: 'ACCOUNT_UNAVAILABLE' } });
    await service.recovery.connectionError(new Error('transport failed'));
    assert.equal(service.refreshes(), 0); invalid.recovery.dispose(); service.recovery.dispose();
});

test('account switching, sign-out and disposal fence stale refresh results', async () => {
    for (const transition of ['switch', 'signout', 'dispose']) {
        const response = deferred(), f = fixture(() => response.promise);
        const waiting = f.recovery.connectionError(denied); await Promise.resolve();
        if (transition === 'switch') { f.setSession(session('bob')); f.recovery.invalidate(); }
        else if (transition === 'signout') { f.setSession(null); f.recovery.invalidate(); }
        else f.recovery.dispose();
        response.resolve({ error: { code: 'refresh_token_not_found', status: 400 } }); await waiting;
        assert.equal(f.signouts.length, 0, transition); assert.equal(f.reconnects(), 0, transition); f.recovery.dispose();
    }
    const response = deferred(), f = fixture(() => response.promise);
    const waiting = f.recovery.connectionError(denied); await Promise.resolve();
    f.setSession(session('alice', 'newer-from-another-tab'));
    response.resolve({ error: { code: 'refresh_token_not_found', status: 400 } }); await waiting;
    assert.equal(f.signouts.length, 0); f.recovery.dispose();
});

test('an invalid stored account session reconnects as guest to expose a terminal room ownership error', async () => {
    let current = session(), reconnects = 0;
    const recovery = createAccountRecovery({
        auth: { refreshSession: async () => ({ error: { code: 'refresh_token_not_found' } }), signOut: async () => { current = null; recovery.invalidate(); } },
        getSession: () => current, reconnect: () => { reconnects++; },
    });
    await recovery.connectionError(denied);
    assert.equal(reconnects, 1); recovery.dispose();
});
