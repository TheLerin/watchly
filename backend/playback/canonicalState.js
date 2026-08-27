const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const canonicalPosition = (playback, serverNowMs, durationSec = Infinity) => {
    const elapsed = playback.status === 'playing'
        ? Math.max(0, serverNowMs - playback.effectiveAtServerMs) / 1000 * playback.rate
        : 0;
    return clamp(playback.positionSec + elapsed, 0, durationSec);
};

const createPlayback = (now = Date.now()) => ({
    seq: 0,
    status: 'paused',
    positionSec: 0,
    rate: 1,
    effectiveAtServerMs: now,
    updatedByMemberId: null,
    commandId: null
});

const reduceCommand = ({ playback, action, positionSec, now, effectiveAt, memberId, durationSec }) => {
    // Commands take effect at a shared future deadline. Preserve the position
    // the room will have reached at that deadline so a scheduled pause does not
    // freeze everyone at the earlier request-receipt position.
    const current = canonicalPosition(playback, Math.max(now, effectiveAt), durationSec);
    const position = action === 'SEEK'
        ? clamp(positionSec, 0, durationSec)
        : current;
    return {
        seq: playback.seq + 1,
        status: action === 'PLAY' ? 'playing' : action === 'PAUSE' || action === 'ENDED' ? 'paused' : playback.status,
        positionSec: action === 'ENDED' ? durationSec : position,
        rate: 1,
        effectiveAtServerMs: effectiveAt,
        updatedByMemberId: memberId
    };
};

module.exports = { canonicalPosition, createPlayback, reduceCommand };
