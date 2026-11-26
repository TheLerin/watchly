const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const playbackRate = value => Number.isFinite(value) && value >= 0.25 && value <= 4 ? value : 1;
export const canonicalPosition = (state, serverNowMs, durationSec = Infinity) => {
  if (!state) return 0;
  const elapsed = state.status === 'playing' ? Math.max(0, serverNowMs - state.effectiveAtServerMs) / 1000 * playbackRate(state.rate) : 0;
  return clamp(state.positionSec + elapsed, 0, durationSec);
};
export const createPlayback = (now = Date.now()) => ({ seq: 0, status: 'paused', positionSec: 0, rate: 1, effectiveAtServerMs: now, updatedByMemberId: null, commandId: null });
export function reduceCommand({ playback, action, positionSec, requestedAtServerMs, now, effectiveAt, memberId, durationSec, rate }) {
  const current = canonicalPosition(playback, Math.max(now, effectiveAt), durationSec);
  const seekElapsed = action === 'SEEK' && playback.status === 'playing' && Number.isFinite(requestedAtServerMs)
    ? Math.max(0, effectiveAt - clamp(requestedAtServerMs, now - 10000, now)) / 1000 * playbackRate(playback.rate) : 0;
  const position = action === 'SEEK' ? clamp(positionSec + seekElapsed, 0, durationSec) : action === 'PLAY' && current >= durationSec ? 0 : current;
  return { seq: playback.seq + 1, status: action === 'PLAY' ? 'playing' : ['PAUSE', 'ENDED'].includes(action) ? 'paused' : playback.status,
    positionSec: action === 'ENDED' ? durationSec : position, rate: action === 'RATE' ? playbackRate(rate) : playbackRate(playback.rate), effectiveAtServerMs: effectiveAt, updatedByMemberId: memberId };
}
export const remoteCanonical = state => ({ seq: state.stateVersion || 0, status: state.isPlaying ? 'playing' : 'paused', positionSec: Math.max(0, Number(state.playedSeconds) || 0),
  effectiveAtServerMs: Number.isFinite(state.updatedAt) ? state.updatedAt : Date.now(), rate: playbackRate(state.rate), mediaId: state.localMedia?.sessionId || state.sourceId || null, generation: state.sourceEpoch || 0 });
export const expectedRemotePosition = (state, now, duration = Infinity) => canonicalPosition(remoteCanonical(state || {}), now, duration);
export const projectRemote = (state, now, duration = Infinity) => ({ ...state, playedSeconds: expectedRemotePosition(state, now, duration), updatedAt: now });
export function transitionRemote(state, { action, positionSec, now = Date.now(), memberId, durationSec = Infinity }) {
  let playback = remoteCanonical(state);
  if (action === 'PAUSE' && Number.isFinite(positionSec)) playback = { ...playback, positionSec: clamp(positionSec, 0, durationSec), effectiveAtServerMs: now };
  const next = reduceCommand({ playback, action: action === 'PROGRESS' ? 'SEEK' : action, positionSec, now, effectiveAt: now, memberId, durationSec });
  return { ...state, stateVersion: next.seq, isPlaying: next.status === 'playing', playedSeconds: next.positionSec, updatedAt: now,
    seekVersion: (state.seekVersion || 0) + (action === 'SEEK' ? 1 : 0), ...(state.rate !== undefined ? { rate: next.rate } : {}) };
}
export function correctionForDrift(driftSec, rate = 1) {
  const base = playbackRate(rate), absolute = Math.abs(driftSec);
  if (absolute <= 0.15) return { type: 'none', rate: base };
  if (absolute <= 0.75) return { type: 'rate', rate: clamp(base * (driftSec > 0 ? 1.03 : 0.97), 0.25, 4) };
  return { type: 'seek', rate: base };
}
export const shouldApplyPlaybackSequence = (lastSeq, nextSeq, force = false) => Number.isInteger(nextSeq) && (nextSeq > lastSeq || force && nextSeq === lastSeq);
export const sourceCapabilities = source => ({ seek: true, scheduledStart: source === 'local-file', rateCorrection: !['youtube', 'youtube-playlist', 'embed'].includes(source), sharedFiles: source === 'local-file', providerControlled: ['youtube', 'youtube-playlist', 'embed'].includes(source) });
