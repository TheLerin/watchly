import { createFrameReceiver } from './frameReceiver.js';

class Events {
    constructor() { this.listeners = new Map(); }
    on(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(handler); return this; }
    off(name, handler) { if (handler) { for (const candidate of this.listeners.get(name) || []) if (candidate === handler || candidate.original === handler) this.listeners.get(name).delete(candidate); } else this.listeners.delete(name); return this; }
    once(name, handler) { const once = (...args) => { this.off(name, once); handler(...args); }; once.original = handler; return this.on(name, once); }
    fire(name, ...args) { for (const handler of [...this.listeners.get(name) || []]) handler(...args); }
}
const newCode = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(7));
    return [...bytes].map(value => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[value % 36]).join('');
};

// Retains the application's event subscription API while using native WebSocket frames exclusively.
export class NativeTransport extends Events {
    constructor({ baseUrl = '', WebSocketImpl = globalThis.WebSocket, origin = globalThis.location?.origin,
        schedule = setTimeout, cancel = clearTimeout, random = Math.random } = {}) {
        super(); this.baseUrl = baseUrl || origin; this.WebSocketImpl = WebSocketImpl;
        // Browser timer APIs must be called without this transport as their receiver.
        this.schedule = (...args) => schedule(...args); this.cancel = (...args) => cancel(...args); this.random = random;
        this.io = new Events(); this.connected = false; this.active = false; this.sendBuffer = [];
        this.pending = new Map(); this.generation = 0; this.attempt = 0; this.seq = 0; this.target = newCode(); this.watchFriends = false;
    }
    connect() { if (!this.active) { this.active = true; this.open(); } return this; }
    open(silent = false) {
        const generation = ++this.generation;
        this.cancel(this.retry); this.cancel(this.heartbeat); this.cancel(this.handshake); this.cancel(this.accountLease);
        const url = new URL(`/ws/rooms/${this.target}`, this.baseUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = this.ws = new this.WebSocketImpl(url);
        this.receiver?.reset();
        this.receiver = createFrameReceiver({ receipt: seq => ws.send(JSON.stringify({ v: 1, type: 'delivery-ack', seq })), fail: () => ws.close(), schedule: this.schedule, cancel: this.cancel });
        this.seq = 0; this.connected = false;
        this.handshake = this.schedule(() => ws.close(), 12000);
        ws.onopen = () => {
            if (generation !== this.generation) return;
            const hello = auth => ws.send(JSON.stringify({ v: 1, type: 'hello', ...auth, features: ['queue-delta-v1', 'delivery-ack-v1'] }));
            if (typeof this.auth === 'function') this.auth(hello); else hello(this.auth || {});
        };
        ws.onmessage = event => {
            if (generation !== this.generation) return;
            if (event.data === '__watchly_pong__') { this.waitingPong = false; return; }
            let frame; try { frame = JSON.parse(event.data); } catch { ws.close(); return; }
            if (frame.v !== 1) { ws.close(); return; }
            frame = this.receiver.accept(frame); if (!frame) return;
            if (frame.type === 'welcome') {
                this.cancel(this.handshake); this.id = frame.id; this.connected = true; this.attempt = 0;
                if (!silent) this.fire('connect');
                // A connect listener can route a pending join onto another room socket.
                if (generation !== this.generation) return;
                const queued = this.sendBuffer.splice(0); for (const item of queued) item();
                if (this.watchFriends) this.emit('social:watch', {});
                this.waitingPong = false; this.armHeartbeat(generation); this.armAccountLease(generation); return;
            }
            if (frame.type === 'error') {
                const error = new Error(frame.error?.message || 'Connection rejected'); error.data = frame.error;
                this.fire('connect_error', error); return;
            }
            if (frame.ack) {
                const pending = this.pending.get(frame.ack);
                if (pending) { this.pending.delete(frame.ack); this.cancel(pending.timer); pending.finish(null, frame.result); }
                return;
            }
            if (frame.event && Array.isArray(frame.args)) {
                if (frame.event === 'account:ready' && this.watchFriends) this.emit('social:watch', {});
                if (frame.event === 'account:refresh-required') {
                    this.refreshAccount(generation);
                    return;
                }
                if (frame.event === 'room_joined') { this.boundRoom = frame.args[0]?.roomId; this.usedTarget = true; }
                this.fire(frame.event, ...frame.args);
            }
        };
        ws.onerror = () => { if (generation === this.generation && !this.connected) this.fire('connect_error', new Error('Room connection failed')); };
        ws.onclose = () => {
            if (generation !== this.generation) return;
            this.receiver.reset();
            this.cancel(this.handshake); this.cancel(this.heartbeat); this.cancel(this.accountLease);
            const wasConnected = this.connected; this.connected = false; this.id = undefined; this.refreshingAccount = false;
            this.rejectPending(); this.sendBuffer.length = 0;
            if (wasConnected || silent) this.fire('disconnect', 'transport close');
            if (this.active) {
                const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) * (0.75 + this.random() * 0.5);
                this.retry = this.schedule(() => { this.io.fire('reconnect_attempt', this.attempt); this.open(); }, delay);
            }
        };
    }
    refreshAccount(generation) {
        if (this.refreshingAccount || !this.connected || generation !== this.generation) return;
        this.refreshingAccount = true;
        const refreshed = auth => {
            if (generation !== this.generation) return;
            if (!auth?.accessToken) { this.refreshingAccount = false; return; }
            this.emit('auth:update', auth, () => { if (generation === this.generation) this.refreshingAccount = false; });
        };
        try { if (typeof this.auth === 'function') this.auth(refreshed); else refreshed(this.auth || {}); }
        catch { this.refreshingAccount = false; }
    }
    armAccountLease(generation) {
        this.accountLease = this.schedule(() => {
            if (!this.connected || generation !== this.generation) return;
            this.refreshAccount(generation); this.armAccountLease(generation);
        }, 300000);
    }
    armHeartbeat(generation) {
        const hidden = globalThis.document?.visibilityState === 'hidden';
        this.heartbeat = this.schedule(() => {
            if (!this.connected || generation !== this.generation) return;
            if (this.waitingPong) { this.ws.close(); return; }
            this.waitingPong = true; this.ws.send('__watchly_ping__'); this.armHeartbeat(generation);
        }, hidden ? 180000 : 60000);
    }
    timeout(ms) { return { emit: (event, payload, callback) => this.send(event, payload, callback, ms) }; }
    emit(event, payload, callback) { if (typeof payload === 'function') { callback = payload; payload = {}; } return this.send(event, payload, callback); }
    send(event, payload = {}, callback, timeoutMs) {
        if (event === 'social:watch') this.watchFriends = true;
        if (event === 'social:unwatch') this.watchFriends = false;
        const finish = (error, response) => { if (timeoutMs) callback?.(error, response); else callback?.(error ? { ok: false, error: { code: 'DISCONNECTED', message: error.message } } : response); };
        const transmit = () => {
            if (this.pending.size >= 128 || this.ws.bufferedAmount > 1024 * 1024) {
                finish(new Error('Connection is busy. Retry shortly.')); return;
            }
            const id = crypto.randomUUID();
            if (callback) {
                const timer = this.schedule(() => { this.pending.delete(id); finish(new Error('Request timed out')); }, timeoutMs || 15000);
                this.pending.set(id, { timer, finish });
            }
            try { this.ws.send(JSON.stringify({ v: 1, id, seq: ++this.seq, event, args: [payload], ack: Boolean(callback) })); }
            catch {
                const pending = this.pending.get(id); if (pending) { this.cancel(pending.timer); this.pending.delete(id); }
                finish(new Error('Connection interrupted')); this.ws.close();
            }
        };
        if (event === 'room:join' || event === 'room:create') {
            const target = event === 'room:create' ? (this.usedTarget ? newCode() : this.target) : String(payload.roomId || '').toUpperCase();
            if (!/^[A-Z0-9]{7}$/.test(target)) { finish(null, { ok: false, error: { code: 'INVALID_ROOM_CODE', message: 'Room codes contain seven letters or numbers.' } }); return this; }
            if (this.boundRoom && this.boundRoom !== target) { finish(null, { ok: false, error: { code: 'ALREADY_IN_ROOM', message: 'Leave the current room first.' } }); return this; }
            if (target !== this.target) {
                this.target = target; const old = this.ws; this.generation++; this.rejectPending();
                this.sendBuffer.push(transmit); this.open(true); old?.close(); return this;
            }
        }
        if (event === 'leave_room') this.boundRoom = null;
        if (!this.connected) {
            // Never replay playback/chat/signaling captured during a network outage.
            finish(new Error('Room connection is unavailable')); return this;
        }
        transmit(); return this;
    }
    rejectPending() { for (const pending of this.pending.values()) { this.cancel(pending.timer); pending.finish(new Error('Connection interrupted')); } this.pending.clear(); }
    disconnect() {
        this.active = false; this.generation++; this.cancel(this.retry); this.cancel(this.heartbeat); this.cancel(this.handshake); this.cancel(this.accountLease);
        this.receiver?.reset();
        const wasConnected = this.connected; this.connected = false; this.id = undefined; this.boundRoom = null;
        this.rejectPending(); this.sendBuffer.length = 0; this.ws?.close();
        if (wasConnected) this.fire('disconnect', 'io client disconnect'); return this;
    }
    close() { return this.disconnect(); }
}
