import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialStore, socialSections, SOCIAL_SECTIONS } from '../src/utils/socialStore.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 15));
const result = patch => ({ data: { friends: [], requests: [], outgoing: [], invites: [], sentInvites: [], blocks: [], ...patch }, error: null });
function fixture({ owner = 'alice', rpc = async () => result() } = {}) {
    const channels = [], requests = [], removed = [], handlers = new Map(), emitted = [];
    const client = {
        channel(topic, options) {
            const channel = { topic, options, bindings: [], on(kind, filter, callback) { this.bindings.push({ kind, filter, callback }); return this; },
                subscribe(callback) { this.joined = callback; return this; } };
            channels.push(channel); return channel;
        },
        removeChannel: async channel => { removed.push(channel); },
        rpc(name, args) { requests.push({ name, args }); return { abortSignal: signal => rpc(name, args, signal), then: (...args) => rpc(name, args).then(...args) }; },
    };
    const socket = { connected: true, on: (name, fn) => handlers.set(name, fn), off: name => handlers.delete(name),
        emit: (...args) => emitted.push(args), connect() {} };
    const windowTarget = new EventTarget(), documentTarget = new EventTarget(); documentTarget.visibilityState = 'visible';
    const store = createSocialStore({ client, socket, owner, windowTarget, documentTarget, debounceMs: 2 });
    const event = (table, row = {}, kind = 'INSERT') => {
        const binding = channels.at(-2).bindings.find(b => b.filter.table === table && b.filter.event === kind);
        binding.callback({ new: row });
    };
    return { store, channels, requests, removed, handlers, emitted, event, windowTarget, documentTarget };
}
test('authenticated account has two fixed channels, narrow filters and no anonymous subscriptions', async () => {
    const f = fixture(); const stop = f.store.start(); await tick();
    assert.equal(f.channels.length, 2); assert.equal(f.channels[1].options.config.private, true);
    assert.equal(f.channels[1].topic, 'watchly-social:alice');
    assert.equal(f.channels[0].bindings.length, 14);
    for (const b of f.channels[0].bindings) { assert.ok(b.filter.filter.endsWith('=eq.alice')); assert.notEqual(b.filter.event, 'DELETE'); }
    assert.deepEqual(new Set(f.channels[0].bindings.map(b => b.filter.table)), new Set(['friend_requests', 'friendships', 'blocks', 'room_invites']));
    stop(); assert.equal(f.removed.length, 2); assert.equal(f.handlers.size, 0);
    const guest = fixture({ owner: null }); guest.store.start(); await tick(); assert.equal(guest.channels.length, 0); assert.equal(guest.requests.length, 0);
});
test('targeted coalesced invalidations preserve existing data without loading skeletons', async () => {
    const f = fixture({ rpc: async () => result({ friends: [{ id: 'bob' }] }) }); const stop = f.store.start(); await tick(); f.requests.length = 0;
    for (let i = 0; i < 4; i++) f.event('room_invites');
    assert.equal(f.store.getSnapshot().loading, false); assert.deepEqual(f.store.getSnapshot().friends, [{ id: 'bob' }]);
    await tick(); assert.equal(f.requests.length, 1); assert.deepEqual(f.requests[0].args.sections, ['invites']);
    f.requests.length = 0; f.event('friend_requests', { status: 'accepted' }, 'UPDATE'); f.event('friendships'); await tick();
    assert.deepEqual(new Set(f.requests[0].args.sections), new Set(['friends', 'requests']));
    assert.deepEqual(socialSections('blocks'), SOCIAL_SECTIONS);
    assert.deepEqual(socialSections('friend_requests', { status: 'rejected' }), ['requests']);
    assert.deepEqual(socialSections('unrelated'), []); stop();
});
test('mid-fetch invalidation gets a trailing authoritative read; cleanup fences a late account response', async () => {
    const waiting = []; const f = fixture({ rpc: () => new Promise(resolve => waiting.push(resolve)) });
    const stop = f.store.start(); await tick(); f.event('room_invites'); await tick();
    waiting.shift()(result({ friends: [{ id: 'bob' }] })); await tick();
    assert.equal(f.requests.length, 2); assert.deepEqual(f.requests[1].args.sections, ['invites']);
    stop(); waiting.shift()(result({ invites: [{ id: 'private-old-account-invite' }] })); await tick();
    assert.deepEqual(f.store.getSnapshot().invites, []);
});
test('Strict Mode replay waits for removal and ignores the old channel callbacks', async () => {
    const f = fixture(); const first = f.store.start(); await tick(); const old = f.channels.slice(); first();
    const stop = f.store.start(); await tick(); first(); assert.equal(f.removed.length, 2);
    f.requests.length = 0; old[0].bindings[0].callback({ new: {} }); old[1].joined('SUBSCRIBED'); await tick(); assert.equal(f.requests.length, 0);
    stop(); assert.equal(f.removed.length, 4);
});
test('two reconnect acknowledgements and focus/visibility reconcile once without polling', async () => {
    const f = fixture(); const stop = f.store.start(); await tick(); f.requests.length = 0;
    f.channels[0].joined('SUBSCRIBED'); f.channels[1].joined('SUBSCRIBED'); await tick();
    assert.equal(f.requests.length, 1); assert.deepEqual(new Set(f.requests[0].args.sections), new Set(SOCIAL_SECTIONS));
    f.requests.length = 0; f.channels[0].joined('CHANNEL_ERROR'); f.channels[1].joined('CHANNEL_ERROR');
    f.channels[0].joined('SUBSCRIBED'); await tick(); assert.equal(f.requests.length, 0);
    f.channels[1].joined('SUBSCRIBED'); await tick(); assert.equal(f.requests.length, 1);
    f.requests.length = 0; f.windowTarget.dispatchEvent(new Event('focus')); f.documentTarget.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(f.requests.length, 1);
    f.requests.length = 0; stop(); f.windowTarget.dispatchEvent(new Event('focus')); await tick(); assert.equal(f.requests.length, 0);
});
test('staggered deployment falls back only when the new RPC has not been installed', async () => {
    const f = fixture({ rpc: async name => name === 'get_social_data'
        ? { error: { code: 'PGRST202' }, data: null }
        : { data: { friends: [{ id: 'bob' }], requests: [], outgoing: [], invites: [], blocks: [] }, error: null } });
    const stop = f.store.start(); await tick();
    assert.deepEqual(f.requests.map(r => r.name), ['get_social_data', 'get_my_watchly']);
    assert.equal(f.store.getSnapshot().friends[0].id, 'bob'); assert.deepEqual(f.store.getSnapshot().sentInvites, []); stop();
});
test('successful initiator mutations refetch immediately without waiting for an event', async () => {
    const f = fixture({ rpc: async name => name === 'respond_friend_request' ? { data: 'accepted', error: null } : result({ friends: [{ id: 'bob' }] }) });
    const stop = f.store.start(); await tick(); f.requests.length = 0;
    await f.store.mutate('respond_friend_request', { request_id: 'request-1', accept: true });
    assert.equal(f.requests[0].name, 'respond_friend_request'); assert.deepEqual(f.requests[1].args.sections, ['requests', 'friends']);
    assert.equal(f.store.getSnapshot().friends.length, 1); stop();
});
