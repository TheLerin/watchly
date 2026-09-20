// Link players use the URL protocol; local files use scheduled canonical state.
export function playbackCommand(state, action, options = {}) {
    if (state.sourceType === 'local' && state.localMedia) {
        return { event: 'playback:command', payload: {
            mediaId: state.localMedia.sessionId, action,
            ...(action === 'SEEK' ? { positionSec: options.positionSec } : {}),
            ...(action === 'PLAY' ? { startAnyway: options.startAnyway === true } : {}),
        } };
    }
    return { event: { PLAY: 'play_video', PAUSE: 'pause_video', SEEK: 'seek_video', ENDED: 'pause_video' }[action],
        payload: { ...(Number.isFinite(options.positionSec) ? { playedSeconds: options.positionSec } : {}),
            ...(action === 'PLAY' ? { startAnyway: options.startAnyway === true } : {}) } };
}
