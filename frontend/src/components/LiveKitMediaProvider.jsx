/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createLocalAudioTrack, createLocalVideoTrack, DisconnectReason, Room, RoomEvent, VideoPresets } from 'livekit-client';
import { RoomContext, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import '@livekit/components-styles';
import { useRoom } from '../context/RoomContext';
import { useAuth } from '../context/AuthContext';
import { socket } from '../socket';
import { requestVoiceToken } from '../utils/livekitVoice';
import { createMediaSession } from '../utils/livekitMedia';
import { useSoundEffects } from '../context/SoundEffectsContext';
import { createCallPresenceSounds, createMediaActionSounds } from '../utils/soundNotifications';

const MediaContext = createContext(null);
export const useMediaCall = () => useContext(MediaContext);
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
export const mediaStateLabel = connection => ({ disconnected: 'Not connected', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', signalReconnecting: 'Reconnecting…' })[connection] || connection;

export default function LiveKitMediaProvider({ children }) {
    const { playSound } = useSoundEffects();
    const watchly = useRoom(), { session } = useAuth();
    const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution, frameRate: 24 },
        publishDefaults: { videoCodec: 'vp8', simulcast: true },
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }));
    const [view, setView] = useState({ joining: false, micBusy: false, cameraBusy: false, error: '', cameraError: '' });
    const latest = useRef({ watchly, session }), controllerRef = useRef(null);
    useEffect(() => { latest.current = { watchly, session }; }, [watchly, session]);
    useEffect(() => {
        let mounted = true;
        const controller = createMediaSession({ room,
            canJoin: () => mounted && latest.current.watchly.canSendRoomAction(),
            requestToken: signal => {
                const { watchly: current, session: account } = latest.current;
                return requestVoiceToken({ backendUrl: BACKEND_URL, roomId: current.roomId, memberId: current.currentUser?.userId, socketId: socket.id, accountToken: account?.access_token, signal });
            },
            createMicrophone: options => createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...options }),
            createCamera: options => createLocalVideoTrack({ resolution: VideoPresets.h720.resolution, frameRate: 24, ...options }),
            onState: patch => { if (mounted) setView(current => ({ ...current, ...patch })); },
        });
        controller.actWithSounds = createMediaActionSounds({ room, act: (action, ...args) => controller[action](...args), play: name => { if (mounted) playSound(name); } });
        controllerRef.current = controller;
        room.on(RoomEvent.Disconnected, controller.reset);
        return () => { mounted = false; room.off(RoomEvent.Disconnected, controller.reset); controllerRef.current = null; void controller.leave(); };
    }, [room, playSound]);
    const act = useCallback((action, ...args) => controllerRef.current?.actWithSounds(action, ...args), []);
    useEffect(() => {
        const presence = createCallPresenceSounds({ play: playSound, ready: () => latest.current.watchly.canSendRoomAction() });
        const state = connection => { if (connection === 'connected') presence.baseline([...room.remoteParticipants.keys()]); else presence.suspend(); };
        const joined = participant => presence.joined(participant.identity);
        const left = (participant, reason) => presence.left(participant.identity, reason === DisconnectReason.CLIENT_INITIATED || reason === DisconnectReason.PARTICIPANT_REMOVED);
        const disconnected = reason => { if (reason === DisconnectReason.CLIENT_INITIATED) presence.reset(); else presence.suspend(); };
        state(room.state);
        room.on(RoomEvent.ConnectionStateChanged, state).on(RoomEvent.ParticipantConnected, joined).on(RoomEvent.ParticipantDisconnected, left).on(RoomEvent.Disconnected, disconnected);
        return () => { room.off(RoomEvent.ConnectionStateChanged, state).off(RoomEvent.ParticipantConnected, joined).off(RoomEvent.ParticipantDisconnected, left).off(RoomEvent.Disconnected, disconnected); };
    }, [room, playSound]);
    const onError = useCallback(error => setView(current => ({ ...current, error })), []);
    return <RoomContext.Provider value={room}><MediaContext.Provider value={{ room, view, act, onError }}>
        {children}
        <div className="watchly-media-audio"><RoomAudioRenderer room={room} /><StartAudio label="Enable call audio" room={room} /></div>
    </MediaContext.Provider></RoomContext.Provider>;
}
