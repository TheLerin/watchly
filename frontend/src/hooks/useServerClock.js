import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../socket';
import { createClockSampler } from '../utils/clockSampler';

const epochNow = () => performance.timeOrigin + performance.now();

export default function useServerClock(enabled) {
    const offsetRef = useRef(0);
    const [quality, setQuality] = useState({ offsetMs: 0, rttMs: null, sampledAt: null });

    const samplerRef = useRef(null);
    const sample = useCallback((count = 7) => enabled ? samplerRef.current?.sample(count) || Promise.resolve(null) : Promise.resolve(null), [enabled]);

    useEffect(() => {
        if (!enabled) return undefined;
        const sampler = samplerRef.current = createClockSampler({ connected: () => socket.connected, now: epochNow,
            request: sent => new Promise(resolve => socket.timeout(2500).emit('clock:ping', { clientSendMs: sent }, (error, result) => resolve(error ? null : result))),
            onResult: result => { offsetRef.current = result.offsetMs; setQuality(result); },
        });
        sample(7);
        const interval = setInterval(() => { if (!document.hidden) void sample(3); }, 120000);
        const visible = () => { if (document.visibilityState === 'visible') sample(7); };
        document.addEventListener('visibilitychange', visible);
        const reconnect = () => { void sample(7); };
        socket.on('connect', reconnect);
        return () => { sampler.cancel(); samplerRef.current = null; clearInterval(interval); socket.off('connect', reconnect); document.removeEventListener('visibilitychange', visible); };
    }, [enabled, sample]);

    const serverNow = useCallback(() => epochNow() + offsetRef.current, []);
    const toLocalDelay = useCallback(serverMs => serverMs - serverNow(), [serverNow]);
    return useMemo(() => ({ ...quality, sample, serverNow, toLocalDelay }), [quality, sample, serverNow, toLocalDelay]);
}
