import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';
import { createVoiceSession, requestVoiceToken } from '../src/utils/livekitVoice.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const setup = overrides => {
    const calls = [], states = [], track = { stop: () => calls.push('stop') };
    const room = { state: 'disconnected', startAudio: async () => calls.push('playback'), connect: async () => { calls.push('connect'); room.state = 'connected'; }, disconnect: async () => { calls.push('disconnect'); room.state = 'disconnected'; }, localParticipant: { publishTrack: async (value, options) => { assert.equal(value, track); assert.equal(options.source, 'microphone'); calls.push('publish'); } } };
    const voice = createVoiceSession({ room, requestToken: async () => { calls.push('token'); return { serverUrl: 'wss://voice.test', participantToken: 'participant-only' }; }, createMicrophone: async () => { calls.push('microphone'); return track; }, canJoin: () => true, onState: patch => states.push(patch), ...overrides });
    return { voice, room, calls, states, track };
};
test('creating voice is idle; only Join fetches a token, captures microphone and connects/publishes', async () => {
    const { voice, calls, states } = setup(); assert.deepEqual(calls, []);
    await voice.join(); assert.deepEqual(calls, ['playback', 'token', 'microphone', 'connect', 'publish']); assert.deepEqual(states.at(-1), { joining: false });
    await voice.leave(); assert.deepEqual(calls.slice(-2), ['stop', 'disconnect']);
});
test('membership/token errors never request microphone permission', async () => {
    const { voice, calls, states } = setup({ requestToken: async () => { throw new Error('Not a room member'); } }); await voice.join();
    assert.equal(calls.includes('microphone'), false); assert.equal(calls.includes('connect'), false); assert.equal(states.find(value => value.error)?.error, 'Not a room member');
});
test('duplicate Join clicks coalesce and cancellation fences a delayed token', async () => {
    const token = deferred(), { voice, calls } = setup({ requestToken: () => token.promise }); const first = voice.join(); await voice.join(); await voice.leave(); token.resolve({ serverUrl: 'wss://voice.test', participantToken: 'participant-only' }); await first;
    assert.equal(calls.includes('microphone'), false); assert.equal(calls.includes('connect'), false);
});
test('leaving/unmounting during a microphone permission prompt stops the late stream without connecting', async () => {
    const capture = deferred(), { voice, calls, track } = setup({ createMicrophone: () => capture.promise }); const joining = voice.join(); await new Promise(resolve => setImmediate(resolve)); await voice.leave(); capture.resolve(track); await joining;
    assert.equal(calls.includes('stop'), true); assert.equal(calls.includes('connect'), false); assert.equal(calls.includes('publish'), false);
});
test('lost Watchly readiness during capture also stops the microphone and prevents joining', async () => {
    let ready = true; const capture = deferred(), { voice, calls, track } = setup({ createMicrophone: () => capture.promise, canJoin: () => ready }); const joining = voice.join(); await new Promise(resolve => setImmediate(resolve)); ready = false; capture.resolve(track); await joining;
    assert.equal(calls.includes('stop'), true); assert.equal(calls.includes('connect'), false);
});
test('SDK failure stops unpublished/published capture and disconnects voice', async () => {
    const { voice, room, calls, states } = setup(); room.localParticipant.publishTrack = async () => { throw new Error('Publish failed'); }; await voice.join();
    assert.ok(calls.includes('stop')); assert.equal(room.state, 'disconnected'); assert.ok(states.some(value => value.error === 'Publish failed'));
});
test('the HTTP request carries private room proof and optional account JWT, never a client-selected identity', async () => {
    let request; const storage = { getItem: () => JSON.stringify({ roomId: 'ABC1234', memberId: 'stable-id', resumeToken: 'private-room-proof' }) };
    const result = await requestVoiceToken({ backendUrl: 'https://backend.test/', roomId: 'ABC1234', memberId: 'stable-id', socketId: 'current-socket', accountToken: 'account-jwt', storage, fetcher: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ serverUrl: 'wss://voice.test', participantToken: 'participant-only' }) }; } });
    assert.equal(result.participantToken, 'participant-only'); assert.equal(request.url, 'https://backend.test/api/livekit/token'); assert.equal(request.options.headers.Authorization, 'Bearer account-jwt');
    assert.deepEqual(JSON.parse(request.options.body), { roomId: 'ABC1234', socketId: 'current-socket', resumeToken: 'private-room-proof' });
    await assert.rejects(requestVoiceToken({ backendUrl: '', roomId: 'ABC1234', memberId: 'different-member', socketId: 'current-socket', storage }), /Reconnect/);
});
