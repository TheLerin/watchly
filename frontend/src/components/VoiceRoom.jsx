import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ChevronDown,
    ChevronUp,
    Clock,
    Headphones,
    Mic,
    MicOff,
    PhoneCall,
    PhoneOff,
    RefreshCw,
    Users,
    Wifi,
    WifiOff,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRoom } from '../context/RoomContext';
import { socket } from '../socket';
import { NETWORK_QUALITY_META, formatPing } from '../utils/networkQuality';

const FORCE_RELAY = import.meta.env.DEV && import.meta.env.VITE_FORCE_RELAY === 'true';
const MAX_VOICE_PARTICIPANTS = 6;
const DISCONNECT_GRACE_MS = 7000;

const formatCallDuration = seconds => {
    const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
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
    const [iceWarning, setIceWarning] = useState('');
    const [audioBlocked, setAudioBlocked] = useState(false);
    const [isCheckingPing, setIsCheckingPing] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [peerStatuses, setPeerStatuses] = useState({});

    const localStreamRef = useRef(null);
    const peersRef = useRef({});
    const audioElementsRef = useRef({});
    const pendingCandidatesRef = useRef({});
    const disconnectTimersRef = useRef({});
    const iceConfigRef = useRef({
        iceServers: [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        ],
        iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all',
    });
    const isVoiceActiveRef = useRef(false);
    const isMutedRef = useRef(false);

    useEffect(() => {
        isVoiceActiveRef.current = isVoiceActive;
    }, [isVoiceActive]);
    useEffect(() => {
        isMutedRef.current = isMuted;
    }, [isMuted]);

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

    const voiceUsers = useMemo(() => {
        const active = users
            .filter(user => user.isVoiceActive)
            .map(user => user.id === currentUser?.id ? { ...user, isMuted } : user);
        if (isVoiceActive && currentUser && !active.some(user => user.id === currentUser.id)) {
            active.push({ ...currentUser, isVoiceActive: true, isMuted });
        }
        return active;
    }, [users, currentUser, isVoiceActive, isMuted]);

    const updatePeerStatus = useCallback((peerId, patch) => {
        setPeerStatuses(previous => ({
            ...previous,
            [peerId]: {
                status: 'Connecting',
                connectionType: '',
                candidateType: '',
                ...previous[peerId],
                ...patch,
            },
        }));
    }, []);

    const cleanupPeer = useCallback(peerId => {
        clearTimeout(disconnectTimersRef.current[peerId]);
        delete disconnectTimersRef.current[peerId];
        const record = peersRef.current[peerId];
        if (record) {
            record.pc.ontrack = null;
            record.pc.onicecandidate = null;
            record.pc.close();
            delete peersRef.current[peerId];
        }
        const audio = audioElementsRef.current[peerId];
        if (audio) {
            audio.pause();
            audio.srcObject = null;
            delete audioElementsRef.current[peerId];
        }
        delete pendingCandidatesRef.current[peerId];
        setRemoteStreams(previous => {
            const next = { ...previous };
            delete next[peerId];
            return next;
        });
        setPeerStatuses(previous => {
            const next = { ...previous };
            delete next[peerId];
            return next;
        });
    }, []);

    const cleanupPeers = useCallback(() => {
        Object.keys(peersRef.current).forEach(cleanupPeer);
        peersRef.current = {};
        pendingCandidatesRef.current = {};
    }, [cleanupPeer]);

    const stopLocalStream = useCallback(() => {
        localStreamRef.current?.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
    }, []);

    const inspectPeer = useCallback(async peerId => {
        const record = peersRef.current[peerId];
        if (!record || record.pc.connectionState !== 'connected') return;
        try {
            const stats = await record.pc.getStats();
            let selectedPair;
            stats.forEach(report => {
                if (
                    report.type === 'candidate-pair' &&
                    report.state === 'succeeded' &&
                    (report.nominated || report.selected)
                ) selectedPair = report;
            });
            if (!selectedPair) {
                stats.forEach(report => {
                    if (report.type === 'transport' && report.selectedCandidatePairId) {
                        selectedPair = stats.get(report.selectedCandidatePairId);
                    }
                });
            }
            const local = selectedPair ? stats.get(selectedPair.localCandidateId) : null;
            const remote = selectedPair ? stats.get(selectedPair.remoteCandidateId) : null;
            const candidateType = local?.candidateType || remote?.candidateType || '';
            const relay = candidateType === 'relay' || remote?.candidateType === 'relay';
            updatePeerStatus(peerId, {
                status: relay ? 'Connected through relay' : 'Connected directly',
                connectionType: relay ? 'Relay' : 'Direct',
                candidateType: candidateType || 'unknown',
            });
        } catch (error) {
            console.warn('[WebRTC] Could not read peer stats', error);
        }
    }, [updatePeerStatus]);

    const flushCandidates = useCallback(async peerId => {
        const record = peersRef.current[peerId];
        const queued = pendingCandidatesRef.current[peerId] || [];
        if (!record?.pc.remoteDescription || queued.length === 0) return;
        pendingCandidatesRef.current[peerId] = [];
        for (const candidate of queued) {
            try {
                await record.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                if (!record.ignoreOffer) console.warn('[WebRTC] Candidate rejected', error);
            }
        }
    }, []);

    const sendOffer = useCallback(async (peerId, iceRestart = false) => {
        const record = peersRef.current[peerId];
        if (!record || record.makingOffer) return;
        try {
            record.makingOffer = true;
            updatePeerStatus(peerId, { status: iceRestart ? 'Reconnecting' : 'Connecting' });
            const offer = await record.pc.createOffer({ iceRestart });
            if (record.pc.signalingState !== 'stable') return;
            await record.pc.setLocalDescription(offer);
            socket.emit('webrtc_offer', {
                targetSocketId: peerId,
                offer: record.pc.localDescription.toJSON(),
            });
        } catch (error) {
            updatePeerStatus(peerId, { status: 'Failed' });
            console.error('[WebRTC] Could not create offer', error);
        } finally {
            if (record) record.makingOffer = false;
        }
    }, [updatePeerStatus]);

    const createPeerConnection = useCallback((peerId, shouldOffer = false) => {
        if (!peerId || peerId === socket.id) return null;
        if (peersRef.current[peerId]) {
            if (shouldOffer) sendOffer(peerId);
            return peersRef.current[peerId];
        }

        const pc = new RTCPeerConnection(iceConfigRef.current);
        const record = {
            pc,
            makingOffer: false,
            ignoreOffer: false,
            polite: socket.id.localeCompare(peerId) > 0,
        };
        peersRef.current[peerId] = record;
        pendingCandidatesRef.current[peerId] ||= [];
        updatePeerStatus(peerId, { status: 'Connecting' });

        localStreamRef.current?.getTracks().forEach(track => {
            pc.addTrack(track, localStreamRef.current);
        });

        pc.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('webrtc_ice_candidate', {
                    targetSocketId: peerId,
                    candidate: event.candidate.toJSON(),
                });
            }
        };
        pc.onicecandidateerror = event => {
            console.warn('[WebRTC] ICE candidate error', event.errorCode, event.errorText);
            updatePeerStatus(peerId, { status: pc.connectionState === 'connected' ? 'Connected' : 'Connecting' });
        };
        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'gathering') {
                updatePeerStatus(peerId, { status: 'Connecting' });
            }
        };
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed') {
                updatePeerStatus(peerId, { status: 'Reconnecting' });
                if (socket.id.localeCompare(peerId) < 0) sendOffer(peerId, true);
            }
        };
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === 'connected') {
                clearTimeout(disconnectTimersRef.current[peerId]);
                updatePeerStatus(peerId, { status: 'Connected' });
                inspectPeer(peerId);
            } else if (state === 'disconnected') {
                updatePeerStatus(peerId, { status: 'Reconnecting' });
                clearTimeout(disconnectTimersRef.current[peerId]);
                disconnectTimersRef.current[peerId] = setTimeout(() => {
                    if (pc.connectionState === 'disconnected' && socket.id.localeCompare(peerId) < 0) {
                        sendOffer(peerId, true);
                    }
                }, DISCONNECT_GRACE_MS);
            } else if (state === 'failed') {
                updatePeerStatus(peerId, { status: 'Reconnecting' });
                if (socket.id.localeCompare(peerId) < 0) sendOffer(peerId, true);
            } else if (state === 'closed') {
                cleanupPeer(peerId);
            }
        };
        pc.ontrack = event => {
            const stream = event.streams[0] || new MediaStream([event.track]);
            setRemoteStreams(previous => ({ ...previous, [peerId]: stream }));
        };

        if (shouldOffer) queueMicrotask(() => sendOffer(peerId));
        return record;
    }, [cleanupPeer, inspectPeer, sendOffer, updatePeerStatus]);

    const fetchIceConfig = useCallback(async () => {
        try {
            const config = await new Promise((resolve, reject) => socket.timeout(8000).emit(
                'ice:config', {}, (error, value) => error ? reject(error) : resolve(value)
            ));
            if (!config?.ok) throw new Error(config?.error?.message || 'ICE configuration was rejected.');
            if (!Array.isArray(config.iceServers) || config.iceServers.length === 0) {
                throw new Error('No ICE servers were returned.');
            }
            iceConfigRef.current = {
                iceServers: config.iceServers,
                iceTransportPolicy: FORCE_RELAY ? 'relay' : 'all',
            };
            setIceWarning(config.turnConfigured
                ? ''
                : 'TURN is not configured. Voice may fail between different or restrictive networks.');
            return config;
        } catch (error) {
            setIceWarning('TURN configuration could not be loaded. Cross-network voice may fail.');
            console.error('[Voice] ICE configuration failed', error);
            return null;
        }
    }, []);

    const joinVoiceOnServer = useCallback(() => new Promise((resolve, reject) => {
        socket.timeout(8000).emit('join_voice', {
            roomId,
            isMuted: isMutedRef.current,
        }, (error, response) => {
            if (error || !response?.ok) {
                reject(new Error(response?.error || 'Voice join timed out.'));
                return;
            }
            resolve(response);
        });
    }), [roomId]);

    const reconnectVoice = useCallback(async () => {
        if (!isVoiceActiveRef.current || !localStreamRef.current || !socket.connected) return;
        cleanupPeers();
        try {
            const response = await joinVoiceOnServer();
            for (const peer of response.peers || []) {
                createPeerConnection(peer.id, true);
            }
            setVoiceError('');
        } catch (error) {
            setVoiceError(`Voice reconnect failed: ${error.message}`);
        }
    }, [cleanupPeers, createPeerConnection, joinVoiceOnServer]);

    useEffect(() => {
        const handleOffer = async ({ senderSocketId, offer }) => {
            if (!isVoiceActiveRef.current || !localStreamRef.current) return;
            const record = createPeerConnection(senderSocketId, false);
            if (!record) return;
            const collision = record.makingOffer || record.pc.signalingState !== 'stable';
            record.ignoreOffer = !record.polite && collision;
            if (record.ignoreOffer) return;
            try {
                if (collision) {
                    await record.pc.setLocalDescription({ type: 'rollback' });
                }
                await record.pc.setRemoteDescription(new RTCSessionDescription(offer));
                await flushCandidates(senderSocketId);
                const answer = await record.pc.createAnswer();
                await record.pc.setLocalDescription(answer);
                socket.emit('webrtc_answer', {
                    targetSocketId: senderSocketId,
                    answer: record.pc.localDescription.toJSON(),
                });
            } catch (error) {
                updatePeerStatus(senderSocketId, { status: 'Failed' });
                console.error('[WebRTC] Offer handling failed', error);
            }
        };
        const handleAnswer = async ({ senderSocketId, answer }) => {
            const record = peersRef.current[senderSocketId];
            if (!record) return;
            try {
                await record.pc.setRemoteDescription(new RTCSessionDescription(answer));
                await flushCandidates(senderSocketId);
            } catch (error) {
                updatePeerStatus(senderSocketId, { status: 'Failed' });
                console.error('[WebRTC] Answer handling failed', error);
            }
        };
        const handleCandidate = async ({ senderSocketId, candidate }) => {
            const record = peersRef.current[senderSocketId];
            if (!record?.pc.remoteDescription) {
                pendingCandidatesRef.current[senderSocketId] ||= [];
                pendingCandidatesRef.current[senderSocketId].push(candidate);
                return;
            }
            try {
                await record.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                if (!record.ignoreOffer) console.warn('[WebRTC] Candidate handling failed', error);
            }
        };
        const handlePeerLeft = ({ userId }) => cleanupPeer(userId);
        const handleDisconnect = () => {
            if (!isVoiceActiveRef.current) return;
            cleanupPeers();
            setVoiceError('Signaling disconnected. Voice will reconnect automatically.');
        };
        const handleRoomJoined = () => {
            if (isVoiceActiveRef.current && localStreamRef.current) {
                setTimeout(reconnectVoice, 150);
            }
        };

        socket.on('webrtc_offer', handleOffer);
        socket.on('webrtc_answer', handleAnswer);
        socket.on('webrtc_ice_candidate', handleCandidate);
        socket.on('voice_peer_left', handlePeerLeft);
        socket.on('disconnect', handleDisconnect);
        socket.on('room_joined', handleRoomJoined);
        return () => {
            socket.off('webrtc_offer', handleOffer);
            socket.off('webrtc_answer', handleAnswer);
            socket.off('webrtc_ice_candidate', handleCandidate);
            socket.off('voice_peer_left', handlePeerLeft);
            socket.off('disconnect', handleDisconnect);
            socket.off('room_joined', handleRoomJoined);
        };
    }, [cleanupPeer, cleanupPeers, createPeerConnection, flushCandidates, reconnectVoice, updatePeerStatus]);

    useEffect(() => {
        if (!isVoiceActive) return undefined;
        const statsInterval = setInterval(() => {
            Object.keys(peersRef.current).forEach(inspectPeer);
        }, 3000);
        return () => clearInterval(statsInterval);
    }, [isVoiceActive, inspectPeer]);

    useEffect(() => () => {
        if (isVoiceActiveRef.current && socket.connected) {
            socket.emit('leave_voice', { roomId });
        }
        cleanupPeers();
        stopLocalStream();
    }, [cleanupPeers, roomId, stopLocalStream]);

    const leaveVoice = useCallback(() => {
        socket.emit('leave_voice', { roomId });
        cleanupPeers();
        stopLocalStream();
        isVoiceActiveRef.current = false;
        setIsVoiceActive(false);
        setCallStartedAt(null);
        setVoiceError('');
        setAudioBlocked(false);
    }, [cleanupPeers, roomId, stopLocalStream]);

    const toggleVoice = async event => {
        event?.stopPropagation();
        if (isVoiceActive) {
            leaveVoice();
            return;
        }
        if (!isConnected) {
            setVoiceError('The signaling server is reconnecting. Try again in a moment.');
            setIsExpanded(true);
            return;
        }
        if (voiceUsers.length >= MAX_VOICE_PARTICIPANTS) {
            setVoiceError(`Voice is full (max ${MAX_VOICE_PARTICIPANTS} participants).`);
            setIsExpanded(true);
            return;
        }

        try {
            setVoiceError('');
            await fetchIceConfig();
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
                video: false,
            });
            const track = stream.getAudioTracks()[0];
            if (!track) throw new Error('No microphone audio track was created.');
            track.enabled = !isMutedRef.current;
            localStreamRef.current = stream;
            isVoiceActiveRef.current = true;
            setIsVoiceActive(true);
            setIsExpanded(true);
            setCallStartedAt(Date.now());

            const response = await joinVoiceOnServer();
            for (const peer of response.peers || []) {
                createPeerConnection(peer.id, true);
            }
            measurePing?.();
        } catch (error) {
            cleanupPeers();
            stopLocalStream();
            isVoiceActiveRef.current = false;
            setIsVoiceActive(false);
            setCallStartedAt(null);
            setIsExpanded(true);
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setVoiceError('Microphone access is blocked.');
            } else if (error.name === 'NotFoundError') {
                setVoiceError('No microphone was found.');
            } else {
                setVoiceError(error.message || 'Could not join voice.');
            }
        }
    };

    const toggleMute = event => {
        event?.stopPropagation();
        const track = localStreamRef.current?.getAudioTracks()[0];
        if (!track) return;
        const nextMuted = !isMutedRef.current;
        track.enabled = !nextMuted;
        isMutedRef.current = nextMuted;
        setIsMuted(nextMuted);
        socket.emit('update_voice_mute', { roomId, isMuted: nextMuted });
    };

    const setAudioElement = useCallback((peerId, element) => {
        if (!element) {
            delete audioElementsRef.current[peerId];
            return;
        }
        audioElementsRef.current[peerId] = element;
        const stream = remoteStreams[peerId];
        if (stream && element.srcObject !== stream) {
            element.srcObject = stream;
            element.play().catch(error => {
                if (error.name === 'NotAllowedError') setAudioBlocked(true);
            });
        }
    }, [remoteStreams]);

    const enableVoiceAudio = async () => {
        const results = await Promise.allSettled(
            Object.values(audioElementsRef.current).map(audio => audio.play())
        );
        setAudioBlocked(results.some(result => result.status === 'rejected'));
    };

    const handlePingCheck = async event => {
        event?.stopPropagation();
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
    const connectedPeers = Object.values(peerStatuses).filter(item => item.status?.startsWith('Connected')).length;
    const failedPeers = Object.values(peerStatuses).filter(item => item.status === 'Failed').length;
    const peerSummary = !isVoiceActive
        ? 'Idle'
        : failedPeers > 0
            ? 'Failed'
            : connectedPeers > 0
                ? `${connectedPeers} connected`
                : 'Connecting';
    const callStatus = isVoiceActive ? (isMuted ? 'Muted' : 'Live') : 'Ready';
    const callStatusStyle = isVoiceActive
        ? isMuted
            ? { background: 'rgba(239, 68, 68, 0.13)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.28)' }
            : { background: 'rgba(34, 197, 94, 0.13)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.28)' }
        : { background: 'var(--accent-soft)', color: 'var(--text-sub)', border: '1px solid var(--glass-border)' };

    return (
        <div className="shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="hidden">
                {Object.entries(remoteStreams).map(([peerId]) => (
                    <audio
                        key={peerId}
                        ref={element => setAudioElement(peerId, element)}
                        autoPlay
                        playsInline
                    />
                ))}
            </div>

            <div className="relative z-10 p-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsExpanded(value => !value)}
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
                            {isVoiceActive && !isMuted && <span className="absolute inset-0 rounded-2xl bg-green-400/20 animate-ping" />}
                            <PhoneCall size={18} className="relative z-10" />
                        </span>

                        <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 min-w-0">
                                <span className="syne text-sm font-bold truncate" style={{ color: 'var(--text)' }}>Voice Call</span>
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={callStatusStyle}>{callStatus}</span>
                                {FORCE_RELAY && <span className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[9px] font-bold text-violet-300">Relay test</span>}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                <span className="flex items-center gap-1"><Users size={11} />{voiceUsers.length}/{MAX_VOICE_PARTICIPANTS}</span>
                                {isVoiceActive && <span className="flex items-center gap-1"><Clock size={11} />{formatCallDuration(elapsedSeconds)}</span>}
                                <span className="flex items-center gap-1" style={{ color: qualityMeta.color }}>
                                    {isConnected ? <Wifi size={11} /> : <WifiOff size={11} />}{pingText}
                                </span>
                            </span>
                        </span>
                        {isExpanded ? <ChevronUp size={15} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={15} style={{ color: 'var(--text-muted)' }} />}
                    </button>

                    <button
                        type="button"
                        onClick={handlePingCheck}
                        disabled={!isConnected || isCheckingPing}
                        className="h-10 shrink-0 rounded-2xl px-3 flex items-center justify-center gap-1.5 text-[10px] font-bold transition-all disabled:opacity-60"
                        style={{ background: qualityMeta.bg, color: qualityMeta.color, border: `1px solid ${qualityMeta.border}` }}
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
                            >
                                {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                                {isMuted ? 'Unmute' : 'Mute'}
                            </button>
                            <button
                                type="button"
                                onClick={toggleVoice}
                                className="flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-400"
                            >
                                <PhoneOff size={15} />
                                <span className="hidden sm:inline">Leave</span>
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={toggleVoice}
                            className="col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/15 px-3 py-2.5 text-xs font-bold text-green-400"
                        >
                            <PhoneCall size={15} />
                            Join Voice
                        </button>
                    )}
                </div>

                <AnimatePresence>
                    {audioBlocked && (
                        <MotionDiv
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-2"
                        >
                            <span className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                                <Headphones size={14} /> Tap to enable voice audio.
                            </span>
                            <button type="button" onClick={enableVoiceAudio} className="rounded-xl bg-white px-3 py-1.5 text-[10px] font-bold text-black">Enable</button>
                        </MotionDiv>
                    )}
                </AnimatePresence>

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
                            <div className="mt-3 border-t border-white/10 pt-3">
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                                        <div className="text-[10px] font-bold uppercase text-zinc-600">Signaling</div>
                                        <div className="mt-1 flex items-center gap-1.5 text-xs font-bold" style={{ color: qualityMeta.color }}>
                                            {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}{pingText}
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                                        <div className="text-[10px] font-bold uppercase text-zinc-600">WebRTC</div>
                                        <div className="mt-1 truncate text-xs font-bold text-zinc-200">{peerSummary}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                                        <div className="text-[10px] font-bold uppercase text-zinc-600">Active</div>
                                        <div className="mt-1 text-xs font-bold text-zinc-200">{voiceUsers.length}/{MAX_VOICE_PARTICIPANTS}</div>
                                    </div>
                                </div>

                                {(voiceError || iceWarning) && (
                                    <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs font-semibold ${voiceError ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-200'}`}>
                                        {voiceError || iceWarning}
                                    </div>
                                )}

                                <div className="mt-3 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                                    {voiceUsers.length === 0 ? (
                                        <div className="py-5 text-center text-xs font-medium text-zinc-600">No active voice users</div>
                                    ) : (
                                        <div className="space-y-2">
                                            {voiceUsers.map(user => {
                                                const isMe = user.id === currentUser?.id;
                                                const status = isMe
                                                    ? (user.isMuted ? 'Muted' : 'Your microphone')
                                                    : (peerStatuses[user.id]?.status || 'Connecting');
                                                const detail = peerStatuses[user.id];
                                                return (
                                                    <div key={user.id} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-zinc-700 via-neutral-500 to-zinc-300 text-[11px] font-bold text-white">
                                                            {user.nickname?.charAt(0)?.toUpperCase() || '?'}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="truncate text-xs font-bold text-zinc-100">{user.nickname}</span>
                                                                {isMe && <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">You</span>}
                                                            </div>
                                                            <div className={`mt-0.5 truncate text-[10px] font-medium ${status === 'Failed' ? 'text-red-400' : status === 'Reconnecting' ? 'text-amber-300' : 'text-zinc-500'}`}>
                                                                {status}
                                                                {!isMe && detail?.candidateType ? ` · ${detail.connectionType} · ${detail.candidateType}` : ''}
                                                            </div>
                                                        </div>
                                                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${user.isMuted ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                                                            {user.isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                                                        </div>
                                                    </div>
                                                );
                                            })}
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
