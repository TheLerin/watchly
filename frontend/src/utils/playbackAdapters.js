import { correctionForDrift } from './playbackMath.js';
import { sourceCapabilities } from '../../../shared/playback-core.mjs';

// Provider capabilities determine correction: HTML media can change rate, while generic embeds use explicit seeks.
export function createPlaybackAdapter({ element, player, kind = 'native' }) {
    const native = Boolean(element && typeof element.currentTime === 'number');
    const youtube = kind === 'youtube' || kind === 'youtube-playlist';
    return {
        capabilities: { ...sourceCapabilities(kind), position: native || typeof player?.getCurrentTime === 'function', seek: native || typeof player?.seekTo === 'function', rate: native || youtube && typeof player?.setPlaybackRate === 'function' },
        position: () => native ? element.currentTime : Number(player?.getCurrentTime?.()) || 0,
        seek(seconds) { if (!Number.isFinite(seconds) || seconds < 0) return false; try { if (native) element.currentTime = seconds; else if (player?.seekTo) player.seekTo(seconds, youtube ? true : 'seconds'); else return false; return true; } catch { return false; } },
        rate(value) {
            if (!Number.isFinite(value) || value < 0.25 || value > 4) return false;
            try {
                if (native) { element.playbackRate = value; return true; }
                if (youtube && typeof player?.setPlaybackRate === 'function') {
                    if (player.getAvailablePlaybackRates && !player.getAvailablePlaybackRates().includes(value)) return false;
                    player.setPlaybackRate(value); return true;
                }
            } catch { /* provider capability changed */ }
            return false;
        },
    };
}

export function correctPlayback(adapter, target, { force = false, baseRate = 1, hardThreshold = 1.25 } = {}) {
    const drift = target - adapter.position();
    if (!Number.isFinite(drift)) return 'none';
    const correction = correctionForDrift(drift, baseRate);
    if (force || Math.abs(drift) > hardThreshold || correction.type === 'seek') { adapter.seek(target); adapter.rate(baseRate); return 'seek'; }
    // Keep existing small-drift smoothing for native players. Unsupported embed rates remain unchanged.
    if (adapter.capabilities.rateCorrection) adapter.rate(correction.rate); return correction.type === 'none' ? 'none' : 'rate';
}
