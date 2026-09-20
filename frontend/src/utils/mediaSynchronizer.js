import { canonicalPosition, correctionForDrift, shouldApplyPlaybackSequence } from './playbackMath.js';

export function createMediaSynchronizer({ serverNow, toLocalDelay, duration = () => Infinity, onPlayError = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
    let lastSeq = -1;
    let timer;
    let generation = 0;
    let removeListeners = () => {};
    const seeking = new WeakMap();
    const isApplyingSeek = element => seeking.has(element) && Math.abs(element.currentTime - seeking.get(element)) < 0.15;
    const clearPending = () => {
        generation += 1;
        cancel(timer);
        removeListeners();
        removeListeners = () => {};
    };
    const correct = (element, state, force = false) => {
        if (!element || !state || element.readyState < 1 || element.seeking || serverNow() < state.effectiveAtServerMs) return;
        const target = canonicalPosition(state, serverNow(), duration());
        const drift = target - element.currentTime;
        const correction = force || (state.status !== 'playing' && Math.abs(drift) > 0.01)
            ? { type: 'seek', rate: 1 } : correctionForDrift(drift);
        if (correction.type === 'seek' && Math.abs(drift) > 0.01) {
            seeking.set(element, target);
            element.currentTime = target;
        }
        element.playbackRate = correction.rate;
    };
    return {
        correct,
        isApplyingSeek,
        finishSeek: element => {
            const applied = isApplyingSeek(element);
            seeking.delete(element);
            return applied;
        },
        reset: () => { clearPending(); lastSeq = -1; },
        cancel: clearPending,
        apply(element, state, { force = false } = {}) {
            if (!element || !state || !shouldApplyPlaybackSequence(lastSeq, state.seq, force)) return false;
            clearPending();
            lastSeq = state.seq;
            const token = generation;
            const execute = () => {
                if (token !== generation) return;
                removeListeners();
                if (element.readyState < 1 || element.seeking) {
                    element.addEventListener('loadedmetadata', execute);
                    element.addEventListener('canplay', execute);
                    element.addEventListener('seeked', execute);
                    removeListeners = () => {
                        element.removeEventListener('loadedmetadata', execute);
                        element.removeEventListener('canplay', execute);
                        element.removeEventListener('seeked', execute);
                    };
                    return;
                }
                correct(element, state, true);
                if (state.status === 'playing') {
                    element.play()?.catch(error => { if (token === generation) onPlayError(error); });
                } else element.pause();
            };
            const delay = toLocalDelay(state.effectiveAtServerMs);
            if (delay > 0) timer = schedule(execute, delay);
            else execute();
            return true;
        },
    };
}
