const identity = state => `${state.sourceId}:${state.sourceRevision}`;

// Uses ReactPlayer's existing YT.Player; never creates an iframe or another
// clock/playback store. The room owns order, while the iframe cues one item.
export function createYouTubePlaylistSession({ getState, getPlayer, isController, getPosition, send, onReady, onError, now = Date.now }) {
    let sourceId, discoveryAt, discoverySent = false, cueIdentity, readyIdentity, readySent;
    let suppressUntil = 0, failedIdentity, reportedFailureIdentity, cueAt, startupAt;
    const currentId = player => player?.getVideoData?.()?.video_id || null;
    const ready = () => {
        const state = getState();
        return state.sourceType === 'youtube-playlist' && readyIdentity === identity(state) && currentId(getPlayer()) === state.currentVideoId;
    };
    const canEmit = () => ready() && now() >= suppressUntil && getState().playlistStatus === 'ready';

    function reportFailure(state, message) {
        const key = identity(state);
        if (reportedFailureIdentity !== key) {
            reportedFailureIdentity = key;
            onError(message);
        }
        if (isController()) {
            failedIdentity = key;
            void send('ERROR', {}, state).then(ok => {
                if (!ok && identity(getState()) === key) failedIdentity = null;
            });
        }
    }

    function fail(message, timedOut = false) {
        const state = getState();
        const key = identity(state);
        if (state.playlistStatus === 'loading' && (discoveryAt == null || now() - discoveryAt < 15000)) {
            tick();
            return;
        }
        if (failedIdentity === key || !['loading', 'ready'].includes(state.playlistStatus)) return;
        const videoId = currentId(getPlayer());
        if (!timedOut && state.currentVideoId && videoId && videoId !== state.currentVideoId) return;
        reportFailure(state, message);
    }

    function tick() {
        const state = getState();
        const player = getPlayer();
        if (state.sourceType !== 'youtube-playlist') return;
        if (sourceId !== state.sourceId) {
            sourceId = state.sourceId;
            discoveryAt = null; discoverySent = false; cueIdentity = null;
            readyIdentity = null; readySent = null; failedIdentity = null; reportedFailureIdentity = null;
            startupAt = now();
        }
        if (!player?.cuePlaylist || !player?.cueVideoById) {
            if (['loading', 'ready'].includes(state.playlistStatus) && now() - startupAt > 20000 && failedIdentity !== identity(state)) {
                reportFailure(state, 'The YouTube player could not initialize. Check your connection and try again.');
            }
            return;
        }
        if (state.playlistStatus === 'loading') {
            if (!isController()) return;
            if (discoveryAt === null) {
                discoveryAt = now();
                player.setLoop?.(false);
                player.setShuffle?.(false);
                player.cuePlaylist({ listType: 'playlist', list: state.playlistId, index: 0, startSeconds: 0 });
            }
            const items = player.getPlaylist?.();
            if (!discoverySent && Array.isArray(items) && items.length && items.every(id => /^[A-Za-z0-9_-]{11}$/.test(id))) {
                discoverySent = true;
                void send('RESOLVE', { items: [...items] }, state).then(ok => {
                    if (!ok && getState().sourceId === state.sourceId) discoverySent = false;
                });
            } else if (!discoverySent && now() - discoveryAt > 15000) {
                fail('YouTube could not load this playlist. Check that it is public and allows embedding.');
            }
            return;
        }
        if (!['ready', 'finished'].includes(state.playlistStatus) || !state.currentVideoId) return;
        const key = identity(state);
        if (cueIdentity !== key) {
            cueIdentity = key;
            readyIdentity = null;
            failedIdentity = null;
            suppressUntil = now() + 600;
            cueAt = now();
            onReady(false, key);
            player.setLoop?.(false);
            player.setShuffle?.(false);
            // Clear the native playlist so only the controller can advance.
            // The complete ordered playlist remains authoritative room state.
            player.cueVideoById({ videoId: state.currentVideoId, startSeconds: getPosition(state) });
            return;
        }
        const nativeItems = player.getPlaylist?.();
        if (readyIdentity !== key && player.getPlayerState?.() === 5 && currentId(player) === state.currentVideoId && (!nativeItems?.length || (nativeItems.length === 1 && nativeItems[0] === state.currentVideoId))) {
            readyIdentity = key;
            onReady(true, key);
        }
        if (state.playlistStatus === 'ready' && readyIdentity === key && readySent !== key) {
            readySent = key;
            void send('READY', { title: player.getVideoData?.()?.title || '' }, state).then(ok => {
                if (!ok && getState().sourceId === state.sourceId && identity(getState()) === key) readySent = null;
            });
        }
        if (readyIdentity !== key && now() - cueAt > 15000) fail('This playlist item could not become ready. Waiting for the next playable item.', true);
    }
    const resync = () => { readySent = null; failedIdentity = null; suppressUntil = now() + 600; };
    return { tick, ready, canEmit, fail, resync };
}
