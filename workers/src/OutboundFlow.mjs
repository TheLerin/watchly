const WINDOW = 128 * 1024, FRAME = 4 * 1024 * 1024, OBJECT_QUEUE = 16 * 1024 * 1024;
const bytes = value => new TextEncoder().encode(value).length;

// Delivery receipts bound unacknowledged bytes. Queued data is transient: interrupted chunk transfers reconnect for an authoritative snapshot.
export class OutboundFlow {
  constructor() { this.queues = new WeakMap(); this.queuedBytes = 0; }
  send(ws, frame) {
    if (!ws || ws.readyState > 1) return;
    const raw = JSON.stringify(frame), size = bytes(raw), attachment = ws.deserializeAttachment();
    if (size > FRAME || (Number.isFinite(ws.bufferedAmount) && ws.bufferedAmount > WINDOW * 2)) return this.close(ws);
    if (!attachment?.deliveryEnabled) { ws.send(raw); return; }
    const chunks = [];
    if (size <= 16384) chunks.push(raw);
    else {
      const id = crypto.randomUUID(), count = Math.ceil(raw.length / 12000);
      for (let index = 0; index < count; index++) chunks.push(JSON.stringify({ v: 1, type: 'chunk', id, index, count, data: raw.slice(index * 12000, (index + 1) * 12000) }));
    }
    const queue = this.queues.get(ws) || { frames: [], bytes: 0 };
    const total = chunks.reduce((sum, item) => sum + bytes(item), 0);
    if (queue.bytes + total > FRAME * 3 || this.queuedBytes + total > OBJECT_QUEUE) return this.close(ws);
    queue.frames.push(...chunks); queue.bytes += total; this.queuedBytes += total; this.queues.set(ws, queue);
    this.flush(ws);
  }
  flush(ws) {
    const queue = this.queues.get(ws); if (!queue) return;
    const attachment = ws.deserializeAttachment();
    const state = attachment.delivery || { seq: 0, pending: [] };
    while (queue.frames.length) {
      const raw = queue.frames[0], size = bytes(raw) + 64;
      if (state.pending.length >= 32 || state.pending.reduce((sum, item) => sum + item[1], 0) + size > WINDOW) break;
      if (Number.isFinite(ws.bufferedAmount) && ws.bufferedAmount > WINDOW * 2) return this.close(ws);
      queue.frames.shift(); queue.bytes -= bytes(raw); this.queuedBytes -= bytes(raw);
      const frame = JSON.parse(raw); frame.deliveryId = ++state.seq;
      state.pending.push([state.seq, size]);
      ws.send(JSON.stringify(frame));
    }
    attachment.delivery = state; ws.serializeAttachment(attachment);
  }
  receipt(ws, seq) {
    const attachment = ws.deserializeAttachment(), state = attachment?.delivery;
    if (!attachment?.deliveryEnabled || !Number.isSafeInteger(seq) || seq <= 0 || !state?.pending.some(item => item[0] === seq)) return false;
    state.pending = state.pending.filter(item => item[0] > seq); attachment.delivery = state; ws.serializeAttachment(attachment);
    this.flush(ws); return true;
  }
  close(ws) {
    this.forget(ws); ws.close(1013, 'Receiver is too slow; reconnect for a fresh snapshot');
  }
  forget(ws) { const queue = this.queues.get(ws); if (queue) this.queuedBytes -= queue.bytes; this.queues.delete(ws); }
}
