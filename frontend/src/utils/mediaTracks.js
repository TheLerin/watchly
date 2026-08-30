import { languageDisplayName, normalizeLanguageCode } from './subtitleParser.js';

const fallbackTrackLabel = (prefix, index, language, label) => (
    label || languageDisplayName(language) || `${prefix} ${index + 1}`
);

const externalTrackMap = mediaElement => {
    if (!mediaElement?.querySelectorAll) return new Map();
    return new Map(
        [...mediaElement.querySelectorAll('track[data-watchly-track-id]')]
            .map(element => [element.track, element.dataset.watchlyTrackId])
    );
};

export function discoverMediaTracks({ mediaElement, inspectionResult, attachedSubtitles = [], externalSubtitles = attachedSubtitles }) {
    const subtitleAttachments = attachedSubtitles.length ? attachedSubtitles : externalSubtitles;
    const inspectedAudio = inspectionResult?.audioTracks || [];
    const browserAudioTracks = mediaElement?.audioTracks ? [...mediaElement.audioTracks] : [];
    const claimedInspectedAudio = new Set();
    const nativeAudioTracks = browserAudioTracks.map((track, index) => {
            const nativeLanguage = normalizeLanguageCode(track.language);
            const inspected = inspectedAudio.find(candidate => (
                !claimedInspectedAudio.has(candidate.id) &&
                nativeLanguage && normalizeLanguageCode(candidate.language) === nativeLanguage
            )) || inspectedAudio[index];
            if (inspected) claimedInspectedAudio.add(inspected.id);
            const language = normalizeLanguageCode(track.language || inspected?.language);
            return {
                id: `browser-audio:${index}`,
                browserIndex: index,
                inspectedTrackId: inspected?.id ?? null,
                label: fallbackTrackLabel('Audio', index, language, track.label || inspected?.label),
                language,
                codec: inspected?.codec || '',
                channels: inspected?.channels || null,
                supported: inspected?.supported ?? true,
                support: inspected?.support || 'supported',
                switchable: true,
                default: Boolean(track.enabled || inspected?.default),
                origin: 'embedded',
            };
        });
    const detectedAudioTracks = inspectedAudio.flatMap((track, index) => {
        if (claimedInspectedAudio.has(track.id)) return [];
        return [{
            ...track,
            id: `detected-audio:${track.id ?? index}`,
            inspectedTrackId: track.id ?? index,
            browserIndex: null,
            label: fallbackTrackLabel('Audio', index, track.language, track.label),
            switchable: Boolean(track.remuxable),
            switchMethod: track.remuxable ? 'remux' : 'unavailable',
            origin: 'detected',
        }];
    });
    const audioTracks = [...nativeAudioTracks, ...detectedAudioTracks];

    const externalByTextTrack = externalTrackMap(mediaElement);
    const browserTextTracks = mediaElement?.textTracks ? [...mediaElement.textTracks] : [];
    const nativeEmbeddedSubtitles = browserTextTracks.flatMap((track, index) => {
        if (externalByTextTrack.has(track)) return [];
        const language = normalizeLanguageCode(track.language);
        return [{
            id: `embedded-subtitle:${index}`,
            browserIndex: index,
            label: fallbackTrackLabel('Subtitle', index, language, track.label),
            language,
            kind: track.kind || 'subtitles',
            format: 'embedded',
            origin: 'embedded',
            switchable: true,
        }];
    });

    const attached = subtitleAttachments.map((track, index) => {
        const browserIndex = browserTextTracks.findIndex(textTrack => externalByTextTrack.get(textTrack) === track.id);
        return {
            ...track,
            browserIndex: browserIndex >= 0 ? browserIndex : null,
            label: fallbackTrackLabel('Subtitle', index, track.language, track.label),
            origin: track.origin || 'external',
            switchable: true,
            prepared: true,
        };
    });

    const attachedIds = new Set(attached.map(track => track.id));
    const inspectedEmbeddedSubtitles = (inspectionResult?.subtitleTracks || []).flatMap((track, index) => {
        if (attachedIds.has(track.id)) return [];
        return [{
            ...track,
            id: track.id || `detected-subtitle:${track.trackNumber ?? index}`,
            browserIndex: null,
            label: fallbackTrackLabel('Subtitle', index, track.language, track.label),
            origin: 'embedded',
            switchable: Boolean(track.extractable),
            requiresPreparation: Boolean(track.extractable),
        }];
    });

    return {
        audioTracks,
        subtitleTracks: [...nativeEmbeddedSubtitles, ...inspectedEmbeddedSubtitles, ...attached],
    };
}

export function applyAudioTrack(mediaElement, selectedTrack) {
    if (!mediaElement?.audioTracks || !selectedTrack?.switchable || selectedTrack.browserIndex === null) return false;
    [...mediaElement.audioTracks].forEach((track, index) => {
        track.enabled = index === selectedTrack.browserIndex;
    });
    return true;
}

export function applySubtitleTrack(mediaElement, selectedTrack) {
    if (!mediaElement?.textTracks) return false;
    [...mediaElement.textTracks].forEach((track, index) => {
        track.mode = selectedTrack?.browserIndex === index ? 'showing' : 'hidden';
    });
    return !selectedTrack || selectedTrack.browserIndex !== null;
}

export function attachExternalSubtitleTracks(mediaElement, tracks, onTrackReady = () => {}) {
    if (!(mediaElement instanceof HTMLMediaElement)) return () => {};
    const elements = tracks.map(track => {
        const element = document.createElement('track');
        element.kind = 'subtitles';
        element.src = track.src;
        element.srclang = track.language || 'und';
        element.label = track.label;
        element.dataset.watchlyTrackId = track.id;
        element.addEventListener('load', onTrackReady, { once: true });
        mediaElement.appendChild(element);
        return element;
    });
    onTrackReady();
    return () => elements.forEach(element => element.remove());
}

export function getMediaSourceCapabilities({ isLocal, isPlatformEmbed, mediaElement, inspectionResult }) {
    const isHtmlMedia = mediaElement instanceof HTMLMediaElement;
    const discovered = discoverMediaTracks({ mediaElement, inspectionResult, externalSubtitles: [] });
    return {
        canInspectFile: Boolean(isLocal),
        canSwitchAudio: discovered.audioTracks.some(track => track.switchable),
        canUseExternalSubtitles: isHtmlMedia && !isPlatformEmbed,
        canUseEmbeddedSubtitles: isHtmlMedia && (
            Boolean(mediaElement.textTracks) || inspectionResult?.subtitleTracks?.some(track => track.extractable)
        ),
        canReportCodecs: Boolean(inspectionResult),
    };
}
