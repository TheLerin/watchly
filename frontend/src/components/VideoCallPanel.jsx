import { useEffect, useState } from 'react';
import { Track, ConnectionState } from 'livekit-client';
import { useConnectionState, useIsMuted, useIsSpeaking, useLocalParticipant, useSpeakingParticipants, useTracks, VideoTrack } from '@livekit/components-react';
import { Camera, CameraOff, ExternalLink, Mic, MicOff, PhoneOff, Settings2, SwitchCamera } from 'lucide-react';
import { useMediaCall, mediaStateLabel } from './LiveKitMediaProvider';
import { useRoom } from '../context/RoomContext';
import Avatar from './account/Avatar';
import './video-call.css';

function CameraTile({ reference }) {
    const { users } = useRoom(), participant = reference.participant;
    const speaking = useIsSpeaking(participant);
    const micMuted = useIsMuted({ participant, source: Track.Source.Microphone });
    const cameraMuted = useIsMuted({ participant, source: Track.Source.Camera });
    const publication = reference.publication;
    const live = publication?.track && !cameraMuted && publication.track.mediaStreamTrack.readyState !== 'ended';
    const member = users.find(user => `watchly-${user.userId}` === participant.identity);
    const name = member?.nickname || participant.name || 'Watchly member';
    return <div className="call-camera-tile" data-identity={participant.identity} data-camera-on={Boolean(live)} data-speaking={speaking && !micMuted}>
        {live ? <VideoTrack trackRef={reference} muted playsInline autoPlay /> : <div className="call-camera-fallback"><Avatar name={name} url={member?.avatarUrl} size={44} /><span>Camera off</span></div>}
        <div className="call-camera-caption"><span title={name}>{name}{participant.isLocal && <small> You</small>}</span><span aria-label={micMuted ? 'Microphone muted' : 'Microphone on'}>{micMuted ? <MicOff size={13} /> : <Mic size={13} />}</span></div>
    </div>;
}

function DeviceSettings() {
    const { act, onError, room } = useMediaCall();
    const [devices, setDevices] = useState([]), [selected, setSelected] = useState({});
    useEffect(() => {
        let current = true;
        const read = async () => { try { const values = await navigator.mediaDevices?.enumerateDevices(); if (current) setDevices(values || []); } catch { /* Device labels may be unavailable until permission is granted. */ } };
        void read(); navigator.mediaDevices?.addEventListener('devicechange', read);
        return () => { current = false; navigator.mediaDevices?.removeEventListener('devicechange', read); };
    }, []);
    const change = async (kind, deviceId) => {
        try { await act('switchDevice', kind, deviceId); setSelected(values => ({ ...values, [kind]: deviceId })); }
        catch { onError('That device is unavailable. Select another device or try again.'); }
    };
    return <div className="call-device-settings">
        {['videoinput', 'audioinput'].map(kind => <label key={kind}>{kind === 'videoinput' ? 'Camera device' : 'Microphone device'}
            <select aria-label={kind === 'videoinput' ? 'Camera device' : 'Microphone device'} value={selected[kind] || room.getActiveDevice(kind) || ''} onChange={event => void change(kind, event.target.value)}>
                <option value="">System default</option>{devices.filter(device => device.kind === kind && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${index + 1}`}</option>)}
            </select>
        </label>)}
        <button type="button" onClick={() => void act('flipCamera').catch(() => onError('Camera switching is unavailable on this device.'))}><SwitchCamera size={14} />Switch front / rear camera</button>
        <p>Device names appear after browser permission is granted.</p>
    </div>;
}

export function VideoCallContent({ floating = false, compact = false, onPopOut }) {
    const { room, act, view } = useMediaCall(), { roomActionsEnabled } = useRoom();
    const connection = useConnectionState(), { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
    const references = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
    const speakers = useSpeakingParticipants();
    const [devicesOpen, setDevicesOpen] = useState(false);
    const connected = connection === ConnectionState.Connected;
    const participants = connection === ConnectionState.Disconnected ? [] : references.filter(ref => ref.participant.identity);
    const ordered = [...participants].sort((a, b) => Number(speakers.includes(b.participant)) - Number(speakers.includes(a.participant)) || Number(b.participant.isLocal) - Number(a.participant.isLocal));
    const tiles = compact ? ordered.slice(0, 1) : ordered;
    return <div className="video-call-content" data-call-state={connection} data-camera-on={isCameraEnabled} data-microphone-on={isMicrophoneEnabled} data-call-room={room.name}>
        <div className="video-call-status" role="status">{view.cameraBusy ? 'Starting camera…' : mediaStateLabel(connection)}<span>{isCameraEnabled ? 'Camera On' : 'Camera Off'}</span></div>
        <div className="video-call-actions">
            {connection === ConnectionState.Disconnected ? <button type="button" disabled={!roomActionsEnabled || view.cameraBusy} onClick={() => void act('cameraOn')}><Camera size={15} />Join video</button>
                : <><button type="button" aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'} disabled={!connected || view.cameraBusy} onClick={() => void act(isCameraEnabled ? 'cameraOff' : 'cameraOn')}>
                    {isCameraEnabled ? <Camera size={15} /> : <CameraOff size={15} />}<span className="call-button-label">{isCameraEnabled ? 'Camera On' : 'Camera Off'}</span></button>
                <button type="button" aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'} disabled={!connected || view.micBusy} onClick={() => void act('toggleMicrophone')}>{isMicrophoneEnabled ? <Mic size={15} /> : <MicOff size={15} />}<span className="call-button-label">{isMicrophoneEnabled ? 'Mute' : 'Unmute'}</span></button></>}
            {!floating && <button type="button" aria-label="Pop out video call" onClick={onPopOut}><ExternalLink size={15} />Pop out</button>}
            <button type="button" aria-label="Call device settings" aria-expanded={devicesOpen} onClick={() => setDevicesOpen(!devicesOpen)}><Settings2 size={15} /><span className="call-button-label">Devices</span></button>
            {connection !== ConnectionState.Disconnected && <button type="button" aria-label="Leave call" onClick={() => void act('leave')}><PhoneOff size={15} /><span className="call-button-label">Leave call</span></button>}
        </div>
        {devicesOpen && <DeviceSettings />}
        {(view.cameraError || view.error) && <div className="call-error" role="alert">{view.cameraError || view.error}
            {view.cameraError && <div><button type="button" disabled={view.cameraBusy} onClick={() => void act('cameraOn')}>Try again</button><button type="button" onClick={() => void act('openWithoutCamera')}>Open without camera</button></div>}
        </div>}
        {tiles.length ? <div className="call-camera-grid" data-count={tiles.length} aria-label="Video call participants">{tiles.map(ref => <CameraTile key={ref.participant.identity} reference={ref} />)}</div>
            : <p className="call-empty">Join video when you’re ready. Your camera stays off until you choose to enable it.</p>}
    </div>;
}

export default function VideoCallPanel({ mode, onPopOut, onRestore }) {
    return <div className="room-video-call" aria-label="Video Call"><h2>Video Call</h2>
        {mode === 'floating' ? <div className="call-empty">Video is popped out.<button type="button" onClick={onRestore}>Restore video panel</button></div>
            : <VideoCallContent onPopOut={onPopOut} />}
    </div>;
}
