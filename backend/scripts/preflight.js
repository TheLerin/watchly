const fail = message => {
    console.error(`Preflight failed: ${message}`);
    process.exitCode = 1;
};

const split = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);
const origins = split(process.env.CORS_ORIGIN);
const turnUrls = split(process.env.TURN_URLS);
const { livekitConfig } = require('../livekitVoice');

if (process.env.NODE_ENV !== 'production') {
    fail('NODE_ENV must be production.');
}

if (!origins.length) {
    fail('CORS_ORIGIN must contain the deployed frontend origin.');
} else {
    for (const origin of origins) {
        try {
            const parsed = new URL(origin);
            if (parsed.origin !== origin || parsed.protocol !== 'https:') {
                fail(`CORS_ORIGIN entry must be an HTTPS origin without a path: ${origin}`);
            }
        } catch {
            fail(`CORS_ORIGIN contains an invalid URL: ${origin}`);
        }
    }
}

if (origins.includes('*')) fail('CORS_ORIGIN cannot be * in production.');

if (!livekitConfig()) fail('LIVEKIT_URL (wss://), LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required for LiveKit voice.');
// coturn remains optional for the retained legacy voice and Screen Share Beta;
// LiveKit Cloud supplies voice transport/relay independently of these settings.
if (turnUrls.length && !process.env.TURN_SHARED_SECRET) fail('TURN_SHARED_SECRET is required when TURN_URLS is configured.');
if (process.env.TURN_SHARED_SECRET && !turnUrls.length) fail('TURN_URLS is required when TURN_SHARED_SECRET is configured.');
for (const url of turnUrls) {
    if (!/^turns?:[^\s,]+$/i.test(url)) fail(`Invalid TURN URL: ${url}`);
}

const ttl = Number(process.env.TURN_TTL_SECONDS || 3600);
if (!Number.isInteger(ttl) || ttl < 300 || ttl > 86400) {
    fail('TURN_TTL_SECONDS must be an integer from 300 through 86400.');
}

if (!process.exitCode) console.log('Production configuration preflight passed.');
