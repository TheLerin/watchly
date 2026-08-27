export const canonicalPosition = (state, serverNowMs, durationSec = Infinity) => {
    if (!state) return 0;
    const elapsed = state.status === 'playing'
        ? Math.max(0, serverNowMs - state.effectiveAtServerMs) / 1000 * (state.rate || 1)
        : 0;
    return Math.min(durationSec, Math.max(0, state.positionSec + elapsed));
};

export const correctionForDrift = driftSec => {
    const absolute = Math.abs(driftSec);
    if (absolute <= 0.15) return { type: 'none', rate: 1 };
    if (absolute <= 0.75) return { type: 'rate', rate: driftSec > 0 ? 1.03 : 0.97 };
    return { type: 'seek', rate: 1 };
};

export const shouldApplyPlaybackSequence = (lastSeq, nextSeq, force = false) => (
    force || (Number.isInteger(nextSeq) && nextSeq > lastSeq)
);
