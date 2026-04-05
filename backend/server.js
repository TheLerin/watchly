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
// Streams a public Google Drive file using multiple fallback strategies
// to bypass Google's download restrictions.
// Usage: GET /api/proxy/gdrive?id=<GOOGLE_DRIVE_FILE_ID>
app.get('/api/proxy/gdrive', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send('Missing Google Drive file id');

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    const setCorsHeaders = () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    };

    const forwardRangeHeaders = (extra = {}) => {
        const h = { 'User-Agent': UA, ...extra };
        if (req.headers.range) h['Range'] = req.headers.range;
        return h;
    };

    // Stream a response object back to the client
    const streamResponse = (response) => {
        const contentType = response.headers['content-type'] || 'video/mp4';
        const contentLength = response.headers['content-length'];
        const acceptRanges = response.headers['accept-ranges'];

        setCorsHeaders();
        res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);
        if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        res.status(response.status === 206 ? 206 : 200);
        response.data.pipe(res);
        req.on('close', () => response.data.destroy());
    };

    try {
        // ── Strategy 1: Try the newer /uc endpoint with authuser param ───
        // This works for many publicly-shared files without needing a session
        const urls = [
            `https://drive.google.com/uc?export=download&id=${id}&confirm=t&authuser=0`,
            `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
        ];

        for (const downloadUrl of urls) {
            let response;
            try {
                response = await axios({
                    method: 'GET',
                    url: downloadUrl,
                    responseType: 'stream',
                    headers: forwardRangeHeaders(),
                    maxRedirects: 10,
                    validateStatus: (s) => s < 500,
                });
            } catch (e) {
                console.log(`GDrive: strategy failed for ${downloadUrl}: ${e.message}`);
                continue;
            }

            const ct = response.headers['content-type'] || '';

            // Got a non-HTML response → it's the actual file
            if (!ct.includes('text/html') && response.status < 400) {
                console.log(`GDrive: streaming via ${downloadUrl} (${ct})`);
                return streamResponse(response);
            }

            // Got HTML → might be a virus-warning/confirmation page, extract token and retry
            if (ct.includes('text/html')) {
                const chunks = [];
                for await (const chunk of response.data) chunks.push(chunk);
                const html = Buffer.concat(chunks).toString('utf-8');

                const rawCookies = response.headers['set-cookie'];
                const cookieStr = rawCookies ? rawCookies.map(c => c.split(';')[0]).join('; ') : '';

                let confirmToken = 't';
                const confirmMatch = html.match(/confirm=([0-9A-Za-z_-]+)/);
                if (confirmMatch) confirmToken = confirmMatch[1];

                const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
                let retryUrl = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirmToken}`;
                if (uuidMatch) retryUrl += `&uuid=${uuidMatch[1]}`;

                let retryResponse;
                try {
                    retryResponse = await axios({
                        method: 'GET',
                        url: retryUrl,
                        responseType: 'stream',
                        headers: forwardRangeHeaders({ Cookie: cookieStr }),
                        maxRedirects: 10,
                        validateStatus: (s) => s < 500,
                    });
                } catch (e) {
                    console.log(`GDrive: retry failed: ${e.message}`);
                    continue;
                }

                const retryCt = retryResponse.headers['content-type'] || '';
                if (!retryCt.includes('text/html') && retryResponse.status < 400) {
                    console.log(`GDrive: streaming via retry (${retryCt})`);
                    return streamResponse(retryResponse);
                }
            }
        }

        // All strategies failed
        console.error(`GDrive: all strategies failed for id=${id}`);
        if (!res.headersSent) {
            setCorsHeaders();
            res.status(403).send('Could not download file from Google Drive. Make sure it is shared as "Anyone with the link" and not restricted.');
        }

    } catch (err) {
        console.error('Google Drive proxy error:', err.message);
        if (!res.headersSent) {
            setCorsHeaders();
            res.status(500).send('Failed to stream from Google Drive.');
        }
    }
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
                // BUG-07: Increment seekVersion so viewer drift-correction effects fire
                rooms[roomId].videoState.seekVersion = (rooms[roomId].videoState.seekVersion || 0) + 1;
                // Broadcast drift correction to viewers (they only act if drift > threshold)
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
