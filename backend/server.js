const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { PROTOCOL_VERSION } = require('./validators');

const splitEnvList = (value) => (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
const FRONTEND_ORIGINS = splitEnvList(process.env.CORS_ORIGIN || 'http://localhost:5173');
const CORS_ORIGIN = FRONTEND_ORIGINS.includes('*') ? '*' : FRONTEND_ORIGINS;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6  // S6: explicit 1 MB limit (Socket.IO default)
});

// â”€â”€ Local BitTorrent Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Removed: We now use public WebTorrent trackers to support Vercel/Render serverless.

// In-memory store
// rooms[roomId] = { users: [], videoState: {...}, queue: [], kickedUserIds: Set }
// User supplied room codes must never become object prototype keys.
const rooms = new Map();

const PUBLIC_STUN_URLS = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302'
];

const turnIsReady = () => Boolean(splitEnvList(process.env.TURN_URLS).length && process.env.TURN_SHARED_SECRET);

const buildIceConfig = (memberId = null) => {
    const turnUrls = splitEnvList(process.env.TURN_URLS);
    const iceServers = [{ urls: PUBLIC_STUN_URLS }];
    let username = '';
    let credential = '';
    let expiresAt = null;

    // coturn's REST API credential mechanism. The shared secret never leaves
    // the backend; authenticated room members receive unique short-lived credentials.
    if (memberId && turnUrls.length && process.env.TURN_SHARED_SECRET) {
        const ttlSeconds = Math.min(86400, Math.max(300, Number(process.env.TURN_TTL_SECONDS) || 3600));
        const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
        const prefix = (process.env.TURN_USERNAME_PREFIX || 'watchly').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
        const subject = String(memberId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
        username = `${expiry}:${prefix || 'watchly'}-${subject}`;
        credential = crypto
            .createHmac('sha1', process.env.TURN_SHARED_SECRET)
            .update(username)
            .digest('base64');
        expiresAt = expiry * 1000;
    }

    if (turnUrls.length && username && credential) {
        iceServers.push({ urls: turnUrls, username, credential });
    }

    return {
        iceServers,
        turnConfigured: iceServers.length > 1,
        turnAvailable: turnIsReady(),
        expiresAt
    };
};

// P2: Periodically evict stale rooms where all users disconnected uncleanly.
// Without this, crashed browser sessions leave ghost rooms forever.
setInterval(() => {
    for (const [roomId, room] of rooms) {
        const hasConnected = room.users.some(u => u.connected);
        if (!hasConnected) {
            console.log(`GC: cleaning stale room ${roomId}`);
            rooms.delete(roomId);
        }
    }
}, 5 * 60 * 1000).unref();

app.get('/', (req, res) => {
    res.send('Watchly API is running');
});

app.get('/api/ice-config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Public callers receive STUN only. TURN credentials are issued through the
    // authenticated Socket.IO room membership event below.
    res.json(buildIceConfig());
});

app.get('/api/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
        activeRooms: rooms.size,
        turnReady: turnIsReady()
    });
});

// â”€â”€ Google Drive Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const gdriveCache    = new Map(); // id â†’ { url, cookieJar, timestamp }
const gdriveInFlight = new Map(); // id â†’ Promise<{url,cookieJar}|null>  â€” FIX #2: dedup concurrent requests

// FIX #6: 20-min TTL â€” Google session tokens expire in ~15â€“30 min; 1-hour TTL caused mass expiry races
const CACHE_TTL_MS = 20 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of gdriveCache) {
        if (now - val.timestamp >= CACHE_TTL_MS) gdriveCache.delete(key);
    }
}, 10 * 60 * 1000).unref();

// FIX #10: Proxy CORS can safely be wildcard â€” no user auth cookies traverse this route
app.options('/api/proxy/gdrive', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.sendStatus(204);
});

