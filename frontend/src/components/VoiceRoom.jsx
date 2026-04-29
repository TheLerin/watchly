import React, { useEffect, useState, useRef } from 'react';
import { Mic, MicOff, Phone, PhoneOff, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoom } from '../context/RoomContext';
import { socket } from '../socket';

const VoiceRoom = () => {
    const { roomId, currentUser, users, isConnected } = useRoom();
    const [isVoiceActive, setIsVoiceActive] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    
    const localStreamRef = useRef(null);
    const peersRef = useRef({}); // { [socketId]: RTCPeerConnection }
    const audioRefs = useRef({}); // { [socketId]: HTMLAudioElement }

    // Active voice users (including self if active)
    const voiceUsers = users.filter(u => u.isVoiceActive);
    if (isVoiceActive && currentUser) {
        if (!voiceUsers.some(u => u.id === currentUser.id)) {
            voiceUsers.push({ ...currentUser, isVoiceActive: true, isMuted });
        }
    }

    const ICE_SERVERS = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    };

    const cleanupWebRTC = () => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        Object.values(peersRef.current).forEach(peer => peer.close());
        peersRef.current = {};
        
        Object.values(audioRefs.current).forEach(audio => {
            audio.pause();
            audio.srcObject = null;
        });
        audioRefs.current = {};
    };

    const toggleVoice = async (e) => {
        if (e) e.stopPropagation();
        
        if (isVoiceActive) {
            // Leave voice
            cleanupWebRTC();
            setIsVoiceActive(false);
            socket.emit('toggle_voice', { roomId, isVoiceActive: false, isMuted: true });
        } else {
            // Join voice
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localStreamRef.current = stream;
                stream.getAudioTracks()[0].enabled = !isMuted;
                setIsVoiceActive(true);
                setIsExpanded(true); // Auto expand when joining
                
                socket.emit('toggle_voice', { roomId, isVoiceActive: true, isMuted });

                // Create offers for all users already in voice
                const otherVoiceUsers = users.filter(u => u.isVoiceActive && u.id !== currentUser?.id);
                for (const user of otherVoiceUsers) {
                    createPeerConnection(user.id, true);
                }
            } catch (err) {
                console.error("Failed to access microphone:", err);
                alert("Could not access microphone. Please check permissions.");
            }
        }
    };

    const toggleMute = (e) => {
        if (e) e.stopPropagation();
        
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = isMuted; // Toggle: if currently muted, enable it
                setIsMuted(!isMuted);
                socket.emit('toggle_voice', { roomId, isVoiceActive, isMuted: !isMuted });
            }
        }
    };

    const createPeerConnection = async (targetSocketId, isInitiator) => {
        if (peersRef.current[targetSocketId]) return peersRef.current[targetSocketId];

        const peer = new RTCPeerConnection(ICE_SERVERS);
        peersRef.current[targetSocketId] = peer;

        // Add local stream tracks
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peer.addTrack(track, localStreamRef.current);
            });
        }

        // Handle incoming ICE candidates
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_ice_candidate', {
                    targetSocketId,
                    candidate: event.candidate
                });
            }
        };

        // Handle incoming audio tracks
        peer.ontrack = (event) => {
            let audio = audioRefs.current[targetSocketId];
            if (!audio) {
                audio = new Audio();
                audio.autoplay = true;
                audioRefs.current[targetSocketId] = audio;
            }
            audio.srcObject = event.streams[0];
        };

        // Negotiate
        if (isInitiator) {
            try {
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                socket.emit('webrtc_offer', { targetSocketId, offer });
            } catch (err) {
                console.error("Error creating offer:", err);
            }
        }

        peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed' || peer.connectionState === 'closed') {
                peer.close();
                delete peersRef.current[targetSocketId];
                if (audioRefs.current[targetSocketId]) {
                    audioRefs.current[targetSocketId].pause();
                    audioRefs.current[targetSocketId].srcObject = null;
                    delete audioRefs.current[targetSocketId];
                }
            }
        };

        return peer;
    };

    // WebRTC Signaling Event Handlers
    useEffect(() => {
        if (!socket) return;

        const handleOffer = async ({ senderSocketId, offer }) => {
            if (!isVoiceActive) return; // Ignore offers if not in voice
            const peer = await createPeerConnection(senderSocketId, false);
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                socket.emit('webrtc_answer', { targetSocketId: senderSocketId, answer });
            } catch (err) {
                console.error("Error handling offer:", err);
            }
        };

        const handleAnswer = async ({ senderSocketId, answer }) => {
            const peer = peersRef.current[senderSocketId];
            if (peer) {
                try {
                    await peer.setRemoteDescription(new RTCSessionDescription(answer));
                } catch (err) {
                    console.error("Error handling answer:", err);
                }
            }
        };

        const handleIceCandidate = async ({ senderSocketId, candidate }) => {
            const peer = peersRef.current[senderSocketId];
            if (peer) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error("Error adding ice candidate:", err);
                }
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
    }, [isVoiceActive, roomId]);

    // Cleanup on unmount or disconnect
    useEffect(() => {
        if (!isConnected && isVoiceActive) {
            cleanupWebRTC();
            setIsVoiceActive(false);
        }
        return () => {
            cleanupWebRTC();
        };
    }, [isConnected]);

    return (
        <div className="mb-2 glass-panel rounded-2xl overflow-hidden shrink-0" style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
            <button 
                onClick={() => setIsExpanded(v => !v)}
                className="flex items-center justify-between w-full px-4 py-3 hover:brightness-110 transition-all"
            >
                <div className="flex items-center gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold syne" style={{ color:'var(--text)' }}>
                        <Phone size={14} style={{ color: isVoiceActive ? '#4ade80' : 'var(--accent)' }} />
                        Voice Lounge
                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background:'var(--accent-soft)', color:'var(--accent)', border:'1px solid var(--accent-border)' }}>
                            {voiceUsers.length}
                        </span>
                    </span>
                </div>
                
                <div className="flex items-center gap-3">
                    {/* Inline controls to join/leave without expanding */}
                    {isVoiceActive ? (
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={toggleMute}
                                className={`p-1 rounded-lg transition-all ${isMuted ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-gray-500/20 text-gray-300 hover:bg-gray-500/30'}`}
                                title={isMuted ? "Unmute" : "Mute"}
                            >
                                {isMuted ? <MicOff size={13} /> : <Mic size={13} />}
                            </button>
                            <button
                                onClick={toggleVoice}
                                className="p-1 rounded-lg transition-all bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                title="Leave Voice"
                            >
                                <PhoneOff size={13} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={toggleVoice}
                            className="text-xs font-semibold px-2 py-1 rounded transition-all bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20"
                        >
                            Join
                        </button>
                    )}
                    {isExpanded ? <ChevronUp size={13} style={{ color:'var(--text-muted)' }}/> : <ChevronDown size={13} style={{ color:'var(--text-muted)' }}/>}
                </div>
            </button>
            
            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div key="voice-body" initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
                        exit={{ height:0, opacity:0 }} transition={{ duration:0.22 }}
                        className="overflow-hidden" style={{ borderTop:'1px solid var(--glass-border)' }}>
                        <div className="p-3 max-h-40 overflow-y-auto custom-scrollbar">
                            {voiceUsers.length === 0 ? (
                                <div className="w-full text-center py-4 text-xs text-gray-500">
                                    No one is in voice.
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <AnimatePresence>
                                        {voiceUsers.map(user => (
                                            <motion.div
                                                key={user.id}
                                                initial={{ opacity: 0, scale: 0.8 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.8 }}
                                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border ${user.isMuted ? 'border-white/5 bg-white/5' : 'border-green-500/30 bg-green-500/10'}`}
                                            >
                                                <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-[10px] text-white">
                                                    {user.nickname.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="max-w-[80px] truncate" style={{ color: 'var(--text)' }}>
                                                    {user.nickname} {user.id === currentUser?.id ? '(You)' : ''}
                                                </span>
                                                {user.isMuted && <MicOff size={10} className="text-red-400 ml-1" />}
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default VoiceRoom;
