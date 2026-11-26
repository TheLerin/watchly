import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreationVerification } from '../src/utils/turnstileWidget.js';
import { createRoomRequester } from '../src/utils/roomRequest.js';

test('room verification coalesces pending prompts, resolves once, cancels safely and never accepts foreign actions', async () => {
    const prompts = [], gate = createCreationVerification(value => prompts.push(value)), challenge = { siteKey: 'public-test-key', action: 'room_create' };
    const first = gate.request(challenge); assert.equal(first, gate.request(challenge));
    gate.complete('single-use-token'); assert.equal(await first, 'single-use-token'); gate.complete('ignored'); assert.equal(prompts.length, 2);
    const canceled = gate.request(challenge); gate.cancel(); await assert.rejects(canceled, /canceled/);
    await assert.rejects(gate.request({ ...challenge, action: 'login' }), /not configured/);
    const disposed = gate.request(challenge); gate.dispose(); await assert.rejects(disposed, /canceled/);
});
test('room request preserves only the public challenge descriptor on a server challenge response', async () => {
    const socket = { connected: true, off() {}, io: { off() {} }, timeout() { return { emit(_event, _payload, callback) { callback(null, { ok: false, error: { code: 'TURNSTILE_REQUIRED', message: 'Verify', challenge: { siteKey: 'public-key', action: 'room_create' } } }); } }; } };
    await assert.rejects(createRoomRequester(socket).request('room:create', { nickname: 'Guest' }), error => error.code === 'TURNSTILE_REQUIRED' && error.challenge.siteKey === 'public-key');
});
