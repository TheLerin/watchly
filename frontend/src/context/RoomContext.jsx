/* eslint-disable react-refresh/only-export-components */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useMemo,
    useState,
} from 'react';
import toast from 'react-hot-toast';
import { socket } from '../socket';
import { getNetworkQualityFromPing } from '../utils/networkQuality';
import useServerClock from '../hooks/useServerClock';
import { commandId, PROTOCOL_VERSION, protocolErrorMessage } from '../utils/protocol';
import { playbackCommand } from '../utils/playbackCommands';
import { createRoomRequester } from '../utils/roomRequest';
import { createRoomRecovery, readRoomSession, terminalRoomError } from '../utils/roomRecovery';
import { acceptsVideoState, mergeChatHistory } from '../utils/roomState';
import { useLocation } from 'react-router-dom';
import { actionPermission, getRoomPermissions } from '../utils/roomPermissions';

const RoomContext = createContext();
export const useRoom = () => useContext(RoomContext);

const PING_INTERVAL_MS = 7000;
const PING_TIMEOUT_MS = 2500;

const emptyVideoState = () => ({
    sourceType: 'remote',
    sourceId: null,
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
    const location = useLocation();
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
    const [resyncRequest, setResyncRequest] = useState(null);
    const [connectionError, setConnectionError] = useState('');
    const clock = useServerClock(isConnected);
    const roomRequester = useMemo(() => createRoomRequester(socket), []);
    useEffect(() => () => roomRequester.cancel(), [roomRequester]);

    const isKicked = useRef(false);
    const serverClockOffsetRef = useRef(0);
    const activeMediaIdRef = useRef(null);
    const videoStateRef = useRef(videoState);
    const currentUserRef = useRef(currentUser);
    currentUserRef.current = currentUser;
    const pendingPlayRef = useRef(new Map());
    const sessionRef = useRef(null);
    const recoveryRef = useRef(null);
    const connectionPhaseRef = useRef(connectionPhase);
    const routeRef = useRef(location.pathname);
    useEffect(() => {
        videoStateRef.current = videoState;
    }, [videoState]);

    const resetRoom = useCallback(() => {
        setIsRestoringSession(false);
        setRoomId(null);
        setCurrentUser(null);
        currentUserRef.current = null;
        setUsers([]);
        setMessages([]);
        setQueue([]);
        videoStateRef.current = emptyVideoState();
        setVideoState(videoStateRef.current);
        setLocalReadiness(emptyReadiness);
        setMediaDescriptor(null);
        setPlayback(null);
        setControllerMemberId(null);
        activeMediaIdRef.current = null;
        pendingPlayRef.current.clear();
        setResyncRequest(null);
    }, []);

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
        // Membership notifications are socket side effects. Keep them outside
        // state updaters, which React can replay while rendering the provider.
        const knownMembers = new Map();
        const permissionsDuringSync = new Map();
        const applyReadiness = payload => {
            if (!payload) return;
            if (Number.isInteger(payload.sourceEpoch) && payload.sourceEpoch < (videoStateRef.current.sourceEpoch || 0)) return;
            const playlist = videoStateRef.current;
            if (playlist.sourceType === 'youtube-playlist' && (payload.mediaSessionId !== playlist.sourceId || payload.sourceRevision !== playlist.sourceRevision)) return;
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
            setUsers(previous => {
                let changed = false;
                const next = previous.map(user => {
                    const localReady = readinessSession ? readyIds.has(user.userId) : null;
                    if (user.localReady === localReady) return user;
                    changed = true;
                    return { ...user, localReady };
                });
                return changed ? next : previous;
            });
            setCurrentUser(previous => {
                if (!previous) return previous;
                const localReady = readinessSession ? readyIds.has(previous.userId) : null;
                return previous.localReady === localReady ? previous : { ...previous, localReady };
            });
        };

        const applyVideoState = nextState => {
            if (!acceptsVideoState(videoStateRef.current, nextState)) return false;
            updateClockOffset(nextState.serverTime);
            const sameSource = nextState.sourceId === videoStateRef.current.sourceId && nextState.sourceType === videoStateRef.current.sourceType;
            videoStateRef.current = { ...emptyVideoState(), ...(sameSource ? videoStateRef.current : {}), ...nextState, localMedia: nextState.localMedia || null };
            setVideoState(videoStateRef.current);
            return true;
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

        const saveJoin = ({ roomId: joinedRoomId, resumeToken, memberId, user }) => {
            setConnectionError('');
            isKicked.current = false;
            if (joinedRoomId && resumeToken) {
                const session = { roomId: joinedRoomId, nickname: user.nickname, resumeToken, memberId };
                sessionRef.current = session;
                try { sessionStorage.setItem('watchTogetherSession', JSON.stringify(session)); } catch { /* retained in memory */ }
                setRoomId(joinedRoomId);
            }
            setCurrentUser(user);
            currentUserRef.current = user;
        };
        const applySnapshot = (snapshot, id) => {
            if (!snapshot) return;
            const initialVideoState = snapshot.videoState;
            // Role events can arrive after the snapshot was generated but before
            // its ACK/player restoration. Preserve those newer capabilities.
            const members = (snapshot.members || []).map(member => ({
                ...member, ...permissionsDuringSync.get(member.userId || member.id),
            }));
            permissionsDuringSync.clear();
            activeMediaIdRef.current = snapshot.media?.mediaId || initialVideoState?.localMedia?.sessionId || null;
            knownMembers.clear();
            for (const member of members) knownMembers.set(member.userId || member.id, member);
            setUsers(members);
            currentUserRef.current = members.find(member => member.userId === sessionRef.current?.memberId) || null;
            setCurrentUser(currentUserRef.current);
            setQueue(snapshot.queue || []);
            setMessages(previous => mergeChatHistory(previous, snapshot.chatHistory));
            setControllerMemberId(snapshot.controllerMemberId);
            setMediaDescriptor(snapshot.media);
            setPlayback(snapshot.media ? snapshot.playback : null);
            updateClockOffset(snapshot.serverTimeMs);
            if (snapshot.media) onMediaDeclared({ media: snapshot.media, playback: snapshot.playback, sourceEpoch: initialVideoState?.sourceEpoch });
            else if (initialVideoState) applyVideoState(initialVideoState);
            if (snapshot.readiness) applyReadiness(snapshot.readiness);
            setResyncRequest({ id });
            setIsRestoringSession(false);
        };
        const onRoomJoined = response => {
            if (!recoveryRef.current?.isJoining()) recoveryRef.current?.acceptJoin(response);
        };
        const onUserJoined = newUser => {
            const memberKey = newUser.userId || newUser.id;
            const alreadyKnown = knownMembers.has(memberKey);
            knownMembers.set(memberKey, newUser);
            setUsers(previous => {
                const index = previous.findIndex(user => (
                    user.id === newUser.id || user.userId === newUser.userId
                ));
                if (index >= 0) {
                    const next = [...previous];
                    next[index] = newUser;
                    return next;
                }
                return [...previous, newUser];
            });
            if (!alreadyKnown) toast(`${newUser.nickname} joined`, { icon: '👋', duration: 2000 });
        };
        const onUserLeft = userId => {
            const leaving = [...knownMembers.values()].find(user => user.id === userId);
            if (leaving) knownMembers.delete(leaving.userId || leaving.id);
            setUsers(previous => previous.filter(user => user.id !== userId));
            if (leaving) toast(`${leaving.nickname} left`, { icon: '🚪', duration: 2000 });
        };
        const onReceiveMessage = message => {
            setMessages(previous => (
                previous.some(item => item.id === message.id)
                    ? previous
                    : [...previous, message].slice(-200)
            ));
        };
        const onRoleUpdated = ({ userId, newRole, member }) => {
            if (connectionPhaseRef.current === 'resyncing' && member) {
                permissionsDuringSync.set(member.userId || member.id, { role: newRole, permissions: member.permissions });
            }
            setUsers(previous => previous.map(user => (
                user.id === userId ? { ...user, ...member, role: newRole } : user
            )));
            if (currentUserRef.current?.id === userId) {
                currentUserRef.current = { ...currentUserRef.current, ...member, role: newRole };
                setCurrentUser(currentUserRef.current);
            }
        };
        const onUserKicked = () => {
            isKicked.current = true;
            recoveryRef.current?.stop(); sessionRef.current = null;
            sessionStorage.removeItem('watchTogetherSession');
            socket.disconnect();
            resetRoom();
            toast.error('You have been kicked from the room.', { duration: 4000 });
            setTimeout(() => window.dispatchEvent(new CustomEvent('watchly:kicked')), 300);
        };
        const onVideoChanged = state => {
            if (!recoveryRef.current?.acceptsEvents() || !applyVideoState(state)) return;
            activeMediaIdRef.current = null;
            setMediaDescriptor(null);
            setPlayback(null);
            setLocalReadiness(emptyReadiness);
            setUsers(previous => previous.map(user => ({ ...user, localReady: null })));
            addSystemMessage('The video has been changed.');
        };
        const onLocalMediaSelected = ({ videoState: state, readiness }) => {
            if (!recoveryRef.current?.acceptsEvents() || !applyVideoState(state)) return;
            activeMediaIdRef.current = state.localMedia?.sessionId || null;
            applyReadiness(readiness);
            addSystemMessage(`${state.localMedia?.selectedBy || 'The host'} selected ${state.localMedia?.displayName || 'a local file'}.`);
        };
        const onVideoPlayed = state => {
            if (!recoveryRef.current?.acceptsEvents() || !applyVideoState(state)) return;
            toast('▶ Playing', { duration: 1200 });
        };
        const onVideoPaused = state => {
            if (!recoveryRef.current?.acceptsEvents() || !applyVideoState(state)) return;
            toast('⏸ Paused', { duration: 1200 });
        };
        const onVideoProgress = state => recoveryRef.current?.acceptsEvents() && applyVideoState(state);
        const onVideoSeeked = state => recoveryRef.current?.acceptsEvents() && applyVideoState(state);
        const onQueueUpdated = nextQueue => setQueue(nextQueue || []);
        const onPlaylistNotice = payload => toast(payload.message, { duration: 2500 });
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
        const onControlChanged = payload => {
            setControllerMemberId(payload.controllerMemberId);
            if (payload.members) {
                if (connectionPhaseRef.current === 'resyncing') {
                    for (const member of payload.members) permissionsDuringSync.set(member.userId || member.id, {
                        role: member.role, permissions: member.permissions,
                    });
                }
                setUsers(payload.members);
                knownMembers.clear();
                for (const member of payload.members) knownMembers.set(member.userId, member);
                const member = payload.members.find(item => item.userId === sessionRef.current?.memberId);
                if (member) { currentUserRef.current = member; setCurrentUser(member); }
            }
        };
        const onMediaDeclared = ({ media, playback: nextPlayback, sourceEpoch = nextPlayback?.sourceEpoch }) => {
            if (Number.isInteger(sourceEpoch) && sourceEpoch < (videoStateRef.current.sourceEpoch || 0)) return;
            activeMediaIdRef.current = media.mediaId;
            setMediaDescriptor(media);
            setPlayback(nextPlayback);
            const fingerprint = media.mediaId.split(':').at(-1);
            applyVideoState({
                sourceType: 'local', sourceId: null, sourceEpoch, url: '', magnetURI: '', isPlaying: nextPlayback.status === 'playing', playedSeconds: nextPlayback.positionSec,
                updatedAt: nextPlayback.effectiveAtServerMs, stateVersion: nextPlayback.seq, seekVersion: 0,
                localMedia: {
                    sessionId: media.mediaId, declarationId: media.declaredAtServerMs || sourceEpoch || nextPlayback.effectiveAtServerMs, fingerprint, displayName: media.displayTitle,
                    size: media.sizeBytes, duration: media.durationMs / 1000,
                    mimeType: 'video/*'
                }
            });
        };
        const onPlaybackState = next => {
            if (!recoveryRef.current?.acceptsEvents() || (next.mediaId && next.mediaId !== activeMediaIdRef.current) ||
                (Number.isInteger(next.sourceEpoch) && next.sourceEpoch < (videoStateRef.current.sourceEpoch || 0))) return;
            setPlayback(previous => (!previous || next.seq > previous.seq) ? next : previous);
            setVideoState(previous => next.seq <= (previous.stateVersion ?? -1) ? previous : ({
                ...previous,
                isPlaying: next.status === 'playing',
                playedSeconds: next.positionSec,
                updatedAt: next.effectiveAtServerMs,
                stateVersion: next.seq,
                seekVersion: next.action === 'SEEK' ? (previous.seekVersion || 0) + 1 : previous.seekVersion
            }));
        };
        const onRoomError = error => {
            if (terminalRoomError(error) && sessionRef.current) recoveryRef.current?.fail(error);
            else if (error?.code === 'PROTOCOL_MISMATCH') setProtocolMismatch(true);
            else toast.error(error?.message || 'Room error');
        };

        const recovery = createRoomRecovery({
            socket, getSession: () => sessionRef.current, isEntryPending: roomRequester.isPending,
            onJoin: saveJoin, onSnapshot: applySnapshot,
            onPhase: (phase, connected) => {
                if (phase === 'resyncing' && connectionPhaseRef.current !== 'resyncing') permissionsDuringSync.clear();
                connectionPhaseRef.current = phase;
                setConnectionPhase(phase); setIsConnected(connected);
                if (!connected) { setNetworkPingMs(null); setNetworkQuality('offline'); setResyncRequest(null); }
            },
            onOutage: () => toast('Connection lost — reconnecting…', { id: 'watchly-connection', duration: 3000 }),
            onRestored: () => toast.success('Back in sync', { id: 'watchly-connection', duration: 2000 }),
            onFailure: error => {
                sessionRef.current = null;
                sessionStorage.removeItem('watchTogetherSession');
                socket.disconnect(); resetRoom();
                setConnectionError(error.message || 'This room session is no longer available.');
                if (error.code === 'PROTOCOL_MISMATCH') setProtocolMismatch(true);
                toast.error(error.message, { id: 'watchly-connection', duration: 4000 });
            },
        });
        recoveryRef.current = recovery;
        const wake = () => { if (document.visibilityState === 'visible') recovery.wake(); };
        const online = () => recovery.wake(true);
        const offline = () => { if (!socket.connected && sessionRef.current) { connectionPhaseRef.current = 'offline'; setConnectionPhase('offline'); } };
        document.addEventListener('visibilitychange', wake);
        window.addEventListener('focus', wake); window.addEventListener('online', online); window.addEventListener('offline', offline);
        socket.on('room_joined', onRoomJoined);
        socket.on('user_joined', onUserJoined);
        socket.on('user_left', onUserLeft);
        socket.on('receive_message', onReceiveMessage);
        socket.on('role_updated', onRoleUpdated);
        socket.on('user_kicked', onUserKicked);
        socket.on('video_changed', onVideoChanged);
        socket.on('local_media_selected', onLocalMediaSelected);
        socket.on('local_media_waiting', onLocalWaiting);
        socket.on('video_played', onVideoPlayed);
        socket.on('video_paused', onVideoPaused);
        socket.on('video_progress', onVideoProgress);
        socket.on('video_seeked', onVideoSeeked);
        socket.on('queue_updated', onQueueUpdated);
        socket.on('playlist_notice', onPlaylistNotice);
        socket.on('voice_updated', onVoiceUpdated);
        socket.on('error_message', onErrorMessage);
        socket.on('control:changed', onControlChanged);
        socket.on('media:declared', onMediaDeclared);
        socket.on('media:readiness', applyReadiness);
        socket.on('playback:state', onPlaybackState);
        socket.on('room:error', onRoomError);

        return () => {
            recovery.dispose(); recoveryRef.current = null;
            document.removeEventListener('visibilitychange', wake);
            window.removeEventListener('focus', wake); window.removeEventListener('online', online); window.removeEventListener('offline', offline);
            socket.off('room_joined', onRoomJoined);
            socket.off('user_joined', onUserJoined);
            socket.off('user_left', onUserLeft);
            socket.off('receive_message', onReceiveMessage);
            socket.off('role_updated', onRoleUpdated);
            socket.off('user_kicked', onUserKicked);
            socket.off('video_changed', onVideoChanged);
            socket.off('local_media_selected', onLocalMediaSelected);
            socket.off('local_media_waiting', onLocalWaiting);
            socket.off('video_played', onVideoPlayed);
            socket.off('video_paused', onVideoPaused);
            socket.off('video_progress', onVideoProgress);
            socket.off('video_seeked', onVideoSeeked);
            socket.off('queue_updated', onQueueUpdated);
            socket.off('playlist_notice', onPlaylistNotice);
            socket.off('voice_updated', onVoiceUpdated);
            socket.off('error_message', onErrorMessage);
            socket.off('control:changed', onControlChanged);
            socket.off('media:declared', onMediaDeclared);
            socket.off('media:readiness', applyReadiness);
            socket.off('playback:state', onPlaybackState);
            socket.off('room:error', onRoomError);
        };
    }, [resetRoom, updateClockOffset, roomRequester]);

    useEffect(() => {
        const session = readRoomSession(sessionStorage);
        if (!session || window.location.pathname !== `/room/${session.roomId}`) {
            sessionStorage.removeItem('watchTogetherSession');
            setIsRestoringSession(false);
            return undefined;
        }
        sessionRef.current = session;
        recoveryRef.current?.resume();
    }, []);

    const requestRoom = useCallback((event, payload) => roomRequester.request(event, {
        ...payload, protocolVersion: PROTOCOL_VERSION,
    }), [roomRequester]);

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
        recoveryRef.current?.stop(); sessionRef.current = null;
        roomRequester.cancel();
        if (!isKicked.current && socket.connected) socket.emit('leave_room', { roomId });
        sessionStorage.removeItem('watchTogetherSession');
        socket.disconnect();
        resetRoom();
        setProtocolMismatch(false);
        isKicked.current = false;
    }, [resetRoom, roomId, roomRequester]);

    useEffect(() => {
        const previous = routeRef.current;
        routeRef.current = location.pathname;
        if (previous.startsWith('/room/') && previous !== location.pathname && sessionRef.current) leaveRoom();
    }, [location.pathname, leaveRoom]);

    const completeResync = useCallback(id => {
        if (recoveryRef.current?.complete(id)) setResyncRequest(null);
    }, []);
    const failResync = useCallback(id => {
        if (recoveryRef.current?.failResync(id)) setResyncRequest(null);
    }, []);
    const retryConnection = useCallback(() => recoveryRef.current?.wake(true), []);
    const canSendRoomAction = useCallback(() => socket.connected && connectionPhaseRef.current === 'connected', []);
    const canPerformRoomAction = useCallback(permission => canSendRoomAction() && getRoomPermissions(currentUserRef.current)[permission], [canSendRoomAction]);
    const emitRoomAction = useCallback((event, payload) => {
        if (!canSendRoomAction()) { toast('Room actions are unavailable while reconnecting or resyncing.', { id: 'watchly-offline-action' }); return false; }
        if (actionPermission[event] && !canPerformRoomAction(actionPermission[event])) { toast('Only the Host and Moderators can perform this room action.', { id: 'watchly-permission' }); return false; }
        socket.emit(event, payload);
        return true;
    }, [canSendRoomAction, canPerformRoomAction]);

    const sendMessage = useCallback(text => {
        if (!text.trim() || !currentUser || !roomId) return;
        const message = {
            id: `${Date.now()}-${Math.random()}`,
            text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        emitRoomAction('send_message', { roomId, message });
    }, [roomId, currentUser, emitRoomAction]);

    const emitControl = useCallback((eventName, payload = {}) => {
        if (!canSendRoomAction()) return false;
        if (actionPermission[eventName] && !canPerformRoomAction(actionPermission[eventName])) return false;
        const state = videoStateRef.current;
        socket.emit(eventName, {
            roomId,
            mediaSessionId: state.localMedia?.sessionId || null,
            stateVersion: state.stateVersion || 0,
            sourceId: state.sourceId, sourceEpoch: state.sourceEpoch,
            ...(state.sourceType === 'youtube-playlist' ? {
                sourceId: state.sourceId, sourceRevision: state.sourceRevision,
                playlistId: state.playlistId, playlistIndex: state.playlistIndex,
                currentVideoId: state.currentVideoId,
            } : {}),
            ...payload,
        });
        return true;
    }, [roomId, canSendRoomAction, canPerformRoomAction]);

    const loadVideo = useCallback((url, magnetURI = '') => {
        if (!url && !magnetURI) return;
        return emitRoomAction('change_video', { roomId, url: url || '', magnetURI: magnetURI || '' });
    }, [roomId, emitRoomAction]);

    const selectLocalMedia = useCallback(async (localMedia, beforeDeclare) => {
        const session = sessionRef.current;
        const ready = canSendRoomAction() || await recoveryRef.current?.waitUntilSynced();
        const currentSession = sessionRef.current;
        if (!ready || !canSendRoomAction() || !session || currentSession?.roomId !== session.roomId ||
            currentSession?.memberId !== session.memberId || currentSession?.resumeToken !== session.resumeToken) {
            throw new Error('Wait for the room to reconnect before selecting a new source.');
        }
        if (!canPerformRoomAction('canChangeSource')) throw new Error('Only the Host and Moderators can choose the shared source.');
        const mediaId = `sampled-sha256-v1:${localMedia.size}:${localMedia.fingerprint}`;
        const descriptor = {
            sourceType: 'local-file', mediaId, fingerprintVersion: 'sampled-sha256-v1',
            displayTitle: localMedia.displayName, sizeBytes: localMedia.size,
            durationMs: Math.round(localMedia.duration * 1000)
        };
        return new Promise((resolve, reject) => {
            beforeDeclare?.();
            socket.timeout(10000).emit('media:declare', { descriptor }, (error, response) => {
                if (error || !response?.ok) {
                    reject(new Error(protocolErrorMessage(response) || 'The local file selection timed out.'));
                    return;
                }
                resolve(response.snapshot);
            });
        });
    }, [canSendRoomAction, canPerformRoomAction]);

    const markLocalMediaReady = useCallback(({ mediaSessionId, fingerprint, size, duration }) => {
        if (!recoveryRef.current?.acceptsEvents()) return;
        socket.emit('media:ready', {
            mediaId: mediaSessionId, status: 'READY',
            fingerprint, size, duration
        });
    }, []);

    const markLocalMediaNotReady = useCallback(mediaSessionId => {
        if (!recoveryRef.current?.acceptsEvents()) return;
        socket.emit('media:ready', { mediaId: mediaSessionId, status: 'MISMATCH', reason: 'Different file' });
    }, []);
    const markLocalMediaStatus = useCallback((mediaId, status, reason) => {
        if (!recoveryRef.current?.acceptsEvents()) return;
        const media = videoStateRef.current.localMedia;
        const proof = status === 'READY' && media?.sessionId === mediaId
            ? { fingerprint: media.fingerprint, size: media.size, duration: media.duration }
            : {};
        socket.emit('media:ready', { mediaId, status, reason, ...proof });
    }, []);

    const sendPlaybackCommand = useCallback((action, options = {}) => {
        if (!canSendRoomAction()) return Promise.resolve(false);
        if (!canPerformRoomAction(action === 'SEEK' ? 'canSeek' : action === 'ENDED' ? 'isPlaybackCoordinator' : 'canControlPlayback')) return Promise.resolve(false);
        const { event, payload } = playbackCommand(videoStateRef.current, action, options);
        if (event !== 'playback:command') {
            emitControl(event, payload);
            return Promise.resolve(true);
        }
        const playKey = action === 'PLAY' ? `${payload.mediaId}:${options.startAnyway === true}` : null;
        if (playKey && pendingPlayRef.current.has(playKey)) return pendingPlayRef.current.get(playKey);
        const request = new Promise(resolve => {
            socket.timeout(10000).emit(event, { ...payload, commandId: options.commandId || commandId() }, (error, response) => {
                if (error || !response?.ok) toast.error(error ? 'Playback request timed out. Please try again.' : protocolErrorMessage(response));
                resolve(!error && Boolean(response?.ok));
            });
        });
        if (playKey) {
            pendingPlayRef.current.set(playKey, request);
            void request.finally(() => {
                if (pendingPlayRef.current.get(playKey) === request) pendingPlayRef.current.delete(playKey);
            });
        }
        return request;
    }, [emitControl, canSendRoomAction, canPerformRoomAction]);
    const playVideo = useCallback((options = {}) => sendPlaybackCommand('PLAY', options), [sendPlaybackCommand]);
    const pauseVideo = useCallback(positionSec => sendPlaybackCommand('PAUSE', { positionSec }), [sendPlaybackCommand]);

    const syncProgress = useCallback(playedSeconds => {
        if (!Number.isFinite(playedSeconds)) return;
        emitControl('sync_progress', { playedSeconds });
    }, [emitControl]);

    const seekVideo = useCallback((playedSeconds, options = {}) => {
        if (!Number.isFinite(playedSeconds)) return;
        return sendPlaybackCommand('SEEK', { ...options, positionSec: playedSeconds });
    }, [sendPlaybackCommand]);
    const endVideo = useCallback(positionSec => sendPlaybackCommand('ENDED', { positionSec }), [sendPlaybackCommand]);
    const requestControl = useCallback(() => {
        if (!canPerformRoomAction('canRequestControl')) return;
        socket.emit('control:request', {}, response => {
        if (!response?.ok) toast.error(protocolErrorMessage(response));
        });
    }, [canPerformRoomAction]);
    const sendPlaybackTelemetry = useCallback(telemetry => {
        if (!mediaDescriptor?.mediaId) return;
        if (!canSendRoomAction()) return;
        socket.emit('playback:telemetry', { mediaId: mediaDescriptor.mediaId, ...telemetry });
    }, [mediaDescriptor, canSendRoomAction]);

    const promoteUser = useCallback(targetId => emitRoomAction('promote_to_moderator', { roomId, targetId }), [roomId, emitRoomAction]);
    const demoteUser = useCallback(targetId => emitRoomAction('demote_to_viewer', { roomId, targetId }), [roomId, emitRoomAction]);
    const transferHost = useCallback(targetId => emitRoomAction('transfer_host', { roomId, targetId }), [roomId, emitRoomAction]);
    const kickUser = useCallback(targetId => emitRoomAction('kick_user', { roomId, targetId }), [roomId, emitRoomAction]);
    const addToQueue = useCallback((url, magnetURI = '', label = '') => {
        if (url || magnetURI) return emitRoomAction('add_to_queue', { roomId, url, magnetURI, label: label || url });
    }, [roomId, emitRoomAction]);
    const removeFromQueue = useCallback(itemId => emitRoomAction('remove_from_queue', { roomId, itemId }), [roomId, emitRoomAction]);
    const reorderQueue = useCallback((itemId, direction) => emitRoomAction('reorder_queue', { roomId, itemId, direction }), [roomId, emitRoomAction]);
    const playNext = useCallback(() => emitRoomAction('play_next', { roomId }), [roomId, emitRoomAction]);

    const updatePlaylist = useCallback((action, options = {}, expectedState) => new Promise(resolve => {
        const state = expectedState || videoStateRef.current;
        if (!socket.connected || state.sourceType !== 'youtube-playlist') return resolve(false);
        if (!canSendRoomAction() && !['READY', 'RESOLVE', 'ERROR'].includes(action)) return resolve(false);
        if (!recoveryRef.current?.acceptsEvents()) return resolve(false);
        const permissions = getRoomPermissions(currentUserRef.current);
        if (['RESOLVE', 'ERROR'].includes(action) ? !permissions.isPlaybackCoordinator : action !== 'READY' && !permissions.canChangeSource) return resolve(false);
        socket.timeout(10000).emit('playlist_update', {
            roomId, sourceId: state.sourceId, sourceRevision: state.sourceRevision,
            playlistId: state.playlistId, playlistIndex: state.playlistIndex,
            currentVideoId: state.currentVideoId, action, ...options,
        }, (error, response) => {
            if (error || !response?.ok) return resolve(false);
            resolve(true);
        });
    }), [roomId, canSendRoomAction]);

    return (
        <RoomContext.Provider value={{
            isRestoringSession,
            isConnected,
            connectionPhase,
            connectionError,
            resyncRequest,
            failResync,
            completeResync,
            retryConnection,
            canSendRoomAction,
            canPerformRoomAction,
            permissions: getRoomPermissions(currentUser),
            roomActionsEnabled: isConnected && connectionPhase === 'connected',
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
            updatePlaylist,
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
            reorderQueue,
            playNext,
            syncProgress,
            measurePing,
            getExpectedPosition,
        }}>
            {children}
        </RoomContext.Provider>
    );
};
