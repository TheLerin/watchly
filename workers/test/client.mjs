import { createRequire } from 'node:module';
const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const WebSocket = require('ws');

export async function client(base, roomId) {
  const url = new URL(`/ws/rooms/${roomId}`, base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url, { origin: base }), pending = new Map(), events = [];
  let seq = 0, socketId;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Native handshake timed out')), 10000);
    ws.once('error', error => { clearTimeout(timeout); reject(error); });
    ws.once('open', () => ws.send(JSON.stringify({ v: 1, type: 'hello' })));
    ws.on('message', message => {
      const frame = JSON.parse(String(message));
      if (frame.type === 'welcome') { socketId = frame.id; clearTimeout(timeout); resolve(); }
      if (frame.ack && pending.has(frame.ack)) { const call = pending.get(frame.ack); clearTimeout(call.timeout); pending.delete(frame.ack); call.resolve(frame.result); }
      if (frame.event) events.push(frame);
    });
  });
  return { ws, events, socketId,
    send(event, payload = {}, overrides = {}) {
      const frame = { v: 1, event, args: [payload], id: crypto.randomUUID(), seq: ++seq, ack: true, ...overrides };
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(frame.id); reject(new Error('ACK timed out: ' + event)); }, 10000);
        pending.set(frame.id, { resolve, timeout }); ws.send(JSON.stringify(frame));
      });
    },
    close() { for (const call of pending.values()) clearTimeout(call.timeout); ws.close(); },
  };
}
