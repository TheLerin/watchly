// Node/SQLite lifecycle harness. This is not a substitute for real workerd validation.
import { DatabaseSync } from 'node:sqlite';
import { WatchRoom } from '../src/WatchRoom.mjs';
import { PresenceDirectory } from '../src/PresenceDirectory.mjs';

class Socket {
  constructor() { this.messages = []; this.readyState = 1; }
  serializeAttachment(value) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(value) { this.messages.push(JSON.parse(value)); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; }
}
globalThis.WebSocketRequestResponsePair ||= class { constructor(request, response) { this.request = request; this.response = response; } };
globalThis.WebSocketPair ||= class { constructor() { this[0] = new Socket(); this[1] = new Socket(); } };
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) {
    if (init?.status === 101) return { status: 101, webSocket: init.webSocket };
    super(body, init);
  }
};

export function context() {
  const db = new DatabaseSync(':memory:');
  return {
    sockets: [], tasks: [], ready: Promise.resolve(), alarmAt: null, writes: 0,
    storage: {
      transactionSync(task) {
        db.exec('SAVEPOINT watchly_test');
        try { const result = task(); db.exec('RELEASE watchly_test'); return result; }
        catch (error) { db.exec('ROLLBACK TO watchly_test'); db.exec('RELEASE watchly_test'); throw error; }
      },
      sql: { exec(sql, ...args) {
        const statement = db.prepare(sql);
        const rows = /^(SELECT|PRAGMA)/i.test(sql) ? statement.all(...args) : (statement.run(...args), []);
        return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
      } },
      async getAlarm() { return this.ctx.alarmAt; },
      async setAlarm(value) { this.ctx.alarmAt = value; },
      async deleteAlarm() { this.ctx.alarmAt = null; },
    },
    getWebSockets() { return this.sockets.filter(ws => ws.readyState === 1); },
    acceptWebSocket(ws) { this.sockets.push(ws); },
    setWebSocketAutoResponse(value) { this.autoResponse = value; },
    blockConcurrencyWhile(task) { this.ready = task(); },
    waitUntil(task) { this.tasks.push(task); },
  };
}
export function environment(overrides = {}) {
  const rooms = new Map();
  const env = { NODE_ENV: 'development', ...overrides };
  const directoryCtx = context(); directoryCtx.storage.ctx = directoryCtx;
  const directory = new PresenceDirectory(directoryCtx, env);
  env.PRESENCE = { idFromName: value => value, get: () => ({ fetch: request => directory.fetch(request) }) };
  env.ROOMS = { idFromName: value => value, get(name) {
    if (!rooms.has(name)) {
      const ctx = context(); ctx.storage.ctx = ctx; rooms.set(name, { ctx, object: new WatchRoom(ctx, env) });
    }
    return { fetch: async request => { const item = rooms.get(name); await item.ctx.ready; return item.object.fetch(request); } };
  } };
  return { env, rooms, directory, async room(code = 'ABCDEFG') {
    env.ROOMS.get(code); const item = rooms.get(code); await item.ctx.ready; return item;
  }, async evict(code) {
    const item = rooms.get(code); item.object = new WatchRoom(item.ctx, env); await item.ctx.ready; return item;
  } };
}
export async function connect(item, token) {
  await item.object.fetch(new Request(`https://watchly.test/ws/rooms/${item.object.name || item.code || 'ABCDEFG'}`, { headers: { Upgrade: 'websocket' } }));
  const ws = item.ctx.sockets.at(-1);
  await item.object.webSocketMessage(ws, JSON.stringify({ v: 1, type: 'hello', accessToken: token }));
  return { ws, item, get id() { return ws.deserializeAttachment().id; }, seq: 0,
    async send(event, payload = {}, options = {}) {
      const frame = { v: 1, event, args: [payload], id: crypto.randomUUID(), seq: ++this.seq, ack: true, ...options };
      await item.object.webSocketMessage(ws, JSON.stringify(frame));
      return ws.messages.findLast(message => message.ack === frame.id)?.result;
    },
    async close() { ws.readyState = 3; await item.object.webSocketClose(ws, 1000); },
  };
}
