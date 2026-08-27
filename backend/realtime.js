const crypto = require('crypto');
const { canonicalPosition, createPlayback, reduceCommand } = require('./playback/canonicalState');
const { PROTOCOL_VERSION, normalizedText, validRoomCode, validMediaId, validCommandId, finiteNonNegative } = require('./validators');
const MAX_ROOM_USERS = 50;
const MAX_VOICE_PARTICIPANTS = 6;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_MEDIA_SECONDS = 7 * 24 * 60 * 60;
const ROOM_EMPTY_GRACE_MS = 30 * 1000;
const CONTROLLER_LEASE_MS = Math.min(15000, Math.max(100, Number(process.env.CONTROLLER_LEASE_MS) || 15000));
const ALLOWED_ROLES = new Set(['Host', 'Moderator']);

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);
const clampSeconds = value => Math.min(MAX_MEDIA_SECONDS, Math.max(0, Number(value) || 0));
const cleanText = (value, max) => normalizedText(value, max).replace(/<[^>]*>/g, '').trim();

const createVideoState = () => ({
    sourceType: 'remote',
    url: '',
    magnetURI: '',
    localMedia: null,
    isPlaying: false,
    playedSeconds: 0,
    updatedAt: Date.now(),
    seekVersion: 0,
    stateVersion: 0
});

const advancePlayback = (room, now = Date.now()) => {
    const state = room.videoState;
    if (state.isPlaying) {
        state.playedSeconds = clampSeconds(
            state.playedSeconds + Math.max(0, now - state.updatedAt) / 1000
        );
    }
    state.updatedAt = now;
    return state;
};

const snapshot = (room) => {
    advancePlayback(room);
    return {
        ...room.videoState,
        localMedia: room.videoState.localMedia
            ? { ...room.videoState.localMedia }
            : null,
        serverTime: Date.now()
    };
};

