import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createYouTubePlaylistSession } from '../utils/youtubePlaylistSession';

export default function useYouTubePlaylist({ state, playerRef, isController, getPosition, send, onError, resyncId }) {
    const latest = useRef({ state, isController, getPosition, send, onError });
    const [readyItem, setReadyItem] = useState(null);
    useEffect(() => { latest.current = { state, isController, getPosition, send, onError }; });
    const runtime = useRef(null);
    useEffect(() => {
        runtime.current = createYouTubePlaylistSession({
            getState: () => latest.current.state,
            getPlayer: () => playerRef.current?.getInternalPlayer?.(),
            isController: () => latest.current.isController,
            getPosition: value => latest.current.getPosition(value),
            send: (...args) => latest.current.send(...args),
            onError: message => latest.current.onError(message),
            onReady: (ready, key) => setReadyItem(ready ? key : null),
        });
        return () => { runtime.current = null; };
    }, [playerRef]);
    const tick = useCallback(() => runtime.current?.tick(), []);
    const ready = useCallback(() => runtime.current?.ready() || false, []);
    const canEmit = useCallback(() => runtime.current?.canEmit() || false, []);
    const fail = useCallback(message => runtime.current?.fail(message), []);
    const session = useMemo(() => ({ tick, ready, canEmit, fail }), [tick, ready, canEmit, fail]);
    useEffect(() => { if (resyncId != null) runtime.current?.resync(); }, [resyncId]);
    useEffect(() => {
        if (state.sourceType !== 'youtube-playlist') return;
        const timer = setInterval(session.tick, 200);
        return () => clearInterval(timer);
    }, [session, state.sourceType, state.sourceId]);
    return { session, ready: state.playlistStatus === 'ready' && readyItem === `${state.sourceId}:${state.sourceRevision}` };
}
