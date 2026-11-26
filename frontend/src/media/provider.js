import * as livekit from './livekitAdapter';

const selected = import.meta.env.VITE_MEDIA_PROVIDER || 'livekit';
const adapters = { livekit };
if (!adapters[selected]) throw new Error('The selected media provider has not been installed.');
export const { Room, RoomEvent, VideoPresets, DisconnectReason, Track, ConnectionState,
    createLocalAudioTrack, createLocalVideoTrack, RoomContext, RoomAudioRenderer, StartAudio,
    useConnectionState, useIsMuted, useIsSpeaking, useLocalParticipant, useSpeakingParticipants,
    useTracks, VideoTrack, useParticipants } = adapters[selected];

// Future adapters normalize participant identity/name, publications/tracks, device operations,
// capture cleanup, speaking/mute state and connection state to this contract. Application rooms,
// synchronization, chat, permissions and layouts continue to use the same interface.