const isHttpUrl = value => {
    if (!value || typeof value !== 'string' || value.length > 4096) return false;
    if (/^(blob:|file:|data:)/i.test(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)) return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const validMagnet = value => !value || (
    typeof value === 'string' &&
    value.length <= 4096 &&
    value.startsWith('magnet:?')
);

const validLocalManifest = manifest => {
    if (!manifest || typeof manifest !== 'object') return false;
    return (
        typeof manifest.sessionId === 'string' &&
        /^[a-zA-Z0-9_-]{8,80}$/.test(manifest.sessionId) &&
        typeof manifest.fingerprint === 'string' &&
        /^[a-f0-9]{64}$/i.test(manifest.fingerprint) &&
        typeof manifest.displayName === 'string' &&
        manifest.displayName.trim().length > 0 &&
        manifest.displayName.length <= 180 &&
        isFiniteNumber(manifest.size) &&
        manifest.size > 0 &&
        manifest.size <= Number.MAX_SAFE_INTEGER &&
        typeof manifest.mimeType === 'string' &&
        manifest.mimeType.length <= 100 &&
        (!manifest.duration || (
            isFiniteNumber(manifest.duration) &&
            manifest.duration > 0 &&
            manifest.duration <= MAX_MEDIA_SECONDS
        ))
    );
};

const validDescription = (description, expectedType) => (
    description &&
    typeof description === 'object' &&
    description.type === expectedType &&
    typeof description.sdp === 'string' &&
    description.sdp.length > 0 &&
    description.sdp.length <= MAX_SIGNAL_BYTES
);

const validCandidate = candidate => (
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.candidate === 'string' &&
    candidate.candidate.length <= 4096 &&
    (candidate.sdpMid == null || (
        typeof candidate.sdpMid === 'string' &&
        candidate.sdpMid.length <= 64
    )) &&
    (candidate.sdpMLineIndex == null || (
        Number.isInteger(candidate.sdpMLineIndex) &&
        candidate.sdpMLineIndex >= 0 &&
        candidate.sdpMLineIndex < 128
    ))
);

module.exports = function registerRealtime({ io, rooms, buildIceConfig = () => ({ iceServers: [] }) }) {
    const messageRateLimitMap = new Map();
    const signalRateLimitMap = new Map();
    const playbackRateLimitMap = new Map();
    const telemetryRateLimitMap = new Map();
    const roomCleanupTimers = new Map();
    const hostLeaseTimers = new Map();

    const cancelRoomCleanup = roomId => {
        const timer = roomCleanupTimers.get(roomId);
        if (timer) clearTimeout(timer);
        roomCleanupTimers.delete(roomId);
    };

    const scheduleRoomCleanup = (roomId, room) => {
        cancelRoomCleanup(roomId);
        const timer = setTimeout(() => {
            roomCleanupTimers.delete(roomId);
            if (
                rooms.get(roomId) === room &&
                !room.users.some(user => user.connected)
            ) {
                rooms.delete(roomId);
            }
        }, ROOM_EMPTY_GRACE_MS);
        timer.unref?.();
        roomCleanupTimers.set(roomId, timer);
    };

    setInterval(() => {
        const now = Date.now();
        for (const [key, time] of messageRateLimitMap) {
            if (now - time > 60000) messageRateLimitMap.delete(key);
        }
        for (const [key, bucket] of signalRateLimitMap) {
            if (now - bucket.startedAt > 60000) signalRateLimitMap.delete(key);
        }
    }, 60 * 1000).unref();

    const publicUser = (room, user) => ({
        id: user.id,
        userId: user.userId,
        nickname: user.nickname,
        role: user.role,
        connected: user.connected,
        isVoiceActive: Boolean(user.isVoiceActive),
        isMuted: Boolean(user.isMuted),
        joinedAt: user.joinedAt,
        localReady: room.videoState.sourceType === 'local'
            ? room.localReadyUserIds.has(user.userId)
            : null
    });

    const publicUsers = room => room.users
        .filter(user => user.connected)
        .map(user => publicUser(room, user));

    const getUserBySocket = (room, socketId) => room?.users.find(user => user.id === socketId && user.connected) || null;

    const getBoundRoom = (socket, requestedRoomId) => {
        if (
            !requestedRoomId ||
            socket.data.roomId !== requestedRoomId ||
            !rooms.has(requestedRoomId)
        ) return null;
        return rooms.get(requestedRoomId);
    };

    const readinessPayload = room => {
        const connected = room.users.filter(user => user.connected);
        const readyUserIds = connected
            .filter(user => room.localReadyUserIds.has(user.userId))
            .map(user => user.userId);
        const statuses = Object.fromEntries(connected.map(user => [
            user.userId,
            room.mediaStatuses.get(user.userId) || { status: 'SELECT_FILE', reason: null }
        ]));
        return {
            mediaSessionId: room.media?.mediaId || room.videoState.localMedia?.sessionId || null,
            readyUserIds,
            readyCount: readyUserIds.length,
            totalCount: connected.length,
            statuses
        };
    };

    const roomSnapshot = (room, memberId) => ({
        protocolVersion: PROTOCOL_VERSION,
        memberId,
        members: publicUsers(room),
        controllerMemberId: room.controllerMemberId,
        controllerLeaseUntil: room.controllerLeaseUntil,
        media: room.media,
        readiness: readinessPayload(room),
        playback: room.playback,
        queue: room.queue,
        chatHistory: room.chatHistory,
        serverTimeMs: Date.now()
    });

    const emitReadiness = (roomId, room) => {
        const payload = readinessPayload(room);
        io.to(roomId).emit('local_readiness_updated', payload);
        io.to(roomId).emit('media:readiness', payload);
    };

    const voicePresence = (roomId, user) => {
        io.to(roomId).emit('voice_updated', {
            userId: user.id,
            isVoiceActive: Boolean(user.isVoiceActive),
            isMuted: Boolean(user.isMuted)
        });
    };

    const removeVoice = (socket, room, notify = true) => {
        if (!room) return;
        room.voiceSocketIds.delete(socket.id);
        const user = getUserBySocket(room, socket.id);
        if (user) {
            user.isVoiceActive = false;
            user.isMuted = true;
            if (notify) voicePresence(socket.data.roomId, user);
        }
        if (notify) {
            socket.to(socket.data.roomId).emit('voice_peer_left', { userId: socket.id });
        }
    };

    const canSignal = socket => {
        const now = Date.now();
        const bucket = signalRateLimitMap.get(socket.id);
        if (!bucket || now - bucket.startedAt >= 10000) {
            signalRateLimitMap.set(socket.id, { startedAt: now, count: 1 });
            return true;
        }
        bucket.count += 1;
        return bucket.count <= 180;
    };

    const signalingPeers = (socket, targetSocketId) => {
        if (!canSignal(socket) || typeof targetSocketId !== 'string' || targetSocketId.length > 32) return null;
        const room = rooms.get(socket.data.roomId);
        if (!room || !room.voiceSocketIds.has(socket.id) || !room.voiceSocketIds.has(targetSocketId)) return null;
        const target = io.sockets.sockets.get(targetSocketId);
        if (!target || target.data.roomId !== socket.data.roomId) return null;
        return { room, target };
    };

    io.on('connection', socket => {
        console.log('A user connected:', socket.id);

        socket.use((packet, next) => {
            if (packet.length > 1 && (!packet[1] || typeof packet[1] !== 'object' || Array.isArray(packet[1]))) {
                packet[1] = {};
            }
            const activeRoom = rooms.get(socket.data.roomId);
            if (activeRoom) activeRoom.lastActiveAt = Date.now();
            next();
        });

        const protocolError = (code, message, retryable = false) => ({
            ok: false, error: { code, message, retryable }
        });
        const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
        const newRoomCode = () => {
            let code;
            do code = crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'A').slice(0, 7).toUpperCase();
            while (rooms.has(code));
            return code;
        };
        const createRoom = roomId => ({
                    id: roomId,
                    users: [],
                    videoState: createVideoState(),
                    queue: [],
                    kickedUserIds: new Set(),
                    chatHistory: [],
                    localReadyUserIds: new Set(),
                    voiceSocketIds: new Set(),
                    mediaStatuses: new Map(),
                    media: null,
                    playback: createPlayback(),
                    recentCommandIds: new Map(),
                    controllerMemberId: null,
                    controllerLeaseUntil: null,
                    screenSharerMemberId: null,
                    screenViewerSocketIds: new Set(),
                    protocolVersion: PROTOCOL_VERSION,
                    createdAt: Date.now(),
                    lastActiveAt: Date.now()
        });

        const enterRoom = (payload = {}, callback, creating = false) => {
            const rejectRoom = (code, message, retryable = false) => {
                const error = { code, message, retryable };
                socket.emit('room:error', error);
                callback?.({ ok: false, error });
            };
            const suppliedVersion = Number(payload.protocolVersion);
            if (suppliedVersion !== PROTOCOL_VERSION) {
                return rejectRoom('PROTOCOL_MISMATCH', 'Watchly was updated. Refresh this page to continue.');
            }
            let roomId = creating ? newRoomCode() : String(payload.roomId || '').toUpperCase();
            let nickname = cleanText(payload.nickname, 24);
            if (!nickname) {
                return rejectRoom('INVALID_NICKNAME', 'Enter a nickname (1–24 characters).');
            }
            if (!validRoomCode(roomId)) {
                return rejectRoom('INVALID_ROOM_CODE', 'Room codes contain exactly seven letters or numbers.');
            }
            if (creating) rooms.set(roomId, createRoom(roomId));
            const room = rooms.get(roomId);
            if (!room) {
                return rejectRoom('ROOM_NOT_FOUND', 'This temporary room does not exist or has expired.');
            }

            cancelRoomCleanup(roomId);
            const connectedBeforeJoin = room.users.filter(item => item.connected);
            const suppliedTokenHash = typeof payload.resumeToken === 'string' && payload.resumeToken.length >= 32
                ? tokenHash(payload.resumeToken) : null;
            let user = suppliedTokenHash
                ? room.users.find(item => item.resumeTokenHash === suppliedTokenHash)
                : null;
            if (user && room.kickedUserIds.has(user.userId)) {
                return rejectRoom('MEMBER_BANNED', 'This membership was removed from the room.');
            }
            const resumeToken = user ? payload.resumeToken : crypto.randomBytes(32).toString('base64url');
            if (!user) {
                if (connectedBeforeJoin.length >= MAX_ROOM_USERS) {
                    return rejectRoom('ROOM_FULL', 'Room is full (max 50 users).');
                }
                user = {
                    id: socket.id,
                    userId: crypto.randomUUID(),
                    nickname,
                    role: creating ? 'Host' : 'Viewer',
                    connected: true,
                    isVoiceActive: false,
                    isMuted: true,
                    resumeTokenHash: tokenHash(resumeToken),
                    joinedAt: Date.now()
                };
                room.users.push(user);
                room.mediaStatuses.set(user.userId, { status: room.media ? 'SELECT_FILE' : 'NOT_REQUIRED', reason: null });
                if (creating) room.controllerMemberId = user.userId;
            } else {
                const leaseTimer = hostLeaseTimers.get(roomId);
                if (user.userId === room.controllerMemberId && leaseTimer) {
                    clearTimeout(leaseTimer);
                    hostLeaseTimers.delete(roomId);
                    room.controllerMemberId = user.userId;
                    room.controllerLeaseUntil = null;
                    io.to(roomId).emit('control:changed', { controllerMemberId: user.userId, reason: 'CONTROLLER_RESUMED' });
                }
                const oldSocketId = user.id;
                if (oldSocketId !== socket.id) {
                    room.voiceSocketIds.delete(oldSocketId);
                    const oldSocket = io.sockets.sockets.get(oldSocketId);
                    oldSocket?.leave(roomId);
                }
                user.id = socket.id;
                user.nickname = nickname;
                user.connected = true;
                user.isVoiceActive = false;
                user.isMuted = true;
                room.localReadyUserIds.delete(user.userId);
                if (room.media) room.mediaStatuses.set(user.userId, { status: 'SELECT_FILE', reason: null });
            }

            socket.join(roomId);
            socket.roomId = roomId;
            socket.userId = user.userId;
            socket.data.roomId = roomId;
            socket.data.memberId = user.userId;

            const joined = {
                ok: true,
                roomId,
                memberId: user.userId,
                resumeToken,
                protocolVersion: PROTOCOL_VERSION,
                user: publicUser(room, user),
                existingUsers: publicUsers(room),
                videoState: snapshot(room),
                localReadiness: readinessPayload(room),
                queue: room.queue,
                chatHistory: room.chatHistory
            };
            joined.snapshot = roomSnapshot(room, user.userId);
            socket.emit('room_joined', joined);
            callback?.(joined);
            socket.to(roomId).emit('user_joined', {
                ...publicUser(room, user),
                localReady: room.videoState.sourceType === 'local' ? false : null
            });
            if (room.videoState.sourceType === 'local') emitReadiness(roomId, room);
        };

        socket.on('room:create', (payload, callback) => enterRoom(payload, callback, true));
        socket.on('room:join', (payload, callback) => enterRoom(payload, callback, false));

        socket.on('room:snapshot', (_payload, callback) => {
            const room = rooms.get(socket.data.roomId);
            if (!room || !socket.data.memberId) return callback?.(protocolError('NOT_IN_ROOM', 'Join a room first.'));
            callback?.({ ok: true, snapshot: roomSnapshot(room, socket.data.memberId) });
        });

        socket.on('clock:ping', ({ clientSendMs } = {}, callback) => callback?.({
            clientSendMs,
            serverTimeMs: Date.now()
        }));

        socket.on('ice:config', (_payload = {}, callback) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user) return callback?.(protocolError('NOT_IN_ROOM', 'Join a room before requesting relay credentials.'));
            callback?.({ ok: true, ...buildIceConfig(user.userId) });
        });

        socket.on('send_message', ({ roomId, message } = {}) => {
            const room = getBoundRoom(socket, roomId);
            if (!room || !message || typeof message.text !== 'string') return;
            const now = Date.now();
            const key = socket.data.memberId || socket.id;
            if (now - (messageRateLimitMap.get(key) || 0) < 500) return;
            messageRateLimitMap.set(key, now);

            const sender = getUserBySocket(room, socket.id);
            const text = cleanText(message.text, 500);
            if (!sender || !text) return;
            const safeMessage = {
                id: cleanText(message.id, 80) || `${now}-${Math.random().toString(36).slice(2, 8)}`,
                text,
                nickname: sender.nickname,
                role: sender.role,
                time: cleanText(message.time, 20)
            };
            room.chatHistory.push(safeMessage);
            room.chatHistory = room.chatHistory.slice(-100);
            io.to(roomId).emit('receive_message', safeMessage);
        });

        const roleAction = (roomId, targetId, action) => {
            const room = getBoundRoom(socket, roomId);
            const sender = getUserBySocket(room, socket.id);
            const target = getUserBySocket(room, targetId);
            if (!sender || !target) return;
            action(room, sender, target);
        };

        socket.on('promote_to_moderator', ({ roomId, targetId } = {}) => {
            roleAction(roomId, targetId, (room, sender, target) => {
                if (sender.role === 'Host' && target.role === 'Viewer') {
                    target.role = 'Moderator';
                    io.to(roomId).emit('role_updated', { userId: target.id, newRole: 'Moderator' });
                }
            });
        });

        socket.on('demote_to_viewer', ({ roomId, targetId } = {}) => {
            roleAction(roomId, targetId, (room, sender, target) => {
                if (sender.role === 'Host' && target.role === 'Moderator') {
                    target.role = 'Viewer';
                    io.to(roomId).emit('role_updated', { userId: target.id, newRole: 'Viewer' });
                }
            });
        });

        socket.on('transfer_host', ({ roomId, targetId } = {}) => {
            roleAction(roomId, targetId, (room, sender, target) => {
                if (sender.role !== 'Host') return;
                sender.role = 'Moderator';
                target.role = 'Host';
                room.controllerMemberId = target.userId;
                io.to(roomId).emit('role_updated', { userId: sender.id, newRole: 'Moderator' });
                io.to(roomId).emit('role_updated', { userId: target.id, newRole: 'Host' });
                io.to(roomId).emit('control:changed', { controllerMemberId: target.userId, reason: 'HOST_TRANSFER' });
            });
        });

        socket.on('kick_user', ({ roomId, targetId } = {}) => {
            const room = getBoundRoom(socket, roomId);
            const sender = getUserBySocket(room, socket.id);
            const target = room?.users.find(user => (
                user.connected &&
                (user.id === targetId || user.userId === targetId)
            ));
            if (!sender || !target) return;
            const allowed = sender.role === 'Host' || (
                sender.role === 'Moderator' && target.role === 'Viewer'
            );
            if (!allowed) return;

            room.kickedUserIds.add(target.userId);
            room.localReadyUserIds.delete(target.userId);
            room.mediaStatuses.delete(target.userId);
            room.screenViewerSocketIds.delete(target.id);
            if (room.screenSharerMemberId === target.userId) {
                room.screenSharerMemberId = null;
                room.screenViewerSocketIds.clear();
                io.to(roomId).emit('screen:stopped');
            }
            const targetSocket = io.sockets.sockets.get(target.id);
            if (targetSocket) {
                removeVoice(targetSocket, room);
                targetSocket.emit('user_kicked');
                targetSocket.leave(roomId);
                targetSocket.roomId = null;
                targetSocket.data.roomId = null;
                targetSocket.data.memberId = null;
            }
            target.connected = false;
            if (room.controllerMemberId === target.userId) {
                const candidates = room.users
                    .filter(item => item.connected && item.userId !== target.userId)
                    .sort((a, b) => a.joinedAt - b.joinedAt);
                const replacement = candidates.find(item => item.role === 'Host') ||
                    candidates.find(item => item.role === 'Moderator') || candidates[0] || null;
                room.controllerMemberId = replacement?.userId || null;
                room.controllerLeaseUntil = null;
                io.to(roomId).emit('control:changed', {
                    controllerMemberId: room.controllerMemberId,
                    reason: 'CONTROLLER_REMOVED'
                });
            }
            io.to(roomId).emit('user_left', target.id);
            if (room.videoState.sourceType === 'local') emitReadiness(roomId, room);
        });

        const controller = roomId => {
            const room = getBoundRoom(socket, roomId);
            const user = getUserBySocket(room, socket.id);
            return room && user && room.controllerMemberId === user.userId
                ? { room, user }
                : null;
        };

        socket.on('control:request', (_payload = {}, callback) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user || !ALLOWED_ROLES.has(user.role)) {
                return callback?.(protocolError('FORBIDDEN', 'Only the Host or a Moderator can request control.'));
            }
            if (room.controllerLeaseUntil && room.controllerLeaseUntil > Date.now() && room.controllerMemberId !== user.userId) {
                return callback?.(protocolError('LEASE_ACTIVE', 'The controller reconnect grace period is still active.', true));
            }
            room.controllerMemberId = user.userId;
            room.controllerLeaseUntil = null;
            io.to(socket.data.roomId).emit('control:changed', { controllerMemberId: user.userId, reason: 'CONTROL_REQUESTED' });
            callback?.({ ok: true });
        });

        socket.on('media:declare', ({ descriptor } = {}, callback) => {
            const access = controller(socket.data.roomId);
            const declaredSize = Number(String(descriptor?.mediaId || '').split(':')[1]);
            const valid = descriptor && descriptor.sourceType === 'local-file' &&
                validMediaId(descriptor.mediaId) && descriptor.fingerprintVersion === 'sampled-sha256-v1' &&
                Number.isSafeInteger(descriptor.sizeBytes) && descriptor.sizeBytes > 0 && descriptor.sizeBytes <= 16 * 1024 ** 4 &&
                declaredSize === descriptor.sizeBytes &&
                finiteNonNegative(descriptor.durationMs) && descriptor.durationMs > 0 && descriptor.durationMs <= MAX_MEDIA_SECONDS * 1000 &&
                cleanText(descriptor.displayTitle, 100);
            if (!access || !valid) return callback?.(protocolError('INVALID_MEDIA', 'The local media descriptor is invalid.'));
            const { room, user } = access;
            room.media = {
                sourceType: 'local-file', mediaId: descriptor.mediaId,
                fingerprintVersion: 'sampled-sha256-v1',
                displayTitle: cleanText(descriptor.displayTitle, 100),
                sizeBytes: descriptor.sizeBytes,
                durationMs: descriptor.durationMs
            };
            room.mediaStatuses = new Map(room.users.filter(item => item.connected).map(item => [
                item.userId, { status: item.userId === user.userId ? 'READY' : 'SELECT_FILE', reason: null, verified: item.userId === user.userId }
            ]));
            room.localReadyUserIds = new Set([user.userId]);
            room.playback = createPlayback();
            room.recentCommandIds.clear();
            io.to(socket.data.roomId).emit('media:declared', { media: room.media, playback: room.playback });
            emitReadiness(socket.data.roomId, room);
            callback?.({ ok: true, snapshot: roomSnapshot(room, user.userId) });
        });

        socket.on('media:ready', ({ mediaId, status, reason, fingerprint, size, duration } = {}, callback) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            const allowed = new Set(['READY', 'MISMATCH', 'UNSUPPORTED', 'ERROR', 'SELECT_FILE', 'BUFFERING']);
            if (!room || !user || mediaId !== room.media?.mediaId || !allowed.has(status)) {
                return callback?.(protocolError('STALE_MEDIA', 'Readiness does not match the active media.'));
            }
            const prior = room.mediaStatuses.get(user.userId);
            if (status === 'READY' && !prior?.verified) {
                const expectedFingerprint = room.media.mediaId.split(':').at(-1);
                if (fingerprint !== expectedFingerprint || size !== room.media.sizeBytes ||
                    !finiteNonNegative(duration) || Math.abs(duration * 1000 - room.media.durationMs) > 250) {
                    status = 'MISMATCH';
                    reason = 'Different file';
                }
            }
            const verified = status === 'READY' || status === 'BUFFERING' ? Boolean(prior?.verified || status === 'READY') : false;
            room.mediaStatuses.set(user.userId, { status, reason: cleanText(reason, 120) || null, verified });
            if (status === 'READY') room.localReadyUserIds.add(user.userId);
            else room.localReadyUserIds.delete(user.userId);
            emitReadiness(socket.data.roomId, room);
            callback?.({ ok: true });
        });

        socket.on('playback:command', (payload = {}, callback) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user || room.controllerMemberId !== user.userId) {
                return callback?.(protocolError('NOT_CONTROLLER', 'Only the current controller can change playback.'));
            }
            if (payload.mediaId !== room.media?.mediaId || !validCommandId(payload.commandId) ||
                !['PLAY', 'PAUSE', 'SEEK', 'ENDED'].includes(payload.action) ||
                (payload.action === 'SEEK' && !finiteNonNegative(payload.positionSec))) {
                return callback?.(protocolError('INVALID_COMMAND', 'The playback command is invalid.'));
            }
            if (room.recentCommandIds.has(payload.commandId)) {
                return callback?.({ ok: true, duplicate: true, playback: room.recentCommandIds.get(payload.commandId) });
            }
            const now = Date.now();
            const bucket = playbackRateLimitMap.get(user.userId) || { startedAt: now, count: 0 };
            if (now - bucket.startedAt >= 1000) Object.assign(bucket, { startedAt: now, count: 0 });
            bucket.count += 1;
            playbackRateLimitMap.set(user.userId, bucket);
            if (bucket.count > 10) return callback?.(protocolError('RATE_LIMITED', 'Too many playback commands.', true));
            if (payload.action === 'PLAY') {
                const readiness = readinessPayload(room);
                if (readiness.readyCount < readiness.totalCount && payload.startAnyway !== true) {
                    return callback?.(protocolError('NOT_ALL_READY', `${readiness.readyCount}/${readiness.totalCount} participants are ready.`));
                }
            }
            const durationSec = room.media.durationMs / 1000;
            if (payload.action === 'ENDED' && canonicalPosition(room.playback, now, durationSec) < durationSec - 2) {
                return callback?.(protocolError('TOO_EARLY', 'The media has not reached the end.'));
            }
            room.playback = {
                ...reduceCommand({
                    playback: room.playback, action: payload.action,
                    positionSec: Number(payload.positionSec), now,
                    effectiveAt: now + 750, memberId: user.userId, durationSec
                }),
                commandId: payload.commandId
            };
            room.recentCommandIds.set(payload.commandId, room.playback);
            while (room.recentCommandIds.size > 100) room.recentCommandIds.delete(room.recentCommandIds.keys().next().value);
            io.to(socket.data.roomId).emit('playback:state', room.playback);
            callback?.({ ok: true, playback: room.playback });
        });

        socket.on('playback:telemetry', ({ mediaId, positionSec, readyState, buffering, lastSeq } = {}) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user || mediaId !== room.media?.mediaId || !finiteNonNegative(positionSec) ||
                !Number.isInteger(readyState) || readyState < 0 || readyState > 4 ||
                typeof buffering !== 'boolean' || !Number.isInteger(lastSeq) || lastSeq < -1) return;
            const now = Date.now();
            const previous = telemetryRateLimitMap.get(user.userId) || 0;
            if (now - previous < 500) return;
            telemetryRateLimitMap.set(user.userId, now);
            user.telemetry = { positionSec, readyState, buffering, lastSeq, receivedAt: now };
        });

        const mediaEventIsCurrent = (room, payload = {}) => {
            if (room.videoState.sourceType === 'local') {
                if (payload.mediaSessionId !== room.videoState.localMedia?.sessionId) return false;
            }
            if (
                Number.isInteger(payload.stateVersion) &&
                payload.stateVersion < room.videoState.stateVersion - 2
            ) return false;
            return true;
        };

        socket.on('change_video', ({ roomId, url, magnetURI = '' } = {}) => {
            const access = controller(roomId);
            if (!access) return;
            if ((!url && !magnetURI) || (url && !isHttpUrl(url)) || !validMagnet(magnetURI)) {
                socket.emit('error_message', { message: 'Only valid HTTP(S) video URLs are supported.' });
                return;
            }
            const { room } = access;
            room.localReadyUserIds.clear();
            room.videoState = {
                sourceType: 'remote',
                url: url || '',
                magnetURI: magnetURI || '',
                localMedia: null,
                isPlaying: true,
                playedSeconds: 0,
                updatedAt: Date.now(),
                seekVersion: 0,
                stateVersion: room.videoState.stateVersion + 1
            };
            io.to(roomId).emit('video_changed', snapshot(room));
            emitReadiness(roomId, room);
        });

        socket.on('select_local_media', ({ roomId, localMedia } = {}, callback) => {
            const access = controller(roomId);
            if (!access || !validLocalManifest(localMedia)) {
                if (typeof callback === 'function') callback({ ok: false, error: 'Invalid local media selection.' });
                return;
            }
            const { room, user } = access;
            const manifest = {
                sessionId: localMedia.sessionId,
                fingerprint: localMedia.fingerprint.toLowerCase(),
                displayName: cleanText(localMedia.displayName, 180),
                size: localMedia.size,
                mimeType: cleanText(localMedia.mimeType, 100),
                duration: clampSeconds(localMedia.duration),
                selectedBy: user.nickname
            };
            room.localReadyUserIds.clear();
            room.localReadyUserIds.add(user.userId);
            room.videoState = {
                sourceType: 'local',
                url: '',
                magnetURI: '',
                localMedia: manifest,
                isPlaying: false,
                playedSeconds: 0,
                updatedAt: Date.now(),
                seekVersion: 0,
                stateVersion: room.videoState.stateVersion + 1
            };
            const state = snapshot(room);
            io.to(roomId).emit('local_media_selected', {
                videoState: state,
                readiness: readinessPayload(room)
            });
            emitReadiness(roomId, room);
            if (typeof callback === 'function') callback({ ok: true, videoState: state });
        });

        socket.on('local_media_ready', ({ roomId, mediaSessionId, fingerprint, size, duration } = {}) => {
            const room = getBoundRoom(socket, roomId);
            const user = getUserBySocket(room, socket.id);
            const media = room?.videoState.localMedia;
            if (
                !user ||
                room.videoState.sourceType !== 'local' ||
                mediaSessionId !== media?.sessionId ||
                typeof fingerprint !== 'string' ||
                fingerprint.toLowerCase() !== media.fingerprint ||
                size !== media.size ||
                !isFiniteNumber(duration) ||
                Math.abs(duration - media.duration) > 0.25
            ) return;
            room.localReadyUserIds.add(user.userId);
            emitReadiness(roomId, room);
        });

        socket.on('local_media_not_ready', ({ roomId, mediaSessionId } = {}) => {
            const room = getBoundRoom(socket, roomId);
            const user = getUserBySocket(room, socket.id);
            if (!user || mediaSessionId !== room.videoState.localMedia?.sessionId) return;
            room.localReadyUserIds.delete(user.userId);
            emitReadiness(roomId, room);
        });

        socket.on('sync_progress', (payload = {}) => {
            const access = controller(payload.roomId);
            if (!access || !mediaEventIsCurrent(access.room, payload)) return;
            if (!isFiniteNumber(payload.playedSeconds)) return;
            const { room } = access;
            room.videoState.playedSeconds = clampSeconds(payload.playedSeconds);
            room.videoState.updatedAt = Date.now();
            room.videoState.stateVersion += 1;
            io.to(payload.roomId).emit('video_progress', snapshot(room));
        });

        socket.on('play_video', (payload = {}) => {
            const access = controller(payload.roomId);
            if (!access || !mediaEventIsCurrent(access.room, payload)) return;
            const { room } = access;
            if (room.videoState.sourceType === 'local') {
                const readiness = readinessPayload(room);
                if (readiness.readyCount < readiness.totalCount && payload.startAnyway !== true) {
                    socket.emit('local_media_waiting', readiness);
                    return;
                }
            }
            advancePlayback(room);
            if (!room.videoState.isPlaying) {
                room.videoState.isPlaying = true;
                room.videoState.stateVersion += 1;
            }
            io.to(payload.roomId).emit('video_played', snapshot(room));
        });

        socket.on('pause_video', (payload = {}) => {
            const access = controller(payload.roomId);
            if (!access || !mediaEventIsCurrent(access.room, payload)) return;
            const { room } = access;
            advancePlayback(room);
            if (isFiniteNumber(payload.playedSeconds)) {
                room.videoState.playedSeconds = clampSeconds(payload.playedSeconds);
            }
            room.videoState.isPlaying = false;
            room.videoState.updatedAt = Date.now();
            room.videoState.stateVersion += 1;
            io.to(payload.roomId).emit('video_paused', snapshot(room));
        });

        socket.on('seek_video', (payload = {}) => {
            const access = controller(payload.roomId);
            if (
                !access ||
                !mediaEventIsCurrent(access.room, payload) ||
                !isFiniteNumber(payload.playedSeconds)
            ) return;
            const { room } = access;
            room.videoState.playedSeconds = clampSeconds(payload.playedSeconds);
            room.videoState.updatedAt = Date.now();
            room.videoState.seekVersion += 1;
            room.videoState.stateVersion += 1;
            io.to(payload.roomId).emit('video_seeked', snapshot(room));
        });

        socket.on('add_to_queue', ({ roomId, url, magnetURI = '', label } = {}) => {
            const access = controller(roomId);
            if (!access || (!url && !magnetURI) || (url && !isHttpUrl(url)) || !validMagnet(magnetURI)) return;
            const item = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                url: url || '',
                magnetURI,
                label: cleanText(label, 300) || url || 'Unnamed'
            };
            access.room.queue.push(item);
            io.to(roomId).emit('queue_updated', access.room.queue);
        });

        socket.on('remove_from_queue', ({ roomId, itemId } = {}) => {
            const access = controller(roomId);
            if (!access || typeof itemId !== 'string') return;
            access.room.queue = access.room.queue.filter(item => item.id !== itemId);
            io.to(roomId).emit('queue_updated', access.room.queue);
        });

        socket.on('play_next', ({ roomId } = {}) => {
            const access = controller(roomId);
            if (!access || access.room.queue.length === 0) return;
            const next = access.room.queue.shift();
            access.room.localReadyUserIds.clear();
            access.room.videoState = {
                sourceType: 'remote',
                url: next.url,
                magnetURI: next.magnetURI,
                localMedia: null,
                isPlaying: true,
                playedSeconds: 0,
                updatedAt: Date.now(),
                seekVersion: 0,
                stateVersion: access.room.videoState.stateVersion + 1
            };
            io.to(roomId).emit('video_changed', snapshot(access.room));
            io.to(roomId).emit('queue_updated', access.room.queue);
            emitReadiness(roomId, access.room);
        });

        socket.on('network_ping', (_payload, callback) => {
            if (typeof callback === 'function') callback({ serverTime: Date.now() });
        });

        socket.on('join_voice', ({ roomId, isMuted = false } = {}, callback) => {
            const room = getBoundRoom(socket, roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user) {
                callback?.({ ok: false, error: 'Join the room before joining voice.' });
                return;
            }
            if (!room.voiceSocketIds.has(socket.id) && room.voiceSocketIds.size >= MAX_VOICE_PARTICIPANTS) {
                callback?.({ ok: false, error: `Voice is full (max ${MAX_VOICE_PARTICIPANTS} participants).` });
                return;
            }
            const peers = [...room.voiceSocketIds]
                .filter(id => id !== socket.id)
                .map(id => {
                    const peerUser = getUserBySocket(room, id);
                    return peerUser ? {
                        id: peerUser.id,
                        nickname: peerUser.nickname,
                        isMuted: Boolean(peerUser.isMuted)
                    } : null;
                })
                .filter(Boolean);

            room.voiceSocketIds.add(socket.id);
            user.isVoiceActive = true;
            user.isMuted = Boolean(isMuted);
            voicePresence(roomId, user);
            socket.to(roomId).emit('voice_peer_joined', {
                userId: user.id,
                nickname: user.nickname,
                isMuted: user.isMuted
            });
            callback?.({ ok: true, peers, maxParticipants: MAX_VOICE_PARTICIPANTS });
        });

        socket.on('leave_voice', ({ roomId } = {}) => {
            const room = getBoundRoom(socket, roomId);
            removeVoice(socket, room);
        });

        socket.on('update_voice_mute', ({ roomId, isMuted } = {}) => {
            const room = getBoundRoom(socket, roomId);
            const user = getUserBySocket(room, socket.id);
            if (!user || !room.voiceSocketIds.has(socket.id) || typeof isMuted !== 'boolean') return;
            user.isMuted = isMuted;
            voicePresence(roomId, user);
        });

        socket.on('webrtc_offer', ({ targetSocketId, offer } = {}) => {
            if (!signalingPeers(socket, targetSocketId) || !validDescription(offer, 'offer')) return;
            io.to(targetSocketId).emit('webrtc_offer', { senderSocketId: socket.id, offer });
        });

        socket.on('webrtc_answer', ({ targetSocketId, answer } = {}) => {
            if (!signalingPeers(socket, targetSocketId) || !validDescription(answer, 'answer')) return;
            io.to(targetSocketId).emit('webrtc_answer', { senderSocketId: socket.id, answer });
        });

        socket.on('webrtc_ice_candidate', ({ targetSocketId, candidate } = {}) => {
            if (!signalingPeers(socket, targetSocketId) || !validCandidate(candidate)) return;
            io.to(targetSocketId).emit('webrtc_ice_candidate', {
                senderSocketId: socket.id,
                candidate
            });
        });

        const screenPeers = (targetSocketId, direction) => {
            if (!canSignal(socket) || typeof targetSocketId !== 'string') return null;
            const room = rooms.get(socket.data.roomId);
            const target = io.sockets.sockets.get(targetSocketId);
            if (!room || !getUserBySocket(room, socket.id) || !target || target.data.roomId !== socket.data.roomId || !getUserBySocket(room, targetSocketId)) return null;
            const senderIsSharer = socket.data.memberId === room.screenSharerMemberId;
            const targetIsSharer = target.data.memberId === room.screenSharerMemberId;
            const senderIsViewer = room.screenViewerSocketIds.has(socket.id);
            const targetIsViewer = room.screenViewerSocketIds.has(targetSocketId);
            if (direction === 'offer' && !(senderIsSharer && targetIsViewer)) return null;
            if (direction === 'answer' && !(senderIsViewer && targetIsSharer)) return null;
            if (direction === 'ice' && !((senderIsSharer && targetIsViewer) || (senderIsViewer && targetIsSharer))) return null;
            return target;
        };
        socket.on('screen:offer', ({ targetSocketId, offer } = {}) => {
            if (!screenPeers(targetSocketId, 'offer') || !validDescription(offer, 'offer')) return;
            io.to(targetSocketId).emit('screen:offer', { senderSocketId: socket.id, offer });
        });
        socket.on('screen:answer', ({ targetSocketId, answer } = {}) => {
            if (!screenPeers(targetSocketId, 'answer') || !validDescription(answer, 'answer')) return;
            io.to(targetSocketId).emit('screen:answer', { senderSocketId: socket.id, answer });
        });
        socket.on('screen:ice', ({ targetSocketId, candidate } = {}) => {
            if (!screenPeers(targetSocketId, 'ice') || !validCandidate(candidate)) return;
            io.to(targetSocketId).emit('screen:ice', { senderSocketId: socket.id, candidate });
        });
        socket.on('screen:started', (_payload = {}, callback) => {
            const room = rooms.get(socket.data.roomId);
            const user = getUserBySocket(room, socket.id);
            if (!room || !user || room.controllerMemberId !== user.userId) return callback?.(protocolError('NOT_CONTROLLER', 'Only the controller can share a screen.'));
            const candidates = room.users.filter(item => item.connected && item.id !== socket.id);
            const viewers = candidates.slice(0, 3);
            candidates.slice(3).forEach(item => io.to(item.id).emit('screen:unavailable', {
                code: 'PARTICIPANT_LIMIT', message: 'Screen Share Beta supports up to three viewers. Use Local File Sync instead.'
            }));
            room.screenSharerMemberId = user.userId;
            room.screenViewerSocketIds = new Set(viewers.map(item => item.id));
            io.to(socket.data.roomId).emit('screen:started', { sharerSocketId: socket.id, sharerMemberId: user.userId });
            callback?.({ ok: true, viewers: viewers.map(item => ({ socketId: item.id, memberId: item.userId })), excludedCount: Math.max(0, candidates.length - 3) });
        });
        socket.on('screen:stopped', () => {
            const room = rooms.get(socket.data.roomId);
            if (!room || room.screenSharerMemberId !== socket.data.memberId) return;
            room.screenSharerMemberId = null;
            room.screenViewerSocketIds.clear();
            io.to(socket.data.roomId).emit('screen:stopped');
        });

        const handleDisconnect = () => {
            const roomId = socket.data.roomId;
            const room = rooms.get(roomId);
            if (!room) return;
            removeVoice(socket, room);

            const user = room.users.find(item => item.id === socket.id && item.connected);
            if (!user) return;
            user.connected = false;
            room.screenViewerSocketIds.delete(socket.id);
            room.localReadyUserIds.delete(user.userId);
            if (room.screenSharerMemberId === user.userId) {
                room.screenSharerMemberId = null;
                room.screenViewerSocketIds.clear();
                io.to(roomId).emit('screen:stopped');
            }
            socket.to(roomId).emit('user_left', socket.id);

            const remaining = room.users.filter(item => item.connected);
            if (remaining.length === 0) {
                scheduleRoomCleanup(roomId, room);
                return;
            }
            if (user.userId === room.controllerMemberId) {
                advancePlayback(room);
                room.videoState.isPlaying = false;
                io.to(roomId).emit('video_paused', snapshot(room));
                if (room.media) {
                    const now = Date.now();
                    room.playback = {
                        ...reduceCommand({ playback: room.playback, action: 'PAUSE', now, effectiveAt: now,
                            memberId: user.userId, durationSec: room.media.durationMs / 1000 }),
                        commandId: `disconnect_${room.playback.seq + 1}`
                    };
                    io.to(roomId).emit('playback:state', room.playback);
                }
                room.controllerLeaseUntil = Date.now() + CONTROLLER_LEASE_MS;
                io.to(roomId).emit('control:changed', {
                    controllerMemberId: user.userId,
                    reason: 'HOST_RECONNECT_GRACE',
                    leaseUntil: room.controllerLeaseUntil
                });
                const timer = setTimeout(() => {
                    hostLeaseTimers.delete(roomId);
                    if (user.connected || rooms.get(roomId) !== room) return;
                    const candidates = room.users.filter(item => item.connected).sort((a, b) => a.joinedAt - b.joinedAt);
                    const nextHost = candidates.find(item => item.role === 'Moderator') || candidates[0];
                    if (!nextHost) return;
                    room.controllerMemberId = nextHost.userId;
                    room.controllerLeaseUntil = null;
                    io.to(roomId).emit('control:changed', {
                        controllerMemberId: nextHost.userId,
                        reason: 'HOST_LEASE_EXPIRED'
                    });
                }, CONTROLLER_LEASE_MS);
                timer.unref?.();
                hostLeaseTimers.set(roomId, timer);
            }
            if (room.videoState.sourceType === 'local') emitReadiness(roomId, room);
        };

        socket.on('leave_room', () => {
            const roomId = socket.data.roomId;
            handleDisconnect();
            if (roomId) socket.leave(roomId);
            socket.roomId = null;
            socket.userId = null;
            socket.data.roomId = null;
            socket.data.memberId = null;
        });
        socket.on('disconnect', () => {
            handleDisconnect();
            messageRateLimitMap.delete(socket.data.memberId || socket.id);
            telemetryRateLimitMap.delete(socket.data.memberId);
            signalRateLimitMap.delete(socket.id);
        });
    });
};
