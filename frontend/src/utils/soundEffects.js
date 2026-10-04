export const SOUND_SETTINGS_KEY = 'watchly-sound-settings';
export const DEFAULT_SOUND_SETTINGS = Object.freeze({ enabled: true, room: true, voice: true, volume: .35 });

// Warm, softly enveloped tones, rendered into memory once per AudioContext.
// No audio files, network fetches, capture streams or LiveKit publications.
export const SOUND_TONES = Object.freeze({
    roomJoin: { category: 'room', duration: .28, notes: [392, 493.88] },
    roomLeave: { category: 'room', duration: .26, notes: [392, 329.63] },
    voiceJoin: { category: 'voice', duration: .24, notes: [440, 554.37] },
    voiceLeave: { category: 'voice', duration: .23, notes: [440, 349.23] },
    cameraOn: { category: 'voice', duration: .16, notes: [523.25, 659.25] },
    cameraOff: { category: 'voice', duration: .15, notes: [523.25, 415.3] },
    unmute: { category: 'voice', duration: .12, notes: [587.33, 698.46] },
    mute: { category: 'voice', duration: .11, notes: [587.33, 493.88] },
});

export function normalizeSoundSettings(value = {}) {
    const result = { ...DEFAULT_SOUND_SETTINGS };
    for (const key of ['enabled', 'room', 'voice']) if (typeof value?.[key] === 'boolean') result[key] = value[key];
    if (typeof value?.volume === 'number' && Number.isFinite(value.volume)) result.volume = Math.min(1, Math.max(0, value.volume));
    return result;
}

export function readSoundSettings(storage) {
    try { return normalizeSoundSettings(JSON.parse(storage.getItem(SOUND_SETTINGS_KEY))); } catch { return { ...DEFAULT_SOUND_SETTINGS }; }
}

export function renderSoundSamples({ duration, notes }, sampleRate) {
    const samples = new Float32Array(Math.ceil(duration * sampleRate));
    for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        for (let n = 0; n < notes.length; n++) {
            const age = t - n * duration * .28, length = duration * .7;
            if (age < 0 || age >= length) continue;
            const envelope = Math.sin(Math.PI * age / length) ** 2 * Math.exp(-3 * age / length);
            const phase = 2 * Math.PI * notes[n] * age;
            samples[i] += .22 * envelope * (Math.sin(phase) + .1 * Math.sin(2 * phase));
        }
    }
    return samples;
}

export function createSoundEffects({ settings: initial, createContext = () => new (window.AudioContext || window.webkitAudioContext)() } = {}) {
    let settings = normalizeSoundSettings(initial), context, gain, unlocked = false;
    const buffers = new Map(), playing = new Map();
    const preload = () => {
        if (context) return context;
        try {
            context = createContext(); gain = context.createGain(); gain.gain.value = settings.enabled ? settings.volume : 0;
            gain.connect(context.destination);
            for (const [name, tone] of Object.entries(SOUND_TONES)) {
                const samples = renderSoundSamples(tone, context.sampleRate), buffer = context.createBuffer(1, samples.length, context.sampleRate);
                buffer.copyToChannel(samples, 0); buffers.set(name, buffer);
            }
            return context;
        } catch { context = null; buffers.clear(); return null; }
    };
    const unlock = () => {
        const audio = preload(); if (!audio) return;
        if (audio.state === 'running') { unlocked = true; return; }
        // Called only from trusted user input. Never queue missed notifications.
        try { void Promise.resolve(audio.resume()).then(() => { if (context === audio) unlocked = audio.state === 'running'; }).catch(() => {}); } catch { /* Autoplay remains blocked. */ }
    };
    const configure = value => {
        settings = normalizeSoundSettings(value);
        if (gain) gain.gain.setTargetAtTime(settings.enabled ? settings.volume : 0, context.currentTime, .01);
        for (const [source, category] of playing) if (!settings.enabled || !settings[category] || settings.volume === 0) {
            try { source.stop(); } catch { /* Already ended. */ } playing.delete(source);
        }
        return settings;
    };
    const play = name => {
        const tone = SOUND_TONES[name];
        if (!tone || !settings.enabled || !settings[tone.category] || settings.volume === 0 || !unlocked || context?.state !== 'running') return false;
        try {
            const source = context.createBufferSource(); source.buffer = buffers.get(name);
            source.connect(gain); source.onended = () => { playing.delete(source); source.disconnect(); };
            playing.set(source, tone.category); source.start(); return true;
        } catch { return false; }
    };
    const dispose = () => {
        unlocked = false;
        for (const source of playing.keys()) { try { source.stop(); } catch { /* Already ended. */ } }
        playing.clear(); buffers.clear();
        const previous = context; context = null; gain = null;
        if (previous) void previous.close().catch(() => {});
    };
    return { preload, unlock, play, configure, dispose, getSettings: () => settings };
}
