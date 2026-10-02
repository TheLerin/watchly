const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalPosition, createPlayback, reduceCommand } = require('../playback/canonicalState');

test('canonical position advances playing state and clamps duration', () => {
    const playback = { ...createPlayback(1000), status: 'playing', positionSec: 3, effectiveAtServerMs: 1000 };
    assert.equal(canonicalPosition(playback, 2500, 10), 4.5);
    assert.equal(canonicalPosition(playback, 20000, 10), 10);
});

test('paused state does not advance', () => {
    assert.equal(canonicalPosition({ ...createPlayback(1000), positionSec: 8 }, 9000, 20), 8);
});

test('commands increment sequence and clamp seeks', () => {
    const next = reduceCommand({ playback: createPlayback(0), action: 'SEEK', positionSec: 99, now: 0, effectiveAt: 750, memberId: 'm', durationSec: 12 });
    assert.equal(next.seq, 1);
    assert.equal(next.positionSec, 12);
});

test('scheduled pause preserves playback progress through its effective deadline', () => {
    const playing = { ...createPlayback(1000), status: 'playing', positionSec: 5, effectiveAtServerMs: 1000 };
    const paused = reduceCommand({
        playback: playing, action: 'PAUSE', now: 2000, effectiveAt: 2750,
        memberId: 'controller', durationSec: 20
    });
    assert.equal(paused.status, 'paused');
    assert.equal(paused.positionSec, 6.75);
    assert.equal(paused.effectiveAtServerMs, 2750);
});

test('playing again after reaching the end restarts from zero', () => {
    for (const status of ['paused', 'playing']) {
        const next = reduceCommand({ playback: { ...createPlayback(0), status, positionSec: 20 },
            action: 'PLAY', now: 1000, effectiveAt: 1750, memberId: 'controller', durationSec: 20 });
        assert.equal(next.status, 'playing');
        assert.equal(next.positionSec, 0);
    }
});

test('optimistic playing seeks preserve local progress through network latency and the shared deadline', () => {
    const playing = { ...createPlayback(1000), status: 'playing' };
    const seek = reduceCommand({ playback: playing, action: 'SEEK', positionSec: 40,
        requestedAtServerMs: 2000, now: 2500, effectiveAt: 3250, memberId: 'host', durationSec: 100 });
    assert.equal(seek.status, 'playing');
    assert.equal(seek.positionSec, 41.25);
    assert.equal(canonicalPosition(seek, 3500, 100), 41.5);
    assert.equal(seek.seq, playing.seq + 1);
});

test('optimistic paused seeks stay paused, and legacy seeks keep their existing semantics', () => {
    const args = { action: 'SEEK', positionSec: 5, now: 2500, effectiveAt: 3250, memberId: 'host', durationSec: 100 };
    const paused = reduceCommand({ ...args, playback: createPlayback(1000), requestedAtServerMs: 2000 });
    assert.equal(paused.status, 'paused');
    assert.equal(paused.positionSec, 5);
    const legacy = reduceCommand({ ...args, playback: { ...createPlayback(1000), status: 'playing' } });
    assert.equal(legacy.positionSec, 5);
});

test('seek timestamp compensation is bounded and clamps at the media duration', () => {
    const args = { playback: { ...createPlayback(1000), status: 'playing' }, action: 'SEEK', positionSec: 5,
        now: 20000, effectiveAt: 20750, memberId: 'host', durationSec: 100 };
    assert.equal(reduceCommand({ ...args, requestedAtServerMs: 0 }).positionSec, 15.75);
    assert.equal(reduceCommand({ ...args, requestedAtServerMs: 99999 }).positionSec, 5.75);
    assert.equal(reduceCommand({ ...args, requestedAtServerMs: 0, durationSec: 10 }).positionSec, 10);
});
