import { boundedJson, json } from './runtime.mjs';

// Internal binding only; indexed account lookups avoid scanning all rooms for every friend refresh.
export class PresenceDirectory {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, object_name TEXT NOT NULL, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL, friends TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS connections_object ON connections(object_name)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS connections_account ON connections(account_id,expires_at)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS connections_expiry ON connections(expires_at)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS subscriptions (subject_id TEXT NOT NULL, object_name TEXT NOT NULL, PRIMARY KEY(subject_id,object_name))');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS notifications (object_name TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, terminal_until INTEGER NOT NULL DEFAULT 0)');
    const columns = new Set(this.rows('PRAGMA table_info(notifications)').map(row => row.name));
    for (const [name, definition] of [['version', 'INTEGER NOT NULL DEFAULT 1'], ['attempts', 'INTEGER NOT NULL DEFAULT 0'], ['next_at', 'INTEGER NOT NULL DEFAULT 0'], ['terminal_until', 'INTEGER NOT NULL DEFAULT 0']]) if (!columns.has(name)) ctx.storage.sql.exec(`ALTER TABLE notifications ADD COLUMN ${name} ${definition}`);
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS notifications_due ON notifications(next_at)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS source_updates (object_name TEXT PRIMARY KEY, version INTEGER NOT NULL, expires_at INTEGER NOT NULL)');
  }
  rows(sql, ...args) { return this.ctx.storage.sql.exec(sql, ...args).toArray(); }
  status(id) {
    const live = this.rows('SELECT status FROM connections WHERE account_id=? AND expires_at>?', id, Date.now());
    return live.some(row => row.status === 'in_room') ? 'in_room' : live.length ? 'online' : 'offline';
  }
  notify(subjects) {
    for (const id of subjects) for (const row of this.rows('SELECT object_name FROM subscriptions WHERE subject_id=?', id)) {
      const previous = this.rows('SELECT version FROM notifications WHERE object_name=?', row.object_name)[0];
      if (!previous && this.rows('SELECT COUNT(*) AS count FROM notifications')[0].count >= 10000) continue;
      this.ctx.storage.sql.exec('INSERT INTO notifications(object_name,version,next_at) VALUES(?,1,?) ON CONFLICT(object_name) DO UPDATE SET version=version+1,attempts=0,next_at=excluded.next_at,terminal_until=0', row.object_name, Date.now() + 1000);
    }
  }
  async schedule() {
    const pending = this.rows('SELECT MIN(next_at) AS at FROM notifications')[0]?.at;
    const expiry = this.rows('SELECT MIN(expires_at) AS expiry FROM connections')[0]?.expiry;
    const sourceExpiry = this.rows('SELECT MIN(expires_at) AS expiry FROM source_updates')[0]?.expiry;
    const at = Math.min(pending ?? Infinity, expiry || Infinity, sourceExpiry || Infinity);
    const current = await this.ctx.storage.getAlarm();
    if (Number.isFinite(at) && current !== at) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, at));
    else if (!Number.isFinite(at) && current !== null) await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    const body = await boundedJson(request, 512 * 1024);
    if (new URL(request.url).pathname === '/query') {
      if (!Array.isArray(body.friends) || body.friends.length > 5000 || body.friends.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return json({ error: 'Invalid presence query' }, 400);
      return json([...new Set(body.friends)].map(accountId => ({ accountId, status: this.status(accountId) })));
    }
    if (!/^[A-Z0-9]{7}$/.test(body.objectName) || !Array.isArray(body.entries) || body.entries.length > 70) return json({ error: 'Invalid object' }, 400);
    if (body.entries.some(entry => !entry || typeof entry.id !== 'string' || entry.id.length > 100 || typeof entry.accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(entry.accountId) || !Number.isFinite(entry.expiresAt) || !['online', 'in_room'].includes(entry.status) || !Array.isArray(entry.friends) || entry.friends.length > 5000 || entry.friends.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) return json({ error: 'Invalid presence entries' }, 400);
    const last = this.rows('SELECT version FROM source_updates WHERE object_name=?', body.objectName)[0];
    if (body.version !== undefined && (!Number.isSafeInteger(body.version) || body.version <= 0)) return json({ error: 'Invalid source version' }, 400);
    if (body.version !== undefined && last?.version >= body.version) return json({ ok: true, duplicate: true });
    const previous = this.rows('SELECT * FROM connections WHERE object_name=?', body.objectName);
    const next = body.entries.filter(entry => entry.expiresAt > Date.now()).map(entry => ({ ...entry, expiresAt: Math.min(entry.expiresAt, Date.now() + 600000) }));
    const affected = new Set([...previous.map(entry => entry.account_id), ...next.map(entry => entry.accountId)]);
    const before = new Map([...affected].map(id => [id, this.status(id)]));
    const nextById = new Map(next.map(entry => [entry.id, entry]));
    let subscriptionsChanged = false;
    for (const old of previous) if (!nextById.has(old.id)) {
      this.ctx.storage.sql.exec('DELETE FROM connections WHERE id=?', old.id); subscriptionsChanged = true;
    }
    for (const entry of next) {
      const old = previous.find(item => item.id === entry.id), friends = JSON.stringify(entry.friends || []);
      if (!old || old.account_id !== entry.accountId || old.expires_at !== entry.expiresAt || old.status !== entry.status || old.friends !== friends) {
        this.ctx.storage.sql.exec('INSERT INTO connections VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,expires_at=excluded.expires_at,status=excluded.status,friends=excluded.friends', entry.id, body.objectName, entry.accountId, entry.expiresAt, entry.status, friends);
      }
      if (!old || old.friends !== friends) subscriptionsChanged = true;
    }
    if (subscriptionsChanged) {
      this.ctx.storage.sql.exec('DELETE FROM subscriptions WHERE object_name=?', body.objectName);
      const subjects = new Set(next.flatMap(entry => entry.friends || []));
      for (const subject of subjects) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO subscriptions VALUES(?,?)', subject, body.objectName);
    }
    this.notify([...affected].filter(id => before.get(id) !== this.status(id)));
    if (body.version !== undefined) this.ctx.storage.sql.exec('INSERT INTO source_updates VALUES(?,?,?) ON CONFLICT(object_name) DO UPDATE SET version=excluded.version,expires_at=excluded.expires_at', body.objectName, body.version, Date.now() + 86400000);
    await this.schedule(); return json({ ok: true });
  }
  async alarm() {
    const now = Date.now(), expired = this.rows('SELECT id,account_id,object_name FROM connections WHERE expires_at<=? LIMIT 500', now);
    this.ctx.storage.sql.exec('DELETE FROM source_updates WHERE expires_at<=?', now);
    for (const row of expired) this.ctx.storage.sql.exec('DELETE FROM connections WHERE id=?', row.id);
    for (const name of new Set(expired.map(row => row.object_name))) {
      if (!this.rows('SELECT id FROM connections WHERE object_name=? LIMIT 1', name).length) this.ctx.storage.sql.exec('DELETE FROM subscriptions WHERE object_name=?', name);
    }
    this.notify(new Set(expired.map(row => row.account_id)));
    // Bound fan-out per event; pending notifications remain durable and are retried by the next alarm.
    const notifications = this.rows('SELECT object_name,version,attempts,terminal_until FROM notifications WHERE next_at<=? LIMIT 40', now);
    await Promise.allSettled(notifications.map(async ({ object_name: name, version, attempts, terminal_until }) => {
      if (terminal_until) { this.ctx.storage.sql.exec('DELETE FROM notifications WHERE object_name=? AND version=?', name, version); return; }
      try {
        const response = await this.env.ROOMS.get(this.env.ROOMS.idFromName(name)).fetch(new Request('https://internal/presence-refresh', { signal: AbortSignal.timeout(5000) }));
        if (!response.ok) throw new Error('Presence notification unavailable');
        this.ctx.storage.sql.exec('DELETE FROM notifications WHERE object_name=? AND version=?', name, version);
      } catch {
        const failures = attempts + 1, terminal = failures >= 6 ? now + 3600000 : 0;
        const next = terminal || now + Math.round(Math.min(60000, 1000 * 2 ** failures) * (0.85 + Math.random() * 0.3));
        this.ctx.storage.sql.exec('UPDATE notifications SET attempts=?,next_at=?,terminal_until=? WHERE object_name=? AND version=?', failures, next, terminal, name, version);
        if (terminal) console.warn(JSON.stringify({ code: 'PRESENCE_NOTIFY_EXHAUSTED', attempts: failures }));
      }
    }));
    await this.schedule();
  }
}
