import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ReactPlayer from 'react-player/lazy'; // FIX #3: lazy import loads only the needed adapter, not all adapters
import { useRoom } from '../context/RoomContext';
import { Play, Link as LinkIcon, Lock, AlertCircle, FolderOpen, Maximize, Minimize, RefreshCw, FileVideo, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { fingerprintLocalFile, formatFileSize, readLocalVideoDuration } from '../utils/localMedia';
import useSynchronizedMedia from '../hooks/useSynchronizedMedia';
import useVideoAmbientLight from '../hooks/useVideoAmbientLight';
import MediaTrackControls from './player/MediaTrackControls';
import MediaInfoPanel from './player/MediaInfoPanel';
import { inspectLocalMedia } from '../utils/mediaInspector';
import { parseSubtitleFile } from '../utils/subtitleParser';
import { extractMatroskaSubtitle } from '../utils/matroskaSubtitles';
import { createLocalRemuxSession, getRemuxEligibility } from '../utils/localMediaRemux';
import {
    applyAudioTrack,
    applySubtitleTrack,
    attachExternalSubtitleTracks,
    discoverMediaTracks,
    getMediaSourceCapabilities,
} from '../utils/mediaTracks';

// How often the host reports playback position (ms)
const SYNC_INTERVAL_MS = 1500;
// Max drift before a viewer auto-corrects during normal playback
const HARD_DRIFT_THRESHOLD = 1.25;
const SOFT_DRIFT_THRESHOLD = 0.18;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const MotionDiv = motion.div;
const AUDIO_LANGUAGE_PREFERENCE = 'watchly-preferred-audio-language';
const SUBTITLE_LANGUAGE_PREFERENCE = 'watchly-preferred-subtitle-language';

const readLanguagePreference = key => {
    try { return window.localStorage.getItem(key) || ''; }
    catch { return ''; }
};

const writeLanguagePreference = (key, value) => {
    try {
        if (value) window.localStorage.setItem(key, value);
        else window.localStorage.removeItem(key);
    } catch { /* storage can be disabled */ }
};

function rewriteGDriveUrl(url) {
    if (!url) return url;
    // Match both share links and direct usercontent links
    const isGDrive = url.includes('drive.google.com') || url.includes('drive.usercontent.google.com');
    if (!isGDrive) return url;
    let fileId = null;
    const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) fileId = m1[1];
    if (!fileId) {
        const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m2) fileId = m2[1];
    }
    if (!fileId) return url;
    return `${BACKEND_URL}/api/proxy/gdrive?id=${fileId}`;
}


