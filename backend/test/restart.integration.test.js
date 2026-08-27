const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { io } = require('../../frontend/node_modules/socket.io-client');

const waitForServer = async port => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try { await fetch(`http://127.0.0.1:${port}`); return; } catch { await new Promise(resolve => setTimeout(resolve, 75)); }
    }
    throw new Error('server failed to start');
};
const connect = port => new Promise((resolve, reject) => {
    const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    client.once('connect', () => resolve(client)); client.once('connect_error', reject);
});
const emit = (client, event, payload) => new Promise(resolve => client.emit(event, payload, resolve));

test('a Render-like restart returns typed room expiration instead of recreating it', { timeout: 10000 }, async () => {
    const port = 6400 + Math.floor(Math.random() * 200);
    const launch = () => fork(require.resolve('../server'), [], { env: { ...process.env, PORT: String(port), CORS_ORIGIN: '*' }, stdio: 'ignore' });
    let server = launch(); let client;
    try {
        await waitForServer(port); client = await connect(port);
        const created = await emit(client, 'room:create', { nickname: 'Host', protocolVersion: 2 });
        client.close(); server.kill(); await new Promise(resolve => server.once('exit', resolve));
        server = launch(); await waitForServer(port); client = await connect(port);
        const expired = await emit(client, 'room:join', { roomId: created.roomId, nickname: 'Host', protocolVersion: 2, resumeToken: created.resumeToken });
        assert.deepEqual(expired.error, { code: 'ROOM_NOT_FOUND', message: 'This temporary room does not exist or has expired.', retryable: false });
    } finally { client?.close(); server.kill(); }
});
