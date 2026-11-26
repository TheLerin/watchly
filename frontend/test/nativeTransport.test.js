import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeTransport } from '../src/utils/nativeTransport.js';
import { createRoomRequester } from '../src/utils/roomRequest.js';

class FakeWebSocket {
    static sockets = [];
    constructor(url) { this.url = String(url); this.sent = []; FakeWebSocket.sockets.push(this); }
    send(value) { this.sent.push(value === '__watchly_ping__' ? value : JSON.parse(value)); }
    close() { this.closed = true; }
    welcome(id = 'socket1') { this.onopen(); this.onmessage({ data: JSON.stringify({ v: 1, type: 'welcome', id }) }); }
    receive(frame) { this.onmessage({ data: JSON.stringify({ v: 1, ...frame }) }); }
}
function setup() {
    const timers = [];
    const transport = new NativeTransport({ origin: 'https://watchly.test', WebSocketImpl: FakeWebSocket,
        schedule: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; }, cancel: timer => { if (timer) timer.cancelled = true; }, random: () => 0.5 });
    transport.auth = callback => callback({ accessToken: 'private-test-token' });
    transport.connect(); return { transport, ws: transport.ws, timers };
}

test('native auth never appears in URLs; ACKs correlate once and the wire is not Socket.IO', () => {
    const { transport, ws } = setup(); ws.welcome();
    assert.equal(ws.url.includes('private-test-token'), false); assert.equal(ws.sent[0].type, 'hello');
    let calls = 0;
    transport.timeout(1000).emit('room:snapshot', {}, (error, value) => { assert.equal(error, null); assert.equal(value.ok, true); calls++; });
    const frame = ws.sent.at(-1); assert.equal(frame.event, 'room:snapshot'); assert.equal(frame.seq, 1);
    ws.receive({ ack: frame.id, result: { ok: true } }); ws.receive({ ack: frame.id, result: { ok: true } });
    assert.equal(calls, 1); transport.disconnect();
});
test('room routing changes native endpoints without losing the pending join or firing a false disconnect', () => {
    const { transport, ws } = setup(); ws.welcome(); let disconnects = 0, response;
    transport.on('disconnect', () => disconnects++);
    transport.timeout(1000).emit('room:join', { roomId: 'ABCDEFG', nickname: 'Viewer', protocolVersion: 2 }, (error, result) => { assert.equal(error, null); response = result; });
    const next = transport.ws; assert.ok(next.url.endsWith('/ws/rooms/ABCDEFG')); next.welcome('socket2');
    const frame = next.sent.find(item => item.event === 'room:join'); assert.ok(frame);
    next.receive({ ack: frame.id, result: { ok: true } }); assert.equal(response.ok, true); assert.equal(disconnects, 0); transport.disconnect();
});
test('outages fail pending requests, discard stale controls and reconnect with bounded jitter', () => {
    const { transport, ws, timers } = setup(); ws.welcome(); let failed = false;
    transport.timeout(1000).emit('playback:command', {}, error => { failed = Boolean(error); });
    ws.onclose(); assert.equal(failed, true); assert.equal(transport.sendBuffer.length, 0);
    const retry = timers.at(-1); assert.equal(retry.delay, 1000);
    transport.emit('seek_video', { playedSeconds: 300 }); assert.equal(transport.sendBuffer.length, 0);
    retry.callback(); transport.ws.welcome(); assert.equal(transport.ws.sent.some(frame => frame.event === 'seek_video'), false); transport.disconnect();
});
test('intentional disconnect cancels reconnect and heartbeat work, and a missing pong recovers', () => {
    const { transport, ws, timers } = setup(); ws.welcome();
    timers.find(t => t.delay === 60000 && !t.cancelled).callback(); assert.equal(ws.sent.at(-1), '__watchly_ping__');
    timers.at(-1).callback(); assert.equal(ws.closed, true);
    transport.disconnect(); assert.equal(transport.active, false); assert.equal(timers.at(-1).cancelled, true);
});

test('a join requested before the first welcome waits for the destination socket to open', async () => {
    const { transport, ws } = setup();
    const requester = createRoomRequester(transport);
    const promise = requester.request('room:join', { roomId: 'ABCDEFG', nickname: 'Viewer', protocolVersion: 2 });
    ws.welcome();
    const destination = transport.ws;
    assert.notEqual(destination, ws); assert.equal(destination.sent.length, 0);
    destination.welcome('socket2');
    const request = destination.sent.find(frame => frame.event === 'room:join');
    destination.receive({ ack: request.id, result: { ok: true } });
    assert.equal((await promise).ok, true); transport.disconnect();
});

test('hibernation account refresh is coalesced and transport backpressure bounds pending work', () => {
    const { transport, ws } = setup(); ws.welcome();
    ws.receive({ event: 'account:refresh-required', args: [] });
    ws.receive({ event: 'account:refresh-required', args: [] });
    const updates = ws.sent.filter(frame => frame.event === 'auth:update'); assert.equal(updates.length, 1);
    ws.receive({ ack: updates[0].id, result: { ok: true } });
    ws.bufferedAmount = 1024 * 1024 + 1;
    let result; transport.emit('room:snapshot', {}, value => { result = value; }); assert.equal(result.ok, false);
    assert.equal(transport.pending.size, 0); transport.disconnect();
});

test('account leases refresh before directory expiry and stop on disconnect', () => {
    const { transport, ws, timers } = setup(); ws.welcome();
    const lease = timers.find(t => t.delay === 300000 && !t.cancelled); lease.callback();
    const update = ws.sent.find(frame => frame.event === 'auth:update'); assert.ok(update);
    ws.receive({ ack: update.id, result: { ok: true } });
    transport.disconnect(); assert.equal(timers.filter(t => t.delay === 300000).at(-1).cancelled, true);
});
