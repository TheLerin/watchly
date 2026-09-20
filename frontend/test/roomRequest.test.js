import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRoomRequester } from '../src/utils/roomRequest.js';

const fixture = () => {
    const socket = new EventEmitter();
    socket.io = new EventEmitter();
    socket.connect = () => {};
    const sent = [];
    socket.timeout = () => ({ emit: (...args) => sent.push(args) });
    const timers = new Map();
    let id = 0;
    const requester = createRoomRequester(socket, {
        schedule: fn => { timers.set(++id, fn); return id; },
        cancelTimer: key => timers.delete(key),
    });
    return { socket, sent, timers, requester, expire: () => [...timers.values()].forEach(fn => fn()) };
};

test('offline room requests expire and cannot fire after a later connection', async () => {
    const { socket, requester, sent, expire } = fixture();
    const result = requester.request('room:create', { nickname: 'Host' });
    const rejected = assert.rejects(result, /Could not connect/);
    expire();
    await rejected;
    socket.emit('connect');
    assert.equal(sent.length, 0);
    assert.equal(socket.listenerCount('connect'), 0);
    assert.equal(socket.io.listenerCount('reconnect_failed'), 0);
});

test('double clicks share one operation and conflicting requests are rejected', async () => {
    const { socket, requester, sent, timers } = fixture();
    const first = requester.request('room:create', { nickname: 'Host' });
    assert.equal(requester.request('room:create', { nickname: 'Host' }), first);
    await assert.rejects(requester.request('room:join', { roomId: 'ABCDEFG' }), /already in progress/);
    socket.connected = true;
    socket.emit('connect');
    assert.equal(sent.length, 1);
    sent[0][2](null, { ok: true, roomId: 'ABCDEFG' });
    assert.equal((await first).roomId, 'ABCDEFG');
    assert.equal(timers.size, 0);
    assert.equal(requester.isPending(), false);
});

test('cancel removes pending listeners and permits another request', async () => {
    const { socket, requester } = fixture();
    const first = requester.request('room:create', {});
    const rejected = assert.rejects(first, /canceled/);
    requester.cancel();
    await rejected;
    assert.equal(socket.listenerCount('connect'), 0);
    const second = requester.request('room:join', {});
    const failed = assert.rejects(second, /Could not connect/);
    socket.io.emit('reconnect_failed');
    await failed;
});

test('acknowledgement timeout releases the operation and ignores late callbacks', async () => {
    const { socket, requester, expire, sent } = fixture();
    socket.connected = true;
    const first = requester.request('room:create', {});
    const rejected = assert.rejects(first, /timed out/);
    expire();
    await rejected;
    const second = requester.request('room:create', {});
    sent[0][2](null, { ok: true });
    assert.equal(requester.isPending(), true);
    sent[1][2](null, { ok: true });
    await second;
});
