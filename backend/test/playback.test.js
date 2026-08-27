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
