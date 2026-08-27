const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { io } = require('../../frontend/node_modules/socket.io-client');

test('room supports fifty sockets with clock traffic inside payload limits', { timeout: 15000 }, async () => {
    const port = 6000 + Math.floor(Math.random() * 300);
    const server = fork(require.resolve('../server'), [], { env: { ...process.env, PORT: String(port), CORS_ORIGIN: '*' }, stdio: 'ignore' });
    const clients = [];
    try {
        for (let attempt = 0; attempt < 40; attempt += 1) {
            try { await fetch(`http://127.0.0.1:${port}`); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
        }
        const connect = () => new Promise((resolve, reject) => {
            const client = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
            clients.push(client); client.once('connect', () => resolve(client)); client.once('connect_error', reject);
        });
        const emit = (client, event, payload) => new Promise(resolve => client.emit(event, payload, resolve));
        const host = await connect();
        const room = await emit(host, 'room:create', { nickname: 'Load 1', protocolVersion: 2 });
        for (let index = 2; index <= 50; index += 1) {
            const client = await connect();
            const joined = await emit(client, 'room:join', { roomId: room.roomId, nickname: `Load ${index}`, protocolVersion: 2 });
            assert.equal(joined.ok, true);
        }
        const clocks = await Promise.all(clients.map(client => emit(client, 'clock:ping', { clientSendMs: Date.now() })));
        assert.equal(clocks.every(value => Number.isFinite(value.serverTimeMs)), true);
        const snapshot = await emit(host, 'room:snapshot', {});
        assert.equal(snapshot.snapshot.members.length, 50);
        const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.json());
        assert.equal(health.ok, true);
        assert.equal(health.protocolVersion, 2);
        assert.equal(health.activeRooms, 1);
    } finally {
        clients.forEach(client => client.close());
        server.kill();
    }
});
