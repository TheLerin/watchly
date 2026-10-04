import { useState } from 'react';
import { ConnectionState } from 'livekit-client';
import { useConnectionState, useIsMuted, useIsSpeaking, useLocalParticipant, useParticipants } from '@livekit/components-react';
import '@livekit/components-styles';
import { ChevronDown, ChevronUp, Mic, MicOff, PhoneCall, PhoneOff, Users } from 'lucide-react';
import { Track } from 'livekit-client';
import { useRoom } from '../context/RoomContext';
import { useMediaCall, mediaStateLabel } from './LiveKitMediaProvider';
import './livekit-voice.css';


function VoiceParticipant({ participant }) {
    const speaking = useIsSpeaking(participant);
    const muted = useIsMuted({ participant, source: Track.Source.Microphone });
    return <li className="livekit-voice-person" data-participant-identity={participant.identity} data-muted={muted} data-speaking={speaking && !muted}>
        <span className="livekit-voice-avatar" aria-hidden="true">{(participant.name || '?').charAt(0).toUpperCase()}</span>
        <span className="livekit-voice-name"><strong>{participant.name || 'Watchly member'}{participant.isLocal && <small> You</small>}</strong><span>{muted ? 'Muted' : speaking ? 'Speaking' : 'Microphone on'}</span></span>
        {muted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
    </li>;
}

export default function LiveKitVoiceRoom({ variant = 'classic', className = '' }) {
    const { view: { joining, error, micBusy }, act } = useMediaCall();
    const { roomActionsEnabled } = useRoom();
    const connection = useConnectionState(), participants = useParticipants();
    const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
    const [expanded, setExpanded] = useState(false);
    const active = connection !== ConnectionState.Disconnected;
    const connected = connection === ConnectionState.Connected;
    const voiceUsers = active ? participants.filter(person => person.identity) : [];
    return <div className={`room-voice livekit-voice ${className}`} data-room-variant={variant} data-voice-provider="livekit" data-voice-state={connection}>
        <div className="livekit-voice-heading"><button type="button" className="livekit-voice-title" aria-expanded={expanded} aria-controls="livekit-voice-participants" onClick={() => setExpanded(!expanded)}>
            <span className="livekit-voice-icon"><PhoneCall size={18} /></span><span><strong>Voice Call</strong><span className="livekit-voice-status" role="status">{joining ? 'Joining voice…' : mediaStateLabel(connection)}</span></span>
            <span className="livekit-voice-count"><Users size={13} />{voiceUsers.length}</span>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button></div>
        <div className="livekit-voice-actions">
            {active || joining ? <><button type="button" aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'} disabled={!connected || joining || micBusy} onClick={() => void act('toggleMicrophone')}>{isMicrophoneEnabled ? <Mic size={15} /> : <MicOff size={15} />}{isMicrophoneEnabled ? 'Mute' : 'Unmute'}</button><button type="button" className="livekit-voice-leave" onClick={() => void act('leave')}><PhoneOff size={15} />{isCameraEnabled ? 'Leave call' : 'Leave Voice'}</button></> : <button type="button" className="room-voice-join livekit-voice-join" disabled={!roomActionsEnabled} onClick={() => { setExpanded(true); void act('joinVoice'); }}><PhoneCall size={15} />Join Voice</button>}
        </div>
        {error && <p className="livekit-voice-error" role="alert">{error}</p>}
        <div id="livekit-voice-participants" hidden={!expanded}>
            {voiceUsers.length ? <ul className="livekit-voice-people" aria-label="Voice participants">{voiceUsers.map(person => <VoiceParticipant key={person.identity} participant={person} />)}</ul> : <p className="livekit-voice-empty">Join voice when you’re ready. Your camera stays off.</p>}
        </div>
    </div>;
}
