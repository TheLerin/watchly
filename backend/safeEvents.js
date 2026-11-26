// The same boundary protects Socket.IO and the native Worker event adapter.
const { Buffer } = require('node:buffer');
const errorResult = (code, message) => ({ ok: false, error: { code, message } });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const signal = name => /^(webrtc_|screen:(offer|answer|ice)$)/.test(name);
const limits = name => signal(name) ? [240, 70000] : name === 'playlist_update' ? [20, 256 * 1024] : name.startsWith('auth:') ? [12, 18000] : name.startsWith('room:') ? [30, 4096] : [120, 16384];

function safeAck(callback) {
    let sent = false;
    return value => { if (sent || typeof callback !== 'function') return; sent = true; try { callback(value); } catch { /* A transport callback must not escape the event boundary. */ } };
}
function safeEvents(socket, authorize) {
    const buckets = new Map();
    return (name, handler) => socket.on(name, (...args) => {
        if (name === 'disconnect') {
            try { return Promise.resolve(handler(...args)).catch(() => {}); } catch { return; }
        }
        const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined;
        const ack = safeAck(callback);
        const payload = args.length ? args[0] : {};
        if (args.length > 1 || !object(payload)) { ack(errorResult('INVALID_PAYLOAD', 'Expected one object payload.')); return; }
        const [count, bytes] = limits(name);
        let size;
        try { size = Buffer.byteLength(JSON.stringify(payload)); } catch { size = Infinity; }
        if (size > bytes) { ack(errorResult('PAYLOAD_TOO_LARGE', 'Event payload is too large.')); return; }
        const now = Date.now(), previous = buckets.get(name);
        const bucket = previous && now - previous.at < 10000 ? previous : { at: now, count: 0 };
        buckets.set(name, bucket);
        if (++bucket.count > count) { ack(errorResult('RATE_LIMITED', 'Too many events. Retry shortly.')); return; }
        const failed = () => { ack(errorResult('EVENT_FAILED', 'This operation could not be completed.')); };
        try {
            if (authorize) return Promise.resolve(authorize(name, payload)).then(result => {
                if (result) { ack(result); return; }
                return handler(payload, ack);
            }).catch(failed);
            return Promise.resolve(handler(payload, ack)).catch(failed);
        } catch { failed(); }
    });
}
module.exports = { safeEvents, safeAck };
