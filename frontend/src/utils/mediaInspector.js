import { languageDisplayName, normalizeLanguageCode } from './subtitleParser.js';
import { inspectMatroskaSubtitleTracks } from './matroskaSubtitles.js';

const inspectionCache = new WeakMap();

const CODEC_LABELS = {
    avc: 'H.264 / AVC',
    hevc: 'H.265 / HEVC',
    vp8: 'VP8',
    vp9: 'VP9',
    av1: 'AV1',
    aac: 'AAC',
    opus: 'Opus',
    vorbis: 'Vorbis',
    mp3: 'MP3',
    flac: 'FLAC',
    ac3: 'Dolby Digital / AC-3',
    eac3: 'Dolby Digital Plus / E-AC-3',
    dts: 'DTS',
    ass: 'ASS',
    vtt: 'WebVTT',
};

const safe = async (operation, fallback = null) => {
    try { return await operation(); }
    catch { return fallback; }
};

export function friendlyCodecName(codec, internalCodecId = '') {
    const value = String(codec || internalCodecId || 'Unknown').toLowerCase();
    return CODEC_LABELS[value] || value.replace(/^v_/, '').replace(/^a_/, '').replace(/_/g, ' ').toUpperCase();
}

export function supportLevel(decodable) {
    if (decodable === true) return 'supported';
    if (decodable === false) return 'unsupported';
    return 'unknown';
}

export function summarizeCompatibility({ mimeSupport, videoTracks, audioTracks, subtitleTracks = [] }) {
    if (videoTracks.some(track => track.support === 'unsupported')) {
        return {
            status: 'unsupported',
            message: 'This movie’s video codec cannot be decoded by this browser.',
        };
    }
    if (audioTracks.length && audioTracks.every(track => track.support === 'unsupported')) {
        return {
            status: 'unsupported',
            message: 'The video may be readable, but none of its audio tracks can be decoded by this browser.',
        };
    }
    const unsupportedAudioCount = audioTracks.filter(track => track.support === 'unsupported').length;
    const unsupportedSubtitleCount = subtitleTracks.filter(track => track.support === 'unsupported').length;
    if (unsupportedAudioCount || unsupportedSubtitleCount) {
        return {
            status: 'partial',
            message: unsupportedAudioCount
                ? 'The movie may play, but some audio languages are unavailable in this browser.'
                : 'The movie may play, but some embedded subtitle formats cannot be rendered.',
        };
    }
    if (mimeSupport && !videoTracks.some(track => track.support === 'unknown')) {
        return {
            status: 'supported',
            message: 'This browser reports that the movie should play.',
        };
    }
    return {
        status: 'unknown',
        message: 'Watchly could inspect this movie, but the browser cannot fully confirm playback support. You can still try it.',
    };
}

async function inspectTrack(track) {
    const [codec, codecParameter, internalCodecId, language, name, disposition, bitrate] = await Promise.all([
        safe(() => track.getCodec()),
        safe(() => track.getCodecParameterString()),
        safe(() => track.getInternalCodecId()),
        safe(() => track.getLanguageCode(), 'und'),
        safe(() => track.getName()),
        safe(() => track.getDisposition(), {}),
        safe(() => track.getBitrate()),
    ]);
    const normalizedLanguage = normalizeLanguageCode(language);
    const base = {
        id: track.id,
        number: track.number,
        type: track.type,
        codec: codec || String(internalCodecId || ''),
        codecLabel: friendlyCodecName(codec, internalCodecId),
        codecParameter: codecParameter || '',
        language: normalizedLanguage,
        label: name || languageDisplayName(normalizedLanguage) || `${track.type === 'audio' ? 'Audio' : track.type === 'subtitle' ? 'Subtitle' : 'Video'} ${track.number}`,
        bitrate,
        default: Boolean(disposition?.default || disposition?.primary),
        forced: Boolean(disposition?.forced),
    };

    if (track.type === 'subtitle') {
        return { ...base, supported: true, support: 'available' };
    }

    const decodable = await safe(() => track.canDecode());
    if (track.type === 'video') {
        const [width, height, frameRateMetrics] = await Promise.all([
            safe(() => track.getDisplayWidth()),
            safe(() => track.getDisplayHeight()),
            safe(() => track.computeFrameRateMetrics({ targetPacketCount: 64 })),
        ]);
        return {
            ...base,
            width,
            height,
            frameRate: frameRateMetrics?.bestGuessFrameRate || null,
            decodable,
            supported: decodable,
            support: supportLevel(decodable),
        };
    }

    const [channels, sampleRate] = await Promise.all([
        safe(() => track.getNumberOfChannels()),
        safe(() => track.getSampleRate()),
    ]);
    return { ...base, channels, sampleRate, decodable, supported: decodable, support: supportLevel(decodable) };
}

const playbackMimeForTrack = track => {
    if (track.type === 'video') {
        if (['vp8', 'vp9'].includes(track.codec)) return 'video/webm';
        return 'video/mp4';
    }
    if (['opus', 'vorbis'].includes(track.codec)) return 'audio/webm';
    if (track.codec === 'flac') return 'audio/flac';
    return 'audio/mp4';
};

