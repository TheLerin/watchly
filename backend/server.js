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
    }
});

// ── Local BitTorrent Tracker ────────────────────────────────────────────────
// Removed: We now use public WebTorrent trackers to support Vercel/Render serverless.

// In-memory store
// rooms[roomId] = { users: [], videoState: {...}, queue: [], kickedUserIds: Set }
const rooms = {};

app.get('/', (req, res) => {
    res.send('WatchSync API is running');
});

// ── Google Drive Proxy ──────────────────────────────────────────────────────
// Manually follows every redirect while accumulating cookies so Google's
// scan/confirmation flow works. Uses drive.google.com/uc as the entry point
// (with a Referer header) which issues a 303 redirect to the actual download.
// Usage: GET /api/proxy/gdrive?id=<GOOGLE_DRIVE_FILE_ID>
app.get('/api/proxy/gdrive', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send('Missing Google Drive file id');

    // Per-hop timeout in ms — prevents the server hanging indefinitely
    const HOP_TIMEOUT_MS = 15000;

    const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
    const REFERER = 'https://drive.google.com/';

    const setCorsHeaders = () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    };

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        setCorsHeaders();
        return res.sendStatus(204);
    }

    const streamResponse = (hop) => {
        const ct = hop.headers['content-type'] || 'video/mp4';
        setCorsHeaders();
        res.setHeader('Content-Type', ct);
        if (hop.headers['content-length']) res.setHeader('Content-Length', hop.headers['content-length']);
        // Always advertise range support so the browser can seek
        res.setHeader('Accept-Ranges', hop.headers['accept-ranges'] || 'bytes');
        if (hop.headers['content-range'])  res.setHeader('Content-Range',  hop.headers['content-range']);
        res.status(hop.status === 206 ? 206 : 200);
        hop.data.pipe(res);
        req.on('close', () => { try { hop.data.destroy(); } catch (_) {} });
    };

    const readBodyText = async (stream) => {
        const chunks = [];
        for await (const c of stream) chunks.push(Buffer.from(c));
        return Buffer.concat(chunks).toString('utf-8');
    };

    // ── Entry-point URL strategies (tried in order) ──────────────────────────
    // Strategy A: drive.google.com/uc — still issues a 303 redirect when given Referer
    // Strategy B: drive.usercontent.google.com/download — legacy fallback
    const startUrls = [
        `https://drive.google.com/uc?export=download&id=${id}&confirm=t`,
        `https://drive.google.com/uc?id=${id}&export=download&confirm=t&authuser=0`,
        `https://drive.usercontent.google.com/download?id=${id}&export=download&authuser=0&confirm=t`,
    ];

    for (const startUrl of startUrls) {
    try {
        let url       = startUrl;
        let cookieJar = '';
        let hops      = 10;

        while (hops-- > 0) {
            const headers = {
                'User-Agent': UA,
                'Referer':    REFERER,   // ← required: Google returns 303 only with Referer
                'Accept':     'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
            };
            if (cookieJar)         headers['Cookie'] = cookieJar;
            // Forward the client's Range header so seeking works
            if (req.headers.range) headers['Range']  = req.headers.range;

            let hop;
            try {
                hop = await axios({
                    method: 'GET', url, responseType: 'stream',
                    headers, maxRedirects: 0,
                    validateStatus: s => s < 600,
                    timeout: HOP_TIMEOUT_MS,
                });
            } catch (e) {
                // axios throws on 3xx when maxRedirects=0 — response is on the error object
                if (e.response && e.response.headers.location) {
                    hop = e.response;
                } else {
                    throw e;
                }
            }

            // Accumulate cookies across hops (critical — axios auto-mode drops them)
            const sc = hop.headers['set-cookie'];
            if (sc) {
                const fresh = sc.map(c => c.split(';')[0]).join('; ');
                cookieJar   = cookieJar ? `${cookieJar}; ${fresh}` : fresh;
            }

            const status = hop.status;
            const ct     = hop.headers['content-type'] || '';
            const loc    = hop.headers['location']     || '';

            // 3xx — follow the redirect
            if (status >= 300 && status < 400 && loc) {
                try { hop.data.destroy(); } catch (_) {}
                url = loc.startsWith('http') ? loc : `https://drive.google.com${loc}`;
                console.log(`GDrive hop (${status}) → ${url.slice(0, 100)}`);
                continue;
            }

            // Got actual bytes — stream to client
            if (!ct.includes('text/html') && status < 400) {
                console.log(`GDrive: streaming (${ct}, status=${status})`);
                return streamResponse(hop);
            }

            // 4xx that isn't HTML — file not found / not shared
            if (status === 403 || status === 404) {
                try { hop.data.destroy(); } catch (_) {}
                console.log(`GDrive: ${status} from ${url.slice(0,80)} — trying next strategy`);
                break; // try next startUrl
            }

            // Got HTML — virus-scan / confirmation page
            if (ct.includes('text/html')) {
                const html = await readBodyText(hop.data);

                // Try 1: extract confirm + uuid hidden fields or URL params (most reliable now)
                const cm = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/)
                         || html.match(/name=["']confirm["'][^>]*value=["']([^"']+)["']/i);
                const um = html.match(/name=["']uuid["'][^>]*value=["']([^"']+)["']/i)
                         || html.match(/[?&]uuid=([0-9A-Za-z_-]+)/);

                if (cm) {
                    const confirm = cm[1];
                    const uuid    = um ? um[1] : null;
                    url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirm}`;
                    if (uuid) url += `&uuid=${uuid}`;
                    console.log(`GDrive: confirm retry (confirm=${confirm}, uuid=${uuid || 'none'})`);
                    continue;
                }

                // Try 2: look for any direct usercontent download link in the HTML
                const lm = html.match(/href="(https:\/\/drive\.usercontent\.google\.com\/download[^"]+)"/i);
                if (lm) {
                    url = lm[1].replace(/&amp;/g, '&');
                    console.log(`GDrive: usercontent link in HTML → ${url.slice(0, 100)}`);
                    continue;
                }

                // Try 3: grab the form action URL directly (only if it has confirm params natively)
                let m = html.match(/action="(https?:\/\/[^"]*download[^"]*confirm=[^"]*)"/i)
                      || html.match(/action="([^"]*\/download[^"]*confirm=[^"]*)"/i);
                if (m) {
                    url = m[1].replace(/&amp;/g, '&');
                    if (!url.startsWith('http')) url = 'https://drive.google.com' + url;
                    console.log(`GDrive: form action fallback → ${url.slice(0, 100)}`);
                    continue;
                }

                console.log(`GDrive: no usable link found in HTML (${html.length} bytes), breaking`);
                break;
            }

            console.error(`GDrive: unexpected status=${status} ct="${ct}"`);
            break;
        }

        // This startUrl strategy exhausted — try next one
        if (res.headersSent) return;
        console.log(`GDrive: startUrl exhausted (${startUrl.slice(0,60)}), trying next...`);
    } catch (err) {
        if (res.headersSent) break;
        console.log(`GDrive: startUrl threw: ${err.message} (${startUrl.slice(0,50)}), trying next...`);
    }
    } // end for (startUrls)

    // All strategies failed
    if (!res.headersSent) {
        setCorsHeaders();
        res.status(502).json({
            error: 'Could not stream this Google Drive file.',
            hint: 'Make sure the file is shared as "Anyone with the link" (Viewer). Large files may require re-sharing or using a direct video host instead.',
        });
    }
});

// Handle CORS preflight for the proxy route
app.options('/api/proxy/gdrive', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.sendStatus(204);
});




io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join_room', ({ roomId, nickname, userId }) => {
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
                kickedUserIds: new Set()
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
            chatHistory: []
        });

        socket.to(roomId).emit('user_joined', user);
    });

    // ISSUE-33: Chat rate limit — minimum 500ms between messages per socket
    let lastMessageTime = 0;
    socket.on('send_message', ({ roomId, message }) => {
        const now = Date.now();
        if (now - lastMessageTime < 500) return; // silently drop spam
        lastMessageTime = now;
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

    socket.on('kick_user', ({ roomId, targetId }) => {
        const sender = getUserInRoom(socket.id, roomId);
        const target = getUserInRoom(targetId, roomId);
        if (!sender || !target) return;
        const canKick = sender.role === 'Host' || (sender.role === 'Moderator' && target.role === 'Viewer');
        if (canKick) {
            // BUG-02: Record the userId in the ban list before removing from users array
            if (rooms[roomId]) {
                rooms[roomId].kickedUserIds.add(target.userId);
            }
            io.to(targetId).emit('user_kicked');
            if (rooms[roomId] && rooms[roomId].users) {
                rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== targetId);
            }
            io.to(roomId).emit('user_left', targetId);
            const targetSocket = io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.leave(roomId);
                targetSocket.roomId = null;
            }
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
            if (rooms[roomId]) {
                const item = { id: Date.now().toString(), url: url || '', magnetURI: magnetURI || '', label: label || url || 'Unnamed' };
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
                socket.to(roomId).emit('video_seeked', playedSeconds);
            }
        }
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
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

// ISSUE-34: Global Express error handler — catches any unhandled route errors
// and returns a clean JSON response instead of leaking stack traces.
app.use((err, req, res, next) => {
    console.error('Unhandled route error:', err.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
