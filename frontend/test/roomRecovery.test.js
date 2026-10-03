import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRoomRecovery, readRoomSession } from '../src/utils/roomRecovery.js';
import { acceptsVideoState, mergeChatHistory } from '../src/utils/roomState.js';

function fixture() {
    const socket = new EventEmitter(); socket.io = new EventEmitter(); socket.sendBuffer = [];
    let session = { roomId: 'ABCDEFG', nickname: 'Viewer', memberId: 'member', resumeToken: 'a'.repeat(43) }, time = 0, connects = 0;
    const sent = [], phases = [], snapshots = [], failures = [], joins = [], notices = [], timers = new Map(); let timerId = 0;
    socket.connect = () => { connects++; socket.active = true; };
    socket.timeout = () => ({ emit: (event, payload, ack) => sent.push({ event, payload, ack }) });
    const recovery = createRoomRecovery({ socket, getSession: () => session, onPhase: value => phases.push(value),
        onSnapshot: (snapshot, id) => snapshots.push({ snapshot, id }), onJoin: value => joins.push(value), onFailure: error => failures.push(error),
        onOutage: () => notices.push('outage'), onRestored: () => notices.push('restored'),
        schedule: (fn, delay) => { timers.set(++timerId, { fn, at: time + delay }); return timerId; }, cancel: id => timers.delete(id), now: () => time,
    });
    const advance = value => { time += value; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); } };
    const connected = () => { socket.connected = true; socket.emit('connect'); };
    const disconnected = () => { socket.connected = false; socket.emit('disconnect', 'transport close'); };
    const acknowledge = () => sent.at(-1).ack(null, { ok: true, snapshot: { videoState: { url: 'B' } } });
    return { socket, recovery, sent, phases, snapshots, failures, joins, notices, advance, connected, disconnected, acknowledge, connects: () => connects, setSession: value => { session = value; } };
}

test('unexpected disconnect rejoins the same identity, waits for player resync, and coalesces wake signals', () => {
    const f = fixture(); f.recovery.resume(); assert.equal(f.connects(), 1);
    f.connected(); f.recovery.wake(true); f.recovery.wake(true);
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].event, 'room:join');
    assert.equal(f.sent[0].payload.memberId, 'member'); assert.equal(f.sent[0].payload.resumeToken, 'a'.repeat(43));
    f.acknowledge(); assert.equal(f.phases.at(-1), 'resyncing');
    assert.equal(f.recovery.complete(-1), false); assert.equal(f.recovery.complete(f.snapshots.at(-1).id), true);
    assert.equal(f.phases.at(-1), 'connected');
    f.disconnected(); assert.equal(f.phases.at(-1), 'reconnecting');
    f.connected(); f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id);
    assert.deepEqual(f.notices, ['outage', 'restored', 'outage', 'restored']);
    f.recovery.dispose(); assert.equal(f.socket.listenerCount('connect'), 0); assert.equal(f.socket.io.listenerCount('reconnect_attempt'), 0);
});

test('long outages keep identity and capped retry notifications; permanent errors stop recovery', () => {
    const f = fixture(); f.recovery.resume(); f.advance(60000);
    f.socket.io.emit('reconnect_attempt'); assert.equal(f.phases.at(-1), 'offline');
    assert.equal(f.notices.length, 1); f.connected();
    f.sent.at(-1).ack(null, { ok: false, error: { code: 'SESSION_INVALID', message: 'Invalid session', retryable: false } });
    assert.equal(f.phases.at(-1), 'failed'); assert.equal(f.failures.length, 1);
    f.recovery.wake(true); f.connected(); assert.equal(f.sent.length, 1);
    f.recovery.dispose();
});

test('old ACKs and completion callbacks cannot restore stale state after a flap or intentional leave', () => {
    const f = fixture(); f.connected(); const old = f.sent.at(-1);
    f.disconnected(); f.connected(); old.ack(null, { ok: true, snapshot: { old: true } });
    assert.equal(f.snapshots.length, 0); f.acknowledge(); const staleId = f.snapshots[0].id;
    f.disconnected(); assert.equal(f.recovery.complete(staleId), false);
    f.socket.sendBuffer.push(['pause_video']); f.recovery.stop(); f.setSession(null); f.connected(); f.advance(60000);
    assert.equal(f.sent.length, 2); assert.equal(f.socket.sendBuffer.length, 0); f.recovery.dispose();
});

test('visible/focus snapshots are throttled, replace state once, and can rebind a lost membership', () => {
    const f = fixture(); f.connected(); f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id);
    f.recovery.wake(); f.recovery.wake(); assert.equal(f.sent.length, 2); assert.equal(f.sent.at(-1).event, 'room:snapshot');
    f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id); f.recovery.wake(); assert.equal(f.sent.length, 2);
    f.advance(5001); f.recovery.wake();
    f.sent.at(-1).ack(null, { ok: false, error: { code: 'NOT_IN_ROOM', retryable: false } });
    assert.equal(f.sent.at(-1).event, 'room:join'); f.recovery.dispose();
});

