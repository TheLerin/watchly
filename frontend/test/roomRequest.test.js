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

test('account handshake rejection fails promptly and cannot create a room after a later connection', async () => {
    const { socket, requester, sent, timers } = fixture();
    const pending = requester.request('room:create', { nickname: 'Host' });
    const rejected = assert.rejects(pending, error => error.code === 'ACCOUNT_UNAVAILABLE' && error.message === 'Secure account verification is unavailable.');
    socket.emit('connect_error', Object.assign(new Error('Secure account verification is unavailable.'), { data: { code: 'ACCOUNT_UNAVAILABLE' } }));
    await rejected;
    assert.equal(requester.isPending(), false);
    assert.equal(timers.size, 0);
    assert.equal(socket.listenerCount('connect_error'), 0);
    socket.connected = true; socket.emit('connect');
    assert.equal(sent.length, 0);
    const retry = requester.request('room:create', { nickname: 'Host' });
    sent[0][2](null, { ok: true, roomId: 'ABCDEFG' });
    assert.equal((await retry).roomId, 'ABCDEFG');
});

test('temporary transport errors keep waiting for a connection and cancellation removes rejection listeners', async () => {
    const { socket, requester, sent } = fixture();
    const result = requester.request('room:create', {});
    socket.emit('connect_error', new Error('Temporary network outage'));
    assert.equal(requester.isPending(), true);
    socket.connected = true; socket.emit('connect');
    sent[0][2](null, { ok: true });
    await result;
    assert.equal(socket.listenerCount('connect_error'), 0);
    socket.connected = false;
    const canceled = requester.request('room:create', {});
    const rejected = assert.rejects(canceled, /canceled/);
    requester.cancel(); await rejected;
    assert.equal(socket.listenerCount('connect_error'), 0);
});
