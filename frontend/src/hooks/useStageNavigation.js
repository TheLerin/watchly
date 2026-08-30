import { useCallback, useEffect, useRef, useState } from 'react';

const WHEEL_THRESHOLD = 88;
const WHEEL_IDLE_MS = 180;
const ACCUMULATOR_RESET_MS = 260;
const TRANSITION_FALLBACK_MS = 900;
const SWIPE_THRESHOLD = 48;

export const STAGE_TRANSITION = Object.freeze({
    HOME_TO_FIRST: 'home-to-first',
    PANEL_FORWARD: 'panel-forward',
    PANEL_BACKWARD: 'panel-backward',
    FIRST_TO_HOME: 'first-to-home',
    LAST_TO_HOME: 'last-to-home',
});

const INTERACTIVE_SELECTOR = [
    'button',
    'a',
    'input',
    'textarea',
    'select',
    'form',
    'dialog',
    '[contenteditable="true"]',
    '[role="menu"]',
    '[data-stage-nav-ignore]',
].join(',');

const isEditableTarget = target => target instanceof Element && Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"]'
));

const isInteractiveTarget = target => target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));

const getScrollableAncestor = (target, boundary) => {
    let element = target instanceof Element ? target : null;

    while (element && element !== boundary) {
        const style = window.getComputedStyle(element);
        const scrollable = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
        if (scrollable) return element;
        element = element.parentElement;
    }

    return null;
};

