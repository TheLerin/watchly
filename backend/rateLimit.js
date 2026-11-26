const { isIP } = require('node:net');
class WindowLimiter {
    constructor(maxKeys = 10000) { this.entries = new Map(); this.maxKeys = maxKeys; this.sweepAt = 0; }
    consume(key, limit, windowMs, now = Date.now()) {
        if (now >= this.sweepAt) { for (const [id, entry] of this.entries) if (entry.until <= now) this.entries.delete(id); this.sweepAt = now + 60000; }
        const old = this.entries.get(key);
        if (!old && this.entries.size >= this.maxKeys) return false;
        const entry = old?.until > now ? old : { until: now + windowMs, count: 0 };
        this.entries.set(key, entry); return ++entry.count <= limit;
    }
}
function clientAddress(request, trustedHops = 0) {
    const remote = request.socket?.remoteAddress || 'unknown';
    if (!trustedHops) return remote;
    const chain = String(request.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
    const candidate = chain.at(-trustedHops);
    return candidate && isIP(candidate) ? candidate : remote;
}
module.exports = { WindowLimiter, clientAddress };
