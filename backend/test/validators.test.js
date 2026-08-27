const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedText, validRoomCode, validMediaId, validCommandId } = require('../validators');

test('protocol validators reject malformed identifiers', () => {
    assert.equal(validRoomCode('ABC1234'), true);
    assert.equal(validRoomCode('__proto__'), false);
    assert.equal(validMediaId(`sampled-sha256-v1:42:${'f'.repeat(64)}`), true);
    assert.equal(validMediaId('blob:https://example.test/movie'), false);
    assert.equal(validCommandId('command_123'), true);
    assert.equal(validCommandId('short'), false);
});

test('text normalization removes control characters and enforces bounds', () => {
    assert.equal(normalizedText('  A\u0000B  ', 24), 'AB');
    assert.equal(normalizedText('x'.repeat(50), 24).length, 24);
});
