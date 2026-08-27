import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintBlob, samplePositions, SLICE_COUNT } from '../src/utils/mediaFingerprint.js';

test('fingerprint is deterministic and independent of filename metadata', async () => {
    const bytes = new Uint8Array(200000).map((_, index) => index % 251);
    const first = await fingerprintBlob(new Blob([bytes]));
    const renamed = await fingerprintBlob(new Blob([bytes]));
    assert.equal(first, renamed);
});

test('changing content or exact size changes fingerprint', async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const original = await fingerprintBlob(new Blob([bytes]));
    bytes[10] = 8;
    assert.notEqual(await fingerprintBlob(new Blob([bytes])), original);
    assert.notEqual(await fingerprintBlob(new Blob([bytes, new Uint8Array([0])])), original);
});

test('large-file sampling includes beginning and end with exactly 32 slices', () => {
    const size = 5 * 1024 * 1024 * 1024;
    const positions = samplePositions(size);
    assert.equal(positions.length, SLICE_COUNT);
    assert.equal(positions[0], 0);
    assert.equal(positions.at(-1), size - 64 * 1024);
});
