import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';

const epochNow = () => performance.timeOrigin + performance.now();
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;

export default function useServerClock(enabled) {
    const offsetRef = useRef(0);
    const [quality, setQuality] = useState({ offsetMs: 0, rttMs: null, sampledAt: null });

    const sample = useCallback(async (count = 7) => {
        if (!socket.connected) return null;
        const samples = [];
        for (let index = 0; index < count; index += 1) {
            const sent = epochNow();
            const response = await new Promise(resolve => socket.timeout(2500).emit(
                'clock:ping', { clientSendMs: sent }, (error, value) => resolve(error ? null : value)
            ));
            const received = epochNow();
            if (response?.serverTimeMs) samples.push({
                rtt: received - sent,
                offset: response.serverTimeMs - ((sent + received) / 2)
            });
        }
        if (!samples.length) return null;
        const best = samples.sort((a, b) => a.rtt - b.rtt).slice(0, 5);
        offsetRef.current = median(best.map(item => item.offset));
        const next = { offsetMs: offsetRef.current, rttMs: median(best.map(item => item.rtt)), sampledAt: Date.now() };
        setQuality(next);
        return next;
    }, []);

    useEffect(() => {
        if (!enabled) return undefined;
        sample(7);
        const interval = setInterval(() => sample(3), 30000);
        const visible = () => { if (document.visibilityState === 'visible') sample(7); };
        document.addEventListener('visibilitychange', visible);
        return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
    }, [enabled, sample]);

    return { ...quality, sample, serverNow: () => epochNow() + offsetRef.current, toLocalDelay: serverMs => serverMs - (epochNow() + offsetRef.current) };
}
