import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadinessReporter } from '../src/utils/readinessReporter.js';

test('transient layout stalls produce no room readiness reset while sustained stalls and recovery are reported', () => {
    const sent = [], timers = new Map(); let id = 0;
    const reporter = createReadinessReporter({ send: (...args) => sent.push(args), schedule: fn => { timers.set(++id, fn); return id; }, cancel: key => timers.delete(key) });
    reporter.report('movie', 'READY');
    reporter.report('movie', 'BUFFERING', 'waiting'); reporter.report('movie', 'READY'); reporter.report('movie', 'READY');
    assert.deepEqual(sent, [['movie', 'READY', undefined]]); assert.equal(timers.size, 0);
    reporter.report('movie', 'BUFFERING', 'waiting'); [...timers.values()][0](); timers.clear();
    reporter.report('movie', 'READY');
    assert.deepEqual(sent.slice(1), [['movie', 'BUFFERING', 'waiting'], ['movie', 'READY', undefined]]);
    reporter.report('movie', 'BUFFERING'); reporter.report('next', 'READY');
    assert.equal(timers.size, 0); assert.equal(sent.at(-1)[0], 'next');
    reporter.report('next', 'BUFFERING'); reporter.dispose(); assert.equal(timers.size, 0);
    reporter.reset(); reporter.report('next', 'READY'); assert.equal(sent.length, 5);
});