// Resolves an archive.org/details/ page URL into a direct streamable video URL
// by fetching the item's metadata from the archive.org API.
// BUG-A FIX: Added .ogv/.webm fallback so more items resolve successfully.
async function resolveArchiveUrl(url) {
    if (!url || !url.includes('archive.org')) return url;

    // Already a direct download file URL — use as-is
    const directMatch = url.match(/archive\.org\/download\/([^/?#]+)\/.+/);
    if (directMatch) return url;

    // Extract identifier from a details page URL
    const detailsMatch = url.match(/archive\.org\/details\/([^/?#]+)/);
    if (!detailsMatch) return url;

    const identifier = detailsMatch[1];
    try {
        const res  = await fetch(`https://archive.org/metadata/${identifier}`);
        const data = await res.json();
        const files = data.files || [];

        // Find best video file. Priority order — browser-friendly formats first.
        const priorityFormats = ['MPEG4', 'h.264', 'H.264 IA', '512Kb MPEG4', 'Ogg Video'];
        let videoFile = null;
        for (const fmt of priorityFormats) {
            videoFile = files.find(f => f.format === fmt && !f.name.includes('_thumb') && !f.name.includes('.thumbs'));
            if (videoFile) break;
        }
        // Fallback 1: any .mp4
        if (!videoFile) {
            videoFile = files.find(f => f.name.endsWith('.mp4') && !f.name.includes('_thumb'));
        }
        // Fallback 2: .ogv or .webm (BUG-A: these were not attempted before)
        if (!videoFile) {
            videoFile = files.find(f =>
                (f.name.endsWith('.ogv') || f.name.endsWith('.webm')) &&
                !f.name.includes('_thumb')
            );
        }

        if (videoFile) {
            const directUrl = `https://archive.org/download/${identifier}/${videoFile.name}`;
            console.log(`Archive.org resolved: ${url} → ${directUrl}`);
            return directUrl;
        }
    } catch (e) {
        console.warn('Archive.org metadata fetch failed:', e);
    }
    return url; // Fall back to original URL if resolution fails
}

// ─────────────────────────────────────────────────────────────────────────────

const VideoPlayer = ({ ambientTargetRef, appearance = 'classic', className = '' }) => {
    const {
        videoState, currentUser, localReadiness, controllerMemberId, playback, clock, isConnected,
        loadVideo, addToQueue,
        selectLocalMedia, markLocalMediaReady, markLocalMediaNotReady, markLocalMediaStatus,
        playVideo, pauseVideo, syncProgress, seekVideo, endVideo, getExpectedPosition, sendPlaybackTelemetry
    } = useRoom();

    // ── Refs ─────────────────────────────────────────────────────────────────
    const playerRef          = useRef(null);
    const nativeVideoRef     = useRef(null);
    const playerContainerRef = useRef(null);
    const localFileInputRef  = useRef(null);
    const localInputModeRef  = useRef('match');
    const syncIntervalRef    = useRef(null);
    const localFileUrlRef    = useRef('');
    const localSessionRef    = useRef(null);
    const wasConnectedRef    = useRef(isConnected);
    const externalSubtitlesRef = useRef([]);
    const embeddedSubtitlesRef = useRef([]);
    const embeddedSubtitleAbortRef = useRef(null);
    const localFileRef = useRef(null);
    const localRemuxSessionRef = useRef(null);
    const localPlaybackSwitchRef = useRef(false);
    const remuxGenerationRef = useRef(0);
    const remuxFailureIdsRef = useRef(new Set());
    const localInspectionBySessionRef = useRef(new Map());

    const isSeekingRef     = useRef(false);
    const seekEndTimerRef  = useRef(null);
    const playDebounceRef  = useRef(null);
    const pauseDebounceRef = useRef(null);
    const lastSyncedPosRef = useRef(0);
    // BUG-I FIX: track whether ReactPlayer is currently buffering.
    // Drift correction must NOT fire during a stall — it restarts the buffer
    // from a further position, causing an infinite buffering loop on slow connections.
    const isBufferingRef   = useRef(false);

    // FIX #3: auto-retry state for transient GDrive network errors
    const retryCountRef = useRef(0);
    const retryTimerRef = useRef(null);

    // FIX #5: Track whether the initial seek (jump to host's playedSeconds on join) has
    // completed. onCanPlay can fire before the seek finishes, causing play() to start
    // from position 0 then visibly jump to the correct position.
    // Only allow onCanPlay → play() once the initial seek has fired onSeeked.
    const initialSeekDoneRef = useRef(true); // true = no seek needed (stateTime <= 2)

    const prevSeekVersionReactPlayerRef = useRef(0);
    const prevSeekVersionGDriveRef      = useRef(0);

    const videoStateRef = useRef(videoState);
    useEffect(() => { videoStateRef.current = videoState; }, [videoState]);

    // ── State ─────────────────────────────────────────────────────────────────
    const [inputUrl, setInputUrl]           = useState('');
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [playerError, setPlayerError]     = useState(null);
    // FIX #9: Show actual buffer fill % in the loading skeleton
    const [bufferedPercent, setBufferedPercent] = useState(0);
    const [subtitleTracks, setSubtitleTracks] = useState([]);
    const [audioTracks, setAudioTracks]     = useState([]);
    const [externalSubtitles, setExternalSubtitles] = useState([]);
    const [embeddedSubtitles, setEmbeddedSubtitles] = useState([]);
    const [activeSubtitleId, setActiveSubtitleId] = useState(null);
    const [activeAudioId, setActiveAudioId] = useState(null);
    const [activeMediaElement, setActiveMediaElement] = useState(null);
    const [mediaInspection, setMediaInspection] = useState(null);
    const [mediaInspectionError, setMediaInspectionError] = useState('');
    const [isInspectingMedia, setIsInspectingMedia] = useState(false);
    const [subtitleLoadingId, setSubtitleLoadingId] = useState(null);
    const [isFullscreen, setIsFullscreen]   = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);
    const [localFileUrl, setLocalFileUrl] = useState('');
    const [localPlaybackUrl, setLocalPlaybackUrl] = useState('');
    const [audioSwitchStatus, setAudioSwitchStatus] = useState(null);
    const [remuxFailureVersion, setRemuxFailureVersion] = useState(0);
    const [fingerprintProgress, setFingerprintProgress] = useState(0);
    const [isFingerprinting, setIsFingerprinting] = useState(false);
    const [localFileError, setLocalFileError] = useState('');
    useVideoAmbientLight(activeMediaElement, ambientTargetRef);

    // ── Fullscreen Listeners ──────────────────────────────────────────────────
    useEffect(() => {
        const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            playerContainerRef.current?.requestFullscreen?.().catch(() => {});
        } else {
            document.exitFullscreen?.().catch(() => {});
        }
    };

    // ── Derived values ────────────────────────────────────────────────────────
    const isPrivileged  = currentUser?.userId === controllerMemberId;
    const rawUrl        = videoState.url || null;
    const playerUrl     = rewriteGDriveUrl(rawUrl);
    const isLocal       = videoState.sourceType === 'local' && !!videoState.localMedia;
    const isGDriveProxy = !!(playerUrl && playerUrl.includes('/api/proxy/gdrive'));
    const isNativePlayer = isLocal || isGDriveProxy;
    const hasContent    = isLocal || !!(videoState.url || videoState.magnetURI);
    const isYouTube     = !!(playerUrl && (playerUrl.includes('youtube.com') || playerUrl.includes('youtu.be')));
    const isVimeo       = !!(playerUrl && playerUrl.includes('vimeo.com'));
    const isArchive     = !!(playerUrl && playerUrl.includes('archive.org'));
    const isLocalReady  = isLocal && !!localFileUrl && localSessionRef.current === videoState.localMedia?.sessionId;
    const nowWatchingLabel = isLocal
        ? videoState.localMedia?.displayName
        : rawUrl
            ? (() => {
                try { return new URL(rawUrl).hostname.replace(/^www\./, ''); }
                catch { return 'Shared movie'; }
            })()
            : 'Waiting for a movie';
    const { apply: applySynchronizedState, correct: correctSynchronizedState } = useSynchronizedMedia({ clock, durationSec: videoState.localMedia?.duration || Infinity });

    const isPlatformEmbed = isYouTube || isVimeo;
    const mediaCapabilities = useMemo(() => getMediaSourceCapabilities({
        isLocal,
        isPlatformEmbed,
        mediaElement: activeMediaElement,
        inspectionResult: mediaInspection,
    }), [activeMediaElement, isLocal, isPlatformEmbed, mediaInspection]);

    useEffect(() => {
        if (!isLocal || !isLocalReady || !playback || !nativeVideoRef.current || localPlaybackSwitchRef.current) return;
        applySynchronizedState(nativeVideoRef.current, playback);
    }, [isLocal, isLocalReady, playback, applySynchronizedState]);
    useEffect(() => {
        const reconnected = isConnected && !wasConnectedRef.current;
        wasConnectedRef.current = isConnected;
        if (!isLocal || !isLocalReady || !nativeVideoRef.current) return;
        if (!isConnected) {
            nativeVideoRef.current.pause();
            return;
        }
        if (reconnected && playback) {
            clock.sample(7).finally(() => applySynchronizedState(nativeVideoRef.current, playback, { force: true }));
        }
    }, [applySynchronizedState, clock, isConnected, isLocal, isLocalReady, playback]);
    useEffect(() => {
        if (!isLocal || !isLocalReady || !playback) return undefined;
        const correct = (force = false) => {
            if (!isBufferingRef.current && !localPlaybackSwitchRef.current) correctSynchronizedState(nativeVideoRef.current, playback, force);
        };
        const interval = setInterval(correct, 1000);
        const visible = () => { if (document.visibilityState === 'visible') correct(true); };
        document.addEventListener('visibilitychange', visible);
        return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
    }, [isLocal, isLocalReady, playback, correctSynchronizedState]);
    useEffect(() => {
        if (!isLocal || !isLocalReady || !playback) return undefined;
        const report = () => {
            if (localPlaybackSwitchRef.current) return;
            const video = nativeVideoRef.current;
            if (!video) return;
            sendPlaybackTelemetry({
                positionSec: video.currentTime || 0,
                readyState: video.readyState,
                buffering: isBufferingRef.current,
                lastSeq: playback.seq
            });
        };
        report();
        const interval = setInterval(report, 2000);
        return () => clearInterval(interval);
    }, [isLocal, isLocalReady, playback, sendPlaybackTelemetry]);
    const everyoneReady = localReadiness.totalCount > 0 && localReadiness.readyCount >= localReadiness.totalCount;

    // A brief Socket.IO reconnect clears server-side readiness, but the browser
    // can still have the verified File and blob URL. Re-announce that readiness
    // instead of forcing the user to choose the same file again.
    useEffect(() => {
        const media = videoState.localMedia;
        if (!isLocalReady || currentUser?.localReady !== false || !media) return;
        markLocalMediaReady({
            mediaSessionId: media.sessionId,
            fingerprint: media.fingerprint,
            size: media.size,
            duration: media.duration,
        });
    }, [
        currentUser?.localReady,
        isLocalReady,
        markLocalMediaReady,
        videoState.localMedia,
    ]);

    useEffect(() => {
        externalSubtitlesRef.current = externalSubtitles;
    }, [externalSubtitles]);

    useEffect(() => {
        embeddedSubtitlesRef.current = embeddedSubtitles;
    }, [embeddedSubtitles]);

    const attachedSubtitles = useMemo(
        () => [...embeddedSubtitles, ...externalSubtitles],
        [embeddedSubtitles, externalSubtitles]
    );

    const clearExternalSubtitles = useCallback(() => {
        externalSubtitlesRef.current.forEach(track => {
            try { URL.revokeObjectURL(track.src); } catch { /* already released */ }
        });
        externalSubtitlesRef.current = [];
        setExternalSubtitles([]);
        setActiveSubtitleId(null);
    }, []);

    const clearEmbeddedSubtitles = useCallback(() => {
        embeddedSubtitleAbortRef.current?.abort();
        embeddedSubtitleAbortRef.current = null;
        embeddedSubtitlesRef.current.forEach(track => {
            try { URL.revokeObjectURL(track.src); } catch { /* already released */ }
        });
        embeddedSubtitlesRef.current = [];
        setEmbeddedSubtitles([]);
        setSubtitleLoadingId(null);
        setActiveSubtitleId(null);
    }, []);

    const cacheLocalInspection = useCallback((sessionId, result) => {
        const cache = localInspectionBySessionRef.current;
        cache.delete(sessionId);
        cache.set(sessionId, result);
        while (cache.size > 6) {
            cache.delete(cache.keys().next().value);
        }
    }, []);

    const refreshMediaTracks = useCallback((mediaElement = activeMediaElement) => {
        // The revision invalidates memoized discovery after a remux attempt is
        // marked unavailable; the actual failed IDs live in the ref.
        void remuxFailureVersion;
        const isMatroska = /matroska/i.test(mediaInspection?.container || '');
        const inspectionForTracks = mediaInspection ? {
            ...mediaInspection,
            audioTracks: mediaInspection.audioTracks?.map(track => ({
                ...track,
                remuxable: isMatroska &&
                    !remuxFailureIdsRef.current.has(String(track.id)) &&
                    getRemuxEligibility(mediaInspection, track).supported,
            })),
        } : null;
        if (!(mediaElement instanceof HTMLMediaElement)) {
            setAudioTracks(inspectionForTracks?.audioTracks?.map((track, index) => ({
                ...track,
                id: `detected-audio:${track.id ?? index}`,
                inspectedTrackId: track.id ?? index,
                browserIndex: null,
                switchable: Boolean(track.remuxable),
                switchMethod: track.remuxable ? 'remux' : 'unavailable',
                origin: 'detected',
            })) || []);
            setSubtitleTracks([]);
            return;
        }
        const discovered = discoverMediaTracks({
            mediaElement,
            inspectionResult: inspectionForTracks,
            attachedSubtitles,
        });
        setAudioTracks(discovered.audioTracks);
        setSubtitleTracks(discovered.subtitleTracks);
        setActiveAudioId(previous => {
            if (previous && discovered.audioTracks.some(track => track.id === previous && track.switchable)) return previous;
            const preferredLanguage = readLanguagePreference(AUDIO_LANGUAGE_PREFERENCE);
            return discovered.audioTracks.find(track => track.switchable && track.language === preferredLanguage && track.support !== 'unsupported')?.id
                || discovered.audioTracks.find(track => track.switchable && track.default && track.support !== 'unsupported')?.id
                || discovered.audioTracks.find(track => track.switchable && track.support !== 'unsupported')?.id
                || null;
        });
        setActiveSubtitleId(previous => {
            if (previous && discovered.subtitleTracks.some(track => track.id === previous)) return previous;
            const preferredLanguage = readLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE);
            return discovered.subtitleTracks.find(track => (
                track.browserIndex !== null && track.language === preferredLanguage
            ))?.id || discovered.subtitleTracks.find(track => track.browserIndex !== null && track.forced)?.id || null;
        });
    }, [activeMediaElement, attachedSubtitles, mediaInspection, remuxFailureVersion]);

    useEffect(() => {
        if (!(activeMediaElement instanceof HTMLMediaElement)) return undefined;
        return attachExternalSubtitleTracks(activeMediaElement, attachedSubtitles, () => {
            window.setTimeout(() => refreshMediaTracks(activeMediaElement), 0);
        });
    }, [activeMediaElement, attachedSubtitles, refreshMediaTracks]);

    useEffect(() => {
        if (!(activeMediaElement instanceof HTMLMediaElement)) {
            refreshMediaTracks(null);
            return undefined;
        }
        const refresh = () => refreshMediaTracks(activeMediaElement);
        const textTracks = activeMediaElement.textTracks;
        const browserAudioTracks = activeMediaElement.audioTracks;
        textTracks?.addEventListener?.('addtrack', refresh);
        textTracks?.addEventListener?.('removetrack', refresh);
        browserAudioTracks?.addEventListener?.('addtrack', refresh);
        browserAudioTracks?.addEventListener?.('removetrack', refresh);
        refresh();
        const delayedRefresh = window.setTimeout(refresh, 250);
        return () => {
            window.clearTimeout(delayedRefresh);
            textTracks?.removeEventListener?.('addtrack', refresh);
            textTracks?.removeEventListener?.('removetrack', refresh);
            browserAudioTracks?.removeEventListener?.('addtrack', refresh);
            browserAudioTracks?.removeEventListener?.('removetrack', refresh);
        };
    }, [activeMediaElement, refreshMediaTracks]);

    useEffect(() => {
        const selectedTrack = audioTracks.find(track => track.id === activeAudioId) || null;
        applyAudioTrack(activeMediaElement, selectedTrack);
    }, [activeAudioId, activeMediaElement, audioTracks]);

    useEffect(() => {
        if (!isLocalReady || !mediaInspection || !localFileRef.current || !/^detected-audio:/.test(activeAudioId || '')) return undefined;
        if (!/matroska/i.test(mediaInspection.container || '')) return undefined;
        const inspectedTrackId = String(activeAudioId).replace(/^detected-audio:/, '');
        const inspectedTrack = mediaInspection.audioTracks?.find(track => String(track.id) === inspectedTrackId);
        if (!inspectedTrack || remuxFailureIdsRef.current.has(inspectedTrackId)) return undefined;
        const eligibility = getRemuxEligibility(mediaInspection, inspectedTrack);
        if (!eligibility.supported) return undefined;

        const seekVersion = videoState.seekVersion ?? 0;
        const existing = localRemuxSessionRef.current;
        if (existing && String(existing.audioTrackId) === inspectedTrackId && existing.seekVersion === seekVersion) return undefined;

        const generation = ++remuxGenerationRef.current;
        let canceled = false;
        let pendingSession = null;
        const prepare = async () => {
            const targetTime = Math.max(0, getExpectedPosition(videoStateRef.current));
            localPlaybackSwitchRef.current = true;
            setAudioSwitchStatus({ status: 'preparing', trackId: activeAudioId, label: inspectedTrack.label });
            setPlayerError(null);
            setIsPlayerReady(false);
            await localRemuxSessionRef.current?.dispose();
            localRemuxSessionRef.current = null;

            try {
                pendingSession = await createLocalRemuxSession({
                    file: localFileRef.current,
                    inspection: mediaInspection,
                    audioTrackId: inspectedTrack.id,
                    startTime: targetTime,
                    duration: videoState.localMedia?.duration || mediaInspection.duration,
                    getCurrentTime: () => nativeVideoRef.current?.currentTime || targetTime,
                    onStatus: status => {
                        if (!canceled && generation === remuxGenerationRef.current && status.status === 'error') {
                            setAudioSwitchStatus({ status: 'error', trackId: activeAudioId, label: inspectedTrack.label, message: status.error?.message });
                        }
                    },
                });
                pendingSession.seekVersion = seekVersion;
                if (canceled || generation !== remuxGenerationRef.current) {
                    await pendingSession.dispose();
                    return;
                }
                localRemuxSessionRef.current = pendingSession;
                setLocalPlaybackUrl(pendingSession.url);
                await pendingSession.ready;
                if (canceled || generation !== remuxGenerationRef.current) return;
                setAudioSwitchStatus({ status: 'ready', trackId: activeAudioId, label: inspectedTrack.label });
            } catch (error) {
                if (canceled || generation !== remuxGenerationRef.current || error?.name === 'AbortError') return;
                // A runtime MSE/mux failure is generally a pipeline capability
                // failure, not a reason to cascade through every language.
                mediaInspection.audioTracks?.forEach(track => remuxFailureIdsRef.current.add(String(track.id)));
                setRemuxFailureVersion(value => value + 1);
                setAudioSwitchStatus({
                    status: 'error',
                    trackId: activeAudioId,
                    label: inspectedTrack.label,
                    message: error.message || 'This audio track cannot be remuxed safely.',
                });
                toast.error(`${inspectedTrack.label}: ${error.message || 'audio switching is unavailable'}`, { duration: 6000 });
                await pendingSession?.dispose();
                if (localRemuxSessionRef.current === pendingSession) localRemuxSessionRef.current = null;
                setLocalPlaybackUrl(localFileUrlRef.current);
                window.setTimeout(() => { localPlaybackSwitchRef.current = false; }, 0);
            }
        };
        void prepare();

        return () => {
            canceled = true;
            if (generation === remuxGenerationRef.current) remuxGenerationRef.current += 1;
            if (pendingSession && localRemuxSessionRef.current !== pendingSession) void pendingSession.dispose();
        };
    }, [
        activeAudioId,
        getExpectedPosition,
        isLocalReady,
        mediaInspection,
        remuxFailureVersion,
        videoState.localMedia?.duration,
        videoState.seekVersion,
    ]);

    useEffect(() => {
        const selectedTrack = subtitleTracks.find(track => track.id === activeSubtitleId) || null;
        applySubtitleTrack(activeMediaElement, selectedTrack);
    }, [activeMediaElement, activeSubtitleId, subtitleTracks]);

    // ── 1. Reset on URL change ────────────────────────────────────────────────
    useEffect(() => {
        const localSessionId = videoState.localMedia?.sessionId || null;
        const hasActiveLocalFile = Boolean(
            localSessionId &&
            localSessionRef.current === localSessionId &&
            localFileUrlRef.current
        );

        // Blob URLs can reach `canplay` before this source-reset effect runs.
        // Do not overwrite that ready event for the file that is still active.
        // If the event won the race, readyState is already HAVE_FUTURE_DATA (3)
        // or better; otherwise the normal onCanPlay handler will finish setup.
        const activeLocalVideoIsReady = hasActiveLocalFile &&
            nativeVideoRef.current?.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
        setIsPlayerReady(activeLocalVideoIsReady);
        setPlayerError(null);
        setAutoplayBlocked(false);
        setActiveMediaElement(null);
        void localRemuxSessionRef.current?.dispose();
        localRemuxSessionRef.current = null;
        localPlaybackSwitchRef.current = false;
        remuxFailureIdsRef.current.clear();
        setRemuxFailureVersion(value => value + 1);
        setAudioSwitchStatus(null);
        clearExternalSubtitles();
        clearEmbeddedSubtitles();
        setSubtitleTracks([]);
        setAudioTracks([]);
        setActiveSubtitleId(null);
        setActiveAudioId(null);
        const cachedInspection = localSessionId ? localInspectionBySessionRef.current.get(localSessionId) : null;
        setMediaInspection(cachedInspection?.inspection || null);
        setMediaInspectionError(cachedInspection?.error || '');
        setBufferedPercent(0);
        lastSyncedPosRef.current = 0;
        isBufferingRef.current   = false;
        initialSeekDoneRef.current = true; // FIX #5: reset; will be set false if stateTime > 2
        // FIX #3: reset retry state on every new URL
        retryCountRef.current = 0;
        clearTimeout(retryTimerRef.current);
        prevSeekVersionReactPlayerRef.current = videoState.seekVersion ?? 0;
        prevSeekVersionGDriveRef.current      = videoState.seekVersion ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoState.url, videoState.magnetURI, videoState.localMedia?.sessionId]);

    useEffect(() => {
        const activeSession = videoState.localMedia?.sessionId || null;
        if (localSessionRef.current === activeSession) return;
        if (localFileUrlRef.current) {
            URL.revokeObjectURL(localFileUrlRef.current);
            localFileUrlRef.current = '';
        }
        localSessionRef.current = null;
        localFileRef.current = null;
        setLocalFileUrl('');
        setLocalPlaybackUrl('');
        setLocalFileError('');
        setFingerprintProgress(0);
    }, [videoState.localMedia?.sessionId]);

    useEffect(() => () => {
        if (localFileUrlRef.current) {
            URL.revokeObjectURL(localFileUrlRef.current);
            localFileUrlRef.current = '';
        }
        localFileRef.current = null;
        void localRemuxSessionRef.current?.dispose();
        localRemuxSessionRef.current = null;
    }, []);

    useEffect(() => () => {
        externalSubtitlesRef.current.forEach(track => {
            try { URL.revokeObjectURL(track.src); } catch { /* already released */ }
        });
        embeddedSubtitleAbortRef.current?.abort();
        embeddedSubtitlesRef.current.forEach(track => {
            try { URL.revokeObjectURL(track.src); } catch { /* already released */ }
        });
    }, []);

    // ── 2. Drift correction – ReactPlayer viewers ─────────────────────────────
    // BUG-I FIX: Guard against buffering. When the player is stalled, seeking
    // to the host's ever-advancing time restarts the buffer from a further
    // position → infinite buffer death-loop. We skip correction until playback resumes.
    useEffect(() => {
        if (isPrivileged || !isPlayerReady || !playerRef.current || isNativePlayer) return;
        if (isBufferingRef.current) return; // BUG-I: skip during buffer stall

        const stateTime    = getExpectedPosition(videoState);
        const internalTime = playerRef.current.getCurrentTime() || 0;
        const seekVer      = videoState.seekVersion ?? 0;
        const isForcedSeek = seekVer !== prevSeekVersionReactPlayerRef.current;
        prevSeekVersionReactPlayerRef.current = seekVer;
        const drift = stateTime - internalTime;
        if (isForcedSeek || Math.abs(drift) > HARD_DRIFT_THRESHOLD) {
            playerRef.current.seekTo(stateTime, 'seconds');
            const internal = playerRef.current?.getInternalPlayer?.();
            if (internal instanceof HTMLMediaElement) internal.playbackRate = 1;
        } else {
            const internal = playerRef.current?.getInternalPlayer?.();
            if (internal instanceof HTMLMediaElement) {
                internal.playbackRate = Math.abs(drift) > SOFT_DRIFT_THRESHOLD
                    ? (drift > 0 ? 1.03 : 0.97)
                    : 1;
            }
        }
    }, [videoState, isPlayerReady, isPrivileged, isNativePlayer, getExpectedPosition]);

    // ── 3. Drift correction – GDrive native video viewers ────────────────────
    // Guard with isPlayerReady so we don't seek before video is loaded
    // FIX #6: Also guard with isBufferingRef — same protection as ReactPlayer path
    useEffect(() => {
        if (!isNativePlayer || isPrivileged || !nativeVideoRef.current || !isPlayerReady || (isLocal && !isLocalReady) || localPlaybackSwitchRef.current) return;
        if (isBufferingRef.current) return; // FIX #6: skip during buffer stall
        const stateTime   = getExpectedPosition(videoState);
        const currentTime = nativeVideoRef.current.currentTime || 0;
        const seekVer     = videoState.seekVersion ?? 0;
        const isForcedSeek = seekVer !== prevSeekVersionGDriveRef.current;
        prevSeekVersionGDriveRef.current = seekVer;

        if (isForcedSeek) {
            nativeVideoRef.current.currentTime = stateTime;
            if (nativeVideoRef.current.playbackRate !== 1.0) nativeVideoRef.current.playbackRate = 1.0;
        } else if (nativeVideoRef.current.readyState >= 3 && !nativeVideoRef.current.paused) {
            // Use subtle playbackRate to smoothly catch up instead of hard seeking,
            // which causes buffer starvation on marginal proxy connections.
            const diff = stateTime - currentTime; // Positive means host is ahead

            if (Math.abs(diff) > HARD_DRIFT_THRESHOLD) {
                // Way out of sync (or joined late), force jump
                nativeVideoRef.current.currentTime = stateTime;
                if (nativeVideoRef.current.playbackRate !== 1.0) nativeVideoRef.current.playbackRate = 1.0;
            } else if (diff > SOFT_DRIFT_THRESHOLD) {
                if (nativeVideoRef.current.playbackRate !== 1.03) nativeVideoRef.current.playbackRate = 1.03;
            } else if (diff < -SOFT_DRIFT_THRESHOLD) {
                if (nativeVideoRef.current.playbackRate !== 0.97) nativeVideoRef.current.playbackRate = 0.97;
            } else {
                if (nativeVideoRef.current.playbackRate !== 1.0) nativeVideoRef.current.playbackRate = 1.0;
            }
        }
    }, [videoState, isNativePlayer, isLocal, isLocalReady, isPrivileged, isPlayerReady, getExpectedPosition]);

    // ── 4. GDrive play / pause control ────────────────────────────────────────
    useEffect(() => {
        if (!isNativePlayer || isLocal || !nativeVideoRef.current || !isPlayerReady) return;

        if (videoState.isPlaying) {
            if (nativeVideoRef.current.paused) {
                nativeVideoRef.current.play().catch((err) => {
                    if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
                });
            }
        } else {
            if (!nativeVideoRef.current.paused) {
                nativeVideoRef.current.pause();
            }
        }
    }, [videoState.isPlaying, isNativePlayer, isLocal, isLocalReady, isPlayerReady]);

    // ── 4b. BUG-H FIX: Autoplay-blocked detection for ReactPlayer viewers ─────
    // ReactPlayer forwards the `playing` prop but browsers can silently block
    // autoplay. We detect this by trying to call play() on the internal element
    // when the room is in a playing state and the element is paused.
    useEffect(() => {
        if (isPrivileged || isNativePlayer || !isPlayerReady) return;
        if (videoState.isPlaying) {
            const internal = playerRef.current?.getInternalPlayer?.();
            if (internal instanceof HTMLVideoElement && internal.paused) {
                internal.play().catch(err => {
                    if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
                });
            }
        } else {
            setAutoplayBlocked(false);
        }
    }, [videoState.isPlaying, isPlayerReady, isPrivileged, isNativePlayer]);

    // ── 5. ReactPlayer onReady ────────────────────────────────────────────────
    const handleReady = useCallback(() => {
        setIsPlayerReady(true);
        setPlayerError(null);
        const stateTime = videoStateRef.current.playedSeconds || 0;
        if (stateTime > 2 && playerRef.current) {
            playerRef.current.seekTo(stateTime, 'seconds');
        }
        const internal = playerRef.current?.getInternalPlayer?.();
        setActiveMediaElement(internal instanceof HTMLMediaElement ? internal : null);
    }, []);

    // ── 6. Host progress sync interval (ReactPlayer + GDrive host) ───────────
    // BUG-G FIX: syncProgress is ONLY called here (every 2s), not in onProgress.
    // Previously both the interval and onProgress emitted sync_progress, causing
    // redundant traffic and viewer state race conditions.
    useEffect(() => {
        if (!isPrivileged || isLocal) return;
        syncIntervalRef.current = setInterval(() => {
            if (isSeekingRef.current) return;
            if (isNativePlayer) {
                const t = nativeVideoRef.current?.currentTime || 0;
                if (t > 0) syncProgress(t);
            } else {
                if (!playerRef.current) return;
                const t = playerRef.current.getCurrentTime?.() || 0;
                if (t > 0) syncProgress(t);
            }
        }, SYNC_INTERVAL_MS);
        return () => clearInterval(syncIntervalRef.current);
    }, [isPrivileged, isLocal, syncProgress, isNativePlayer]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    // P5 FIX: Wrap all helper functions in useCallback so they are stable across renders.
    // These functions only use refs and stable callbacks, so they never need to re-create
    // unless the underlying context action changes.
    const debouncePlay = useCallback(() => {
        clearTimeout(pauseDebounceRef.current);
        clearTimeout(playDebounceRef.current);
        playDebounceRef.current = setTimeout(() => {
            if (!isSeekingRef.current) playVideo();
        }, 200);
    }, [playVideo]);

    const debouncePause = useCallback((getTime) => {
        clearTimeout(playDebounceRef.current);
        clearTimeout(pauseDebounceRef.current);
        pauseDebounceRef.current = setTimeout(() => {
            if (!isSeekingRef.current) pauseVideo(getTime());
        }, 200);
    }, [pauseVideo]);

    const startSeekGuard = useCallback(() => {
        clearTimeout(playDebounceRef.current);
        clearTimeout(pauseDebounceRef.current);
        isSeekingRef.current = true;
    }, []);

    // BUG-D FIX: Reset isSeekingRef to false IMMEDIATELY (not inside the 300ms
    // timeout). Previously the timeline was:
    //   onSeek → startSeekGuard (isSeekingRef=true) → endSeekGuard (300ms timer)
    //   → onPlay → debouncePlay (200ms) → fires while isSeekingRef STILL TRUE
    //   → playVideo() never called → viewers stayed paused after every host seek.
    // Now isSeekingRef clears immediately so the 200ms play debounce succeeds.
    const endSeekGuard = useCallback((getTime) => {
        clearTimeout(seekEndTimerRef.current);
        isSeekingRef.current = false; // ← clear now, not inside the timeout
        seekEndTimerRef.current = setTimeout(() => {
            const t = getTime();
            lastSyncedPosRef.current = t;
            seekVideo(t);
        }, 300);
    }, [seekVideo]);

    // ── Keyboard shortcuts (host/mod) ─────────────────────────────────────
    useEffect(() => {
        if (!isPrivileged) return;
        const handleKeyDown = (e) => {
            // Don't capture keys when typing in an input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                if (videoStateRef.current.isPlaying) {
                    const t = isNativePlayer
                        ? nativeVideoRef.current?.currentTime || 0
                        : playerRef.current?.getCurrentTime?.() || 0;
                    pauseVideo(t);
                } else {
                    playVideo();
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isPrivileged, isNativePlayer, playVideo, pauseVideo]);

    const handleLoad = async (e) => {
        e.preventDefault();
        if (!isPrivileged || !inputUrl.trim()) return;
        setPlayerError(null);
        let url = inputUrl.trim();
        // Auto-resolve archive.org details page URLs to direct streamable links
        if (url.includes('archive.org/details/')) {
            toast.loading('Resolving archive.org link...', { id: 'archive-resolve' });
            url = await resolveArchiveUrl(url);
            toast.dismiss('archive-resolve');
            if (url === inputUrl.trim()) {
                toast.error('Could not find a video file at that archive.org link.');
                return;
            }
            toast.success('Archive.org link resolved!', { icon: '📼' });
        }
        loadVideo(url);
        setInputUrl('');
    };

    // BUG-F FIX: Queue button also resolves archive.org /details/ URLs before
    // queuing. Previously the raw /details/ page URL was queued, which broke
    // playback for all viewers when the item was played from the queue.
    const handleQueueAdd = async () => {
        if (!inputUrl.trim()) return;
        let url = inputUrl.trim();
        if (url.includes('archive.org/details/')) {
            toast.loading('Resolving archive.org link...', { id: 'archive-resolve-q' });
            url = await resolveArchiveUrl(url);
            toast.dismiss('archive-resolve-q');
            if (url === inputUrl.trim()) {
                toast.error('Could not find a video file at that archive.org link.');
                return;
            }
        }
        addToQueue(url, '', url);
        toast.success('Added to queue');
        setInputUrl('');
    };

    const replaceLocalObjectUrl = useCallback((file, sessionId) => {
        void localRemuxSessionRef.current?.dispose();
        localRemuxSessionRef.current = null;
        if (localFileUrlRef.current) URL.revokeObjectURL(localFileUrlRef.current);
        const nextUrl = URL.createObjectURL(file);
        localFileUrlRef.current = nextUrl;
        localFileRef.current = file;
        localSessionRef.current = sessionId;
        setLocalFileUrl(nextUrl);
        setLocalPlaybackUrl(nextUrl);
        setLocalFileError('');
        setIsPlayerReady(false);
        return nextUrl;
    }, []);

    const handleLocalFile = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        const expected = localInputModeRef.current === 'match'
            ? videoStateRef.current.localMedia
            : null;
        if (expected && file.size !== expected.size) {
            setLocalFileError('That file does not match the host’s selection (file size differs).');
            markLocalMediaNotReady(expected.sessionId);
            return;
        }

        setIsFingerprinting(true);
        setIsInspectingMedia(true);
        setFingerprintProgress(1);
        setLocalFileError('');
        try {
            const [fingerprint, durationOutcome, inspectionOutcome] = await Promise.all([
                fingerprintLocalFile(file, setFingerprintProgress),
                readLocalVideoDuration(file)
                    .then(duration => ({ duration, error: null }))
                    .catch(error => ({ duration: null, error })),
                inspectLocalMedia(file)
                    .then(inspection => ({ inspection, error: '' }))
                    .catch(error => ({
                        inspection: null,
                        error: error?.message || 'Could not inspect this media file.',
                    })),
            ]);
            const duration = durationOutcome.duration || inspectionOutcome.inspection?.duration;
            if (!Number.isFinite(duration) || duration <= 0) {
                throw durationOutcome.error || new Error('Watchly could not determine this movie’s duration.');
            }

            const inspection = inspectionOutcome.inspection
                ? { ...inspectionOutcome.inspection, duration: inspectionOutcome.inspection.duration || duration }
                : null;

            if (expected) {
                if (
                    expected.sessionId !== videoStateRef.current.localMedia?.sessionId ||
                    fingerprint !== expected.fingerprint ||
                    file.size !== expected.size ||
                    Math.abs(duration - expected.duration) > 0.25
                ) {
                    setLocalFileError('That is a different file. Choose the same video as the host.');
                    markLocalMediaNotReady(expected.sessionId);
                    return;
                }
                cacheLocalInspection(expected.sessionId, {
                    inspection,
                    error: inspectionOutcome.error,
                });
                replaceLocalObjectUrl(file, expected.sessionId);
                setMediaInspection(inspection);
                setMediaInspectionError(inspectionOutcome.error);
                markLocalMediaReady({
                    mediaSessionId: expected.sessionId,
                    fingerprint,
                    size: file.size,
                    duration,
                });
                toast.success('Local file matched. You’re ready.');
                return;
            }

            if (!isPrivileged) return;
            const sessionId = `sampled-sha256-v1:${file.size}:${fingerprint}`;
            const displayTitle = window.prompt('Choose a title for the room (your filename stays private):', 'Movie night')?.trim().slice(0, 100) || 'Local movie';
            cacheLocalInspection(sessionId, {
                inspection,
                error: inspectionOutcome.error,
            });
            replaceLocalObjectUrl(file, sessionId);
            try {
                await selectLocalMedia({
                    sessionId,
                    fingerprint,
                    // Never expose the device filename to the room by default.
                    displayName: displayTitle,
                    size: file.size,
                    mimeType: file.type || 'application/octet-stream',
                    duration,
                });
                setMediaInspection(inspection);
                setMediaInspectionError(inspectionOutcome.error);
                toast.success('Local file selected. Waiting for everyone to match it.');
            } catch (error) {
                localInspectionBySessionRef.current.delete(sessionId);
                if (localFileUrlRef.current) URL.revokeObjectURL(localFileUrlRef.current);
                localFileUrlRef.current = '';
                localSessionRef.current = null;
                localFileRef.current = null;
                setLocalFileUrl('');
                setLocalPlaybackUrl('');
                throw error;
            }
        } catch (error) {
            const message = error.message || 'Could not read this video file.';
            setLocalFileError(message);
            toast.error(message, { duration: 5000 });
            if (expected?.sessionId) {
                const unsupported = /format|decode|browser cannot read/i.test(error.message || '');
                markLocalMediaStatus(expected.sessionId, unsupported ? 'UNSUPPORTED' : 'ERROR', error.message);
            }
        } finally {
            setIsFingerprinting(false);
            setIsInspectingMedia(false);
        }
    };

    const handleSubtitleFiles = useCallback(async files => {
        const parsedTracks = [];
        for (const [index, file] of files.entries()) {
            try {
                const parsed = await parseSubtitleFile(file);
                parsedTracks.push({
                    ...parsed,
                    blob: undefined,
                    id: `external-subtitle:${Date.now()}:${index}:${Math.random().toString(36).slice(2, 8)}`,
                    src: URL.createObjectURL(parsed.blob),
                    origin: 'external',
                });
            } catch (error) {
                toast.error(`${file.name}: ${error.message}`, { duration: 5000 });
            }
        }
        if (!parsedTracks.length) return;
        setExternalSubtitles(previous => [...previous, ...parsedTracks]);
        setActiveSubtitleId(parsedTracks[0].id);
        writeLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE, parsedTracks[0].language);
        toast.success(`Loaded ${parsedTracks.length} subtitle track${parsedTracks.length === 1 ? '' : 's'}`, { icon: '🗒️' });
        if (parsedTracks.some(track => track.limited)) {
            toast('ASS/SSA timing and text were loaded. Advanced styling is not preserved.', { icon: 'ℹ️', duration: 5000 });
        }
    }, []);

    const removeExternalSubtitle = useCallback(trackId => {
        setExternalSubtitles(previous => previous.filter(track => {
            if (track.id !== trackId) return true;
            try { URL.revokeObjectURL(track.src); } catch { /* already released */ }
            return false;
        }));
        setActiveSubtitleId(previous => previous === trackId ? null : previous);
    }, []);

    const handleAudioChange = useCallback(trackId => {
        const track = audioTracks.find(candidate => candidate.id === trackId);
        if (!track?.switchable || track.support === 'unsupported') return;
        setActiveAudioId(trackId);
        writeLanguagePreference(AUDIO_LANGUAGE_PREFERENCE, track.language);
    }, [audioTracks]);

    const handleSubtitleChange = useCallback(async trackId => {
        embeddedSubtitleAbortRef.current?.abort();
        embeddedSubtitleAbortRef.current = null;
        if (!trackId) {
            setSubtitleLoadingId(null);
            setActiveSubtitleId(null);
            writeLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE, '');
            return;
        }

        const track = subtitleTracks.find(candidate => candidate.id === trackId);
        if (!track?.switchable) return;
        if (!track.requiresPreparation) {
            setActiveSubtitleId(trackId);
            writeLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE, track.language);
            return;
        }

        const file = localFileRef.current;
        const sessionId = localSessionRef.current;
        if (!file || !sessionId) {
            toast.error('Choose your local movie file before loading its embedded subtitles.');
            return;
        }

        const controller = new AbortController();
        embeddedSubtitleAbortRef.current = controller;
        setSubtitleLoadingId(trackId);
        toast.loading(`Loading ${track.label} subtitles…`, { id: 'embedded-subtitle' });
        try {
            const extracted = await extractMatroskaSubtitle(file, track.trackNumber ?? track.id, { signal: controller.signal });
            if (controller.signal.aborted || localSessionRef.current !== sessionId) return;
            const preparedTrack = {
                ...track,
                ...extracted,
                blob: undefined,
                src: URL.createObjectURL(extracted.blob),
                origin: 'embedded',
                prepared: true,
                requiresPreparation: false,
            };
            setEmbeddedSubtitles(previous => {
                previous.filter(candidate => candidate.id === trackId).forEach(candidate => {
                    try { URL.revokeObjectURL(candidate.src); } catch { /* already released */ }
                });
                return [...previous.filter(candidate => candidate.id !== trackId), preparedTrack];
            });
            setActiveSubtitleId(trackId);
            writeLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE, track.language);
            toast.success(`${track.label} subtitles ready · ${extracted.cueCount} cues`, { id: 'embedded-subtitle' });
            if (extracted.limited) {
                toast('Embedded ASS/SSA styling is simplified to safe timing and text.', { icon: 'ℹ️', duration: 5000 });
            }
        } catch (error) {
            if (error?.name !== 'AbortError') {
                writeLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE, '');
                toast.error(error.message || 'Could not load embedded subtitles.', { id: 'embedded-subtitle', duration: 6000 });
            }
        } finally {
            if (embeddedSubtitleAbortRef.current === controller) embeddedSubtitleAbortRef.current = null;
            setSubtitleLoadingId(current => current === trackId ? null : current);
        }
    }, [subtitleTracks]);

    useEffect(() => {
        if (activeSubtitleId || subtitleLoadingId || !isLocalReady) return;
        const preferredLanguage = readLanguagePreference(SUBTITLE_LANGUAGE_PREFERENCE);
        if (!preferredLanguage) return;
        const preferredTrack = subtitleTracks.find(track => track.switchable && track.language === preferredLanguage);
        if (preferredTrack) void handleSubtitleChange(preferredTrack.id);
    }, [activeSubtitleId, handleSubtitleChange, isLocalReady, subtitleLoadingId, subtitleTracks]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className={`room-video-player flex h-full w-full flex-col gap-3 ${className}`} data-room-appearance={appearance}>
            <div className="video-player-controls flex min-h-0 flex-col gap-3">
                <div className="cinematic-now-watching" aria-live="polite">
                    <span>Now Watching</span>
                    <strong title={nowWatchingLabel}>{nowWatchingLabel}</strong>
                    <small>{hasContent ? 'Synchronized for everyone' : 'Choose a source to begin'}</small>
                </div>
                <div className="cinematic-watch-controls-heading">
                    <span>Watch Controls</span>
                    <small>{isPrivileged ? 'Host controls' : 'Synced viewing'}</small>
                </div>

            {/* ── Control Bar (Host/Mod only) ─────────────────────────── */}
            {isPrivileged && (
                <div className="flex flex-shrink-0 flex-wrap gap-2">
                    <form onSubmit={handleLoad} className="flex min-w-0 basis-full items-center gap-1.5 rounded-2xl border border-white/10 bg-black/80 p-1.5 shadow-xl shadow-black/30 transition-all lg:basis-auto lg:flex-1">
                        <div className="relative flex flex-1 items-center">
                            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                            <input
                                type="text"
                                value={inputUrl}
                                onChange={e => setInputUrl(e.target.value)}
                                placeholder="Watch from Link — YouTube, Vimeo, Google Drive, or direct URL..."
                                className="w-full bg-transparent py-2.5 pl-10 pr-4 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                            <button type="submit" disabled={!inputUrl.trim()}
                                className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-zinc-200 active:scale-95 disabled:opacity-40">
                                Play Now
                            </button>
                            <button type="button" disabled={!inputUrl.trim()} onClick={handleQueueAdd}
                                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/[0.06] active:scale-95 disabled:opacity-40">
                                Queue
                            </button>
                        </div>
                    </form>
                    <button
                        type="button"
                        onClick={() => {
                            localInputModeRef.current = 'replace';
                            localFileInputRef.current?.click();
                        }}
                        disabled={isFingerprinting}
                        className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/80 px-3 text-xs font-bold text-white transition hover:bg-white/[0.06] disabled:opacity-50"
                        title="Play a file that stays on each person’s device"
                    >
                        <FileVideo size={15} />
                        <span className="hidden xl:inline">Watch Local File</span>
                    </button>
                    {/* Source badge */}
                    {(() => {
                        if (isLocal) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-violet-500/30 bg-violet-500/10 rounded-xl text-xs text-violet-300 shrink-0" title="This video stays on each person’s device">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isLocalReady ? 'bg-violet-400 animate-pulse' : 'bg-violet-700'}`} />
                                <FileVideo size={13} />
                                <span className="hidden sm:inline font-medium">Local</span>
                            </div>
                        );
                        if (isGDriveProxy) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-blue-500/30 bg-blue-500/10 rounded-xl text-xs text-blue-300 shrink-0" title="Streaming via Google Drive proxy">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPlayerReady ? 'bg-blue-400 animate-pulse' : 'bg-blue-600'}`} />
                                <FolderOpen size={13} />
                                <span className="hidden sm:inline font-medium">{isPlayerReady ? 'G-Drive · Live' : 'G-Drive · Loading'}</span>
                            </div>
                        );
                        if (isArchive) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-orange-500/30 bg-orange-500/10 rounded-xl text-xs text-orange-300 shrink-0" title="Streaming from archive.org">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPlayerReady ? 'bg-orange-400 animate-pulse' : 'bg-orange-600'}`} />
                                <span className="hidden sm:inline font-medium">{isPlayerReady ? 'Archive · Live' : 'Archive · Loading'}</span>
                            </div>
                        );
                        if (isYouTube) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-red-500/30 bg-red-500/10 rounded-xl text-xs text-red-300 shrink-0" title="Playing YouTube video">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPlayerReady ? 'bg-red-400 animate-pulse' : 'bg-red-700'}`} />
                                <span className="hidden sm:inline font-medium">{isPlayerReady ? 'YouTube · Live' : 'YouTube · Loading'}</span>
                            </div>
                        );
                        if (hasContent) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-green-500/30 bg-green-500/10 rounded-xl text-xs text-green-300 shrink-0" title="Streaming direct file">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPlayerReady ? 'bg-green-400 animate-pulse' : 'bg-green-700'}`} />
                                <span className="hidden sm:inline font-medium">{isPlayerReady ? 'Direct · Live' : 'Direct · Loading'}</span>
                            </div>
                        );
                        return (
                            <div className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-500" title="No video loaded">
                                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-700" />
                                <span className="hidden sm:inline">No source</span>
                            </div>
                        );
                    })()}
                </div>
            )}

            <input
                ref={localFileInputRef}
                type="file"
                className="hidden"
                accept="video/*,.mkv,.mov,.m4v,.ogv,.ts,.m2ts"
                onChange={handleLocalFile}
            />

            {isLocal && (
                <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-violet-500/20 bg-violet-500/[0.07] px-3 py-2 text-xs">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <ShieldCheck size={15} className="shrink-0 text-violet-300" />
                        <div className="min-w-0">
                            <div className="truncate font-semibold text-zinc-200" title={videoState.localMedia.displayName}>
                                {videoState.localMedia.displayName}
                            </div>
                            <div className="truncate text-[10px] text-zinc-500">
                                {formatFileSize(videoState.localMedia.size)} · The file never leaves your device
                            </div>
                        </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 font-bold ${isLocalReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/[0.03] text-zinc-400'}`}>
                        {localReadiness.readyCount}/{localReadiness.totalCount} ready
                    </span>
                    {isLocalReady && <button
                        type="button"
                        onClick={async () => {
                            await clock.sample(7);
                            correctSynchronizedState(nativeVideoRef.current, playback, true);
                            toast.success('Resynced to room time.');
                        }}
                        className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 font-bold text-zinc-300 hover:bg-white/[0.06]"
                    ><RefreshCw size={12}/> Resync</button>}
                    {isLocalReady && !isPrivileged && <button
                        type="button"
                        onClick={async () => {
                            const video = nativeVideoRef.current;
                            if (!video) return;
                            try {
                                correctSynchronizedState(video, playback, true);
                                await video.play();
                                if (playback?.status !== 'playing') video.pause();
                                setAutoplayBlocked(false);
                                toast.success('Playback enabled for this browser.');
                            } catch {
                                setAutoplayBlocked(true);
                            }
                        }}
                        className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 font-bold text-zinc-300 hover:bg-white/[0.06]"
                    ><Play size={12}/> Enable playback</button>}
                    {isPrivileged && !everyoneReady && !videoState.isPlaying && (
                        <button
                            type="button"
                            onClick={() => playVideo({ startAnyway: true })}
                            className="rounded-xl border border-white/10 bg-white px-3 py-1.5 font-bold text-black transition hover:bg-zinc-200"
                        >
                            Start anyway
                        </button>
                    )}
                </div>
            )}

            {isFingerprinting && (
                <div className="flex flex-shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-black/70 px-3 py-2 text-xs text-zinc-400">
                    <span className="whitespace-nowrap">Checking file… {fingerprintProgress}%</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-violet-400 transition-all" style={{ width: `${fingerprintProgress}%` }} />
                    </div>
                </div>
            )}

            {localFileError && !isLocal && (
                <div className="flex flex-shrink-0 items-center gap-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    <AlertCircle size={14} className="shrink-0" />
                    <span>{localFileError}</span>
                </div>
            )}

            {hasContent && (
                <MediaTrackControls
                    variant={appearance}
                    audioTracks={audioTracks}
                    subtitleTracks={subtitleTracks}
                    activeAudioId={activeAudioId}
                    activeSubtitleId={activeSubtitleId}
                    capabilities={mediaCapabilities}
                    inspection={mediaInspection}
                    inspectionError={mediaInspectionError}
                    isInspecting={isInspectingMedia}
                    audioSwitchStatus={audioSwitchStatus}
                    subtitleLoadingId={subtitleLoadingId}
                    onAudioChange={handleAudioChange}
                    onSubtitleChange={handleSubtitleChange}
                    onSubtitleFiles={handleSubtitleFiles}
                    onRemoveSubtitle={removeExternalSubtitle}
                />
            )}
            </div>

            {/* ── Player ────────────────────────────────────────────────── */}
            <div ref={playerContainerRef} className="room-player-surface group relative min-h-0 flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-black shadow-2xl shadow-black/50">
                <AnimatePresence mode="wait">
                    {!hasContent ? (
                        <MotionDiv key="empty"
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_45%)] p-6 text-center">
                            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/60">
                                <img src="/logo.png" alt="Watchly Logo" className="w-14 h-auto opacity-80 theme-invert transition-all" />
                            </div>
                            <h2 className="mb-2 text-xl font-semibold text-white">No video playing</h2>
                            <p className="max-w-sm text-sm leading-6 text-zinc-500">
                                {isPrivileged
                                    ? appearance === 'cinematic'
                                        ? 'Choose a source in Watch Controls to begin syncing.'
                                        : 'Paste a video URL in the bar above and click Play Now to begin syncing.'
                                    : 'Waiting for the host to start a video.'}
                            </p>
                        </MotionDiv>
                    ) : (
                        <MotionDiv key="player"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 w-full h-full">

                            {/* ── Loading Skeleton ─────────────────────────────── */}
                            <AnimatePresence>
                                {!isPlayerReady && !playerError && (!isLocal || isLocalReady) && (
                                    <MotionDiv
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center"
                                        style={{ background: 'var(--bg-base)' }}
                                    >
                                        <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 ring-4 ring-white/5 animate-pulse shimmer-pill">
                                            <img src="/logo.png" alt="Loading" className="w-16 h-auto opacity-50 animate-bounce theme-invert transition-all" />
                                        </div>
                                        <h2 className="text-xl font-bold mb-2 animate-pulse" style={{ color: 'var(--text)' }}>
                                            {isLocal ? 'Preparing local video…' : 'Buffering stream...'}
                                        </h2>
                                        {/* FIX #9: Real buffer fill bar for GDrive; indeterminate shimmer for others */}
                                        <div className="w-48 h-2 bg-white/10 rounded-full overflow-hidden mt-2">
                                            {isGDriveProxy && bufferedPercent > 0 ? (
                                                <div
                                                    className="h-full bg-emerald-400 transition-all duration-500 rounded-full"
                                                    style={{ width: `${bufferedPercent}%` }}
                                                />
                                            ) : (
                                                <div className="h-full bg-emerald-400 animate-pulse w-full origin-left" style={{ animation: 'shimmer 1.5s infinite linear' }} />
                                            )}
                                        </div>
                                        {isGDriveProxy && bufferedPercent > 0 && (
                                            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{Math.round(bufferedPercent)}% buffered</p>
                                        )}
                                    </MotionDiv>
                                )}
                            </AnimatePresence>

                            {/* ── Google Drive: native <video> ─────────────────── */}
                            {isLocal && !isLocalReady && (
                                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black px-5">
                                    <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.035] p-6 text-center">
                                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
                                            <FileVideo size={25} />
                                        </div>
                                        <h3 className="text-lg font-bold text-white">Choose the same local file</h3>
                                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                                            {videoState.localMedia.selectedBy || 'The host'} selected <span className="font-semibold text-zinc-200">{videoState.localMedia.displayName}</span>. Choose your own copy to join playback.
                                        </p>
                                        <button
                                            type="button"
                                            disabled={isFingerprinting}
                                            onClick={() => {
                                                localInputModeRef.current = 'match';
                                                localFileInputRef.current?.click();
                                            }}
                                            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:opacity-50"
                                        >
                                            <FolderOpen size={16} />
                                            {isFingerprinting ? `Checking ${fingerprintProgress}%` : 'Choose matching file'}
                                        </button>
                                        {localFileError && (
                                            <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
                                                {localFileError}
                                            </div>
                                        )}
                                        <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-3 text-left text-xs leading-5 text-emerald-200">
                                            <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                                            Only a sampled SHA-256 fingerprint and small metadata are shared. No video bytes are uploaded.
                                        </div>
                                        <p className="mt-3 text-[11px] leading-5 text-zinc-600">
                                            MP4 with H.264/AAC is safest. WebM support depends on the browser; some MKV files and codecs will not play.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {isNativePlayer && (!isLocal || isLocalReady) && (
                                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <video
                                        ref={nativeVideoRef}
                                        key={isLocal ? videoState.localMedia.sessionId : playerUrl}
                                        src={isLocal ? localPlaybackUrl : playerUrl}
                                        controls
                                        preload="auto"
                                        controlsList="nodownload"
                                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                        onLoadedMetadata={() => {
                                            setActiveMediaElement(nativeVideoRef.current);
                                            const stateTime = getExpectedPosition(videoStateRef.current);
                                            if (stateTime > 2 && nativeVideoRef.current) {
                                                // FIX #5: Mark seek as pending — onCanPlay must wait for onSeeked
                                                initialSeekDoneRef.current = false;
                                                nativeVideoRef.current.currentTime = stateTime;
                                            }
                                        }}
                                        onCanPlay={() => {
                                            // B7 FIX: Use functional setIsPlayerReady so we read the
                                            // *previous* state value instead of the stale closure
                                            // 'isPlayerReady'. Two rapid onCanPlay calls both saw
                                            // wasReady=false and called play() twice.
                                             setIsPlayerReady(prev => {
                                                // FIX #5: Only autoplay if the initial seek has already completed
                                                // (or no seek was needed). Prevents playing from position 0
                                                // then visibly jumping to the correct position.
                                                if (!prev && initialSeekDoneRef.current && videoStateRef.current.isPlaying && nativeVideoRef.current?.paused) {
                                                    nativeVideoRef.current.play().catch((err) => {
                                                        if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
                                                    });
                                                }
                                                 return true;
                                             });
                                            if (localPlaybackSwitchRef.current && initialSeekDoneRef.current) {
                                                localPlaybackSwitchRef.current = false;
                                            }
                                            setPlayerError(null);
                                        }}
                                        onPlay={() => {
                                            setAutoplayBlocked(false);
                                            if (localPlaybackSwitchRef.current) return;
                                            if (!isPrivileged) return;
                                            if (isLocal && videoStateRef.current.isPlaying) return;
                                            if (isLocal && !everyoneReady && !videoStateRef.current.isPlaying) {
                                                nativeVideoRef.current?.pause();
                                                toast.error('Not everyone is ready. Use “Start anyway” to continue.');
                                                return;
                                            }
                                            if (isLocal && !videoStateRef.current.isPlaying) {
                                                nativeVideoRef.current?.pause();
                                                debouncePlay();
                                                return;
                                            }
                                            debouncePlay();
                                        }}
                                        onPause={() => {
                                            if (localPlaybackSwitchRef.current) return;
                                            if (!isPrivileged || (isLocal && !videoStateRef.current.isPlaying)) return;
                                            if (isLocal) {
                                                const position = nativeVideoRef.current?.currentTime || 0;
                                                nativeVideoRef.current?.play().catch(() => {});
                                                pauseVideo(position);
                                                return;
                                            }
                                            debouncePause(() => nativeVideoRef.current?.currentTime || 0);
                                        }}
                                        onSeeking={() => { if (localPlaybackSwitchRef.current || !isPrivileged) return; startSeekGuard(); }}
                                        onSeeked={() => {
                                            // FIX #5: Initial seek completed — now safe to autoplay.
                                            // FIX #1-code: onSeeked fires before the isPlayerReady state
                                            // update from onCanPlay propagates in some browsers.
                                            // Use functional setState to read the CURRENT value without
                                            // a stale closure — return prev unchanged so state won't update.
                                            initialSeekDoneRef.current = true;
                                            if (localPlaybackSwitchRef.current) localPlaybackSwitchRef.current = false;
                                            setIsPlayerReady(prev => {
                                                if (prev && videoStateRef.current.isPlaying && nativeVideoRef.current?.paused) {
                                                    nativeVideoRef.current.play().catch((err) => {
                                                        if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
                                                    });
                                                }
                                                return prev; // no state change — only reading current value
                                            });
                                            if (!isPrivileged) return;
                                            if (isLocal && Math.abs((nativeVideoRef.current?.currentTime || 0) - getExpectedPosition(videoStateRef.current)) < 0.2) return;
                                            endSeekGuard(() => nativeVideoRef.current?.currentTime || 0);
                                        }}
                                        // FIX #6: Track buffering state on native <video> so drift
                                        // correction skips during stalls (same as ReactPlayer path).
                                        onWaiting={() => {
                                            isBufferingRef.current = true;
                                            if (isLocal && !localPlaybackSwitchRef.current) markLocalMediaStatus(videoState.localMedia.sessionId, 'BUFFERING', 'Local player is buffering');
                                        }}
                                        onPlaying={() => {
                                            isBufferingRef.current = false;
                                            if (isLocal && !localPlaybackSwitchRef.current) markLocalMediaStatus(videoState.localMedia.sessionId, 'READY');
                                        }}
                                        // FIX #9: Update buffer fill progress
                                        onTimeUpdate={() => {
                                            const v = nativeVideoRef.current;
                                            if (v && v.buffered.length > 0 && v.duration > 0) {
                                                setBufferedPercent(Math.min(100, (v.buffered.end(v.buffered.length - 1) / v.duration) * 100));
                                            }
                                        }}
                                        onError={() => {
                                            if (localPlaybackSwitchRef.current) return;
                                            clearTimeout(retryTimerRef.current);
                                            const v = nativeVideoRef.current;
                                            const code = v?.error?.code;
                                            if (isLocal) markLocalMediaStatus(
                                                videoState.localMedia.sessionId,
                                                code === 3 || code === 4 ? 'UNSUPPORTED' : 'ERROR',
                                                code === 3 || code === 4 ? 'This browser cannot decode this file' : 'The local file could not be read'
                                            );
                                            // MediaError codes: 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
                                            // FIX #3: Auto-retry up to 3× on transient network errors
                                            if (code === 2 && retryCountRef.current < 3) {
                                                retryCountRef.current++;
                                                const attempt = retryCountRef.current;
                                                setPlayerError(`Connection issue — retrying (${attempt}/3)…`);
                                                retryTimerRef.current = setTimeout(() => {
                                                    if (nativeVideoRef.current) {
                                                        nativeVideoRef.current.load();
                                                    }
                                                }, 2000);
                                                return;
                                            }
                                            // FIX #2: Format-specific error messages
                                            if (code === 3) {
                                                setPlayerError(mediaInspection?.compatibility?.message || 'This format or codec cannot be decoded by your browser. MP4 with H.264/AAC is the safest option.');
                                            } else if (code === 4) {
                                                setPlayerError(isLocal
                                                    ? (mediaInspection?.compatibility?.message || 'This local file format is not supported by your browser. Try an MP4 (H.264/AAC) or a compatible WebM.')
                                                    : 'Could not load this file. Make sure it is an MP4 or WebM and is shared as “Anyone with the link” in Google Drive.');
                                            } else {
                                                setPlayerError(isLocal
                                                    ? 'Could not play this local file.'
                                                    : 'Could not load Google Drive video. Make sure the file is shared as “Anyone with the link”.');
                                            }
                                        }}
                                        onEnded={() => { if (isLocal && isPrivileged) endVideo(); }}
                                    />
                                    {/* FIX #8: Dual overlay — bottom covers desktop Chrome/Firefox seekbar,
                                        top covers iOS Safari controls (which appear at top of video) */}
                                    {!isPrivileged && (
                                        <>
                                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '64px', zIndex: 10, cursor: 'not-allowed' }} />
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '44px', zIndex: 10, cursor: 'not-allowed' }} />
                                        </>
                                    )}
                                    {/* Autoplay Blocked Overlay */}
                                    {autoplayBlocked && (
                                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
                                            <div className="flex flex-col items-center p-6 border border-white/20 bg-black/90 rounded-2xl shadow-2xl">
                                                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 cursor-pointer hover:scale-105 transition-all"
                                                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                                                    onClick={() => {
                                                        if (nativeVideoRef.current) {
                                                            nativeVideoRef.current.play().then(() => setAutoplayBlocked(false)).catch(console.error);
                                                        }
                                                    }}>
                                                    <Play size={32} className="ml-1" style={{ color: 'var(--text)' }} />
                                                </div>
                                                <h3 className="text-xl font-bold text-white mb-2">Autoplay Blocked</h3>
                                                <p className="text-gray-400 text-sm text-center max-w-xs">
                                                    Your browser paused the video. Click play to sync with the host.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── YouTube / Vimeo / Archive / direct URL: ReactPlayer ──────── */}
                            {!isLocal && !isGDriveProxy && playerUrl && (
                                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <ReactPlayer
                                        ref={playerRef}
                                        key={playerUrl}
                                        url={playerUrl}
                                        playing={videoState.isPlaying}
                                        controls={isPrivileged || isYouTube || isArchive}
                                        width="100%"
                                        height="100%"
                                        onReady={handleReady}
                                        onPlay={() => { setAutoplayBlocked(false); if (!isPrivileged) return; debouncePlay(); }}
                                        onPause={() => { if (!isPrivileged) return; debouncePause(() => playerRef.current?.getCurrentTime() || 0); }}
                                        onSeek={() => {
                                            if (!isPrivileged) return;
                                            endSeekGuard(() => playerRef.current?.getCurrentTime?.() || 0);
                                        }}
                                        onError={() => setPlayerError('Could not load video.')}
                                        onProgress={(p) => { lastSyncedPosRef.current = p.playedSeconds; }}
                                        progressInterval={1000}
                                        onBuffer={() => { isBufferingRef.current = true; }}
                                        onBufferEnd={() => { isBufferingRef.current = false; }}
                                        config={{
                                            youtube: { playerVars: { disablekb: isPrivileged ? 0 : 1, modestbranding: 1 } },
                                             file: {
                                                 attributes: isArchive
                                                     ? { preload: 'auto' }
                                                    : { preload: 'auto', crossOrigin: 'anonymous' },
                                             }
                                        }}
                                    />

                                    {/* FIX #8: Dual seekbar blocker — bottom for desktop, top for iOS Safari */}
                                    {!isPrivileged && (
                                        <>
                                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '64px', zIndex: 10, cursor: 'not-allowed' }} />
                                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '44px', zIndex: 10, cursor: 'not-allowed' }} />
                                        </>
                                    )}

                                    {/* FIX #12: Autoplay-blocked overlay — null-safe getInternalPlayer + YouTube API fallback */}
                                    {autoplayBlocked && !isPrivileged && (
                                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
                                            <div className="flex flex-col items-center p-6 border border-white/20 bg-black/90 rounded-2xl shadow-2xl">
                                                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 cursor-pointer hover:scale-105 transition-all"
                                                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                                                    onClick={() => {
                                                        const internal = playerRef.current?.getInternalPlayer?.();
                                                        if (internal instanceof HTMLVideoElement) {
                                                            internal.play().then(() => setAutoplayBlocked(false)).catch(console.error);
                                                        } else if (internal && typeof internal.playVideo === 'function') {
                                                            internal.playVideo(); setAutoplayBlocked(false);
                                                        }
                                                    }}>
                                                    <Play size={32} className="ml-1" style={{ color: 'var(--text)' }} />
                                                </div>
                                                <h3 className="text-xl font-bold text-white mb-2">Autoplay Blocked</h3>
                                                <p className="text-gray-400 text-sm text-center max-w-xs">Your browser paused the video. Click play to sync with the host.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Error overlay ───────────────────────────────────── */}
                            {playerError && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90 px-6">
                                    <AlertCircle size={36} className="text-red-400 mb-3" />
                                    {isLocal && mediaInspection && (
                                        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-zinc-100">
                                            {mediaInspection.compatibility?.status === 'partial'
                                                ? 'This file is partially supported'
                                                : mediaInspection.compatibility?.status === 'unknown'
                                                    ? 'Playback compatibility uncertain'
                                                    : 'This file cannot play as-is'}
                                        </h3>
                                    )}
                                    <p className="text-gray-200 text-sm text-center font-medium mb-3">{playerError}</p>
                                    {isLocal && mediaInspection && (
                                        <div className="mb-3 max-h-[45%] w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] p-2 text-left">
                                            <MediaInfoPanel inspection={mediaInspection} inspectionError={mediaInspectionError} />
                                        </div>
                                    )}
                                    {isLocal && localPlaybackUrl && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setPlayerError(null);
                                                setIsPlayerReady(false);
                                                nativeVideoRef.current?.load();
                                            }}
                                            className="mb-4 flex items-center gap-2 rounded-xl border border-white/15 bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
                                        >
                                            <RefreshCw size={14} /> Try Anyway
                                        </button>
                                    )}
                                    {/* Retry button */}
                                    {isPrivileged && rawUrl && (
                                        <button
                                            onClick={() => { setPlayerError(null); loadVideo(rawUrl); }}
                                            className="flex items-center gap-2 px-4 py-2 mb-4 rounded-xl text-sm font-semibold transition-all hover:scale-105"
                                            style={{ background: 'var(--glass-bg-strong)', color: 'var(--text)', border: '1px solid var(--glass-border)' }}>
                                            <RefreshCw size={14} /> Retry
                                        </button>
                                    )}
                                    {isGDriveProxy && (
                                        <div className="border border-blue-500/30 bg-blue-500/10 rounded-xl p-4 text-xs text-blue-200 max-w-sm text-left space-y-1">
                                            <p className="font-semibold text-blue-300 mb-2">How to fix Google Drive sharing:</p>
                                            <p>1. Open the file in Google Drive</p>
                                            <p>2. Click <strong>Share</strong> → change to <strong>Anyone with the link</strong></p>
                                            <p>3. Set role to <strong>Viewer</strong></p>
                                            <p>4. Copy the share link and paste it again here</p>
                                        </div>
                                    )}
                                    {isArchive && (
                                        <div className="border border-orange-500/30 bg-orange-500/10 rounded-xl p-4 text-xs text-orange-200 max-w-sm text-left space-y-1">
                                            <p className="font-semibold text-orange-300 mb-2">Archive.org tips:</p>
                                            <p>⏳ If you <strong>just uploaded</strong> the file, wait <strong>5–15 minutes</strong> for archive.org to finish processing it, then try again.</p>
                                            <p>🔒 Make sure the item is set to <strong>Public</strong> in archive.org settings.</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Viewer indicator ────────────────────────────────── */}
                            {!isPrivileged && (
                                <div className="absolute top-3 right-3 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none">
                                    <Lock size={12} className="text-gray-400" />
                                    <span className="text-xs text-gray-300">Synced to host</span>
                                </div>
                            )}

                            {/* ── Fullscreen Button (Viewers) ──────────────────────── */}
                            {!isPrivileged && (
                                <button
                                    onClick={toggleFullscreen}
                                    className="absolute bottom-4 right-4 bg-black/70 hover:bg-black/90 backdrop-blur p-2 rounded-xl border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-30"
                                    title="Toggle Fullscreen"
                                >
                                    {isFullscreen ? <Minimize size={18} className="text-white" /> : <Maximize size={18} className="text-white" />}
                                </button>
                            )}
                        </MotionDiv>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default VideoPlayer;
