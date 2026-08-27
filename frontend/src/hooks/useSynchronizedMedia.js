import { useCallback, useRef } from 'react';
import { canonicalPosition, correctionForDrift, shouldApplyPlaybackSequence } from '../utils/playbackMath';

export default function useSynchronizedMedia({ clock, durationSec }) {
    const lastSeqRef = useRef(-1);
    const timerRef = useRef(null);
    const correct = useCallback((element, state, force = false) => {
        if (!element || !state || element.readyState < 1 || element.seeking) return;
        const target = canonicalPosition(state, clock.serverNow(), durationSec);
        const correction = force ? { type: 'seek', rate: 1 } : correctionForDrift(target - element.currentTime);
        if (correction.type === 'seek') element.currentTime = target;
        element.playbackRate = correction.rate;
    }, [clock, durationSec]);
    const apply = useCallback((element, state, { force = false } = {}) => {
        if (!element || !state || !shouldApplyPlaybackSequence(lastSeqRef.current, state.seq, force)) return false;
        lastSeqRef.current = Math.max(lastSeqRef.current, state.seq);
        const execute = () => {
            if (state.seq !== lastSeqRef.current) return;
            if (element.readyState < 1 || element.seeking) {
                element.addEventListener('canplay', execute, { once: true });
                return;
            }
            correct(element, state, force);
            if (state.status === 'playing') element.play().catch(() => {});
            else element.pause();
        };
        const delay = clock.toLocalDelay(state.effectiveAtServerMs);
        clearTimeout(timerRef.current);
        if (delay > 5) timerRef.current = setTimeout(execute, delay);
        else execute();
        return true;
    }, [clock, correct]);
    return { apply, correct, resetSequence: () => { lastSeqRef.current = -1; } };
}
