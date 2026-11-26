import { boundedJson, json } from './runtime.mjs';

const policies = {
  connect: [40, 60000], create: [6, 600000], join: [40, 60000],
  drive: [180, 60000], media: [30, 60000], social: [30, 60000], auth: [20, 60000],
};
const dailyBudgets = { rooms: ['DAILY_NEW_ROOM_BUDGET', 1000], social: ['DAILY_SOCIAL_LOOKUP_BUDGET', 10000], media: ['DAILY_MEDIA_JOIN_BUDGET', 100] };
export async function reserveBudget(env, kind) {
  if (env.NODE_ENV !== 'production' && env.QUOTA_ENFORCE !== 'true') return true;
  if (!env.ABUSE) return false;
  const response = await env.ABUSE.get(env.ABUSE.idFromName('quota')).fetch(new Request('https://internal/quota', { method: 'POST', body: JSON.stringify({ kind }) }));
  return response.ok;
}
export async function actorKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function consume(env, actor, action) {
  if (!policies[action]) throw new Error('Unknown rate policy');
  if (!env.ABUSE) return env.NODE_ENV !== 'production';
  if (!/^[a-f0-9]{64}$/.test(actor || '')) return false;
  // 64 fixed shards: attackers cannot allocate a new DO for every forged room code.
  const shard = parseInt(actor.slice(0, 2), 16) % 64;
  const response = await env.ABUSE.get(env.ABUSE.idFromName(`abuse-${shard}`)).fetch(new Request('https://internal/consume', { method: 'POST', body: JSON.stringify({ actor, action }) }));
  return response.ok;
}
export class AbuseGuard {
  constructor(ctx, env = {}) {
    this.ctx = ctx; this.sql = ctx.storage.sql; this.env = env;
    this.sql.exec('CREATE TABLE IF NOT EXISTS budgets (actor TEXT NOT NULL, action TEXT NOT NULL, count INTEGER NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(actor,action))');
    this.sql.exec('CREATE INDEX IF NOT EXISTS budgets_expiry ON budgets(expires)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS daily_usage (day INTEGER NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,kind))');
  }
  async fetch(request) {
    if (new URL(request.url).pathname === '/quota') {
      const { kind } = await boundedJson(request);
      if (!dailyBudgets[kind]) return json({ error: 'Invalid budget' }, 400);
      const [setting, fallback] = dailyBudgets[kind], configured = Number(this.env[setting]);
      const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : fallback;
      const day = Math.floor(Date.now() / 86400000), previous = this.sql.exec('SELECT count FROM daily_usage WHERE day=? AND kind=?', day, kind).toArray()[0]?.count || 0;
      if (previous >= limit) return json({ error: 'DAILY_BUDGET_REACHED' }, 429);
      this.sql.exec('INSERT INTO daily_usage VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET count=count+1', day, kind);
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm((day + 1) * 86400000);
      if (previous + 1 === Math.ceil(limit * 0.8)) console.warn(JSON.stringify({ code: 'APPLICATION_BUDGET_80_PERCENT', kind }));
      return json({ ok: true });
    }
    const { actor, action } = await boundedJson(request);
    if (!/^[a-f0-9]{64}$/.test(actor || '') || !policies[action]) return json({ error: 'Invalid rate request' }, 400);
    const now = Date.now(), [limit, window] = policies[action];
    const row = this.sql.exec('SELECT count,expires FROM budgets WHERE actor=? AND action=?', actor, action).toArray()[0];
    if (row?.expires > now && row.count >= limit) return json({ error: 'RATE_LIMITED' }, 429);
    if (!row && this.sql.exec('SELECT COUNT(*) AS count FROM budgets').toArray()[0].count >= 10000) return json({ error: 'RATE_LIMITED' }, 429);
    this.sql.exec('INSERT INTO budgets VALUES(?,?,?,?) ON CONFLICT(actor,action) DO UPDATE SET count=excluded.count,expires=excluded.expires', actor, action, row?.expires > now ? row.count + 1 : 1, row?.expires > now ? row.expires : now + window);
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(now + 600000);
    return json({ ok: true });
  }
  async alarm() {
    this.sql.exec('DELETE FROM budgets WHERE expires<=?', Date.now());
    const day = Math.floor(Date.now() / 86400000);
    this.sql.exec('DELETE FROM daily_usage WHERE day<?', day);
    const next = this.sql.exec('SELECT MIN(expires) AS expires FROM budgets').toArray()[0]?.expires;
    const quota = this.sql.exec('SELECT day FROM daily_usage LIMIT 1').toArray().length ? (day + 1) * 86400000 : Infinity;
    const at = Math.min(next || Infinity, quota);
    if (Number.isFinite(at)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, at));
  }
}