test('a transient room acknowledgement retries once at the cap without simultaneous requests', () => {
    const f = fixture(); f.connected(); f.sent.at(-1).ack(new Error('Timeout'));
    assert.equal(f.phases.at(-1), 'offline'); f.advance(5000);
    assert.equal(f.sent.length, 2); f.recovery.wake(true); assert.equal(f.sent.length, 2);
    f.acknowledge(); assert.equal(f.snapshots.length, 1); f.recovery.dispose();
});
test('a stalled player reports failed sync without losing membership and can retry a fresh snapshot', () => {
    const f = fixture(); f.connected(); f.acknowledge();
    const id = f.snapshots.at(-1).id;
    assert.equal(f.recovery.failResync(id), true); assert.equal(f.phases.at(-1), 'failed');
    assert.equal(f.failures.length, 0); assert.equal(f.recovery.complete(id), false);
    f.recovery.wake(true); assert.equal(f.sent.at(-1).event, 'room:snapshot');
    f.acknowledge(); assert.equal(f.recovery.complete(f.snapshots.at(-1).id), true);
    assert.equal(f.phases.at(-1), 'connected'); f.recovery.dispose();
});

function foregroundSyncFixture() {
    const f = fixture(); f.connected(); f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id);
    f.recovery.wake(true);
    return f;
}

test('source selection waits for both the foreground snapshot and player restoration', async () => {
    const f = foregroundSyncFixture(); let settled = false;
    const ready = f.recovery.waitUntilSynced().then(value => { settled = true; return value; });
    await Promise.resolve(); assert.equal(settled, false);
    f.acknowledge(); await Promise.resolve(); assert.equal(settled, false);
    f.recovery.complete(f.snapshots.at(-1).id);
    assert.equal(await ready, true); assert.equal(f.phases.at(-1), 'connected');
    assert.equal(await f.recovery.waitUntilSynced(), true); f.recovery.dispose();
});

test('a pending selection has a bounded wait and cannot revive after timing out', async () => {
    const f = foregroundSyncFixture(); const ready = f.recovery.waitUntilSynced(1000);
    f.advance(1000); assert.equal(await ready, false);
    f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id);
    assert.equal(await ready, false); f.recovery.dispose();
});

test('disconnect, leave, disposal and failed synchronization cancel pending selections', async () => {
    for (const action of ['disconnect', 'stop', 'dispose', 'failResync']) {
        const f = foregroundSyncFixture(); const ready = f.recovery.waitUntilSynced();
        if (action === 'disconnect') f.disconnected();
        else if (action === 'failResync') { f.acknowledge(); f.recovery.failResync(f.snapshots.at(-1).id); }
        else f.recovery[action]();
        assert.equal(await ready, false, action);
        if (action === 'disconnect') { f.connected(); f.acknowledge(); f.recovery.complete(f.snapshots.at(-1).id); }
        assert.equal(await ready, false, action); f.recovery.dispose();
    }
});

test('selection cannot wait through a lost membership or a different room identity', async () => {
    const f = foregroundSyncFixture(); const ready = f.recovery.waitUntilSynced();
    f.sent.at(-1).ack(null, { ok: false, error: { code: 'NOT_IN_ROOM' } });
    assert.equal(await ready, false); assert.equal(await f.recovery.waitUntilSynced(), false);
    f.recovery.dispose();
    const other = foregroundSyncFixture(); const changed = other.recovery.waitUntilSynced();
    other.setSession({ roomId: 'HIJKLMN', memberId: 'other', resumeToken: 'b'.repeat(43) });
    // Completion cannot approve a file selected for another room/member.
    other.recovery.acceptJoin({ snapshot: {} }); other.recovery.complete(other.snapshots.at(-1).id);
    assert.equal(await changed, false); other.recovery.dispose();
});

test('source epochs reject old sources while new local declarations can reset playback sequences', () => {
    const current = { sourceEpoch: 4, sourceId: 'B', stateVersion: 2 };
    assert.equal(acceptsVideoState(current, { sourceEpoch: 3, sourceId: 'A', stateVersion: 999 }), false);
    assert.equal(acceptsVideoState(current, { ...current, stateVersion: 1 }), false);
    assert.equal(acceptsVideoState(current, { sourceEpoch: 5, sourceId: null, stateVersion: 0 }), true);
    const local = { sourceEpoch: 5, sourceId: null, stateVersion: 9, localMedia: { sessionId: 'file' } };
    assert.equal(acceptsVideoState(local, { ...local, sourceEpoch: 6, stateVersion: 0 }), true);
});

test('chat snapshots reconcile IDs and saved sessions reject malformed credentials', () => {
    assert.deepEqual(mergeChatHistory([{ id: 'a' }, { id: 'system' }], [{ id: 'a', text: 'server' }, { id: 'b' }]), [{ id: 'a', text: 'server' }, { id: 'system' }, { id: 'b' }]);
    assert.equal(readRoomSession({ getItem: () => '{broken' }), null);
    assert.equal(readRoomSession({ getItem: () => JSON.stringify({ roomId: 'ABCDEFG', nickname: 'Name', resumeToken: 'short' }) }), null);
});
