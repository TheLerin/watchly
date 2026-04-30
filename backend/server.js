const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const FRONTEND_URL = process.env.CORS_ORIGIN || 'http://localhost:5173';

const app = express();
app.use(cors({ origin: FRONTEND_URL }));

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6  // S6: explicit 1 MB limit (Socket.IO default)
});

// ── Local BitTorrent Tracker ────────────────────────────────────────────────
// Removed: We now use public WebTorrent trackers to support Vercel/Render serverless.

// In-memory store
// rooms[roomId] = { users: [], videoState: {...}, queue: [], kickedUserIds: Set }
const rooms = {};

// P2: Periodically evict stale rooms where all users disconnected uncleanly.
// Without this, crashed browser sessions leave ghost rooms forever.
setInterval(() => {
    for (const [roomId, room] of Object.entries(rooms)) {
        const hasConnected = room.users.some(u => u.connected);
        if (!hasConnected) {
            console.log(`GC: cleaning stale room ${roomId}`);
            delete rooms[roomId];
        }
    }
}, 5 * 60 * 1000).unref();

app.get('/', (req, res) => {
    res.send('Watchly API is running');
});

// ── Google Drive Proxy ──────────────────────────────────────────────────────

const gdriveCache    = new Map(); // id → { url, cookieJar, timestamp }
const gdriveInFlight = new Map(); // id → Promise<{url,cookieJar}|null>  — FIX #2: dedup concurrent requests

// FIX #6: 20-min TTL — Google session tokens expire in ~15–30 min; 1-hour TTL caused mass expiry races
const CACHE_TTL_MS = 20 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of gdriveCache) {
        if (now - val.timestamp >= CACHE_TTL_MS) gdriveCache.delete(key);
    }
}, 10 * 60 * 1000).unref();

