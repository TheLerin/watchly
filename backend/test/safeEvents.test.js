const test = require('node:test');
const assert = require('node:assert/strict');
const { safeEvents, safeAck } = require('../safeEvents');
const boundary = handler => { let run; safeEvents({ on(_name, fn) { run = fn; } })('room:join', handler); return (...args) => run(...args); };

test('malformed acknowledgements and payloads cannot enter handlers or throw', async () => {
    let called = 0;
    const run = boundary((_payload, callback) => { called++; callback({ ok: true }); });
    for (const value of [null, [], 'string', 12, true]) {
        let result; await run(value, response => { result = response; });
        assert.equal(result.error.code, 'INVALID_PAYLOAD');
    }
    await run({}, {}); await run({}, 2); assert.equal(called, 0);
    await run({}); assert.equal(called, 1);
    let result; await run(response => { result = response; }); assert.equal(result.ok, true);
});
test('sync and async exceptions are contained and acknowledgements are sent at most once', async () => {
    for (const handler of [() => { throw new Error('private'); }, async () => { throw new Error('private'); }]) {
        let result; await boundary(handler)({}, value => { result = value; });
        assert.equal(result.error.code, 'EVENT_FAILED'); assert.equal(JSON.stringify(result).includes('private'), false);
    }
    let calls = 0; const ack = safeAck(() => { calls++; throw new Error('transport'); });
    ack({}); ack({}); assert.equal(calls, 1);
});
test('event boundary bounds payloads and per-event bursts without blocking independent events', async () => {
    let result, calls = 0;
    const run = boundary(() => { calls++; });
    await run({ value: 'x'.repeat(5000) }, value => { result = value; }); assert.equal(result.error.code, 'PAYLOAD_TOO_LARGE');
    for (let i = 0; i < 31; i++) await run({}, value => { result = value; });
    assert.equal(calls, 30); assert.equal(result.error.code, 'RATE_LIMITED');
});
