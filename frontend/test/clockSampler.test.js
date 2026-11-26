import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockSampler } from '../src/utils/clockSampler.js';
test('clock sampling coalesces concurrent wakeups and cancellation fences late results and extra requests', async () => {
    let release, calls = 0, applied = 0, time = 100;
    const sampler = createClockSampler({ connected: () => true, now: () => time++, request: () => { calls++; return new Promise(resolve => { release = resolve; }); }, onResult: () => applied++ });
    const first = sampler.sample(), second = sampler.sample(); assert.equal(first, second); assert.equal(calls, 1);
    sampler.cancel(); release({ serverTimeMs: 120 }); assert.equal(await first, null); assert.equal(applied, 0); assert.equal(calls, 1);
});
test('clock uses valid low-RTT samples and refuses disconnected updates', async () => {
    let time = 100, result, online = true;
    const sampler = createClockSampler({ connected: () => online, now: () => time++, request: async () => ({ serverTimeMs: 120 }), onResult: value => { result = value; }, wallTime: () => 1 });
    await sampler.sample(3); assert.equal(result.sampledAt, 1); assert.ok(Number.isFinite(result.offsetMs));
    online = false; assert.equal(await sampler.sample(), null);
});
