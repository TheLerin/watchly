import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeekCommandScheduler } from '../src/utils/seekCommandScheduler.js';

const fixture = () => {
    let time = 0;
    let timerId = 0;
    const timers = new Map();
    const sent = [];
    const scheduler = createSeekCommandScheduler({
        now: () => time,
        send: (...request) => sent.push(request),
        schedule: (callback, delay) => { timers.set(++timerId, { callback, at: time + delay }); return timerId; },
        cancel: id => timers.delete(id),
    });
    const advance = next => {
        time = next;
        for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); }
    };
    return { scheduler, sent, timers, advance };
};

test('first native seek sends immediately; rapid targets coalesce to the latest timestamp and command ID', () => {
    const { scheduler, sent, timers, advance } = fixture();
    scheduler.enqueue(10, { commandId: 'first', requestedAtServerMs: 1000 });
    assert.equal(sent.length, 1);
    advance(20);
    scheduler.enqueue(40, { commandId: 'second', requestedAtServerMs: 1020 });
    advance(80);
    scheduler.enqueue(5, { commandId: 'last', requestedAtServerMs: 1080 });
    assert.equal(sent.length, 1);
    assert.equal(timers.size, 1);
    advance(200);
    assert.deepEqual(sent[1], [5, { commandId: 'last', requestedAtServerMs: 1080 }]);
});

test('explicit play/pause flushes the latest seek; disconnect/source changes cancel pending targets', () => {
    const { scheduler, sent, timers } = fixture();
    scheduler.enqueue(10);
    scheduler.enqueue(40);
    scheduler.flush();
    assert.deepEqual(sent.map(([position]) => position), [10, 40]);
    scheduler.enqueue(5);
    scheduler.cancel();
    assert.equal(timers.size, 0);
    scheduler.flush();
    assert.equal(sent.length, 2);
    scheduler.enqueue(20);
    assert.equal(sent[2][0], 20);
});
