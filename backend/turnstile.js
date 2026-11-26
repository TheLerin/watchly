const { WindowLimiter } = require('./rateLimit');
const crypto = require('node:crypto');
const process = require('node:process');

const failure = (code, message, env) => ({ ok: false, error: { code, message, retryable: true,
    ...(env.TURNSTILE_SITE_KEY ? { challenge: { siteKey: env.TURNSTILE_SITE_KEY, action: 'room_create' } } : {}) } });
const required = env => failure('TURNSTILE_REQUIRED', 'Complete the security verification to create another room.', env);
const unavailable = env => failure('TURNSTILE_UNAVAILABLE', 'Room verification is temporarily unavailable. Please retry later.', env);
const threshold = env => {
    const value = Number(env.ANON_CREATE_CHALLENGE_AFTER ?? 2);
    return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 2;
};
const enabled = env => env.NODE_ENV === 'production' || env.TURNSTILE_ENFORCE_ANONYMOUS === 'true';

async function verifyCreationChallenge({ token, hostname, env, fetcher = fetch, now = Date.now }) {
    if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY || !hostname) return unavailable(env);
    if (typeof token !== 'string' || !token.length || token.length > 2048 || /\s/.test(token)) return required(env);
    try {
        const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
            body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
        });
        if (!response.ok) return unavailable(env);
        const result = await response.json(), time = Date.parse(result.challenge_ts);
        if (result.success !== true || result.action !== 'room_create' || result.hostname !== hostname || !Number.isFinite(time) || now() - time > 300000 || time > now() + 10000) {
            return failure('TURNSTILE_FAILED', 'Security verification expired or failed. Complete a fresh verification.', env);
        }
        return { ok: true };
    } catch { return unavailable(env); }
}

function createLegacyCreationGate({ env = process.env, fetcher = fetch, address, hostname, suspicious = () => false } = {}) {
    const attempts = new WindowLimiter(), risks = new WindowLimiter(), redemptions = new WindowLimiter();
    const challengeAfter = env.NODE_ENV === 'production' ? 0 : threshold(env);
    return async (socket, payload) => {
        if (!enabled(env)) return { ok: true };
        const actor = address(socket), account = socket.data.account;
        if (!attempts.consume(actor, 6, 600000)) return failure('RATE_LIMITED', 'Too many room creation attempts. Retry later.', {});
        if (account?.profile && account.expiresAt > Date.now()) return { ok: true };
        const challenge = challengeAfter === 0 || !risks.consume(actor, challengeAfter, 600000) || suspicious(socket);
        if (!challenge) return { ok: true };
        const verified = await verifyCreationChallenge({ token: payload.turnstileToken, hostname: hostname(socket), env, fetcher });
        if (!verified.ok) return verified;
        if (socket.data.account !== account) return failure('AUTH_REPLACED', 'Your account changed. Retry room creation.', {});
        const digest = crypto.createHash('sha256').update(payload.turnstileToken).digest('hex');
        if (!redemptions.consume(digest, 1, 600000)) return failure('TURNSTILE_FAILED', 'Verification was already used. Complete a fresh verification.', env);
        return { ok: true };
    };
}
module.exports = { verifyCreationChallenge, createLegacyCreationGate, enabled, threshold, failure, required, unavailable };
