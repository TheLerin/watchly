// Aggregate in memory, emit at checkpoints, and persist no telemetry. These are handler wall times, not billed CPU measurements.
export class RoomDiagnostics {
  constructor(enabled = false, sink = console.log) { this.enabled = enabled; this.sink = sink; this.reset(); }
  reset() { this.count = 0; this.events = {}; this.rows = 0; this.zeroWriteEvents = 0; this.totalMs = 0; this.maximumMs = 0; }
  record(event, elapsedMs, rows) {
    if (!this.enabled) return;
    const group = event.startsWith('room:') ? 'room' : event.startsWith('screen:') || event.startsWith('webrtc_') ? 'signaling' : event.startsWith('auth:') ? 'auth' : event.startsWith('social:') ? 'social' : ['clock:ping', 'network_ping', 'playback:telemetry'].includes(event) ? 'ephemeral' : 'media-chat-queue';
    this.events[group] = (this.events[group] || 0) + 1; this.count++; this.rows += rows;
    if (!rows) this.zeroWriteEvents++;
    this.totalMs += elapsedMs; this.maximumMs = Math.max(this.maximumMs, elapsedMs);
    if (this.count >= 256) {
      this.sink(JSON.stringify({ code: 'ROOM_EVENT_AGGREGATE', events: this.events, count: this.count, logicalRowsWritten: this.rows, zeroWriteEvents: this.zeroWriteEvents,
        meanHandlerWallMs: Math.round(this.totalMs / this.count * 100) / 100, maxHandlerWallMs: Math.round(this.maximumMs * 100) / 100 })); this.reset();
    }
  }
}
