import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageMeter } from '../src/utils/mediaUsage.js';
test('RTC usage counts deltas per track, ignores resets and fires an optional safeguard once', () => {
    let stops = 0;
    const meter = createUsageMeter({ limitBytes: 100, onLimit: () => stops++ });
    const report = bytes => new Map([['a', { id: 'a', type: 'outbound-rtp', bytesSent: bytes }]]);
    meter.sample(report(500)); meter.sample(report(560)); meter.sample(report(20)); meter.sample(report(80));
    assert.equal(meter.totalBytes, 120); assert.equal(stops, 1); meter.sample(report(200)); assert.equal(stops, 1);
});
