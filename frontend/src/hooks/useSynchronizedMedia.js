import { useEffect, useMemo } from 'react';
import { createMediaSynchronizer } from '../utils/mediaSynchronizer';

export default function useSynchronizedMedia({ clock, durationSec, mediaId, onPlayError }) {
    const { serverNow, toLocalDelay } = clock;
    const synchronizer = useMemo(() => {
        // Each media session has its own sequence and pending work.
        void mediaId;
        return createMediaSynchronizer({ serverNow, toLocalDelay, duration: () => durationSec, onPlayError });
    }, [serverNow, toLocalDelay, durationSec, mediaId, onPlayError]);
    useEffect(() => () => synchronizer.reset(), [synchronizer]);
    return synchronizer;
}
