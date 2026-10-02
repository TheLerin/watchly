import { PROTOCOL_VERSION } from './protocol.js';

export const terminalRoomError = error => Boolean(error && error.retryable !== true && [
    'ROOM_NOT_FOUND', 'MEMBER_BANNED', 'SESSION_INVALID', 'ROOM_FULL', 'ROOM_LOCKED',
    'ROOM_ENDED', 'FORBIDDEN', 'PROTOCOL_MISMATCH', 'INVALID_ROOM_CODE', 'INVALID_NICKNAME', 'ALREADY_IN_ROOM', 'SESSION_REPLACED',
].includes(error.code));

export function readRoomSession(storage) {
    try {
        const value = JSON.parse(storage.getItem('watchTogetherSession') || 'null');
        return value && /^[A-Z0-9]{7}$/.test(value.roomId) && typeof value.nickname === 'string' && value.nickname.trim() &&
            typeof value.resumeToken === 'string' && value.resumeToken.length >= 32 ? value : null;
    } catch { return null; }
}

// Coordinates room entry/snapshots on the existing socket. Socket.IO's Manager
// alone owns transport backoff; this timer only retries a failed room ACK.
export function createRoomRecovery({ socket, getSession, isEntryPending = () => false,
    onPhase, onJoin, onSnapshot, onFailure, onOutage = () => {}, onRestored = () => {},
    schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
    let enabled = true, generation = 0, pending = null, bound = false, outage = false, stoppedPhase = 'offline';
    let retryTimer, offlineTimer, lastWake = -Infinity, restoring = null, outageAt = 0;
    const phase = value => onPhase(value, socket.connected);
    const clearRetry = () => { cancel(retryTimer); retryTimer = null; };
    const invalidate = () => { generation++; pending = null; restoring = null; clearRetry(); };
    const startOutage = () => {
        if (!enabled || !getSession()) return;
        if (!outage) {
            outage = true; outageAt = now(); onOutage();
            offlineTimer = schedule(() => { if (outage && enabled && !socket.connected) phase('offline'); }, 20000);
        }
    };
    const stop = () => {
        enabled = false; bound = false; outage = false;
        invalidate(); cancel(offlineTimer);
        if (socket.sendBuffer) socket.sendBuffer.length = 0;
    };
    const fail = error => {
        stop(); stoppedPhase = 'failed'; phase('failed'); onFailure(error);
    };
    const restore = snapshot => {
        clearRetry(); restoring = ++generation;
        phase('resyncing'); onSnapshot(snapshot, restoring);
    };
    const acceptJoin = response => {
        enabled = true; stoppedPhase = 'offline'; bound = true; pending = null;
        onJoin(response);
        restore(response.snapshot);
    };
    const recover = (join = !bound) => {
        const session = getSession();
        if (!enabled || !session || pending || isEntryPending()) return;
        if (!socket.connected) {
            startOutage(); phase('reconnecting');
            if (!socket.active) socket.connect();
            return;
        }
        const token = ++generation;
        pending = { token, join };
        restoring = null; phase('resyncing');
        socket.timeout(10000).emit(join ? 'room:join' : 'room:snapshot', join ? { ...session, protocolVersion: PROTOCOL_VERSION } : {}, (error, response) => {
            if (!enabled || generation !== token || !socket.connected || getSession()?.resumeToken !== session.resumeToken) return;
            pending = null;
            if (!error && response?.ok) {
                if (join) acceptJoin(response);
                else restore(response.snapshot);
            } else if (response?.error?.code === 'NOT_IN_ROOM') {
                bound = false; recover(true);
            } else if (terminalRoomError(response?.error)) fail(response.error);
            else {
                startOutage(); phase('offline');
                clearRetry(); retryTimer = schedule(() => recover(join), 5000);
            }
        });
    };
    const connected = () => {
        bound = false;
        if (!enabled) { phase(stoppedPhase); return; }
        if (getSession() && !isEntryPending()) recover(true); else phase('connected');
    };
    const disconnected = reason => {
        invalidate(); bound = false;
        if (socket.sendBuffer) socket.sendBuffer.length = 0;
        if (!enabled || !getSession()) { phase(stoppedPhase); return; }
        startOutage(); phase('reconnecting');
        // A server-initiated transport closure is not retried by the Manager.
        if (reason === 'io server disconnect') retryTimer = schedule(() => recover(true), 5000);
    };
    const attempting = () => { if (enabled && getSession()) phase(outage && now() - outageAt < 20000 ? 'reconnecting' : 'offline'); };
    const connectionError = () => { if (enabled && getSession()) { startOutage(); attempting(); } };
    socket.on('connect', connected); socket.on('disconnect', disconnected); socket.on('connect_error', connectionError);
    socket.io.on('reconnect_attempt', attempting);
    return {
        acceptJoin, stop, fail,
        isJoining: () => Boolean(pending?.join),
        acceptsEvents: () => enabled && bound && socket.connected && !pending,
        complete(id) {
            if (!enabled || id !== restoring || !socket.connected || pending) return false;
            restoring = null; cancel(offlineTimer); phase('connected');
            if (outage) { outage = false; onRestored(); }
            return true;
        },
        failResync(id) {
            if (!enabled || id !== restoring || !socket.connected || pending) return false;
            restoring = null; phase('failed'); return true;
        },
        resume() { enabled = true; if (getSession()) recover(true); },
        wake(force = false) {
            if (!enabled || !getSession() || (!force && now() - lastWake < 5000)) return;
            lastWake = now(); recover(!bound);
        },
        dispose() {
            invalidate(); cancel(offlineTimer);
            socket.off('connect', connected); socket.off('disconnect', disconnected); socket.off('connect_error', connectionError);
            socket.io.off('reconnect_attempt', attempting);
        },
    };
}
