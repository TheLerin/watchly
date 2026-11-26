import { encode, decode } from './runtime.mjs';

const VERSION = 3;
const tables = ['room_meta', 'video_state', 'playback_state', 'memberships', 'queue_items', 'chat_messages', 'room_sets', 'media_statuses', 'processed_commands', 'connections_v2', 'acknowledgements', 'media_jobs', 'webhook_receipts', 'room_access', 'room_invites', 'join_requests', 'presence_state'];
const collections = ['users', 'queue', 'chatHistory', 'videoState', 'playback', 'mediaStatuses', 'recentCommandIds', 'kickedUserIds', 'localReadyUserIds', 'voiceSocketIds', 'screenViewerSocketIds', 'access', 'roomInvites', 'joinRequests', 'bannedGuestHashes'];
const sets = ['kickedUserIds', 'localReadyUserIds', 'voiceSocketIds', 'screenViewerSocketIds', 'bannedGuestHashes'];
const key = (room, id) => JSON.stringify([room, id]);
const accountData = data => {
  const { account, ...rest } = data;
  return { ...rest, ...(account ? { account: { id: account.id, profile: account.profile, expiresAt: account.expiresAt } } : { account: null }) };
};
const cleanAck = frame => {
  const { resumeToken, inviteToken, ...result } = frame.result || {};
  return { ...frame, result };
};

