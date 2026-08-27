import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPosition, correctionForDrift, shouldApplyPlaybackSequence } from '../src/utils/playbackMath.js';

test('canonical position handles paused, early, playing and duration-clamped states', () => {
    const paused = { status: 'paused', positionSec: 4, effectiveAtServerMs: 1000, rate: 1 };
    assert.equal(canonicalPosition(paused, 9000, 20), 4);
    const playing = { ...paused, status: 'playing' };
    assert.equal(canonicalPosition(playing, 500, 20), 4);
    assert.equal(canonicalPosition(playing, 2500, 20), 5.5);
    assert.equal(canonicalPosition(playing, 90000, 20), 20);
});

test('drift thresholds select no-op, rate correction and hard seek', () => {
    assert.deepEqual(correctionForDrift(0.15), { type: 'none', rate: 1 });
    assert.deepEqual(correctionForDrift(0.5), { type: 'rate', rate: 1.03 });
    assert.deepEqual(correctionForDrift(-0.5), { type: 'rate', rate: 0.97 });
    assert.deepEqual(correctionForDrift(0.751), { type: 'seek', rate: 1 });
});

test('sequence gate rejects duplicate and out-of-order playback states', () => {
    assert.equal(shouldApplyPlaybackSequence(4, 5), true);
    assert.equal(shouldApplyPlaybackSequence(4, 4), false);
    assert.equal(shouldApplyPlaybackSequence(4, 3), false);
    assert.equal(shouldApplyPlaybackSequence(4, 3, true), true);
});