async function detectPlaybackSupport(track) {
    if (track.type === 'subtitle') return track.support;
    const mime = playbackMimeForTrack(track);
    const contentType = track.codecParameter ? `${mime}; codecs="${track.codecParameter}"` : mime;
    const mediaElementSupport = typeof document === 'undefined'
        ? ''
        : document.createElement(track.type === 'video' ? 'video' : 'audio').canPlayType(contentType);
    let mediaCapabilities = null;
    if (typeof navigator !== 'undefined' && navigator.mediaCapabilities?.decodingInfo && track.codecParameter) {
        const configuration = { type: 'file' };
        if (track.type === 'video') {
            configuration.video = {
                contentType,
                width: track.width || 1920,
                height: track.height || 1080,
                bitrate: track.bitrate || 5_000_000,
                framerate: track.frameRate || 30,
            };
        } else {
            configuration.audio = {
                contentType,
                channels: String(track.channels || 2),
                bitrate: track.bitrate || 192_000,
                samplerate: track.sampleRate || 48_000,
            };
        }
        mediaCapabilities = await safe(() => navigator.mediaCapabilities.decodingInfo(configuration));
    }
    if (track.decodable === true || mediaElementSupport || mediaCapabilities?.supported === true) return 'supported';
    // DTS has no interoperable HTML media/MSE path in current mainstream
    // browsers. Other false probes stay "unknown" because a missing WebCodecs
    // implementation does not prove that HTMLMediaElement cannot decode them.
    if (track.codec === 'dts') return 'unsupported';
    return 'unknown';
}

async function probeMediaCapabilities(mimeType, video, audio) {
    if (typeof navigator === 'undefined' || !navigator.mediaCapabilities?.decodingInfo) return null;
    const baseMime = mimeType.split(';')[0] || 'video/mp4';
    const configuration = { type: 'file' };
    if (video?.codecParameter && video.width && video.height) {
        configuration.video = {
            contentType: `${baseMime}; codecs="${video.codecParameter}"`,
            width: video.width,
            height: video.height,
            bitrate: video.bitrate || 5_000_000,
            framerate: 30,
        };
    }
    if (audio?.codecParameter) {
        const audioMime = baseMime.replace(/^video\//, 'audio/');
        configuration.audio = {
            contentType: `${audioMime}; codecs="${audio.codecParameter}"`,
            channels: String(audio.channels || 2),
            bitrate: audio.bitrate || 192_000,
            samplerate: audio.sampleRate || 48_000,
        };
    }
    if (!configuration.video && !configuration.audio) return null;
    return safe(() => navigator.mediaCapabilities.decodingInfo(configuration));
}

async function inspect(file) {
    const { Input, MATROSKA, WEBM, MP4, QTFF, BlobSource } = await import('mediabunny');
    const input = new Input({
        formats: [MATROSKA, WEBM, MP4, QTFF],
        source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 }),
    });

    try {
        if (!(await input.canRead())) throw new Error('Watchly could not recognize this media container.');
        const [format, mimeType, tracks, metadataDuration] = await Promise.all([
            input.getFormat(),
            input.getMimeType(),
            input.getTracks(),
            input.getDurationFromMetadata(),
        ]);
        const rawInspectedTracks = await Promise.all(tracks.map(inspectTrack));
        const inspectedTracks = await Promise.all(rawInspectedTracks.map(async track => {
            const support = await detectPlaybackSupport(track);
            return { ...track, support, supported: support === 'supported' };
        }));
        const videoTracks = inspectedTracks.filter(track => track.type === 'video');
        const audioTracks = inspectedTracks.filter(track => track.type === 'audio');
        const parserSubtitleTracks = inspectedTracks.filter(track => track.type === 'subtitle');
        const isMatroska = /matroska|webm/i.test(format.name || mimeType || '');
        const matroskaSubtitleTracks = isMatroska
            ? await safe(() => inspectMatroskaSubtitleTracks(file), [])
            : [];
        const subtitleTracks = matroskaSubtitleTracks.length ? matroskaSubtitleTracks : parserSubtitleTracks;
        const mimeSupport = typeof document === 'undefined'
            ? ''
            : document.createElement('video').canPlayType(mimeType);
        const mediaCapabilities = await probeMediaCapabilities(mimeType, videoTracks[0], audioTracks.find(track => track.support !== 'unsupported'));
        const compatibility = summarizeCompatibility({ mimeSupport, videoTracks, audioTracks, subtitleTracks });

        return {
            container: format.name,
            mimeType,
            mimeSupport: mimeSupport || 'unconfirmed',
            duration: Number.isFinite(metadataDuration) ? metadataDuration : null,
            videoTracks,
            video: videoTracks[0] || null,
            audioTracks,
            subtitleTracks,
            mediaCapabilities,
            compatibility,
            inspectedAt: Date.now(),
        };
    } finally {
        input.dispose();
    }
}

export function inspectLocalMedia(file) {
    if (!inspectionCache.has(file)) inspectionCache.set(file, inspect(file));
    return inspectionCache.get(file);
}
