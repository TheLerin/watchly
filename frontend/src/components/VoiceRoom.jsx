import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, ChevronDown, ChevronUp, Wifi, WifiOff, RefreshCw, Users, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoom } from '../context/RoomContext';
import { socket } from '../socket';
import { NETWORK_QUALITY_META, formatPing } from '../utils/networkQuality';

const TURN_USER = import.meta.env.VITE_TURN_USERNAME || 'openrelayproject';
const TURN_CRED = import.meta.env.VITE_TURN_CREDENTIAL || 'openrelayproject';

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'turn:openrelay.metered.ca:80', username: TURN_USER, credential: TURN_CRED },
        { urls: 'turn:openrelay.metered.ca:443', username: TURN_USER, credential: TURN_CRED },
        { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: TURN_USER, credential: TURN_CRED },
        { urls: 'stun:a.relay.metered.ca:80' },
    ],
};

const formatCallDuration = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
};

const MotionDiv = motion.div;

const VoiceRoom = () => {
    const {
        roomId,
        currentUser,
        users,
        isConnected,
        networkPingMs,
        networkQuality,
        measurePing,
    } = useRoom();

    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [callStartedAt, setCallStartedAt] = useState(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [voiceError, setVoiceError] = useState('');
    const [isCheckingPing, setIsCheckingPing] = useState(false);

    const localStreamRef = useRef(null);
    const peersRef = useRef({});
    const audioRefs = useRef({});
    const pendingCandidatesRef = useRef({});
    const isVoiceActiveRef = useRef(false);

    useEffect(() => {
        isVoiceActiveRef.current = isVoiceActive;
    }, [isVoiceActive]);

    useEffect(() => {
        if (!isVoiceActive || !callStartedAt) {
            setElapsedSeconds(0);
            return undefined;
        }

        const tick = () => setElapsedSeconds(Math.floor((Date.now() - callStartedAt) / 1000));
        tick();
        const intervalId = setInterval(tick, 1000);
        return () => clearInterval(intervalId);
    }, [isVoiceActive, callStartedAt]);

    const voiceUsers = React.useMemo(() => {
        const activeUsers = users
            .filter(user => user.isVoiceActive)
            .map(user => user.id === currentUser?.id ? { ...user, isMuted } : user);

        if (isVoiceActive && currentUser && !activeUsers.some(user => user.id === currentUser.id)) {
            return [...activeUsers, { ...currentUser, isVoiceActive: true, isMuted }];
        }

        return activeUsers;
    }, [users, currentUser, isVoiceActive, isMuted]);

    const cleanupPeer = useCallback((targetSocketId) => {
        const peer = peersRef.current[targetSocketId];
        if (peer) {
            peer.close();
            delete peersRef.current[targetSocketId];
        }

        const audio = audioRefs.current[targetSocketId];
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            delete audioRefs.current[targetSocketId];
        }

        delete pendingCandidatesRef.current[targetSocketId];
    }, []);

    const cleanupWebRTC = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }

        Object.keys(peersRef.current).forEach(cleanupPeer);
        peersRef.current = {};
        audioRefs.current = {};
        pendingCandidatesRef.current = {};
    }, [cleanupPeer]);

    const flushPendingCandidates = useCallback(async (targetSocketId) => {
        const peer = peersRef.current[targetSocketId];
        const queued = pendingCandidatesRef.current[targetSocketId] || [];
        if (!peer || queued.length === 0) return;

        for (const candidate of queued) {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.warn('[WebRTC] addIceCandidate flush error:', err);
            }
        }

        pendingCandidatesRef.current[targetSocketId] = [];
    }, []);

    const createPeerConnection = useCallback(async (targetSocketId, isInitiator) => {
        if (peersRef.current[targetSocketId]) {
            cleanupPeer(targetSocketId);
        }

        const peer = new RTCPeerConnection(ICE_SERVERS);
        peersRef.current[targetSocketId] = peer;
        pendingCandidatesRef.current[targetSocketId] = [];

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peer.addTrack(track, localStreamRef.current);
            });
        }

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_ice_candidate', { targetSocketId, candidate: event.candidate });
            }
        };

        peer.oniceconnectionstatechange = () => {
            console.log(`[WebRTC] ICE with ${targetSocketId}: ${peer.iceConnectionState}`);
        };

        peer.onconnectionstatechange = () => {
            console.log(`[WebRTC] connection with ${targetSocketId}: ${peer.connectionState}`);
            if (['disconnected', 'failed', 'closed'].includes(peer.connectionState)) {
                cleanupPeer(targetSocketId);
            }
        };

        peer.ontrack = (event) => {
            let audio = audioRefs.current[targetSocketId];
            if (!audio) {
                audio = new Audio();
                audioRefs.current[targetSocketId] = audio;
            }

            audio.srcObject = event.streams[0];
            audio.play().catch(err => {
                console.warn('[WebRTC] audio.play() blocked:', err.name);
            });
        };

        if (isInitiator) {
            try {
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                socket.emit('webrtc_offer', { targetSocketId, offer });
            } catch (err) {
                console.error('[WebRTC] createOffer error:', err);
            }
        }

        return peer;
    }, [cleanupPeer]);

    useEffect(() => {
        const handleOffer = async ({ senderSocketId, offer }) => {
            if (!isVoiceActiveRef.current) {
                return;
            }

            const peer = await createPeerConnection(senderSocketId, false);
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(offer));
                await flushPendingCandidates(senderSocketId);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                socket.emit('webrtc_answer', { targetSocketId: senderSocketId, answer });
            } catch (err) {
                console.error('[WebRTC] handleOffer error:', err);
            }
        };

        const handleAnswer = async ({ senderSocketId, answer }) => {
            const peer = peersRef.current[senderSocketId];
            if (!peer) return;

            try {
                await peer.setRemoteDescription(new RTCSessionDescription(answer));
                await flushPendingCandidates(senderSocketId);
            } catch (err) {
                console.error('[WebRTC] handleAnswer error:', err);
            }
        };

        const handleIceCandidate = async ({ senderSocketId, candidate }) => {
            const peer = peersRef.current[senderSocketId];
            if (!peer || !peer.remoteDescription) {
                if (!pendingCandidatesRef.current[senderSocketId]) {
                    pendingCandidatesRef.current[senderSocketId] = [];
                }

                pendingCandidatesRef.current[senderSocketId].push(candidate);
                return;
            }

            try {
                await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.warn('[WebRTC] addIceCandidate error:', err);
            }
        };

        socket.on('webrtc_offer', handleOffer);
        socket.on('webrtc_answer', handleAnswer);
        socket.on('webrtc_ice_candidate', handleIceCandidate);

        return () => {
            socket.off('webrtc_offer', handleOffer);
            socket.off('webrtc_answer', handleAnswer);
            socket.off('webrtc_ice_candidate', handleIceCandidate);
        };
    }, [roomId, createPeerConnection, flushPendingCandidates]);

    useEffect(() => {
        return () => cleanupWebRTC();
    }, [cleanupWebRTC]);

    useEffect(() => {
        if (!isConnected && isVoiceActive) {
            cleanupWebRTC();
            setIsVoiceActive(false);
            setCallStartedAt(null);
            setVoiceError('Connection dropped. Rejoin voice after reconnecting.');
        }
    }, [isConnected, isVoiceActive, cleanupWebRTC]);

    const toggleVoice = async (e) => {
        if (e) e.stopPropagation();

        if (isVoiceActive) {
            cleanupWebRTC();
            setIsVoiceActive(false);
            setCallStartedAt(null);
            setVoiceError('');
            socket.emit('toggle_voice', { roomId, isVoiceActive: false, isMuted: true });
            return;
        }

        if (!isConnected) {
            setVoiceError('Server reconnecting. Try voice again in a moment.');
            setIsExpanded(true);
            return;
        }

        try {
            setVoiceError('');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const audioTrack = stream.getAudioTracks()[0];

            localStreamRef.current = stream;
            if (audioTrack) {
                audioTrack.enabled = !isMuted;
            }

            setIsVoiceActive(true);
            setIsExpanded(true);
            setCallStartedAt(Date.now());
            socket.emit('toggle_voice', { roomId, isVoiceActive: true, isMuted });
            measurePing?.();

            const others = users.filter(user => user.isVoiceActive && user.id !== currentUser?.id);
            for (const user of others) {
                createPeerConnection(user.id, true);
            }
        } catch (err) {
            console.error('[Voice] getUserMedia failed:', err);
            setIsExpanded(true);

            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                setVoiceError('Microphone access is blocked.');
            } else if (err.name === 'NotFoundError') {
                setVoiceError('No microphone was found.');
            } else {
                setVoiceError(`Could not access microphone: ${err.message}`);
            }
        }
    };

    const toggleMute = (e) => {
        if (e) e.stopPropagation();
        if (!localStreamRef.current) return;

        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (!audioTrack) return;

        const nextMuted = !isMuted;
        audioTrack.enabled = !nextMuted;
        setIsMuted(nextMuted);
        socket.emit('toggle_voice', { roomId, isVoiceActive, isMuted: nextMuted });
    };

    const handlePingCheck = async (e) => {
        if (e) e.stopPropagation();
        if (!measurePing) return;

        setIsCheckingPing(true);
        try {
            await measurePing();
        } finally {
            setTimeout(() => setIsCheckingPing(false), 250);
        }
    };

    const qualityKey = isConnected ? networkQuality : 'offline';
    const qualityMeta = NETWORK_QUALITY_META[qualityKey] || NETWORK_QUALITY_META.checking;
    const pingText = isConnected ? formatPing(networkPingMs) : 'Offline';
    const callStatus = isVoiceActive ? (isMuted ? 'Muted' : 'Live') : 'Ready';
    const callStatusStyle = isVoiceActive
        ? isMuted
            ? { background: 'rgba(239, 68, 68, 0.13)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.28)' }
            : { background: 'rgba(34, 197, 94, 0.13)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.28)' }
        : { background: 'var(--accent-soft)', color: 'var(--text-sub)', border: '1px solid var(--glass-border)' };

    return (
        <div className="shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="relative z-10 p-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsExpanded(v => !v)}
                        className="min-w-0 flex-1 flex items-center gap-3 rounded-2xl p-1.5 text-left transition-all hover:bg-white/5"
                    >
                        <span
                            className="relative h-10 w-10 shrink-0 rounded-2xl flex items-center justify-center"
                            style={{
                                background: isVoiceActive ? 'rgba(34, 197, 94, 0.13)' : 'var(--glass-bg-strong)',
                                border: `1px solid ${isVoiceActive ? 'rgba(34, 197, 94, 0.28)' : 'var(--glass-border)'}`,
                                color: isVoiceActive ? '#4ade80' : 'var(--text)',
                            }}
                        >
                            {isVoiceActive && !isMuted && (
                                <span className="absolute inset-0 rounded-2xl bg-green-400/20 animate-ping" />
                            )}
                            <PhoneCall size={18} className="relative z-10" />
                        </span>

                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 min-w-0">
                                <span className="syne text-sm font-bold truncate" style={{ color: 'var(--text)' }}>
                                    Voice Call
                                </span>
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={callStatusStyle}>
                                    {callStatus}
                                </span>
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                <span className="flex items-center gap-1">
                                    <Users size={11} />
                                    {voiceUsers.length}
                                </span>
                                {isVoiceActive && (
                                    <span className="flex items-center gap-1">
                                        <Clock size={11} />
                                        {formatCallDuration(elapsedSeconds)}
                                    </span>
                                )}
                                <span className="flex items-center gap-1" style={{ color: qualityMeta.color }}>
                                    {isConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
                                    {pingText}
                                </span>
                            </span>
                        </span>

                        {isExpanded
                            ? <ChevronUp size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
                            : <ChevronDown size={15} className="shrink-0" style={{ color: 'var(--text-muted)' }} />}
                    </button>

                    <button
                        type="button"
                        onClick={handlePingCheck}
                        disabled={!isConnected || isCheckingPing}
                        className="h-10 shrink-0 rounded-2xl px-3 flex items-center justify-center gap-1.5 text-[10px] font-bold transition-all disabled:opacity-60"
                        style={{ background: qualityMeta.bg, color: qualityMeta.color, border: `1px solid ${qualityMeta.border}` }}
                        title="Check ping"
                    >
                        <RefreshCw size={14} className={isCheckingPing ? 'animate-spin' : ''} />
                        <span className="hidden sm:inline">Ping</span>
                    </button>
                </div>

                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    {isVoiceActive ? (
                        <>
                            <button
                                type="button"
                                onClick={toggleMute}
                                className="flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold transition-all"
                                style={{
                                    background: isMuted ? 'rgba(239, 68, 68, 0.13)' : 'var(--glass-bg-strong)',
                                    color: isMuted ? '#f87171' : 'var(--text)',
                                    border: `1px solid ${isMuted ? 'rgba(239, 68, 68, 0.28)' : 'var(--glass-border)'}`,
                                }}
                                title={isMuted ? 'Unmute' : 'Mute'}
                            >
                                {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                                <span>{isMuted ? 'Unmute' : 'Mute'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={toggleVoice}
                                className="flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-xs font-bold transition-all"
                                style={{ background: 'rgba(239, 68, 68, 0.14)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.30)' }}
                                title="Leave voice"
                            >
                                <PhoneOff size={15} />
                                <span className="hidden sm:inline">Leave</span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={toggleVoice}
                            className="col-span-2 flex items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-bold transition-all"
                            style={{ background: 'rgba(34, 197, 94, 0.13)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.28)' }}
                        >
                            <PhoneCall size={15} />
                            <span>Join Voice</span>
                        </button>
                    )}
                </div>

                <AnimatePresence initial={false}>
                    {isExpanded && (
                        <MotionDiv
                            key="voice-body"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22 }}
                            className="overflow-hidden"
                        >
                            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="rounded-2xl px-2.5 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Ping</div>
                                        <div className="mt-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: qualityMeta.color }}>
                                            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                                            {pingText}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl px-2.5 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Quality</div>
                                        <div className="mt-1 text-xs font-bold" style={{ color: qualityMeta.color }}>
                                            {qualityMeta.label}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl px-2.5 py-2" style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                                        <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>Active</div>
                                        <div className="mt-1 text-xs font-bold" style={{ color: 'var(--text)' }}>
                                            {voiceUsers.length}
                                        </div>
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {voiceError && (
                                        <MotionDiv
                                            initial={{ opacity: 0, y: -4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -4 }}
                                            className="mt-3 rounded-2xl px-3 py-2 text-xs font-semibold"
                                            style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.24)' }}
                                        >
                                            {voiceError}
                                        </MotionDiv>
                                    )}
                                </AnimatePresence>

                                <div className="mt-3 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                    {voiceUsers.length === 0 ? (
                                        <div className="w-full text-center py-5 text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                                            No active voice users
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            <AnimatePresence>
                                                {voiceUsers.map(user => (
                                                    <MotionDiv
                                                        key={user.id}
                                                        initial={{ opacity: 0, y: 6 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: 6 }}
                                                        className="flex items-center gap-2 rounded-2xl px-2.5 py-2"
                                                        style={{
                                                            background: user.isMuted ? 'var(--glass-bg)' : 'rgba(34, 197, 94, 0.10)',
                                                            border: `1px solid ${user.isMuted ? 'var(--glass-border)' : 'rgba(34, 197, 94, 0.25)'}`,
                                                        }}
                                                    >
                                                        <div className="relative shrink-0">
                                                            <div className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-zinc-700 via-neutral-500 to-zinc-300 flex items-center justify-center text-[11px] font-bold text-white">
                                                                {user.nickname?.charAt(0)?.toUpperCase() || '?'}
                                                            </div>
                                                            {!user.isMuted && (
                                                                <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-black/70" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <span className="truncate text-xs font-bold" style={{ color: 'var(--text)' }}>
                                                                    {user.nickname}
                                                                </span>
                                                                {user.id === currentUser?.id && (
                                                                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'var(--accent-soft)', color: 'var(--text-sub)' }}>
                                                                        You
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="mt-0.5 text-[10px] font-medium" style={{ color: user.isMuted ? '#f87171' : '#4ade80' }}>
                                                                {user.isMuted ? 'Muted' : 'Mic on'}
                                                            </div>
                                                        </div>
                                                        <div
                                                            className="h-7 w-7 rounded-xl flex items-center justify-center shrink-0"
                                                            style={{
                                                                background: user.isMuted ? 'rgba(239, 68, 68, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                                                                color: user.isMuted ? '#f87171' : '#4ade80',
                                                            }}
                                                        >
                                                            {user.isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                                                        </div>
                                                    </MotionDiv>
                                                ))}
                                            </AnimatePresence>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default VoiceRoom;
