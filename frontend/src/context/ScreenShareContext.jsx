/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useRoom } from './RoomContext';
import { socket } from '../socket';
import useScreenShare from '../hooks/useScreenShare';

const Context = createContext(null);
export const useRoomScreenShare = () => useContext(Context);

// One capture/peer owner per membership, independent of which panel is open.
export function ScreenShareProvider({ children }) {
    const { currentUser } = useRoom();
    const iceServers = useRef([{ urls: 'stun:stun.l.google.com:19302' }]);
    const [iceWarning, setIceWarning] = useState('');
    useEffect(() => {
        if (!currentUser?.id) return;
        let active = true;
        socket.timeout(8000).emit('ice:config', {}, (error, result) => {
            if (!active || error || !result?.ok || !Array.isArray(result.iceServers)) return;
            iceServers.current = result.iceServers;
            setIceWarning(result.turnConfigured ? '' : 'Some networks may need a relay to connect.');
        });
        return () => { active = false; };
    }, [currentUser?.id]);
    const sharing = useScreenShare(iceServers);
    return <Context.Provider value={{ ...sharing, active: Boolean(sharing.sharing || sharing.remoteStream), iceWarning }}>{children}</Context.Provider>;
}
