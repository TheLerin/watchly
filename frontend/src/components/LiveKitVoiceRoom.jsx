import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, createLocalAudioTrack, Room } from 'livekit-client';
import { RoomContext, RoomAudioRenderer, StartAudio, useConnectionState, useIsMuted, useIsSpeaking, useLocalParticipant, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';
import { ChevronDown, ChevronUp, Mic, MicOff, PhoneCall, PhoneOff, Users } from 'lucide-react';
import { Track } from 'livekit-client';
import { useRoom } from '../context/RoomContext';
import { useAuth } from '../context/AuthContext';
import { socket } from '../socket';
import { createVoiceSession, requestVoiceToken } from '../utils/livekitVoice';
import './livekit-voice.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const stateLabels = { disconnected: 'Not connected', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', 'signal-reconnecting': 'Reconnecting…' };

function VoiceParticipant({ participant }) {
    const speaking = useIsSpeaking(participant);
    const muted = useIsMuted({ participant, source: Track.Source.Microphone });
    return <li className="livekit-voice-person" data-participant-identity={participant.identity} data-muted={muted} data-speaking={speaking && !muted}>
        <span className="livekit-voice-avatar" aria-hidden="true">{(participant.name || '?').charAt(0).toUpperCase()}</span>
        <span className="livekit-voice-name"><strong>{participant.name || 'Watchly member'}{participant.isLocal && <small> You</small>}</strong><span>{muted ? 'Muted' : speaking ? 'Speaking' : 'Microphone on'}</span></span>
        {muted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
    </li>;
}

function VoiceControls({ room, controllerRef, joining, error, variant, className, onError }) {
    const { roomActionsEnabled } = useRoom();
    const connection = useConnectionState(), participants = useParticipants();
    const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
    const [expanded, setExpanded] = useState(false), [muting, setMuting] = useState(false);
    const active = connection !== ConnectionState.Disconnected;
    const connected = connection === ConnectionState.Connected;
    const voiceUsers = active ? participants.filter(person => person.identity) : [];
    const toggleMute = async () => {
        if (muting) return;
        setMuting(true); onError('');
        try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }
        catch { onError('Your microphone could not change. Leave voice and join again.'); }
        finally { setMuting(false); }
    };
    return <div className={`room-voice livekit-voice ${className}`} data-room-variant={variant} data-voice-provider="livekit" data-voice-state={connection}>
        <RoomAudioRenderer room={room} />
        <div className="livekit-voice-heading"><button type="button" className="livekit-voice-title" aria-expanded={expanded} aria-controls="livekit-voice-participants" onClick={() => setExpanded(!expanded)}>
            <span className="livekit-voice-icon"><PhoneCall size={18} /></span><span><strong>Voice Call</strong><span className="livekit-voice-status" role="status">{joining ? 'Joining voice…' : stateLabels[connection] || connection}</span></span>
            <span className="livekit-voice-count"><Users size={13} />{voiceUsers.length}</span>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button></div>
        <div className="livekit-voice-actions">
            {active || joining ? <><button type="button" disabled={!connected || joining || muting} onClick={toggleMute}>{isMicrophoneEnabled ? <Mic size={15} /> : <MicOff size={15} />}{isMicrophoneEnabled ? 'Mute' : 'Unmute'}</button><button type="button" className="livekit-voice-leave" onClick={() => { onError(''); void controllerRef.current?.leave(); }}><PhoneOff size={15} />Leave Voice</button></> : <button type="button" className="room-voice-join livekit-voice-join" disabled={!roomActionsEnabled} onClick={() => { setExpanded(true); void controllerRef.current?.join(); }}><PhoneCall size={15} />Join Voice</button>}
        </div>
        <StartAudio label="Enable voice audio" room={room} className="livekit-voice-start-audio" />
        {error && <p className="livekit-voice-error" role="alert">{error}</p>}
        <div id="livekit-voice-participants" hidden={!expanded}>
            {voiceUsers.length ? <ul className="livekit-voice-people" aria-label="Voice participants">{voiceUsers.map(person => <VoiceParticipant key={person.identity} participant={person} />)}</ul> : <p className="livekit-voice-empty">Join voice when you’re ready. Your camera stays off.</p>}
        </div>
    </div>;
}

export default function LiveKitVoiceRoom({ variant = 'classic', className = '' }) {
    const watchly = useRoom(), { session } = useAuth();
    const [room] = useState(() => new Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }));
    const [view, setView] = useState({ joining: false, error: '' });
    const latest = useRef(null), controllerRef = useRef(null);
    useEffect(() => { latest.current = { watchly, session }; }, [watchly, session]);
    useEffect(() => {
        let mounted = true;
        const voice = createVoiceSession({
            room,
            canJoin: () => mounted && latest.current.watchly.canSendRoomAction(),
            requestToken: signal => {
                const { watchly: current, session: account } = latest.current;
                return requestVoiceToken({ backendUrl: BACKEND_URL, roomId: current.roomId, memberId: current.currentUser?.userId, socketId: socket.id, accountToken: account?.access_token, signal });
            },
            createMicrophone: () => createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }),
            onState: patch => { if (mounted) setView(current => ({ ...current, ...patch })); },
        });
        controllerRef.current = voice;
        return () => { mounted = false; controllerRef.current = null; void voice.leave(); };
    }, [room]);
    const onError = useCallback(error => setView(current => ({ ...current, error })), []);
    return <RoomContext.Provider value={room}><VoiceControls room={room} controllerRef={controllerRef} joining={view.joining} error={view.error} onError={onError} variant={variant} className={className} /></RoomContext.Provider>;
}
