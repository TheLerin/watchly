import { useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';

const CHROME = '.room-header, .theater-left-dock, .theater-right-dock';
const OPEN_UI = '[data-open-tool]:not([data-open-tool=""]), .room-settings-popover, .room-header-popover, [role="dialog"], dialog[open], [aria-modal="true"], [role="menu"], [role="listbox"]';
const INTERACTIVE = 'button, a, input, textarea, select, [contenteditable], [tabindex]';
const COLOUR_PROPERTIES = ['--cinema-video-r', '--cinema-video-g', '--cinema-video-b'];

function canSample(video) {
    if (!(video instanceof HTMLVideoElement) || video.srcObject) return false;
    try {
        const source = new URL(video.currentSrc || video.src, window.location.href);
        // Even CORS-enabled remote videos use the neutral fallback. Blob URLs
        // are safe only when owned by this origin (the existing local player).
        return source.origin === window.location.origin && ['http:', 'https:', 'blob:'].includes(source.protocol);
    } catch {
        return false;
    }
}

export default function useCinemaLuxeEffects(media, targetRef, enabled, playing) {
    const { appearanceSettings } = useTheme();
    const { ambientLighting, cinemaPreset, autoHideControls, hideDelay } = appearanceSettings;
    useEffect(() => {
        const target = targetRef?.current;
        if (!enabled || !target) return undefined;

        let sampleTimer;
        let hideTimer;
        let actualPlayback = false;
        let blockedSource = '';
        let context;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const native = media instanceof HTMLVideoElement;
        const compact = window.matchMedia('(max-width: 1179px), (max-height: 649px)');
        const neutral = () => {
            COLOUR_PROPERTIES.forEach(property => target.style.removeProperty(property));
            target.dataset.cinemaAmbient = ambientLighting ? 'neutral' : 'disabled';
        };
        const stopSampling = () => {
            window.clearInterval(sampleTimer);
            sampleTimer = undefined;
        };

        const sample = () => {
            if (!canSample(media) || media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
                neutral();
                return false;
            }
            if (blockedSource === media.currentSrc) return false;
            try {
                context ??= canvas.getContext('2d', { willReadFrequently: true });
                if (!context) { stopSampling(); neutral(); return false; }
                context.drawImage(media, 0, 0, 8, 8);
                const { data } = context.getImageData(0, 0, 8, 8);
                const totals = [0, 0, 0];
                for (let pixel = 0; pixel < data.length; pixel += 4) {
                    totals.forEach((_, channel) => { totals[channel] += data[pixel + channel]; });
                }
                totals.forEach((total, channel) => {
                    target.style.setProperty(COLOUR_PROPERTIES[channel], String(Math.round(total / 64)));
                });
                target.dataset.cinemaAmbient = 'sampled';
                return true;
            } catch {
                // Security/decode failures are isolated from playback and never retried
                // for this source. No playback methods or media properties are written.
                blockedSource = media.currentSrc;
                stopSampling();
                neutral();
                return false;
            }
        };

        const mustStayVisible = () => {
            const focused = document.activeElement;
            return !autoHideControls || hideDelay === 'never' || !actualPlayback || target.dataset.roomAppearance !== 'cinematic' ||
                Boolean(target.querySelector(OPEN_UI) || document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]')) ||
                (focused instanceof Element && target.contains(focused) && focused.matches(INTERACTIVE)) ||
                Boolean(target.querySelector(`${CHROME.split(', ').map(selector => `${selector}:hover`).join(', ')}`));
        };
        const scheduleHide = () => {
            window.clearTimeout(hideTimer);
            if (!autoHideControls || hideDelay === 'never' || !actualPlayback || compact.matches || document.hidden) return;
            hideTimer = window.setTimeout(() => {
                if (mustStayVisible()) {
                    target.removeAttribute('data-cinema-controls-hidden');
                    if (actualPlayback) scheduleHide();
                } else target.dataset.cinemaControlsHidden = 'true';
            }, hideDelay * 1000);
        };
        const reveal = () => {
            window.clearTimeout(hideTimer);
            target.removeAttribute('data-cinema-controls-hidden');
            if (actualPlayback) scheduleHide();
        };
        const updatePlayback = () => {
            stopSampling();
            actualPlayback = playing && (!native || (!media.paused && !media.ended));
            target.dataset.cinemaPlaying = String(actualPlayback);
            neutral();
            reveal();
            if (!ambientLighting || cinemaPreset === 'minimal' || !actualPlayback || document.hidden || compact.matches || !canSample(media)) return;
            if (sample()) sampleTimer = window.setInterval(sample, 480);
        };
        // Reading the existing readiness/playing state plus native media events
        // prevents the room dimming during blocked autoplay or initial loading.
        const playbackEvents = ['playing', 'pause', 'ended', 'emptied', 'loadeddata'];
        if (native) playbackEvents.forEach(event => media.addEventListener(event, updatePlayback));
        document.addEventListener('visibilitychange', updatePlayback);
        compact.addEventListener('change', updatePlayback);
        const interactionEvents = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin', 'focusout'];
        interactionEvents.forEach(event => window.addEventListener(event, reveal, { capture: true, passive: true }));
        // Existing drawer/menu state stays authoritative; observe only relevant
        // DOM changes instead of introducing a second panel state or polling.
        const observer = new MutationObserver(() => {
            if (mustStayVisible()) reveal();
        });
        observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-open-tool', 'aria-expanded', 'open'] });
        updatePlayback();

        return () => {
            stopSampling();
            window.clearTimeout(hideTimer);
            observer.disconnect();
            if (native) playbackEvents.forEach(event => media.removeEventListener(event, updatePlayback));
            document.removeEventListener('visibilitychange', updatePlayback);
            compact.removeEventListener('change', updatePlayback);
            interactionEvents.forEach(event => window.removeEventListener(event, reveal, true));
            ['data-cinema-playing', 'data-cinema-controls-hidden', 'data-cinema-ambient'].forEach(attribute => target.removeAttribute(attribute));
            COLOUR_PROPERTIES.forEach(property => target.style.removeProperty(property));
        };
    }, [media, targetRef, enabled, playing, ambientLighting, cinemaPreset, autoHideControls, hideDelay]);
}
