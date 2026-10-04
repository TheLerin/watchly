/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createLocalAudioTrack, createLocalVideoTrack, Room, RoomEvent, VideoPresets } from 'livekit-client';
import { RoomContext, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import '@livekit/components-styles';
import { useRoom } from '../context/RoomContext';
import { useAuth } from '../context/AuthContext';
import { socket } from '../socket';
import { requestVoiceToken } from '../utils/livekitVoice';
import { createMediaSession } from '../utils/livekitMedia';

const MediaContext = createContext(null);
export const useMediaCall = () => useContext(MediaContext);
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
export const mediaStateLabel = connection => ({ disconnected: 'Not connected', connecting: 'Connecting…', connected: 'Connected', reconnecting: 'Reconnecting…', signalReconnecting: 'Reconnecting…' })[connection] || connection;

export default function LiveKitMediaProvider({ children }) {
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
        controllerRef.current = controller;
        room.on(RoomEvent.Disconnected, controller.reset);
        return () => { mounted = false; room.off(RoomEvent.Disconnected, controller.reset); controllerRef.current = null; void controller.leave(); };
    }, [room]);
    const act = useCallback((action, ...args) => controllerRef.current?.[action](...args), []);
    const onError = useCallback(error => setView(current => ({ ...current, error })), []);
    return <RoomContext.Provider value={room}><MediaContext.Provider value={{ room, view, act, onError }}>
        {children}
        <div className="watchly-media-audio"><RoomAudioRenderer room={room} /><StartAudio label="Enable call audio" room={room} /></div>
    </MediaContext.Provider></RoomContext.Provider>;
}