const canScrollInDirection = (element, delta) => {
    if (!element) return false;
    if (delta > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    return element.scrollTop > 1;
};

const normalizedWheelDelta = event => {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
    return event.deltaY;
};

const resolveStageTransition = (current, next, panelCount) => {
    if (current === 0 && next === 1) return STAGE_TRANSITION.HOME_TO_FIRST;
    if (next === 0 && current === panelCount) return STAGE_TRANSITION.LAST_TO_HOME;
    if (next === 0) return STAGE_TRANSITION.FIRST_TO_HOME;
    return next > current ? STAGE_TRANSITION.PANEL_FORWARD : STAGE_TRANSITION.PANEL_BACKWARD;
};

export default function useStageNavigation({ containerRef, panelCount, suspended = false }) {
    const [navigationState, setNavigationState] = useState({
        stage: 0,
        transition: STAGE_TRANSITION.HOME_TO_FIRST,
    });
    const [hasInteracted, setHasInteracted] = useState(false);

    const stageRef = useRef(0);
    const lockedRef = useRef(false);
    const accumulatedDeltaRef = useRef(0);
    const wheelGestureActiveRef = useRef(false);
    const transitionTimerRef = useRef(null);
    const wheelIdleTimerRef = useRef(null);
    const accumulatorTimerRef = useRef(null);
    const touchRef = useRef(null);
    const suspendedRef = useRef(suspended);

    useEffect(() => {
        suspendedRef.current = suspended;
    }, [suspended]);

    const clearTimer = timerRef => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const unlockTransition = useCallback(() => {
        clearTimer(transitionTimerRef);
        lockedRef.current = false;
    }, []);

    const lockTransition = useCallback(() => {
        lockedRef.current = true;
        clearTimer(transitionTimerRef);

        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        transitionTimerRef.current = window.setTimeout(
            unlockTransition,
            reducedMotion ? 80 : TRANSITION_FALLBACK_MS
        );
    }, [unlockTransition]);

    const goToStage = useCallback((nextStage, { force = false, transition } = {}) => {
        if (!force && lockedRef.current) return false;

        const clamped = Math.max(0, Math.min(panelCount, nextStage));
        if (clamped === stageRef.current) return false;

        const current = stageRef.current;
        const nextTransition = transition ?? resolveStageTransition(current, clamped, panelCount);
        stageRef.current = clamped;
        setNavigationState({ stage: clamped, transition: nextTransition });
        setHasInteracted(true);
        lockTransition();
        return true;
    }, [lockTransition, panelCount]);

    const move = useCallback(direction => {
        if (lockedRef.current) return false;

        const current = stageRef.current;
        if (direction > 0 && current === panelCount) {
            return goToStage(0, { transition: STAGE_TRANSITION.LAST_TO_HOME });
        }

        return goToStage(current + direction);
    }, [goToStage, panelCount]);

    const markWheelGesture = useCallback(() => {
        wheelGestureActiveRef.current = true;
        clearTimer(wheelIdleTimerRef);
        wheelIdleTimerRef.current = window.setTimeout(() => {
            wheelGestureActiveRef.current = false;
        }, WHEEL_IDLE_MS);
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        const previousBodyOverscroll = document.body.style.overscrollBehavior;
        const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;

        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overscrollBehavior = 'none';
        document.documentElement.style.overscrollBehavior = 'none';

        const onWheel = event => {
            const delta = normalizedWheelDelta(event);
            if (!delta) return;

            if (suspendedRef.current) {
                event.preventDefault();
                return;
            }

            const scrollable = getScrollableAncestor(event.target, container);
            if (scrollable && canScrollInDirection(scrollable, delta)) return;
            if (isInteractiveTarget(event.target)) return;

            event.preventDefault();

            if (lockedRef.current) {
                markWheelGesture();
                return;
            }

            if (wheelGestureActiveRef.current) {
                markWheelGesture();
                return;
            }

            if (
                accumulatedDeltaRef.current !== 0 &&
                Math.sign(accumulatedDeltaRef.current) !== Math.sign(delta)
            ) {
                accumulatedDeltaRef.current = 0;
            }

            accumulatedDeltaRef.current += delta;
            clearTimer(accumulatorTimerRef);
            accumulatorTimerRef.current = window.setTimeout(() => {
                accumulatedDeltaRef.current = 0;
            }, ACCUMULATOR_RESET_MS);

            if (Math.abs(accumulatedDeltaRef.current) < WHEEL_THRESHOLD) return;

            const direction = accumulatedDeltaRef.current > 0 ? 1 : -1;
            accumulatedDeltaRef.current = 0;
            clearTimer(accumulatorTimerRef);

            if (move(direction)) markWheelGesture();
        };

        const onTouchStart = event => {
            if (suspendedRef.current) {
                touchRef.current = null;
                return;
            }
            if (event.touches.length !== 1 || isInteractiveTarget(event.target)) {
                touchRef.current = null;
                return;
            }

            const scrollable = getScrollableAncestor(event.target, container);
            touchRef.current = {
                y: event.touches[0].clientY,
                scrollable,
                wasAtTop: !scrollable || scrollable.scrollTop <= 1,
                wasAtBottom: !scrollable || scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1,
            };
        };

        const onTouchEnd = event => {
            const touch = touchRef.current;
            touchRef.current = null;
            if (!touch || event.changedTouches.length !== 1 || lockedRef.current) return;

            const distance = touch.y - event.changedTouches[0].clientY;
            if (Math.abs(distance) < SWIPE_THRESHOLD) return;

            const direction = distance > 0 ? 1 : -1;
            if (touch.scrollable) {
                if (direction > 0 && !touch.wasAtBottom) return;
                if (direction < 0 && !touch.wasAtTop) return;
            }

            move(direction);
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('touchstart', onTouchStart, { passive: true });
        container.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
            container.removeEventListener('wheel', onWheel);
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchend', onTouchEnd);
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
            document.body.style.overscrollBehavior = previousBodyOverscroll;
            document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
        };
    }, [containerRef, markWheelGesture, move]);

    useEffect(() => {
        const onKeyDown = event => {
            if (suspendedRef.current || isEditableTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) return;

            if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') {
                event.preventDefault();
                move(1);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') {
                event.preventDefault();
                move(-1);
            } else if (event.key === 'Escape' && stageRef.current > 0) {
                event.preventDefault();
                goToStage(0);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [goToStage, move]);

    useEffect(() => () => {
        clearTimer(transitionTimerRef);
        clearTimer(wheelIdleTimerRef);
        clearTimer(accumulatorTimerRef);
    }, []);

    return {
        goToStage,
        hasInteracted,
        move,
        stage: navigationState.stage,
        stageTransition: navigationState.transition,
        unlockTransition,
    };
}
