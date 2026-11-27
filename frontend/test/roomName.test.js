import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomName } from '../../shared/room-name.mjs';

test('room names support Unicode and emoji, normalize whitespace, and reject invalid sizes/control characters', () => {
    assert.equal(normalizeRoomName('  Friday   movie night  '), 'Friday movie night');
    assert.equal(normalizeRoomName('സിനിമ രാത്രി 🎬'), 'സിനിമ രാത്രി 🎬');
    assert.equal(normalizeRoomName('Family 👨‍👩‍👧‍👦'), 'Family 👨‍👩‍👧‍👦');
    assert.equal(normalizeRoomName('e\u0301'), 'é');
    assert.equal(normalizeRoomName(), '');
    assert.equal(normalizeRoomName(' '.repeat(2)), '');
    assert.equal(normalizeRoomName('x'.repeat(48)).length, 48);
    for (const name of [null, {}, 42, 'x'.repeat(49), 'line\nbreak', 'bad\u0000name', 'fake\u202eexe', 'bad\u2066name']) assert.equal(normalizeRoomName(name), null);
});
