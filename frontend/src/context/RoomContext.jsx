/* eslint-disable react-refresh/only-export-components */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react';
import toast from 'react-hot-toast';
import { socket } from '../socket';
import { getNetworkQualityFromPing } from '../utils/networkQuality';
import useServerClock from '../hooks/useServerClock';
import { commandId, PROTOCOL_VERSION, protocolErrorMessage } from '../utils/protocol';

const RoomContext = createContext();
export const useRoom = () => useContext(RoomContext);

const PING_INTERVAL_MS = 7000;
const PING_TIMEOUT_MS = 2500;

const emptyVideoState = () => ({
    sourceType: 'remote',
    url: '',
    magnetURI: '',
    localMedia: null,
    isPlaying: false,
    playedSeconds: 0,
    updatedAt: 0,
    seekVersion: 0,
    stateVersion: 0,
});

const emptyReadiness = {
    mediaSessionId: null,
    readyUserIds: [],
    readyCount: 0,
    totalCount: 0,
    statuses: {},
};

export const RoomProvider = ({ children }) => {
    const [isRestoringSession, setIsRestoringSession] = useState(true);
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [connectionPhase, setConnectionPhase] = useState(socket.connected ? 'connected' : 'offline');
    const [networkPingMs, setNetworkPingMs] = useState(null);
    const [networkQuality, setNetworkQuality] = useState('offline');
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [roomId, setRoomId] = useState(null);
    const [videoState, setVideoState] = useState(emptyVideoState);
    const [localReadiness, setLocalReadiness] = useState(emptyReadiness);
    const [queue, setQueue] = useState([]);
    const [controllerMemberId, setControllerMemberId] = useState(null);
    const [mediaDescriptor, setMediaDescriptor] = useState(null);
    const [playback, setPlayback] = useState(null);
    const [protocolMismatch, setProtocolMismatch] = useState(false);
    const clock = useServerClock(isConnected);

    const isKicked = useRef(false);
    const restoreTimeoutRef = useRef(null);
    const serverClockOffsetRef = useRef(0);
    const activeMediaIdRef = useRef(null);
    const videoStateRef = useRef(videoState);
    useEffect(() => {
        videoStateRef.current = videoState;
    }, [videoState]);

    const updateClockOffset = useCallback((serverTime, roundTripMs = 0) => {
        if (!Number.isFinite(serverTime)) return;
        const estimatedServerNow = serverTime + Math.max(0, roundTripMs) / 2;
        const sample = estimatedServerNow - Date.now();
        serverClockOffsetRef.current = serverClockOffsetRef.current === 0
            ? sample
            : (serverClockOffsetRef.current * 0.75) + (sample * 0.25);
    }, []);

    const getExpectedPosition = useCallback((state = videoStateRef.current) => {
        const base = Number(state?.playedSeconds) || 0;
        if (!state?.isPlaying || !Number.isFinite(state?.updatedAt)) return base;
        const serverNow = Date.now() + serverClockOffsetRef.current;
        return Math.max(0, base + Math.max(0, serverNow - state.updatedAt) / 1000);
    }, []);

    const measurePing = useCallback(() => {
        if (!socket.connected) {
            setNetworkPingMs(null);
            setNetworkQuality('offline');
            return Promise.resolve(null);
        }
        const startedAt = performance.now();
        setNetworkQuality(previous => previous === 'offline' ? 'checking' : previous);
        return new Promise(resolve => {
            socket.timeout(PING_TIMEOUT_MS).emit('network_ping', { sentAt: Date.now() }, (error, response = {}) => {
                if (error) {
                    setNetworkPingMs(null);
                    setNetworkQuality('poor');
                    resolve(null);
                    return;
                }
                const pingMs = Math.max(1, Math.round(performance.now() - startedAt));
                updateClockOffset(response.serverTime, pingMs);
                setNetworkPingMs(pingMs);
                setNetworkQuality(getNetworkQualityFromPing(pingMs, true));
                resolve({ pingMs, serverTime: response.serverTime });
            });
        });
    }, [updateClockOffset]);

    useEffect(() => {
        if (!isConnected) return undefined;
        const firstPingId = setTimeout(measurePing, 0);
        const intervalId = setInterval(measurePing, PING_INTERVAL_MS);
        return () => {
            clearTimeout(firstPingId);
            clearInterval(intervalId);
        };
    }, [isConnected, measurePing]);

    useEffect(() => {
        const applyReadiness = payload => {
            if (!payload) return;
            const activeSession = activeMediaIdRef.current || videoStateRef.current.localMedia?.sessionId;
            if (payload.mediaSessionId && activeSession && payload.mediaSessionId !== activeSession) return;
            const readinessSession = payload.mediaSessionId || activeSession || null;
            const readyIds = new Set(payload.readyUserIds || []);
            setLocalReadiness({
                mediaSessionId: readinessSession,
                readyUserIds: [...readyIds],
                readyCount: Number(payload.readyCount) || 0,
                totalCount: Number(payload.totalCount) || 0,
                statuses: payload.statuses || {},
            });
            setUsers(previous => previous.map(user => ({
                ...user,
                localReady: readinessSession ? readyIds.has(user.userId) : null,
            })));
            setCurrentUser(previous => previous
                ? { ...previous, localReady: readinessSession ? readyIds.has(previous.userId) : null }
                : previous);
        };

        const applyVideoState = nextState => {
            if (!nextState || typeof nextState !== 'object') return;
            updateClockOffset(nextState.serverTime);
            setVideoState(previous => ({
                ...emptyVideoState(),
                ...previous,
                ...nextState,
                localMedia: nextState.localMedia || null,
            }));
        };

        const addSystemMessage = text => {
            setMessages(previous => [...previous, {
                id: `${Date.now()}-${Math.random()}`,
                nickname: 'System',
                text,
                timestamp: Date.now(),
                isSystem: true,
            }].slice(-200));
        };

        const onConnect = () => { setIsConnected(true); setConnectionPhase('connected'); };
        const onDisconnect = () => {
            setIsConnected(false);
            setConnectionPhase('reconnecting');
            setNetworkPingMs(null);
            setNetworkQuality('offline');
        };
        const onRoomJoined = ({
            roomId: joinedRoomId,
            resumeToken,
            memberId,
            user,
            existingUsers,
            videoState: initialVideoState,
            localReadiness: initialReadiness,
            queue: initialQueue,
            chatHistory, snapshot,
        }) => {
            clearTimeout(restoreTimeoutRef.current);
            if (joinedRoomId && resumeToken) {
                const session = { roomId: joinedRoomId, nickname: user.nickname, resumeToken, memberId };
                sessionStorage.setItem('watchTogetherSession', JSON.stringify(session));
                setRoomId(joinedRoomId);
            }
            setCurrentUser(user);
            setUsers(existingUsers || []);
            if (initialVideoState) applyVideoState(initialVideoState);
            if (initialReadiness) applyReadiness(initialReadiness);
            setQueue(initialQueue || []);
            setMessages(chatHistory || []);
            if (snapshot) {
                setControllerMemberId(snapshot.controllerMemberId);
                setMediaDescriptor(snapshot.media);
                setPlayback(snapshot.playback);
                if (snapshot.media) onMediaDeclared({ media: snapshot.media, playback: snapshot.playback });
                if (snapshot.readiness) applyReadiness({
                    ...snapshot.readiness,
                    mediaSessionId: snapshot.media?.mediaId || null
                });
            }
            setIsRestoringSession(false);
        };
        const onUserJoined = newUser => {
            setUsers(previous => {
                const index = previous.findIndex(user => (
                    user.id === newUser.id || user.userId === newUser.userId
                ));
                if (index >= 0) {
                    const next = [...previous];
                    next[index] = newUser;
                    return next;
                }
                toast(`${newUser.nickname} joined`, { icon: '👋', duration: 2000 });
                return [...previous, newUser];
            });
        };
        const onUserLeft = userId => {
            setUsers(previous => {
                const leaving = previous.find(user => user.id === userId);
                if (leaving) toast(`${leaving.nickname} left`, { icon: '🚪', duration: 2000 });
                return previous.filter(user => user.id !== userId);
            });
        };
        const onReceiveMessage = message => {
            setMessages(previous => (
                previous.some(item => item.id === message.id)
                    ? previous
                    : [...previous, message].slice(-200)
            ));
        };
        const onRoleUpdated = ({ userId, newRole }) => {
            setUsers(previous => previous.map(user => (
                user.id === userId ? { ...user, role: newRole } : user
            )));
            setCurrentUser(previous => (
                previous?.id === userId ? { ...previous, role: newRole } : previous
            ));
        };
        const onUserKicked = () => {
            isKicked.current = true;
            sessionStorage.removeItem('watchTogetherSession');
            toast.error('You have been kicked from the room.', { duration: 4000 });
            setTimeout(() => window.dispatchEvent(new CustomEvent('watchly:kicked')), 300);
        };
        const onVideoChanged = state => {
            activeMediaIdRef.current = null;
            applyVideoState(state);
            setLocalReadiness(emptyReadiness);
            setUsers(previous => previous.map(user => ({ ...user, localReady: null })));
            addSystemMessage('The video has been changed.');
        };
        const onLocalMediaSelected = ({ videoState: state, readiness }) => {
            activeMediaIdRef.current = state.localMedia?.sessionId || null;
            applyVideoState(state);
            applyReadiness(readiness);
            addSystemMessage(`${state.localMedia?.selectedBy || 'The host'} selected ${state.localMedia?.displayName || 'a local file'}.`);
        };
        const onVideoPlayed = state => {
            applyVideoState(state);
            toast('▶ Playing', { duration: 1200 });
        };
        const onVideoPaused = state => {
            applyVideoState(state);
            toast('⏸ Paused', { duration: 1200 });
        };
        const onVideoProgress = state => applyVideoState(state);
        const onVideoSeeked = state => applyVideoState(state);
        const onQueueUpdated = nextQueue => setQueue(nextQueue || []);
        const onVoiceUpdated = ({ userId, isVoiceActive, isMuted }) => {
            setUsers(previous => previous.map(user => (
                user.id === userId ? { ...user, isVoiceActive, isMuted } : user
            )));
            setCurrentUser(previous => (
                previous?.id === userId ? { ...previous, isVoiceActive, isMuted } : previous
            ));
        };
        const onLocalWaiting = readiness => {
            applyReadiness(readiness);
            toast.error(`${readiness.readyCount}/${readiness.totalCount} users are ready.`, { duration: 3000 });
        };
        const onErrorMessage = ({ message }) => toast.error(message || 'Server error', { duration: 4000 });
        const onControlChanged = payload => setControllerMemberId(payload.controllerMemberId);
        const onMediaDeclared = ({ media, playback: nextPlayback }) => {
            activeMediaIdRef.current = media.mediaId;
            setMediaDescriptor(media);
            setPlayback(nextPlayback);
            const fingerprint = media.mediaId.split(':').at(-1);
            applyVideoState({
                sourceType: 'local', url: '', magnetURI: '', isPlaying: false, playedSeconds: 0,
                updatedAt: nextPlayback.effectiveAtServerMs, stateVersion: nextPlayback.seq,
                localMedia: {
                    sessionId: media.mediaId, fingerprint, displayName: media.displayTitle,
                    size: media.sizeBytes, duration: media.durationMs / 1000,
                    mimeType: 'video/*'
                }
            });
        };
        const onPlaybackState = next => {
            setPlayback(previous => (!previous || next.seq > previous.seq) ? next : previous);
            setVideoState(previous => next.seq <= (previous.stateVersion || -1) ? previous : ({
                ...previous,
                isPlaying: next.status === 'playing',
                playedSeconds: next.positionSec,
                updatedAt: next.effectiveAtServerMs,
                stateVersion: next.seq,
                seekVersion: next.commandId && next.status === previous.isPlaying ? (previous.seekVersion || 0) + 1 : previous.seekVersion
            }));
        };
        const onRoomError = error => {
            if (error?.code === 'PROTOCOL_MISMATCH') setProtocolMismatch(true);
            else if (error?.code === 'ROOM_NOT_FOUND' || error?.code === 'MEMBER_BANNED') {
                clearTimeout(restoreTimeoutRef.current);
                sessionStorage.removeItem('watchTogetherSession');
                setCurrentUser(null);
                setIsRestoringSession(false);
                toast.error(error.message);
            } else toast.error(error?.message || 'Room error');
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('room_joined', onRoomJoined);
        socket.on('user_joined', onUserJoined);
        socket.on('user_left', onUserLeft);
        socket.on('receive_message', onReceiveMessage);
        socket.on('role_updated', onRoleUpdated);
        socket.on('user_kicked', onUserKicked);
        socket.on('video_changed', onVideoChanged);
        socket.on('local_media_selected', onLocalMediaSelected);
        socket.on('local_readiness_updated', applyReadiness);
        socket.on('local_media_waiting', onLocalWaiting);
        socket.on('video_played', onVideoPlayed);
        socket.on('video_paused', onVideoPaused);
        socket.on('video_progress', onVideoProgress);
        socket.on('video_seeked', onVideoSeeked);
        socket.on('queue_updated', onQueueUpdated);
        socket.on('voice_updated', onVoiceUpdated);
        socket.on('error_message', onErrorMessage);
        socket.on('control:changed', onControlChanged);
        socket.on('media:declared', onMediaDeclared);
        socket.on('media:readiness', applyReadiness);
        socket.on('playback:state', onPlaybackState);
        socket.on('room:error', onRoomError);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('room_joined', onRoomJoined);
            socket.off('user_joined', onUserJoined);
            socket.off('user_left', onUserLeft);
            socket.off('receive_message', onReceiveMessage);
            socket.off('role_updated', onRoleUpdated);
            socket.off('user_kicked', onUserKicked);
            socket.off('video_changed', onVideoChanged);
            socket.off('local_media_selected', onLocalMediaSelected);
            socket.off('local_readiness_updated', applyReadiness);
            socket.off('local_media_waiting', onLocalWaiting);
            socket.off('video_played', onVideoPlayed);
            socket.off('video_paused', onVideoPaused);
            socket.off('video_progress', onVideoProgress);
            socket.off('video_seeked', onVideoSeeked);
            socket.off('queue_updated', onQueueUpdated);
            socket.off('voice_updated', onVoiceUpdated);
            socket.off('error_message', onErrorMessage);
            socket.off('control:changed', onControlChanged);
            socket.off('media:declared', onMediaDeclared);
            socket.off('media:readiness', applyReadiness);
            socket.off('playback:state', onPlaybackState);
            socket.off('room:error', onRoomError);
        };
    }, [updateClockOffset]);

    useEffect(() => {
        const handleReconnect = () => {
            const saved = sessionStorage.getItem('watchTogetherSession');
            if (!saved) return;
            try {
                const session = JSON.parse(saved);
                if (session.roomId && session.nickname) {
                    socket.emit('room:join', { ...session, protocolVersion: PROTOCOL_VERSION });
                }
            } catch (error) {
                console.error('Failed to restore the room after reconnecting', error);
            }
        };
        socket.io.on('reconnect', handleReconnect);
        return () => socket.io.off('reconnect', handleReconnect);
    }, []);

    useEffect(() => {
        const attempting = attempt => setConnectionPhase(attempt > 1 ? 'starting-server' : 'reconnecting');
        const failed = () => setConnectionPhase('offline');
        socket.io.on('reconnect_attempt', attempting);
        socket.io.on('reconnect_failed', failed);
        return () => { socket.io.off('reconnect_attempt', attempting); socket.io.off('reconnect_failed', failed); };
    }, []);

    useEffect(() => {
        const savedSession = sessionStorage.getItem('watchTogetherSession');
        if (!savedSession) {
            setIsRestoringSession(false);
            return undefined;
        }
        restoreTimeoutRef.current = setTimeout(() => {
            setIsRestoringSession(false);
            sessionStorage.removeItem('watchTogetherSession');
            socket.disconnect();
            setConnectionPhase('offline');
            toast.error('Could not reconnect to the server. Please rejoin.', { duration: 4000 });
        }, 90000);
        if (!socket.connected) socket.connect();
        return () => clearTimeout(restoreTimeoutRef.current);
    }, []);

    useEffect(() => {
        const saved = sessionStorage.getItem('watchTogetherSession');
        if (!saved || !isConnected || currentUser) return;
        try {
            const session = JSON.parse(saved);
            if (session.roomId && session.nickname) {
                setRoomId(session.roomId);
                socket.emit('room:join', { ...session, protocolVersion: PROTOCOL_VERSION });
            }
        } catch {
            clearTimeout(restoreTimeoutRef.current);
            setIsRestoringSession(false);
        }
    }, [isConnected, currentUser]);

    const requestRoom = useCallback((event, payload) => new Promise((resolve, reject) => {
        const send = () => socket.timeout(15000).emit(
            event,
            { ...payload, protocolVersion: PROTOCOL_VERSION },
            (timeoutError, response) => {
                if (timeoutError) return reject(new Error('Starting room server… please try again in a moment.'));
                if (!response?.ok) {
                    const failure = new Error(response?.error?.message || 'Could not enter the room.');
                    failure.code = response?.error?.code;
                    failure.retryable = Boolean(response?.error?.retryable);
                    return reject(failure);
                }
                resolve(response);
            }
        );
        if (socket.connected) send();
        else {
            socket.connect();
            socket.once('connect', send);
        }
    }), []);

    const joinRoom = useCallback(async (id, nickname) => {
        let resume = {};
        try {
            const saved = JSON.parse(sessionStorage.getItem('watchTogetherSession') || '{}');
            if (saved.roomId === id) resume = { resumeToken: saved.resumeToken };
        } catch { /* start a new membership */ }
        return requestRoom('room:join', { roomId: id, nickname, ...resume });
    }, [requestRoom]);

    const createRoom = useCallback(nickname => requestRoom('room:create', { nickname }), [requestRoom]);

    const leaveRoom = useCallback(() => {
        if (!isKicked.current) socket.emit('leave_room', { roomId });
        sessionStorage.removeItem('watchTogetherSession');
        socket.disconnect();
        setRoomId(null);
        setCurrentUser(null);
        setUsers([]);
        setMessages([]);
        setQueue([]);
        setVideoState(emptyVideoState());
        setLocalReadiness(emptyReadiness);
        activeMediaIdRef.current = null;
        isKicked.current = false;
    }, [roomId]);

    const sendMessage = useCallback(text => {
        if (!text.trim() || !currentUser || !roomId) return;
        const message = {
            id: `${Date.now()}-${Math.random()}`,
            text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        socket.emit('send_message', { roomId, message });
    }, [roomId, currentUser]);

    const emitControl = useCallback((eventName, payload = {}) => {
        const state = videoStateRef.current;
        socket.emit(eventName, {
            roomId,
            mediaSessionId: state.localMedia?.sessionId || null,
            stateVersion: state.stateVersion || 0,
            ...payload,
        });
    }, [roomId]);

    const loadVideo = useCallback((url, magnetURI = '') => {
        if (!url && !magnetURI) return;
        socket.emit('change_video', { roomId, url: url || '', magnetURI: magnetURI || '' });
    }, [roomId]);

    const selectLocalMedia = useCallback(localMedia => new Promise((resolve, reject) => {
        const mediaId = `sampled-sha256-v1:${localMedia.size}:${localMedia.fingerprint}`;
        const descriptor = {
            sourceType: 'local-file', mediaId, fingerprintVersion: 'sampled-sha256-v1',
            displayTitle: localMedia.displayName, sizeBytes: localMedia.size,
            durationMs: Math.round(localMedia.duration * 1000)
        };
        socket.timeout(10000).emit('media:declare', { descriptor }, (error, response) => {
            if (error || !response?.ok) {
                reject(new Error(protocolErrorMessage(response) || 'The local file selection timed out.'));
                return;
            }
            resolve(response.snapshot);
        });
    }), []);

    const markLocalMediaReady = useCallback(({ mediaSessionId, fingerprint, size, duration }) => {
        socket.emit('media:ready', {
            mediaId: mediaSessionId, status: 'READY',
            fingerprint, size, duration
        });
    }, []);

    const markLocalMediaNotReady = useCallback(mediaSessionId => {
        socket.emit('media:ready', { mediaId: mediaSessionId, status: 'MISMATCH', reason: 'Different file' });
    }, []);
    const markLocalMediaStatus = useCallback((mediaId, status, reason) => {
        socket.emit('media:ready', { mediaId, status, reason });
    }, []);

    const playVideo = useCallback((options = {}) => {
        socket.emit('playback:command', {
            commandId: commandId(), mediaId: mediaDescriptor?.mediaId,
            action: 'PLAY', startAnyway: options.startAnyway === true
        });
    }, [mediaDescriptor]);

    const pauseVideo = useCallback(playedSeconds => {
        socket.emit('playback:command', {
            commandId: commandId(), mediaId: mediaDescriptor?.mediaId,
            action: 'PAUSE', positionSec: Number.isFinite(playedSeconds) ? playedSeconds : undefined
        });
    }, [mediaDescriptor]);

    const syncProgress = useCallback(playedSeconds => {
        if (!Number.isFinite(playedSeconds)) return;
        emitControl('sync_progress', { playedSeconds });
    }, [emitControl]);

    const seekVideo = useCallback(playedSeconds => {
        if (!Number.isFinite(playedSeconds)) return;
        socket.emit('playback:command', {
            commandId: commandId(), mediaId: mediaDescriptor?.mediaId,
            action: 'SEEK', positionSec: playedSeconds
        });
    }, [mediaDescriptor]);
    const endVideo = useCallback(() => socket.emit('playback:command', {
        commandId: commandId(), mediaId: mediaDescriptor?.mediaId, action: 'ENDED'
    }), [mediaDescriptor]);
    const requestControl = useCallback(() => socket.emit('control:request', {}, response => {
        if (!response?.ok) toast.error(protocolErrorMessage(response));
    }), []);
    const sendPlaybackTelemetry = useCallback(telemetry => {
        if (!mediaDescriptor?.mediaId) return;
        socket.emit('playback:telemetry', { mediaId: mediaDescriptor.mediaId, ...telemetry });
    }, [mediaDescriptor]);

    const promoteUser = useCallback(targetId => socket.emit('promote_to_moderator', { roomId, targetId }), [roomId]);
    const demoteUser = useCallback(targetId => socket.emit('demote_to_viewer', { roomId, targetId }), [roomId]);
    const transferHost = useCallback(targetId => socket.emit('transfer_host', { roomId, targetId }), [roomId]);
    const kickUser = useCallback(targetId => socket.emit('kick_user', { roomId, targetId }), [roomId]);
    const addToQueue = useCallback((url, magnetURI = '', label = '') => {
        if (url || magnetURI) socket.emit('add_to_queue', { roomId, url, magnetURI, label: label || url });
    }, [roomId]);
    const removeFromQueue = useCallback(itemId => socket.emit('remove_from_queue', { roomId, itemId }), [roomId]);
    const playNext = useCallback(() => socket.emit('play_next', { roomId }), [roomId]);

    return (
        <RoomContext.Provider value={{
            isRestoringSession,
            isConnected,
            connectionPhase,
            networkPingMs,
            networkQuality,
            currentUser,
            users,
            messages,
            roomId,
            videoState,
            localReadiness,
            queue,
            controllerMemberId,
            mediaDescriptor,
            playback,
            clock,
            protocolMismatch,
            joinRoom,
            createRoom,
            leaveRoom,
            sendMessage,
            promoteUser,
            demoteUser,
            transferHost,
            kickUser,
            loadVideo,
            selectLocalMedia,
            markLocalMediaReady,
            markLocalMediaNotReady,
            markLocalMediaStatus,
            playVideo,
            pauseVideo,
            seekVideo,
            endVideo,
            requestControl,
            sendPlaybackTelemetry,
            addToQueue,
            removeFromQueue,
            playNext,
            syncProgress,
            measurePing,
            getExpectedPosition,
        }}>
            {children}
        </RoomContext.Provider>
    );
};
