import React, { useEffect, useRef, useState } from 'react';
import { MonitorUp, Square } from 'lucide-react';
import useScreenShare from '../../hooks/useScreenShare';
import { useRoom } from '../../context/RoomContext';
import { socket } from '../../socket';

export default function ScreenShareAdapter() {
    const { currentUser, controllerMemberId } = useRoom();
    const [iceServers, setIceServers] = useState([{ urls: 'stun:stun.l.google.com:19302' }]);
    const [iceWarning, setIceWarning] = useState('');
    useEffect(() => {
        if (!currentUser) return undefined;
        socket.timeout(8000).emit('ice:config', {}, (error, value) => {
            if (!error && value?.ok && Array.isArray(value.iceServers)) {
                setIceServers(value.iceServers);
                setIceWarning(value.turnConfigured ? '' : 'TURN is not configured; restrictive networks may not connect.');
            }
        });
        return undefined;
    }, [currentUser]);
    const { supported, sharing, remoteStream, status, warning, start, stop } = useScreenShare(iceServers);
    const [error, setError] = useState(''); const [playBlocked, setPlayBlocked] = useState(false); const videoRef = useRef(null);
    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = remoteStream;
        if (remoteStream) videoRef.current.play().catch(() => setPlayBlocked(true));
    }, [remoteStream]);
    if (!supported) return <p className="p-3 text-xs text-zinc-500">Screen sharing is not supported by this browser.</p>;
    return <section className="rounded-xl border border-white/10 p-3">
        {remoteStream && <div className="relative mb-2"><video ref={videoRef} autoPlay playsInline controls className="w-full rounded-lg" />
            {playBlocked && <button onClick={() => videoRef.current?.play().then(() => setPlayBlocked(false))} className="absolute inset-0 bg-black/70 font-bold text-white">Click to enable shared playback</button>}</div>}
        {currentUser?.userId === controllerMemberId && <button onClick={async () => { setError(''); try { if (sharing) stop(); else await start(); } catch (e) { setError(e.name === 'NotAllowedError' ? 'Screen permission was denied. Nothing was shared; try again only when ready.' : e.message); } }} className="flex items-center gap-2 text-xs font-bold text-zinc-300">
            {sharing ? <Square size={14}/> : <MonitorUp size={14}/>} {sharing ? 'Stop sharing' : 'Share Screen (Beta)'}
        </button>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {warning && <p className="mt-2 text-xs text-amber-400">{warning}</p>}
        {iceWarning && <p className="mt-2 text-xs text-amber-400">{iceWarning}</p>}
        {status !== 'idle' && <p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">{status.replaceAll('-', ' ')}</p>}
    </section>;
}