// FIX #10: Proxy CORS can safely be wildcard — no user auth cookies traverse this route
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
        // FIX #11: Inactivity timer — reset on each data chunk; abort if idle for STREAM_IDLE_MS
        let idleTimer = null;
        const resetIdle = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                console.log(`GDrive: stream idle ${STREAM_IDLE_MS}ms — aborting`);
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

    // FIX #7: Cap at 64 KB — enough to find any confirm token / form field in the HTML
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
            console.log(`GDrive: resolved stream (${hop.status}) → ${url.slice(0, 80)}`);
            streamResponse(hop); return true;
        }
        try { hop.data.destroy(); } catch (_) {}
        return false;
    };

    // ── 1. Cache hit ─────────────────────────────────────────────────────────
    const cached = gdriveCache.get(id);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        try {
            const ok = await tryStreamResolved(cached.url, cached.cookieJar);
            if (ok) return;
            console.log('GDrive: CACHE STALE — clearing');
            gdriveCache.delete(id);
        } catch { gdriveCache.delete(id); }
    }

    // ── 2. FIX #2: Wait for any in-flight resolution for the same ID ─────────
    if (gdriveInFlight.has(id)) {
        console.log(`GDrive: waiting for in-flight resolution of ${id}`);
        try {
            const entry = await gdriveInFlight.get(id);
            if (entry) { const ok = await tryStreamResolved(entry.url, entry.cookieJar); if (ok) return; }
        } catch (_) {}
        // in-flight failed — fall through to our own attempt
    }

    // ── 3. Fresh resolution ───────────────────────────────────────────────────
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
                console.log(`GDrive hop (${status}) → ${url.slice(0, 100)}`);
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
                console.log(`GDrive: ${status} from ${url.slice(0, 80)} — trying next strategy`);
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
                if (lm) { url = lm[1].replace(/&amp;/g, '&'); rangeAttached = true; console.log(`GDrive: usercontent link in HTML → ${url.slice(0, 100)}`); continue; }

                const fm = html.match(/action="(https?:\/\/[^"]*download[^"]*confirm=[^"]*)"/i)
                         || html.match(/action="([^"]*\/download[^"]*confirm=[^"]*)"/i);
                if (fm) {
                    url = fm[1].replace(/&amp;/g, '&');
                    if (!url.startsWith('http')) url = 'https://drive.google.com' + url;
                    rangeAttached = true;
                    console.log(`GDrive: form action fallback → ${url.slice(0, 100)}`);
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
        console.log(`GDrive: startUrl threw: ${err.message} — trying next...`);
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



// ISSUE-34: Global Express error handler — catches any unhandled route errors
// and returns a clean JSON response instead of leaking stack traces.
// Must be registered before server.listen so it's in the middleware chain.
app.use((err, req, res, next) => {
    console.error('Unhandled route error:', err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// S3: Shared rate-limit map keyed by userId so multi-tab users share one bucket
const messageRateLimitMap = new Map(); // userId -> lastMessageTime

// FIX #8: Periodically purge stale rate-limit entries so the Map doesn't
// grow unbounded when users crash without clean disconnects.
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of messageRateLimitMap) {
        if (now - time > 60000) messageRateLimitMap.delete(key);
    }
}, 60 * 1000).unref();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_room', ({ roomId, nickname, userId }) => {
        // FIX #18: Validate roomId format to prevent memory pollution
        if (!roomId || typeof roomId !== 'string' || roomId.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(roomId)) {
            socket.emit('error_message', { message: 'Invalid room code format.' });
            return;
        }
        // Sanitize nickname: strip HTML tags, limit length, provide fallback
        nickname = (typeof nickname === 'string' ? nickname : '').replace(/<[^>]*>/g, '').trim().slice(0, 24) || 'Anonymous';
        // Validate userId
        if (!userId || typeof userId !== 'string') userId = Math.random().toString(36).substring(2, 15);

        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                videoState: {
                    url: '',
                    magnetURI: '',
                    isPlaying: false,
                    playedSeconds: 0,
                    updatedAt: Date.now(),
                    seekVersion: 0
                },
                queue: [],
                kickedUserIds: new Set(),
                chatHistory: []
            };
        }

        // BUG-02: Reject reconnection from banned users
        if (rooms[roomId].kickedUserIds.has(userId)) {
            socket.emit('user_kicked');
            return;
        }

        const existingUser = rooms[roomId].users.find(u => u.userId === userId);
        let user;

        if (existingUser) {
            // Reconnect: Update socket ID but keep role
            existingUser.id = socket.id;
            existingUser.nickname = nickname; // In case they changed it
            existingUser.connected = true;
            user = existingUser;
            console.log(`${nickname} (${socket.id}) rejoined room ${roomId} as ${user.role}`);
        } else {
            // Limit max users per room to prevent abuse
            const connectedCount = rooms[roomId].users.filter(u => u.connected).length;
            if (connectedCount >= 50) {
                socket.emit('error_message', { message: 'Room is full (max 50 users).' });
                return;
            }
            // New connection
            const role = rooms[roomId].users.length === 0 ? 'Host' : 'Viewer';
            user = { id: socket.id, userId, nickname, role, connected: true };
            rooms[roomId].users.push(user);
            console.log(`${nickname} (${socket.id}) joined room ${roomId} as ${role}`);
        }

        socket.roomId = roomId;
        socket.userId = userId;

        socket.emit('room_joined', {
            user,
            existingUsers: rooms[roomId].users.filter(u => u.connected),
            videoState: rooms[roomId].videoState,
            queue: rooms[roomId].queue,
            chatHistory: rooms[roomId].chatHistory || []
        });

        socket.to(roomId).emit('user_joined', user);
    });

    // ISSUE-33 / S3: Chat rate limit — minimum 500ms between messages per userId.
    // Using a shared map (keyed by userId) so a user with multiple tabs can't
    // bypass the limit by opening extra connections.
    socket.on('send_message', ({ roomId, message }) => {
        const now = Date.now();
        const key = socket.userId || socket.id;
        if (now - (messageRateLimitMap.get(key) || 0) < 500) return; // silently drop spam
        messageRateLimitMap.set(key, now);

        // Validate message payload
        if (!message || typeof message.text !== 'string') return;
        // Server-side length enforcement (client also limits to 500)
        message.text = message.text.slice(0, 500);
        if (!message.text.trim()) return; // reject empty messages
        
        // Store in room's chat history so it survives page refreshes
        if (rooms[roomId]) {
            if (!rooms[roomId].chatHistory) rooms[roomId].chatHistory = [];
            rooms[roomId].chatHistory.push(message);
            if (rooms[roomId].chatHistory.length > 100) {
                rooms[roomId].chatHistory.shift();
            }
        }
        
        // Broadcast to everyone in room EXCEPT the sender
        // (sender already added the message locally via setMessages)
        socket.to(roomId).emit('receive_message', message);
    });

    // --- ROLE MANAGEMENT ---

    const getUserInRoom = (sId, rId) => {
        if (!rooms[rId] || !rooms[rId].users) return null;
        return rooms[rId].users.find(u => u.id === sId);
    };

    socket.on('promote_to_moderator', ({ roomId, targetId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        const target = getUserInRoom(targetId, roomId);
        if (sender && target && sender.role === 'Host' && target.role === 'Viewer') {
            target.role = 'Moderator';
            io.to(roomId).emit('role_updated', { userId: targetId, newRole: 'Moderator' });
        }
    });

    socket.on('demote_to_viewer', ({ roomId, targetId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        const target = getUserInRoom(targetId, roomId);
        if (sender && target && sender.role === 'Host' && target.role === 'Moderator') {
            target.role = 'Viewer';
            io.to(roomId).emit('role_updated', { userId: targetId, newRole: 'Viewer' });
        }
    });

    socket.on('transfer_host', ({ roomId, targetId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        const target = getUserInRoom(targetId, roomId);
        if (sender && target && sender.role === 'Host') {
            sender.role = 'Moderator';
            target.role = 'Host';
            io.to(roomId).emit('role_updated', { userId: socket.id, newRole: 'Moderator' });
            io.to(roomId).emit('role_updated', { userId: targetId, newRole: 'Host' });
        }
    });

    // FIX #12: kick_user now also looks up by userId so reconnected users
    // (who got a new socket ID) can still be kicked.
    socket.on('kick_user', ({ roomId, targetId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        // Try socket-ID lookup first, then fall back to userId lookup
        let target = getUserInRoom(targetId, roomId);
        if (!target && rooms[roomId]) {
            target = rooms[roomId].users.find(u => u.userId === targetId);
        }
        if (!sender || !target) return;
        const canKick = sender.role === 'Host' || (sender.role === 'Moderator' && target.role === 'Viewer');
        if (canKick) {
            // BUG-02: Record the userId in the ban list before removing from users array
            if (rooms[roomId]) rooms[roomId].kickedUserIds.add(target.userId);

            // B1 FIX: Fetch the actual Socket object and emit directly.
            const targetSocket = io.sockets.sockets.get(target.id);
            if (targetSocket) {
                targetSocket.emit('user_kicked');
                targetSocket.leave(roomId);
                targetSocket.roomId = null;
            }

            if (rooms[roomId] && rooms[roomId].users) {
                rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== target.id);
            }
            io.to(roomId).emit('user_left', target.id);

            if (rooms[roomId] && rooms[roomId].users.length === 0) {
                delete rooms[roomId];
            }
        }
    });

    // --- VIDEO SYNC MANAGEMENT ---

    // Play a video immediately (replaces current)
    socket.on('change_video', ({ roomId, url, magnetURI }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId]) {
                // S4: Reject non-HTTP URLs to prevent javascript:/data: injection.
                // Torrent magnet URIs are passed via the magnetURI field, not url.
                if (url && !/^https?:\/\//i.test(url)) {
                    console.warn(`change_video: rejected non-HTTP url from ${sender.nickname}`);
                    return;
                }
                const newState = { url: url || '', magnetURI: magnetURI || '', isPlaying: true, playedSeconds: 0, updatedAt: Date.now(), seekVersion: 0 };
                rooms[roomId].videoState = newState;
                io.to(roomId).emit('video_changed', newState);
                console.log(`Video changed in ${roomId} to URL:${url || 'P2P'}`);
            }
        }
    });

    // Host periodically syncs playback position
    socket.on('sync_progress', ({ roomId, playedSeconds }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId]) {
                rooms[roomId].videoState.playedSeconds = playedSeconds;
                rooms[roomId].videoState.updatedAt = Date.now();
                // Broadcast drift correction to viewers (they only act if drift > threshold).
                // SeekVersion is NOT incremented here, to prevent viewers from reloading chunks continuously.
                socket.to(roomId).emit('video_progress', { playedSeconds, seekVersion: rooms[roomId].videoState.seekVersion });
            }
        }
    });

    // Add to queue — pushes to the end of the queue
    socket.on('add_to_queue', ({ roomId, url, magnetURI, label }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            // FIX #14: Validate URL scheme — same check as change_video (S4)
            if (url && !/^https?:\/\//i.test(url)) {
                console.warn(`add_to_queue: rejected non-HTTP url from ${sender.nickname}`);
                return;
            }
            if (rooms[roomId]) {
                // FIX #11: Use randomized ID to prevent collisions when two users add in the same ms
                const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url: url || '', magnetURI: magnetURI || '', label: label || url || 'Unnamed' };
                rooms[roomId].queue.push(item);
                io.to(roomId).emit('queue_updated', rooms[roomId].queue);
                console.log(`${sender.nickname} added to queue in ${roomId}: ${item.label}`);
            }
        }
    });

    // Remove item from queue
    socket.on('remove_from_queue', ({ roomId, itemId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId]) {
                rooms[roomId].queue = rooms[roomId].queue.filter(i => i.id !== itemId);
                io.to(roomId).emit('queue_updated', rooms[roomId].queue);
            }
        }
    });

    // Play next in queue
    socket.on('play_next', ({ roomId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId] && rooms[roomId].queue.length > 0) {
                const next = rooms[roomId].queue.shift();
                const newState = { url: next.url, magnetURI: next.magnetURI, isPlaying: true, playedSeconds: 0, updatedAt: Date.now(), seekVersion: 0 };
                rooms[roomId].videoState = newState;
                io.to(roomId).emit('video_changed', newState);
                io.to(roomId).emit('queue_updated', rooms[roomId].queue);
                console.log(`Playing next in queue for room ${roomId}: ${next.label}`);
            }
        }
    });

    socket.on('play_video', ({ roomId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId] && !rooms[roomId].videoState.isPlaying) {
                rooms[roomId].videoState.isPlaying = true;
                rooms[roomId].videoState.updatedAt = Date.now();
                socket.to(roomId).emit('video_played');
            }
        }
    });

    socket.on('pause_video', ({ roomId, playedSeconds }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId]) {
                rooms[roomId].videoState.isPlaying = false;
                rooms[roomId].videoState.updatedAt = Date.now();
                if (playedSeconds !== undefined) {
                    rooms[roomId].videoState.playedSeconds = playedSeconds;
                }
                socket.to(roomId).emit('video_paused', { playedSeconds: rooms[roomId].videoState.playedSeconds });
            }
        }
    });

    socket.on('seek_video', ({ roomId, playedSeconds }) => {
        const sender = getUserInRoom(socket.id, roomId);
        if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
            if (rooms[roomId]) {
                rooms[roomId].videoState.playedSeconds = playedSeconds;
                rooms[roomId].videoState.updatedAt = Date.now();
                // FIX: Increment seekVersion so all clients know this is a deliberate seek, not drift
                rooms[roomId].videoState.seekVersion = (rooms[roomId].videoState.seekVersion || 0) + 1;
                // FIX #5: Broadcast seekVersion so viewers accept it directly
                // instead of blindly incrementing their own copy.
                socket.to(roomId).emit('video_seeked', {
                    playedSeconds,
                    seekVersion: rooms[roomId].videoState.seekVersion
                });
            }
        }
    });

    // --- VOICE / WEBRTC ---
    socket.on('toggle_voice', ({ roomId, isVoiceActive, isMuted }) => {
        const user = getUserInRoom(socket.id, roomId);
        if (user) {
            user.isVoiceActive = isVoiceActive;
            user.isMuted = isMuted;
            io.to(roomId).emit('voice_updated', { userId: user.id, isVoiceActive, isMuted });
        }
    });

    socket.on('webrtc_offer', ({ targetSocketId, offer }) => {
        socket.to(targetSocketId).emit('webrtc_offer', {
            senderSocketId: socket.id,
            offer
        });
    });

    socket.on('webrtc_answer', ({ targetSocketId, answer }) => {
        socket.to(targetSocketId).emit('webrtc_answer', {
            senderSocketId: socket.id,
            answer
        });
    });

    socket.on('webrtc_ice_candidate', ({ targetSocketId, candidate }) => {
        socket.to(targetSocketId).emit('webrtc_ice_candidate', {
            senderSocketId: socket.id,
            candidate
        });
    });

    // --- DISCONNECT HANDLING ---

    const handleDisconnect = () => {
        const roomId = socket.roomId;
        const userId = socket.userId;
        if (roomId && rooms[roomId] && rooms[roomId].users) {
            const user = rooms[roomId].users.find(u => u.userId === userId);
            // Guard: skip if already processed (leave_room + disconnect both call this)
            if (user && user.connected) {
                user.connected = false;
                socket.to(roomId).emit('user_left', socket.id);
                console.log(`User ${user.nickname || socket.id} disconnected from room ${roomId}`);

                const remainingConnected = rooms[roomId].users.filter(u => u.connected);
                if (remainingConnected.length === 0) {
                    delete rooms[roomId];
                } else if (user.role === 'Host') {
                    // ISSUE-36: Auto-promote next user when Host leaves so room stays functional
                    const nextHost =
                        remainingConnected.find(u => u.role === 'Moderator') ||
                        remainingConnected[0];
                    nextHost.role = 'Host';
                    io.to(roomId).emit('role_updated', { userId: nextHost.id, newRole: 'Host' });
                    console.log(`Auto-promoted ${nextHost.nickname} to Host in room ${roomId}`);
                }
            }
        }
    };

    socket.on('leave_room', handleDisconnect);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handleDisconnect();
        // S3: Clean up the rate-limit entry for this user on disconnect
        if (socket.userId) messageRateLimitMap.delete(socket.userId);
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

