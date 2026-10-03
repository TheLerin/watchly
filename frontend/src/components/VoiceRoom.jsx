import { lazy, Suspense } from 'react';
import { useRoom } from '../context/RoomContext';

// Keep the complete legacy implementation until two-browser LiveKit audio is
// verified. A public build-time provider flag offers a rollback without keys.
const VoiceProvider = import.meta.env.VITE_VOICE_PROVIDER === 'legacy'
    ? lazy(() => import('./VoiceRoomLegacy'))
    : lazy(() => import('./LiveKitVoiceRoom'));

export default function VoiceRoom(props) {
    const { roomId, currentUser } = useRoom();
    return <Suspense fallback={<div className="room-voice" role="status">Loading voice controls…</div>}>
        <VoiceProvider key={`${roomId}:${currentUser?.userId}`} {...props} />
    </Suspense>;
}
