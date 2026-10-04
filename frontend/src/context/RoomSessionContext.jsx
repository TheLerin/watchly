/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRoom } from './RoomContext';
import { MediaCallProvider } from '../components/RoomMediaCall';

const RoomSessionContext = createContext(null);
export const useRoomSession = () => useContext(RoomSessionContext);

// This owner is keyed only by real room/member identity. Presentation never
// owns File objects, their URLs, or the shared LiveKit connection.
export function RoomSessionProvider({ children }) {
    const { videoState } = useRoom();
    const localFileRef = useRef(null), localFileUrlRef = useRef(''), localSessionRef = useRef(null);
    const localRemuxSessionRef = useRef(null), aliveRef = useRef(true);
    const [localFileUrl, setLocalFileUrl] = useState('');
    const [localPlaybackUrl, setLocalPlaybackUrl] = useState('');
    const releaseLocalFile = useCallback(() => {
        void localRemuxSessionRef.current?.dispose(); localRemuxSessionRef.current = null;
        if (localFileUrlRef.current) URL.revokeObjectURL(localFileUrlRef.current);
        localFileRef.current = null; localFileUrlRef.current = ''; localSessionRef.current = null;
        setLocalFileUrl(''); setLocalPlaybackUrl('');
    }, []);
    const installLocalFile = useCallback((file, sessionId) => {
        if (!aliveRef.current) throw new Error('This room session has ended.');
        if (localSessionRef.current === sessionId && localFileUrlRef.current) return localFileUrlRef.current;
        releaseLocalFile();
        const url = URL.createObjectURL(file);
        localFileRef.current = file; localFileUrlRef.current = url; localSessionRef.current = sessionId;
        setLocalFileUrl(url); setLocalPlaybackUrl(url);
        return url;
    }, [releaseLocalFile]);
    useEffect(() => {
        // Authoritative source changes release an external media resource;
        // the matching UI URL must be cleared together with that resource.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (localSessionRef.current !== (videoState.localMedia?.sessionId || null)) releaseLocalFile();
    }, [videoState.localMedia?.sessionId, releaseLocalFile]);
    useEffect(() => {
        aliveRef.current = true;
        return () => { aliveRef.current = false; releaseLocalFile(); };
    }, [releaseLocalFile]);
    const value = useMemo(() => ({ localFileRef, localFileUrlRef, localSessionRef, localRemuxSessionRef,
        localFileUrl, localPlaybackUrl, setLocalPlaybackUrl, installLocalFile, releaseLocalFile, aliveRef }),
    [localFileUrl, localPlaybackUrl, installLocalFile, releaseLocalFile]);
    return <RoomSessionContext.Provider value={value}><MediaCallProvider>{children}</MediaCallProvider></RoomSessionContext.Provider>;
}
