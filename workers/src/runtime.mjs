// The shared room engine uses this event API; no Socket.IO server is bundled.
export class AlarmScheduler {
  constructor() { this.timers = new Set(); }
  setTimeout = (callback, delay) => {
    const timer = { callback, at: Date.now() + Math.max(0, delay), unref() {} };
    this.timers.add(timer); return timer;
  };
  clearTimeout = timer => { this.timers.delete(timer); };
  setInterval = () => ({ unref() {} }); // Legacy cache sweeps are unnecessary per object.
  async run() {
    for (const timer of [...this.timers]) if (timer.at <= Date.now()) {
      this.timers.delete(timer); await timer.callback();
    }
  }
  next() { return Math.min(...[...this.timers].map(timer => timer.at)); }
}

export class EventAdapter {
  constructor(send, close) { this.send = send; this.close = close; this.sockets = { sockets: new Map() }; this.middleware = []; }
  use(handler) { this.middleware.push(handler); }
  on(event, handler) { if (event === 'connection') this.connection = handler; }
  to(room, except) {
    return { emit: (event, ...args) => {
      for (const socket of this.sockets.sockets.values()) {
        if (socket.id !== except && socket.connected && (socket.id === room || socket.rooms.has(room))) socket.emit(event, ...args);
      }
    } };
  }
  async add(id, data = {}, auth = {}, restore = false) {
    const socket = {
      id, data, connected: true, rooms: new Set(data.roomId ? [data.roomId] : []), handlers: new Map(), middleware: [],
      handshake: { auth },
      on(event, handler) { this.handlers.set(event, handler); },
      use(handler) { this.middleware.push(handler); },
      join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); },
      emit: (event, ...args) => this.send(id, { v: 1, event, args }),
      to: room => this.to(room, id),
      disconnect: () => { socket.connected = false; this.close(id); },
    };
    if (!restore) for (const handler of this.middleware) await new Promise((resolve, reject) => handler(socket, error => error ? reject(error) : resolve()));
    this.sockets.sockets.set(id, socket);
    this.connection(socket);
    return socket;
  }
  async dispatch(socket, event, args, callback) {
    const handler = socket.handlers.get(event);
    if (!handler || event === 'disconnect') throw new Error('Unknown event');
    const packet = [event, ...args];
    for (const middleware of socket.middleware) await new Promise((resolve, reject) => middleware(packet, error => error ? reject(error) : resolve()));
    const payload = packet.length > 1 ? packet[1] : {};
    return typeof callback === 'function' ? handler(payload, callback) : handler(payload);
  }
  async remove(id) {
    const socket = this.sockets.sockets.get(id);
    if (!socket) return;
    socket.connected = false;
    await socket.handlers.get('disconnect')?.();
    this.sockets.sockets.delete(id);
  }
}

export const encode = (value, omit = new Set()) => JSON.stringify(value, (key, item) => omit.has(key) ? undefined : item instanceof Map
  ? { $watchly: 'map', entries: [...item] } : item instanceof Set ? { $watchly: 'set', entries: [...item] } : item);
export const decode = value => JSON.parse(value, (_key, item) => item?.$watchly === 'map'
  ? new Map(item.entries) : item?.$watchly === 'set' ? new Set(item.entries) : item);

export const errorResult = (code, message) => ({ ok: false, error: { code, message } });
export const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function boundedJson(request, max = 4096) {
  const bytes = await boundedBytes(request, max);
  try {
    const value = bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
    return value;
  }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
export async function boundedBytes(request, max = 4096) {
  if (Number(request.headers.get('content-length')) > max) throw Object.assign(new Error('Request too large'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let size = 0; const chunks = [];
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw Object.assign(new Error('Request too large'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
