// Restoration runs only while room controls/drift correction are suppressed.
// Local files retain their existing scheduled canonical synchronizer.
export function createPlayerResync({ getPlayer, getTarget, isReady, youtube = false, embed = false,
    applyLocal, onComplete, onSeek = () => {}, onPlayError = () => {}, onTimeout = () => {},
    schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
    let disposed = false, timer, playingPromise = false, localVersion = null, seekIssued = false, targetVersion;
    let lastSeekAt = -Infinity;
    const started = now();
    const cleanup = [];
    const complete = () => { if (!disposed) { dispose(); onComplete(); } };
    const pump = () => {
        if (disposed) return;
        if (now() - started > 30000) { dispose(); onTimeout(); return; }
        const player = getPlayer(), target = getTarget();
        if (!player || !target || !isReady() || target.waitMs > 0) return;
        if (target.version !== targetVersion) { targetVersion = target.version; seekIssued = false; }
        if (embed) {
            const position = player.getCurrentTime?.() || 0;
            if ((!seekIssued || (Math.abs(position - target.position) > 1.25 && now() - lastSeekAt >= 1000)) && Math.abs(position - target.position) > 0.15) {
                seekIssued = true; lastSeekAt = now(); player.seekTo(target.position, 'seconds'); return;
            }
            if (Math.abs(position - target.position) <= 1.25) complete();
            return;
        }
        if (youtube) {
            if (!player.getPlayerState || (target.videoId && player.getVideoData?.()?.video_id !== target.videoId)) return;
            let state = player.getPlayerState();
            const duration = player.getDuration?.() || Infinity;
            const position = Math.min(target.position, duration);
            if (state !== 3 && (!seekIssued || (Math.abs((player.getCurrentTime?.() || 0) - position) > 1.25 && now() - lastSeekAt >= 1000)) && Math.abs((player.getCurrentTime?.() || 0) - position) > 0.15) {
                seekIssued = true; lastSeekAt = now(); onSeek(position);
                player.seekTo(position, true);
                if (!target.playing) player.pauseVideo();
                return;
            }
            if (target.playing && state !== 1 && state !== 3) player.playVideo();
            if (!target.playing && [1, 3, -1].includes(state)) player.pauseVideo();
            state = player.getPlayerState();
            if (Math.abs((player.getCurrentTime?.() || 0) - position) <= 1.25 &&
                (target.playing ? state === 1 : [0, 2, 5].includes(state))) complete();
            return;
        }
        if (player.readyState < 2 || player.seeking) return;
        const position = Math.min(target.position, Number.isFinite(player.duration) ? player.duration : Infinity);
        if (applyLocal) {
            if (localVersion !== target.version || (Math.abs(player.currentTime - position) > 1.25 && now() - lastSeekAt >= 1000)) {
                localVersion = target.version; lastSeekAt = now(); applyLocal(); return;
            }
        } else {
            if ((!seekIssued || (Math.abs(player.currentTime - position) > 1.25 && now() - lastSeekAt >= 1000)) && Math.abs(player.currentTime - position) > 0.15) {
                seekIssued = true; lastSeekAt = now(); onSeek(position); player.currentTime = position; return;
            }
            if (target.playing && player.paused && !playingPromise) {
                playingPromise = true;
                Promise.resolve(player.play()).then(() => { playingPromise = false; pump(); }).catch(error => {
                    if (disposed) return;
                    playingPromise = false; onPlayError(error);
                    if (error.name === 'NotAllowedError') complete();
                });
                return;
            }
            if (!target.playing && !player.paused) player.pause();
        }
        if (Math.abs(player.currentTime - position) <= 1.25 && player.paused === !target.playing && !player.seeking) complete();
    };
    function dispose() {
        disposed = true; cancel(timer);
        for (const remove of cleanup) remove();
    }
    const player = getPlayer();
    if (player?.addEventListener && !youtube) for (const name of ['loadedmetadata', 'canplay', 'seeked', 'playing', 'pause']) {
        player.addEventListener(name, pump); cleanup.push(() => player.removeEventListener(name, pump));
    }
    const tick = () => { pump(); if (!disposed) timer = schedule(tick, 200); };
    tick();
    return { dispose, pump };
}
