/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { socket } from '../socket';
import toast from 'react-hot-toast';

const RoomContext = createContext();

export const useRoom = () => useContext(RoomContext);

export const RoomProvider = ({ children }) => {
    const [isRestoringSession, setIsRestoringSession] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [roomId, setRoomId] = useState(null);
    const [videoState, setVideoState] = useState({
        url: '',
        magnetURI: '',
        isPlaying: false,
        playedSeconds: 0,
        updatedAt: 0,
        seekVersion: 0
    });
    const [queue, setQueue] = useState([]);
    const isKicked = useRef(false);

    // Synchronous ref for socket guards
    const videoStateRef = useRef(videoState);
    useEffect(() => { videoStateRef.current = videoState; }, [videoState]);

    // BUG-11: Timeout ref so we can clear it once room_joined fires
    const restoreTimeoutRef = useRef(null);

    useEffect(() => {
        function onConnect() { setIsConnected(true); }
        function onDisconnect() {
            setIsConnected(false);
            setCurrentUser(null);
        }
        function onRoomJoined({ user, existingUsers, videoState: initialVideoState, queue: initialQueue, chatHistory }) {
            // BUG-11: Clear the stale-session timeout — connection succeeded
            clearTimeout(restoreTimeoutRef.current);
            setCurrentUser(user);
            setUsers(existingUsers);
            if (initialVideoState) setVideoState(initialVideoState);
            if (initialQueue) setQueue(initialQueue);
            setMessages(chatHistory || []);
            setIsRestoringSession(false);
        }
        function onUserJoined(newUser) {
            setUsers(prev => {
                if (prev.some(u => u.id === newUser.id)) return prev;
                toast(`${newUser.nickname} joined`, { icon: '👋', duration: 2000 });
                return [...prev, newUser];
            });
        }
        function onUserLeft(userId) {
            setUsers(prev => {
                const leaving = prev.find(u => u.id === userId);
                if (leaving) toast(`${leaving.nickname} left`, { icon: '🚪', duration: 2000 });
                return prev.filter(u => u.id !== userId);
            });
        }
        function onReceiveMessage(message) {
            setMessages(prev => {
                if (prev.some(m => m.id === message.id)) return prev;
                return [...prev, message].slice(-200);
            });
        }
        // BUG-06 / BUG-16: role_updated carries who changed — we track if it's us
        function onRoleUpdated({ userId, newRole }) {
            setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
            setCurrentUser(prev => prev?.id === userId ? { ...prev, role: newRole } : prev);
        }
        function onUserKicked() {
            isKicked.current = true;
            sessionStorage.removeItem('watchTogetherSession');
            // ISSUE-27: Use toast instead of blocking native alert()
            toast.error('You have been kicked from the room.', { duration: 4000 });
            // ISSUE-32: Use a custom event so App.jsx can call navigate() via React Router
            // instead of a full page reload via window.location.href
            setTimeout(() => window.dispatchEvent(new CustomEvent('watchsync:kicked')), 300);
        }

        const addSystemMessage = (text) => {
            setMessages(prev => [...prev, {
                id: Date.now() + Math.random().toString(),
                nickname: 'System',
                text,
                timestamp: Date.now(),
                isSystem: true
            }].slice(-200));
        };

        function onVideoChanged(newState) {
            // BUG-14: newState already has seekVersion: 0 from server, no need to force it
            setVideoState(newState);
            addSystemMessage('The video has been changed.');
        }
        function onVideoPlayed() {
            setVideoState(prev => ({ ...prev, isPlaying: true, updatedAt: Date.now() }));
            // BUG-06: server uses socket.to() so only non-initiators receive this — toast is appropriate
            toast('▶️ Playing', { duration: 1500 });
        }
        function onVideoPaused({ playedSeconds } = {}) {
            setVideoState(prev => ({
                ...prev,
                isPlaying: false,
                ...(playedSeconds !== undefined ? { playedSeconds } : {}),
                updatedAt: Date.now()
            }));
            // BUG-16: only non-initiators receive this event (server uses socket.to())
            toast('⏸️ Paused', { duration: 1500 });
        }
        function onVideoProgress({ playedSeconds, seekVersion }) {
            // BUG-07: now receives seekVersion from server so drift-correction effects trigger
            setVideoState(prev => ({
                ...prev,
                playedSeconds,
                updatedAt: Date.now(),
                // Only update seekVersion if provided (backward-compatible)
                ...(seekVersion !== undefined ? { seekVersion } : {})
            }));
        }
        function onVideoSeeked(playedSeconds) {
            setVideoState(prev => ({ ...prev, playedSeconds, updatedAt: Date.now(), seekVersion: (prev.seekVersion || 0) + 1 }));
        }
        function onQueueUpdated(newQueue) {
            setQueue(newQueue);
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('room_joined', onRoomJoined);
        socket.on('user_joined', onUserJoined);
        socket.on('user_left', onUserLeft);
        socket.on('receive_message', onReceiveMessage);
        socket.on('role_updated', onRoleUpdated);
        socket.on('user_kicked', onUserKicked);
        socket.on('video_changed', onVideoChanged);
        socket.on('video_played', onVideoPlayed);
        socket.on('video_paused', onVideoPaused);
        socket.on('video_progress', onVideoProgress);
        socket.on('video_seeked', onVideoSeeked);
        socket.on('queue_updated', onQueueUpdated);

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
            socket.off('video_played', onVideoPlayed);
            socket.off('video_paused', onVideoPaused);
            socket.off('video_progress', onVideoProgress);
            socket.off('video_seeked', onVideoSeeked);
            socket.off('queue_updated', onQueueUpdated);
        };
    }, []);

    // --- Auto-reconnect from sessionStorage ---
    useEffect(() => {
        const savedSession = sessionStorage.getItem('watchTogetherSession');
        if (!savedSession) {
            setIsRestoringSession(false);
            return;
        }

        // BUG-11: If backend is unreachable the spinner would hang forever.
        // Set a 6-second timeout; if room_joined hasn't fired by then, give up gracefully.
        restoreTimeoutRef.current = setTimeout(() => {
            setIsRestoringSession(false);
            sessionStorage.removeItem('watchTogetherSession');
            toast.error('Could not reconnect to server. Please rejoin.', { duration: 4000 });
        }, 6000);

        if (!socket.connected) {
            socket.connect();
        }

        // Cleanup timeout on unmount
        return () => clearTimeout(restoreTimeoutRef.current);
    }, []);

    useEffect(() => {
        const savedSession = sessionStorage.getItem('watchTogetherSession');
        if (savedSession && isConnected && !currentUser) {
            try {
                let sessionData = JSON.parse(savedSession);
                let { roomId: savedRoomId, nickname, userId } = sessionData;

                if (savedRoomId && nickname) {
                    if (!userId) {
                        userId = Math.random().toString(36).substring(2, 15);
                        sessionData.userId = userId;
                        sessionStorage.setItem('watchTogetherSession', JSON.stringify(sessionData));
                    }
                    setRoomId(savedRoomId);
                    socket.emit('join_room', { roomId: savedRoomId, nickname, userId });
                } else {
                    clearTimeout(restoreTimeoutRef.current);
                    setIsRestoringSession(false);
                }
            } catch (e) {
                console.error('Failed to parse saved session', e);
                clearTimeout(restoreTimeoutRef.current);
                setIsRestoringSession(false);
            }
        }
    }, [isConnected, currentUser]);

    const joinRoom = useCallback((id, nickname) => {
        // BUG-03: Reuse existing userId from sessionStorage if we already have one for this room,
        // so that a host/moderator who refreshes recovers their role correctly.
        let userId;
        try {
            const saved = JSON.parse(sessionStorage.getItem('watchTogetherSession') || '{}');
            userId = (saved.roomId === id && saved.userId) ? saved.userId : Math.random().toString(36).substring(2, 15);
        } catch {
            userId = Math.random().toString(36).substring(2, 15);
        }
        setRoomId(id);
        sessionStorage.setItem('watchTogetherSession', JSON.stringify({ roomId: id, nickname, userId }));
        socket.connect();
        socket.emit('join_room', { roomId: id, nickname, userId });
    }, []);

    const leaveRoom = useCallback(() => {
        if (!isKicked.current) {
            socket.emit('leave_room', { roomId });
        }
        sessionStorage.removeItem('watchTogetherSession');
        socket.disconnect();
        setRoomId(null);
        setCurrentUser(null);
        setUsers([]);
        setMessages([]);
        setQueue([]);
        isKicked.current = false;
    }, [roomId]);

    // BUG-18: Guard sendMessage so it doesn't emit with a null roomId
    const sendMessage = useCallback((text) => {
        if (!text.trim() || !currentUser || !roomId) return;
        const msg = {
            id: Date.now() + Math.random().toString(),
            text,
            nickname: currentUser.nickname,
            role: currentUser.role,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, msg].slice(-200));
        socket.emit('send_message', { roomId, message: msg });
    }, [roomId, currentUser]);

    const promoteUser = useCallback((targetId) => socket.emit('promote_to_moderator', { roomId, targetId }), [roomId]);
    const demoteUser = useCallback((targetId) => socket.emit('demote_to_viewer', { roomId, targetId }), [roomId]);
    const transferHost = useCallback((targetId) => socket.emit('transfer_host', { roomId, targetId }), [roomId]);
    const kickUser = useCallback((targetId) => socket.emit('kick_user', { roomId, targetId }), [roomId]);

    // --- Video Sync ---
    const loadVideo = useCallback((url, magnetURI = '') => {
        if (!url && !magnetURI) return;
        const newState = {
            url: url || '',
            magnetURI: magnetURI || '',
            isPlaying: true,
            playedSeconds: 0,
            updatedAt: Date.now(),
            seekVersion: 0
        };
        setVideoState(newState);
        socket.emit('change_video', { roomId, ...newState });
    }, [roomId]);

    // BUG-08: Strictly guard emits against current state to prevent play/pause spam loops
    const playVideo = useCallback(() => {
        if (videoStateRef.current?.isPlaying) return;
        setVideoState(prev => ({ ...prev, isPlaying: true }));
        socket.emit('play_video', { roomId });
    }, [roomId]);

    // BUG-09: Strictly guard emits against current state to prevent play/pause spam loops
    const pauseVideo = useCallback((playedSeconds) => {
        if (!videoStateRef.current?.isPlaying) return;
        setVideoState(prev => ({ ...prev, isPlaying: false, ...(playedSeconds !== undefined ? { playedSeconds } : {}) }));
        socket.emit('pause_video', { roomId, playedSeconds });
    }, [roomId]);

    const syncProgress = useCallback((playedSeconds) => {
        // Host-only: periodically sync position to server
        socket.emit('sync_progress', { roomId, playedSeconds });
    }, [roomId]);

    const seekVideo = useCallback((seconds) => {
        // BUG-J FIX: Increment seekVersion locally on the host so that:
        // 1. State stays consistent with viewers (who increment via onVideoSeeked).
        // 2. A re-seek to the exact same timestamp still triggers isForcedSeek
        //    on viewers instead of being silently ignored.
        setVideoState(prev => ({ ...prev, playedSeconds: seconds, seekVersion: (prev.seekVersion || 0) + 1 }));
        socket.emit('seek_video', { roomId, playedSeconds: seconds });
    }, [roomId]);

    // --- Queue Management ---
    const addToQueue = useCallback((url, magnetURI = '', label = '') => {
        if (!url && !magnetURI) return;
        socket.emit('add_to_queue', { roomId, url, magnetURI, label: label || url });
    }, [roomId]);

    const removeFromQueue = useCallback((itemId) => {
        socket.emit('remove_from_queue', { roomId, itemId });
    }, [roomId]);

    const playNext = useCallback(() => {
        socket.emit('play_next', { roomId });
    }, [roomId]);

    return (
        <RoomContext.Provider value={{
            isRestoringSession,
            isConnected,
            currentUser,
            users,
            messages,
            roomId,
            videoState,
            queue,
            joinRoom,
            leaveRoom,
            sendMessage,
            promoteUser,
            demoteUser,
            transferHost,
            kickUser,
            loadVideo,
            playVideo,
            pauseVideo,
            seekVideo,
            addToQueue,
            removeFromQueue,
            playNext,
            syncProgress,
        }}>
            {children}
        </RoomContext.Provider>
    );
};
