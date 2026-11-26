const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowLimiter, clientAddress } = require('../rateLimit');
test('legacy limiter is bounded, expires windows and ignores untrusted forwarding headers', () => {
    const rate = new WindowLimiter(2);
    assert.equal(rate.consume('one', 1, 1000, 0), true);
    assert.equal(rate.consume('one', 1, 1000, 1), false);
    assert.equal(rate.consume('two', 1, 1000, 1), true);
    assert.equal(rate.consume('three', 1, 1000, 1), false);
    assert.equal(rate.consume('one', 1, 1000, 1001), true);
    const req = { socket: { remoteAddress: '192.0.2.1' }, headers: { 'x-forwarded-for': '198.51.100.2, 203.0.113.3' } };
    assert.equal(clientAddress(req), '192.0.2.1'); assert.equal(clientAddress(req, 1), '203.0.113.3');
});