app.all('/api/proxy/gdrive', async (req, res) => {
    const { id } = req.query;
    if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
    if (!id) return res.status(400).send('Missing Google Drive file id');

    const HOP_TIMEOUT_MS  = 15000;
    const STREAM_IDLE_MS  = 30000; // FIX #11: kill piped stream if Google stalls mid-transfer
    const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
    const REFERER = 'https://drive.google.com/';
    const isHead  = req.method === 'HEAD';

    const setCorsHeaders = () => {
        res.setHeader('Access-Control-Allow-Origin', '*'); // FIX #10
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    };

    const streamResponse = (hop) => {
        const ct = hop.headers['content-type'] || 'video/mp4';
        setCorsHeaders();
        res.setHeader('Content-Type', ct);
        if (hop.headers['content-length']) res.setHeader('Content-Length', hop.headers['content-length']);
        res.setHeader('Accept-Ranges', hop.headers['accept-ranges'] || 'bytes');
        if (hop.headers['content-range']) res.setHeader('Content-Range', hop.headers['content-range']);
        res.status(hop.status === 206 ? 206 : 200);
        if (isHead) {
            try { hop.data.destroy(); } catch (_) {}
            return res.end();
        }
        // FIX #11: Inactivity timer â€” reset on each data chunk; abort if idle for STREAM_IDLE_MS
        let idleTimer = null;
        const resetIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                console.log(`GDrive: stream idle ${STREAM_IDLE_MS}ms â€” aborting`);
                try { hop.data.destroy(); } catch (_) {}
                if (!res.writableEnded) res.end();
            }, STREAM_IDLE_MS);
        };
        resetIdle();
        hop.data.on('data', resetIdle);
        hop.data.on('end',  () => clearTimeout(idleTimer));
        hop.data.on('error',() => clearTimeout(idleTimer));
        hop.data.pipe(res);
        req.on('close', () => { clearTimeout(idleTimer); try { hop.data.destroy(); } catch (_) {} });
    };

    // FIX #7: Cap at 64 KB â€” enough to find any confirm token / form field in the HTML
    const readBodyText = async (stream) => {
        const chunks = []; let total = 0; const MAX = 64 * 1024;
        for await (const c of stream) {
            chunks.push(Buffer.from(c));
            total += c.length;
            if (total >= MAX) { try { stream.destroy(); } catch (_) {} break; }
        }
        return Buffer.concat(chunks).toString('utf-8');
    };

    // Helper: stream from an already-resolved URL (used by cache hits and in-flight waiters)
    const tryStreamResolved = async (url, cookieJar) => {
        const headers = { 'User-Agent': UA, 'Referer': REFERER, 'Accept': 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8' };
        if (cookieJar)           headers['Cookie'] = cookieJar;
        if (req.headers.range)   headers['Range']  = req.headers.range;
        const hop = await axios({ method: req.method, url, responseType: 'stream', headers, maxRedirects: 0, validateStatus: s => s < 600, timeout: HOP_TIMEOUT_MS });
        if (hop.status < 400 && !(hop.headers['content-type'] || '').includes('text/html')) {
            console.log(`GDrive: resolved stream (${hop.status}) â†’ ${url.slice(0, 80)}`);
            streamResponse(hop); return true;
        }
        try { hop.data.destroy(); } catch (_) {}
        return false;
    };

    // â”€â”€ 1. Cache hit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const cached = gdriveCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        try {
            const ok = await tryStreamResolved(cached.url, cached.cookieJar);
            if (ok) return;
            console.log('GDrive: CACHE STALE â€” clearing');
            gdriveCache.delete(id);
        } catch { gdriveCache.delete(id); }
    }

    // â”€â”€ 2. FIX #2: Wait for any in-flight resolution for the same ID â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (gdriveInFlight.has(id)) {
        console.log(`GDrive: waiting for in-flight resolution of ${id}`);
        try {
            const entry = await gdriveInFlight.get(id);
            if (entry) { const ok = await tryStreamResolved(entry.url, entry.cookieJar); if (ok) return; }
        } catch (_) {}
        // in-flight failed â€” fall through to our own attempt
    }

    // â”€â”€ 3. Fresh resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // FIX #4: Removed duplicate strategy (both /uc entries hit the same endpoint with the same result)
    const startUrls = [
        `https://drive.google.com/uc?export=download&id=${id}&confirm=t`,
        `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`,
    ];

    // Register in-flight promise so concurrent requests for this ID wait instead of hammering Google
    let resolveInFlight, rejectInFlight;
    const inFlightPromise = new Promise((res, rej) => { resolveInFlight = res; rejectInFlight = rej; });
    gdriveInFlight.set(id, inFlightPromise);

    for (const startUrl of startUrls) {
    try {
        let url       = startUrl;
        let cookieJar = '';
        let hops      = 10;
        // FIX #1: Track whether we've followed at least one redirect.
        // Range header must NOT be sent to the /uc entry-point (causes 416).
        // Once we've been redirected to the real file URL it is safe.
        let rangeAttached = false;

        while (hops-- > 0) {
            const headers = {
                'User-Agent': UA,
                'Referer':    REFERER,
                'Accept':     'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
            };
            if (cookieJar)                              headers['Cookie'] = cookieJar;
            // FIX #1: Re-apply Range at the top of EVERY hop after first redirect (headers recreated each iteration)
            if (rangeAttached && req.headers.range)     headers['Range']  = req.headers.range;

            let hop;
            try {
                hop = await axios({ method: isHead ? 'HEAD' : 'GET', url, responseType: 'stream', headers, maxRedirects: 0, validateStatus: s => s < 600, timeout: HOP_TIMEOUT_MS });
            } catch (e) {
                if (e.response && e.response.headers.location) { hop = e.response; } else { throw e; }
            }

            const sc = hop.headers['set-cookie'];
            if (sc) {
                const fresh = sc.map(c => c.split(';')[0]).join('; ');
                cookieJar   = cookieJar ? `${cookieJar}; ${fresh}` : fresh;
            }

            const status = hop.status;
            const ct     = hop.headers['content-type'] || '';
            const loc    = hop.headers['location']     || '';

            if (status >= 300 && status < 400 && loc) {
                try { hop.data.destroy(); } catch (_) {}
                url = loc.startsWith('http') ? loc : `https://drive.google.com${loc}`;
                rangeAttached = true; // FIX #1: past the entry-point, safe to send Range now
                console.log(`GDrive hop (${status}) â†’ ${url.slice(0, 100)}`);
                continue;
            }

            if (!ct.includes('text/html') && status < 400) {
                console.log(`GDrive: streaming (${ct}, status=${status})`);
                const entry = { url, cookieJar, timestamp: Date.now() };
                gdriveCache.set(id, entry);
                gdriveInFlight.delete(id);
                resolveInFlight({ url, cookieJar });
                return streamResponse(hop);
            }

            if (status === 403 || status === 404) {
                try { hop.data.destroy(); } catch (_) {}
                console.log(`GDrive: ${status} from ${url.slice(0, 80)} â€” trying next strategy`);
                break;
            }

            if (ct.includes('text/html')) {
                const html = await readBodyText(hop.data); // FIX #7: capped at 64 KB

                const cm = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/)
                         || html.match(/name=["']confirm["'][^>]*value=["']([^"']+)["']/i);
                const um = html.match(/name=["']uuid["'][^>]*value=["']([^"']+)["']/i)
                         || html.match(/[?&]uuid=([0-9A-Za-z_-]+)/);
                if (cm) {
                    const confirm = cm[1]; const uuid = um ? um[1] : null;
                    url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirm}`;
                    if (uuid) url += `&uuid=${uuid}`;
                    rangeAttached = true;
                    console.log(`GDrive: confirm retry (confirm=${confirm}, uuid=${uuid || 'none'})`);
                    continue;
                }

                const lm = html.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download[^"]+)"/i);
                if (lm) { url = lm[1].replace(/&amp;/g, '&'); rangeAttached = true; console.log(`GDrive: usercontent link in HTML â†’ ${url.slice(0, 100)}`); continue; }

                const fm = html.match(/action="(https?:\/\/[^"]*download[^"]*confirm=[^"]*)"/i)
                         || html.match(/action="([^"]*\/download[^"]*confirm=[^"]*)"/i);
                if (fm) {
                    url = fm[1].replace(/&amp;/g, '&');
                    if (!url.startsWith('http')) url = 'https://drive.google.com' + url;
                    rangeAttached = true;
                    console.log(`GDrive: form action fallback â†’ ${url.slice(0, 100)}`);
                    continue;
                }

                console.log(`GDrive: no usable link in HTML (${html.length} bytes), breaking`);
                break;
            }

            console.error(`GDrive: unexpected status=${status} ct="${ct}"`);
            break;
        }

        if (res.headersSent) { gdriveInFlight.delete(id); rejectInFlight(new Error('failed')); return; }
        console.log(`GDrive: startUrl exhausted (${startUrl.slice(0, 60)}), trying next...`);
    } catch (err) {
        if (res.headersSent) { gdriveInFlight.delete(id); rejectInFlight(new Error('failed')); break; }
        console.log(`GDrive: startUrl threw: ${err.message} â€” trying next...`);
    }
    }

    gdriveInFlight.delete(id);
    rejectInFlight(new Error('all strategies failed'));
    if (!res.headersSent) {
        setCorsHeaders();
        res.status(502).json({
            error: 'Could not stream this Google Drive file.',
            hint: 'Make sure the file is shared as "Anyone with the link" (Viewer). Large files may require re-sharing.',
        });
    }
});



// ISSUE-34: Global Express error handler â€” catches any unhandled route errors
// and returns a clean JSON response instead of leaking stack traces.
// Must be registered before server.listen so it's in the middleware chain.
app.use((err, req, res, next) => {
    console.error('Unhandled route error:', err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

require('./realtime')({ io, rooms, buildIceConfig });

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