// A table row is one bounded domain record. Diffing avoids writes to unrelated collections.
export class RoomStorage {
  constructor(storage) {
    this.storage = storage; this.sql = storage.sql; this.previous = new Map(); this.rowsWritten = 0;
    this.sql.exec('CREATE TABLE IF NOT EXISTS storage_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
    const version = this.sql.exec('SELECT version FROM storage_schema WHERE id=1').toArray()[0]?.version;
    if (version && version !== 2 && version !== VERSION) throw new Error('Unsupported room storage version; refusing to overwrite state');
    for (const table of tables) this.sql.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.sql.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
    for (const table of tables) this.previous.set(table, new Map(this.sql.exec(`SELECT id,value FROM ${table}`).toArray().map(row => [row.id, row.value])));
    if (!version) {
      const row = this.sql.exec('SELECT value FROM state WHERE id=1').toArray()[0];
      // Decode/validate before beginning migration; corrupt state stays untouched for recovery.
      const saved = row ? decode(row.value) : {};
      this.validate(saved);
      this.write(saved, () => {
        this.sql.exec('INSERT INTO storage_schema(id,version) VALUES(1,?)', VERSION);
        this.sql.exec('DELETE FROM state WHERE id=1');
      });
    } else if (version === 2) {
      this.validate(this.load());
      // Older schema-2 Workers must fail closed instead of reopening new private rooms as public on rollback.
      this.atomic(() => this.sql.exec('UPDATE storage_schema SET version=? WHERE id=1', VERSION));
    }
  }
  atomic(task) {
    if (!this.storage.transactionSync) throw new Error('SQLite transactionSync is required for safe room persistence');
    return this.storage.transactionSync(task);
  }
  validate(saved) {
    if (!saved || typeof saved !== 'object' || (saved.rooms !== undefined && !(saved.rooms instanceof Map))) throw new Error('Invalid room storage');
    if (saved.rooms?.size > 1) throw new Error('Unexpected room count');
    for (const [id, room] of saved.rooms || []) {
      if (!/^[A-Z0-9]{7}$/.test(id) || !room || room.id !== id || !Array.isArray(room.users) || room.users.length > 500 || !Array.isArray(room.queue) || room.queue.length > 500 || !Array.isArray(room.chatHistory) || room.chatHistory.length > 500) throw new Error('Invalid room record');
    }
  }
  records(saved, selected = tables) {
    const wanted = new Set(selected);
    const records = new Map([...wanted].map(table => [table, new Map()]));
    const put = (table, id, value) => {
      if (!wanted.has(table)) return;
      const encoded = encode(value);
      if (new TextEncoder().encode(encoded).length > 1024 * 1024) throw new Error('Room record exceeds application storage bound');
      records.get(table).set(id, encoded);
    };
    if (saved.keepObject || saved.rooms?.size || saved.connections?.size || saved.mediaRemovals?.size) put('room_meta', '$object', { name: saved.name, revision: saved.revision || 0 });
    for (const [id, room] of saved.rooms || []) {
      if (wanted.has('room_meta')) put('room_meta', id, Object.fromEntries(Object.entries(room).filter(([field]) => !collections.includes(field))));
      put('video_state', id, room.videoState); put('playback_state', id, room.playback);
      if (room.access) put('room_access', id, room.access);
      if (wanted.has('room_invites')) for (const [inviteId, invite] of room.roomInvites || []) put('room_invites', key(id, inviteId), invite);
      if (wanted.has('join_requests')) for (const [requestId, request] of room.joinRequests || []) put('join_requests', key(id, requestId), request);
      if (wanted.has('memberships')) for (const user of room.users) { const { telemetry, ...member } = user; put('memberships', key(id, user.userId), member); }
      if (wanted.has('queue_items')) room.queue.forEach((value, order) => put('queue_items', key(id, value.id), { order, value }));
      if (wanted.has('chat_messages')) room.chatHistory.forEach((value, order) => put('chat_messages', key(id, value.id || order), { order, value }));
      if (wanted.has('room_sets')) for (const field of sets) for (const value of room[field] || []) put('room_sets', key(id, [field, value]), value);
      if (wanted.has('media_statuses')) for (const [member, status] of room.mediaStatuses || []) put('media_statuses', key(id, member), status);
      if (wanted.has('processed_commands')) for (const [command, result] of room.recentCommandIds || []) put('processed_commands', key(id, command), result);
    }
    if (wanted.has('connections_v2')) for (const [id, data] of saved.connections || []) put('connections_v2', id, accountData(data));
    if (wanted.has('acknowledgements')) for (const [id, frame] of saved.frames || []) put('acknowledgements', id, cleanAck(frame));
    if (wanted.has('media_jobs')) for (const [id, job] of saved.mediaRemovals || []) put('media_jobs', id, job);
    if (wanted.has('webhook_receipts')) for (const [id, expiry] of saved.mediaEvents || []) put('webhook_receipts', id, expiry);
    if (saved.presenceState?.version) put('presence_state', 'state', saved.presenceState);
    return records;
  }
  prepare(saved, selected = tables) {
    this.validate(saved);
    return this.records(saved, selected);
  }
  roomChanged(plan) {
    for (const [table, rows] of plan) {
      if (['connections_v2', 'acknowledgements', 'media_jobs', 'webhook_receipts', 'presence_state'].includes(table)) continue;
      const previous = this.previous.get(table);
      for (const [id, value] of rows) if (!(table === 'room_meta' && id === '$object') && previous.get(id) !== value) return true;
      for (const id of previous.keys()) if (!(table === 'room_meta' && id === '$object') && !rows.has(id)) return true;
    }
    return false;
  }
  write(saved, finalize) { return this.writePrepared(this.prepare(saved), finalize); }
  writePrepared(next, finalize) {
    let changes = 0;
    this.atomic(() => {
      for (const [table, rows] of next) {
        const previous = this.previous.get(table);
        for (const id of previous.keys()) if (!rows.has(id)) { this.sql.exec(`DELETE FROM ${table} WHERE id=?`, id); changes++; }
        for (const [id, value] of rows) if (previous.get(id) !== value) {
          this.sql.exec(`INSERT INTO ${table}(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value`, id, value); changes++;
        }
      }
      finalize?.();
    });
    for (const [table, rows] of next) this.previous.set(table, rows);
    this.rowsWritten += changes;
    return changes;
  }
  load() {
    const rows = table => [...this.previous.get(table)].map(([id, value]) => [id, decode(value)]);
    const saved = { ...decode(this.previous.get('room_meta').get('$object') || '{}'), rooms: new Map(), connections: new Map(rows('connections_v2')), frames: new Map(rows('acknowledgements')), mediaRemovals: new Map(rows('media_jobs')), mediaEvents: new Map(rows('webhook_receipts')) };
    saved.presenceState = this.previous.get('presence_state').has('state') ? decode(this.previous.get('presence_state').get('state')) : { version: 0, job: null };
    for (const [id, meta] of rows('room_meta')) if (id !== '$object') {
      const room = { ...meta, users: [], queue: [], chatHistory: [], mediaStatuses: new Map(), recentCommandIds: new Map(), ...Object.fromEntries(sets.map(field => [field, meta[field] instanceof Set ? meta[field] : new Set()])) };
      room.videoState = decode(this.previous.get('video_state').get(id)); room.playback = decode(this.previous.get('playback_state').get(id));
      const grouped = table => rows(table).filter(([row]) => JSON.parse(row)[0] === id).map(([row, value]) => [JSON.parse(row)[1], value]);
      room.users = grouped('memberships').map(([, value]) => value);
      for (const [table, field] of [['queue_items', 'queue'], ['chat_messages', 'chatHistory']]) room[field] = grouped(table).map(([, value]) => value).sort((a, b) => a.order - b.order).map(row => row.value);
      for (const [[field, entry]] of grouped('room_sets')) if (sets.includes(field)) room[field].add(entry);
      room.mediaStatuses = new Map(grouped('media_statuses')); room.recentCommandIds = new Map(grouped('processed_commands'));
      room.access = this.previous.get('room_access').has(id) ? decode(this.previous.get('room_access').get(id)) : meta.access;
      room.roomInvites = new Map(grouped('room_invites').length ? grouped('room_invites') : meta.roomInvites || []);
      room.joinRequests = new Map(grouped('join_requests').length ? grouped('join_requests') : meta.joinRequests || []);
      saved.rooms.set(id, room);
    }
    this.validate(saved); return saved;
  }
  bytes() { return [...this.previous.values()].reduce((sum, rows) => sum + [...rows.values()].reduce((size, value) => size + new TextEncoder().encode(value).length, 0), 0); }
}
