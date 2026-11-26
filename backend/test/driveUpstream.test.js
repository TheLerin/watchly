const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const test = require('node:test');
const { requestDriveHop } = require('../driveUpstream');

test('Drive transport preserves redirect cookies and streams a range response without decoding', async () => {
    const url = 'https://drive.google.com/uc';
    const signal = new AbortController().signal;
    const headers = { Range: 'bytes=20-23', Cookie: 'drive=fixture' };
    for (const [method, statusCode, responseHeaders] of [
        ['HEAD', 302, { location: '/download', 'set-cookie': ['one=1', 'two=2'] }],
        ['GET', 206, { 'content-range': 'bytes 20-23/100', 'content-length': '4' }],
    ]) {
        const response = Object.assign(Readable.from(['test']), { statusCode, headers: responseHeaders });
        let calls = 0;
        const hop = await requestDriveHop(url, { method, headers, signal, timeout: 1000 }, (target, options, respond) => {
            calls++;
            assert.equal(target, url);
            assert.deepEqual(options, { method, signal, headers: { ...headers, 'Accept-Encoding': 'identity' } });
            const upstream = new EventEmitter();
            upstream.end = () => respond(response);
            upstream.destroy = assert.fail;
            return upstream;
        });
        assert.equal(calls, 1);
        assert.deepEqual(hop, { status: statusCode, headers: responseHeaders, data: response });
        hop.data.destroy();
    }
});

test('Drive transport cancels a hop whose headers never arrive', async () => {
    const request = requestDriveHop('https://drive.google.com/uc', { method: 'GET', headers: {}, timeout: 10 }, () => {
        const upstream = new EventEmitter();
        upstream.end = () => {};
        upstream.destroy = error => upstream.emit('error', error);
        return upstream;
    });
    await assert.rejects(request, /waiting for Google Drive response headers/);
});
