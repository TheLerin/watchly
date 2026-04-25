import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactPlayer from 'react-player/lazy';
import { useRoom } from '../context/RoomContext';
import { Play, Link as LinkIcon, Lock, AlertCircle, Plus, ChevronDown, Mic, Subtitles as SubtitlesIcon, FolderOpen, Maximize, Minimize } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// How often the host reports playback position (ms)
const SYNC_INTERVAL_MS = 2000;
// Max drift before a viewer auto-corrects during normal playback
const DRIFT_THRESHOLD = 2;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

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

// Sub-components defined OUTSIDE VideoPlayer so they never remount on re-render

const SubtitleMenu = ({ activeSubtitle, setActiveSubtitle, subtitleTracks, showSubMenu, setShowSubMenu, setShowAudioMenu }) => (
    <div className="relative">
        <button onClick={() => { setShowSubMenu(p => !p); setShowAudioMenu(false); }}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors" style={{ background: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text)' }}>
            <SubtitlesIcon size={13} />
            {activeSubtitle === -1 ? 'Subs Off' : (subtitleTracks.find(t => t.index === activeSubtitle)?.label || `Track ${activeSubtitle + 1}`)}
            <ChevronDown size={11} />
        </button>
        <AnimatePresence>
            {showSubMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 mt-1 bg-black/80 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden min-w-40" style={{ background: 'var(--glass-bg-strong)', borderColor: 'var(--glass-border)' }}>
                    <button onClick={() => { setActiveSubtitle(-1); setShowSubMenu(false); }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeSubtitle === -1 ? 'font-bold' : ''}`} style={{ color: activeSubtitle === -1 ? 'var(--text)' : 'var(--text-sub)' }}>Off</button>
                    {subtitleTracks.map(t => (
                        <button key={t.index} onClick={() => { setActiveSubtitle(t.index); setShowSubMenu(false); }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeSubtitle === t.index ? 'font-bold' : ''}`} style={{ color: activeSubtitle === t.index ? 'var(--text)' : 'var(--text-sub)' }}>
                            {t.label}{t.language ? ` (${t.language})` : ''}
                        </button>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>
    </div>
);

const AudioMenu = ({ activeAudio, setActiveAudio, audioTracks, showAudioMenu, setShowAudioMenu, setShowSubMenu }) => (
    <div className="relative">
        <button onClick={() => { setShowAudioMenu(p => !p); setShowSubMenu(false); }}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-300 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors" style={{ background: 'var(--panel-bg)', borderColor: 'var(--border-color)', color: 'var(--text)' }}>
            <Mic size={13} />
            {audioTracks.find(t => t.index === activeAudio)?.label || `Audio ${activeAudio + 1}`}
            <ChevronDown size={11} />
        </button>
        <AnimatePresence>
            {showAudioMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 mt-1 bg-black/80 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden min-w-40" style={{ background: 'var(--glass-bg-strong)', borderColor: 'var(--glass-border)' }}>
                    {audioTracks.map(t => (
                        <button key={t.index} onClick={() => { setActiveAudio(t.index); setShowAudioMenu(false); }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeAudio === t.index ? 'font-bold' : ''}`} style={{ color: activeAudio === t.index ? 'var(--text)' : 'var(--text-sub)' }}>
                            {t.label}{t.language ? ` (${t.language})` : ''}
                        </button>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────

const VideoPlayer = () => {
    const {
        videoState, currentUser,
        loadVideo, addToQueue,
        playVideo, pauseVideo, syncProgress, seekVideo
    } = useRoom();

    // ── Refs ─────────────────────────────────────────────────────────────────
    const playerRef          = useRef(null);
    const nativeVideoRef     = useRef(null);
    const playerContainerRef = useRef(null);
    const subtitleInputRef   = useRef(null);
    const syncIntervalRef    = useRef(null);

    const isSeekingRef     = useRef(false);
    const seekEndTimerRef  = useRef(null);
    const playDebounceRef  = useRef(null);
    const pauseDebounceRef = useRef(null);
    const lastSyncedPosRef = useRef(0);
    // BUG-I FIX: track whether ReactPlayer is currently buffering.
    // Drift correction must NOT fire during a stall — it restarts the buffer
    // from a further position, causing an infinite buffering loop on slow connections.
    const isBufferingRef   = useRef(false);

    const prevSeekVersionReactPlayerRef = useRef(0);
    const prevSeekVersionGDriveRef      = useRef(0);

    const videoStateRef = useRef(videoState);
    useEffect(() => { videoStateRef.current = videoState; }, [videoState]);

    // ── State ─────────────────────────────────────────────────────────────────
    const [inputUrl, setInputUrl]           = useState('');
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [playerError, setPlayerError]     = useState(null);
    const [subtitleTracks, setSubtitleTracks] = useState([]);
    const [audioTracks, setAudioTracks]     = useState([]);
    const [activeSubtitle, setActiveSubtitle] = useState(-1);
    const [activeAudio, setActiveAudio]     = useState(0);
    const [showSubMenu, setShowSubMenu]     = useState(false);
    const [showAudioMenu, setShowAudioMenu] = useState(false);
    const [isFullscreen, setIsFullscreen]   = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);

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
    const isPrivileged  = currentUser?.role === 'Host' || currentUser?.role === 'Moderator';
    const rawUrl        = videoState.url || null;
    const playerUrl     = rewriteGDriveUrl(rawUrl);
    const isGDriveProxy = !!(playerUrl && playerUrl.includes('/api/proxy/gdrive'));
    const hasContent    = !!(videoState.url || videoState.magnetURI);
    const isYouTube     = !!(playerUrl && (playerUrl.includes('youtube.com') || playerUrl.includes('youtu.be')));
    const isArchive     = !!(playerUrl && playerUrl.includes('archive.org'));

    // ── 1. Reset on URL change ────────────────────────────────────────────────
    useEffect(() => {
        setIsPlayerReady(false);
        setPlayerError(null);
        setAutoplayBlocked(false);
        setSubtitleTracks([]);
        setAudioTracks([]);
        setActiveSubtitle(-1);
        setActiveAudio(0);
        lastSyncedPosRef.current = 0;
        isBufferingRef.current   = false;
        prevSeekVersionReactPlayerRef.current = videoState.seekVersion ?? 0;
        prevSeekVersionGDriveRef.current      = videoState.seekVersion ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoState.url, videoState.magnetURI]);

    // ── Revoke subtitle Object URLs on unmount ────────────────────────────────
    useEffect(() => {
        return () => {
            subtitleTracks.forEach(t => {
                if (t.src && !t.isNative) {
                    try { URL.revokeObjectURL(t.src); } catch (_) {}
                }
            });
        };
    }, [subtitleTracks]);

    // ── 2. Drift correction – ReactPlayer viewers ─────────────────────────────
    // BUG-I FIX: Guard against buffering. When the player is stalled, seeking
    // to the host's ever-advancing time restarts the buffer from a further
    // position → infinite buffer death-loop. We skip correction until playback resumes.
    useEffect(() => {
        if (isPrivileged || !isPlayerReady || !playerRef.current || isGDriveProxy) return;
        if (isBufferingRef.current) return; // BUG-I: skip during buffer stall

        const stateTime    = videoState.playedSeconds || 0;
        const internalTime = playerRef.current.getCurrentTime() || 0;
        const seekVer      = videoState.seekVersion ?? 0;
        const isForcedSeek = seekVer !== prevSeekVersionReactPlayerRef.current;
        prevSeekVersionReactPlayerRef.current = seekVer;
        if (isForcedSeek || Math.abs(internalTime - stateTime) > DRIFT_THRESHOLD) {
            playerRef.current.seekTo(stateTime, 'seconds');
        }
    }, [videoState.playedSeconds, videoState.seekVersion, isPlayerReady, isPrivileged, isGDriveProxy]);

    // ── 3. Drift correction – GDrive native video viewers ────────────────────
    // Guard with isPlayerReady so we don't seek before video is loaded
    useEffect(() => {
        if (!isGDriveProxy || isPrivileged || !nativeVideoRef.current || !isPlayerReady) return;
        const stateTime   = videoState.playedSeconds || 0;
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

            if (Math.abs(diff) > 15) {
                // Way out of sync (or joined late), force jump
                nativeVideoRef.current.currentTime = stateTime;
                if (nativeVideoRef.current.playbackRate !== 1.0) nativeVideoRef.current.playbackRate = 1.0;
            } else if (diff > 5) {
                if (nativeVideoRef.current.playbackRate !== 1.05) nativeVideoRef.current.playbackRate = 1.05;
            } else if (diff < -5) {
                if (nativeVideoRef.current.playbackRate !== 0.95) nativeVideoRef.current.playbackRate = 0.95;
            } else {
                if (nativeVideoRef.current.playbackRate !== 1.0) nativeVideoRef.current.playbackRate = 1.0;
            }
        }
    }, [videoState.playedSeconds, videoState.seekVersion, isGDriveProxy, isPrivileged, isPlayerReady]);

    // ── 4. GDrive play / pause control ────────────────────────────────────────
    useEffect(() => {
        if (!isGDriveProxy || !nativeVideoRef.current || !isPlayerReady) return;

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
    }, [videoState.isPlaying, isGDriveProxy, isPlayerReady]);

    // ── 4b. BUG-H FIX: Autoplay-blocked detection for ReactPlayer viewers ─────
    // ReactPlayer forwards the `playing` prop but browsers can silently block
    // autoplay. We detect this by trying to call play() on the internal element
    // when the room is in a playing state and the element is paused.
    useEffect(() => {
        if (isPrivileged || isGDriveProxy || !isPlayerReady) return;
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
    }, [videoState.isPlaying, isPlayerReady, isPrivileged, isGDriveProxy]);

    // ── 5. ReactPlayer onReady ────────────────────────────────────────────────
    const handleReady = useCallback(() => {
        setIsPlayerReady(true);
        setPlayerError(null);
        const stateTime = videoStateRef.current.playedSeconds || 0;
        if (stateTime > 2 && playerRef.current) {
            playerRef.current.seekTo(stateTime, 'seconds');
        }
        const internal = playerRef.current?.getInternalPlayer?.();
        if (internal instanceof HTMLVideoElement) {
            const tTracks = [...(internal.textTracks || [])].map((t, i) => ({
                label: t.label || t.language || `Track ${i + 1}`,
                language: t.language, kind: t.kind, index: i, isNative: true,
            }));
            const aTracks = [...(internal.audioTracks || [])].map((t, i) => ({
                label: t.label || t.language || `Audio ${i + 1}`,
                language: t.language, index: i,
            }));
            setSubtitleTracks(prev => prev.some(t => !t.isNative) ? prev : tTracks);
            if (aTracks.length > 0) setAudioTracks(aTracks);
        }
    }, []);

    // ── 6. Host progress sync interval (ReactPlayer + GDrive host) ───────────
    // BUG-G FIX: syncProgress is ONLY called here (every 2s), not in onProgress.
    // Previously both the interval and onProgress emitted sync_progress, causing
    // redundant traffic and viewer state race conditions.
    useEffect(() => {
        if (!isPrivileged) return;
        syncIntervalRef.current = setInterval(() => {
            if (isSeekingRef.current) return;
            if (isGDriveProxy) {
                const t = nativeVideoRef.current?.currentTime || 0;
                if (t > 0) syncProgress(t);
            } else {
                if (!playerRef.current) return;
                const t = playerRef.current.getCurrentTime?.() || 0;
                if (t > 0) syncProgress(t);
            }
        }, SYNC_INTERVAL_MS);
        return () => clearInterval(syncIntervalRef.current);
    }, [isPrivileged, syncProgress, isGDriveProxy]);

    // ── 7. Apply subtitle / audio tracks ─────────────────────────────────────
    useEffect(() => {
        const internal = playerRef.current?.getInternalPlayer?.();
        if (!(internal instanceof HTMLVideoElement) || !internal.textTracks) return;
        [...internal.textTracks].forEach((t, i) => { t.mode = i === activeSubtitle ? 'showing' : 'hidden'; });
    }, [activeSubtitle]);

    useEffect(() => {
        const internal = playerRef.current?.getInternalPlayer?.();
        if (!(internal instanceof HTMLVideoElement) || !internal.audioTracks) return;
        [...internal.audioTracks].forEach((t, i) => { t.enabled = i === activeAudio; });
    }, [activeAudio]);

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

    const handleSubtitleUpload = (e) => {
        const files = [...e.target.files];
        if (!files.length) return;
        e.target.value = '';
        const baseIndex = Date.now();
        const tracks = files.map((file, i) => ({
            kind: 'subtitles', src: URL.createObjectURL(file),
            srcLang: `track${i}`, label: file.name.replace(/\.[^.]+$/, ''),
            default: i === 0, isNative: false, index: baseIndex + i,
        }));
        setSubtitleTracks(prev => [...prev.filter(t => t.isNative), ...tracks]);
        setActiveSubtitle(tracks[0].index);
        toast.success(`Loaded ${files.length} subtitle track(s)`, { icon: '🗒️' });
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col h-full w-full gap-2">

            {/* ── Control Bar (Host/Mod only) ─────────────────────────── */}
            {isPrivileged && (
                <div className="flex gap-2 flex-shrink-0">
                    <form onSubmit={handleLoad} className="flex flex-1 items-center gap-1.5 p-1 rounded-xl transition-all" style={{ background: 'var(--glass-bg-strong)', border: '1px solid var(--glass-border-top)', boxShadow: '0 4px 20px var(--accent-glow)' }}>
                        <div className="relative flex-1 flex items-center">
                            <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={16} style={{ color: 'var(--text-sub)' }} />
                            <input
                                type="text"
                                value={inputUrl}
                                onChange={e => setInputUrl(e.target.value)}
                                placeholder="Paste YouTube, Vimeo, Google Drive, or direct video URL..."
                                className="w-full bg-transparent py-2.5 pl-10 pr-4 text-sm focus:outline-none placeholder-gray-500"
                                style={{ color: 'var(--text)' }}
                            />
                        </div>
                        <div className="flex items-center gap-1.5 pr-1 shrink-0">
                            <button type="submit" disabled={!inputUrl.trim()}
                                className="px-4 py-2 disabled:opacity-40 rounded-lg text-xs font-bold transition-transform active:scale-95"
                                style={{ background: 'var(--text)', color: 'var(--bg-base)' }}>
                                Play Now
                            </button>
                            <button type="button" disabled={!inputUrl.trim()} onClick={handleQueueAdd}
                                className="px-4 py-2 disabled:opacity-40 rounded-lg text-xs font-bold transition-transform active:scale-95"
                                style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--glass-border)' }}>
                                Queue
                            </button>
                        </div>
                    </form>
                    {/* Source badge */}
                    {(() => {
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
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-white/10 bg-white/5 rounded-xl text-xs text-gray-500 shrink-0" title="No video loaded">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0" />
                                <span className="hidden sm:inline">No source</span>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* ── Track toolbar ─────────────────────────────────────────── */}
            {hasContent && (subtitleTracks.length > 0 || audioTracks.length > 0 || isPrivileged) && (
                <div className="flex gap-3 items-center flex-shrink-0 flex-wrap p-2 rounded-xl"
                    style={{ background: 'var(--panel-bg)', border: '1px solid var(--border-color)' }}>
                    <span className="text-xs font-semibold text-gray-400">Tracks:</span>
                    {subtitleTracks.length > 0 && (
                        <SubtitleMenu
                            activeSubtitle={activeSubtitle} setActiveSubtitle={setActiveSubtitle}
                            subtitleTracks={subtitleTracks} showSubMenu={showSubMenu}
                            setShowSubMenu={setShowSubMenu} setShowAudioMenu={setShowAudioMenu}
                        />
                    )}
                    {audioTracks.length > 0 && (
                        <AudioMenu
                            activeAudio={activeAudio} setActiveAudio={setActiveAudio}
                            audioTracks={audioTracks} showAudioMenu={showAudioMenu}
                            setShowAudioMenu={setShowAudioMenu} setShowSubMenu={setShowSubMenu}
                        />
                    )}
                    {isPrivileged && (
                        <>
                            <div className="w-px h-4 bg-white/10 mx-1" />
                            <button onClick={() => subtitleInputRef.current?.click()}
                                className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-300 border border-white/10 rounded-lg transition-colors hover:bg-white/5"
                                style={{ background: 'var(--panel-bg)' }}>
                                <Plus size={12} /> Add Subs (.vtt, .srt)
                            </button>
                            <input type="file" ref={subtitleInputRef} className="hidden"
                                accept=".vtt,.srt,.ass,.ssa" multiple onChange={handleSubtitleUpload} />
                        </>
                    )}
                </div>
            )}

            {/* ── Player ────────────────────────────────────────────────── */}
            <div ref={playerContainerRef} className="flex-1 rounded-2xl overflow-hidden border border-white/10 relative group min-h-0" style={{ background: '#000' }}>
                <AnimatePresence mode="wait">
                    {!hasContent ? (
                        <motion.div key="empty"
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                            <div className="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 ring-4 ring-white/5 animate-pulse">
                                <img src="/logo.png" alt="Watchly Logo" className="w-16 h-auto opacity-70 theme-invert transition-all" />
                            </div>
                            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>No Video Playing</h2>
                            <p className="text-sm max-w-sm" style={{ color: 'var(--text-sub)' }}>
                                {isPrivileged
                                    ? 'Paste a video URL in the bar above and click Play Now to begin syncing.'
                                    : 'Waiting for the host to start a video.'}
                            </p>
                        </motion.div>
                    ) : (
                        <motion.div key="player"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 w-full h-full">

                            {/* ── Loading Skeleton ─────────────────────────────── */}
                            <AnimatePresence>
                                {!isPlayerReady && !playerError && (
                                    <motion.div
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
                                            Buffering stream...
                                        </h2>
                                        <div className="w-48 h-2 bg-white/10 rounded-full overflow-hidden mt-2">
                                            <div className="h-full bg-emerald-400 animate-pulse w-full origin-left" style={{ animation: 'shimmer 1.5s infinite linear' }} />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* ── Google Drive: native <video> ─────────────────── */}
                            {isGDriveProxy && (
                                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <video
                                        ref={nativeVideoRef}
                                        key={playerUrl}
                                        src={playerUrl}
                                        controls
                                        preload="auto"
                                        controlsList="nodownload"
                                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                        onLoadedMetadata={() => {
                                            const stateTime = videoStateRef.current.playedSeconds || 0;
                                            if (stateTime > 2 && nativeVideoRef.current) {
                                                nativeVideoRef.current.currentTime = stateTime;
                                            }
                                        }}
                                        onCanPlay={() => {
                                            // B7 FIX: Use functional setIsPlayerReady so we read the
                                            // *previous* state value instead of the stale closure
                                            // 'isPlayerReady'. Two rapid onCanPlay calls both saw
                                            // wasReady=false and called play() twice.
                                            setIsPlayerReady(prev => {
                                                if (!prev && videoStateRef.current.isPlaying && nativeVideoRef.current?.paused) {
                                                    nativeVideoRef.current.play().catch((err) => {
                                                        if (err.name === 'NotAllowedError') setAutoplayBlocked(true);
                                                    });
                                                }
                                                return true;
                                            });
                                            setPlayerError(null);
                                        }}
                                        onPlay={() => { setAutoplayBlocked(false); if (!isPrivileged) return; debouncePlay(); }}
                                        onPause={() => { if (!isPrivileged) return; debouncePause(() => nativeVideoRef.current?.currentTime || 0); }}
                                        onSeeking={() => { if (!isPrivileged) return; startSeekGuard(); }}
                                        onSeeked={() => { if (!isPrivileged) return; endSeekGuard(() => nativeVideoRef.current?.currentTime || 0); }}
                                        // Q5: Empty onTimeUpdate removed — host sync runs via
                                        // the setInterval in effect #6, not this event.
                                        onError={() => {
                                            setPlayerError('Could not load Google Drive video. Make sure the file is shared as "Anyone with the link" in Google Drive.');
                                        }}
                                    />
                                    {/* Transparent overlay blocks seekbar for viewers so they cannot desync */}
                                    {!isPrivileged && (
                                        <div style={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0, height: '48px',
                                            zIndex: 10, cursor: 'not-allowed'
                                        }} />
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
                            {!isGDriveProxy && playerUrl && (
                                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                                    <ReactPlayer
                                        ref={playerRef}
                                        key={playerUrl}
                                        url={playerUrl}
                                        playing={videoState.isPlaying}
                                        // BUG-B FIX: Archive viewers need controls so they can see the play
                                        // button when autoplay is blocked. Seeking is locked via the
                                        // transparent overlay rendered below — not by hiding controls.
                                        controls={isPrivileged || isYouTube || isArchive}
                                        width="100%"
                                        height="100%"
                                        onReady={handleReady}
                                        onPlay={() => { setAutoplayBlocked(false); if (!isPrivileged) return; debouncePlay(); }}
                                        onPause={() => { if (!isPrivileged) return; debouncePause(() => playerRef.current?.getCurrentTime() || 0); }}
                                        // BUG-C FIX: Viewers — do NOT snap back to videoState.playedSeconds
                                        // here. That caused a seek loop (stale closure value → seeks to wrong
                                        // time → triggers another onSeek → repeat). The seekbar-blocker overlay
                                        // prevents viewers from dragging; drift correction (effect #2) handles
                                        // any residual drift. For host — BUG-D is fixed in endSeekGuard.
                                        onSeek={() => {
                                            if (!isPrivileged) return; // viewers: blocked by overlay, no-op
                                            // B8 FIX: ReactPlayer's onSeek fires AFTER seeking completes
                                            // (equivalent to onSeeked on a native element). Calling
                                            // startSeekGuard() + endSeekGuard() back-to-back was toggling
                                            // isSeekingRef on then off in the same tick — the guard was
                                            // effectively doing nothing. Only endSeekGuard is needed here.
                                            endSeekGuard(() => playerRef.current?.getCurrentTime?.() || 0);
                                        }}
                                        onError={() => setPlayerError('Could not load video.')}
                                        // BUG-G FIX: syncProgress removed from here. The setInterval in
                                        // effect #6 is the single source of progress sync for the host.
                                        // Dual emission caused viewer state races.
                                        onProgress={(p) => {
                                            lastSyncedPosRef.current = p.playedSeconds;
                                        }}
                                        progressInterval={1000}
                                        // BUG-I FIX: Flip isBufferingRef so drift correction skips during stall
                                        onBuffer={() => { isBufferingRef.current = true; }}
                                        onBufferEnd={() => { isBufferingRef.current = false; }}
                                        config={{
                                            youtube: {
                                                playerVars: { disablekb: isPrivileged ? 0 : 1, modestbranding: 1 }
                                            },
                                            file: {
                                                // crossOrigin: 'anonymous' breaks archive.org CDN servers
                                                // — only apply it for non-archive URLs (needed for subtitles)
                                                attributes: isArchive
                                                    ? { preload: 'auto' }
                                                    : { preload: 'auto', crossOrigin: 'anonymous' },
                                                tracks: subtitleTracks
                                                    .filter(t => !t.isNative)
                                                    .map(t => ({ kind: 'subtitles', src: t.src, srcLang: t.srcLang, label: t.label, default: t.default }))
                                            }
                                        }}
                                    />

                                    {/* BUG-B FIX: Transparent seekbar blocker for archive.org viewers.
                                        Archive viewers have controls={true} so they can click play,
                                        but this overlay prevents them from dragging the seekbar
                                        independently (which would desync them from the host). */}
                                    {isArchive && !isPrivileged && (
                                        <div style={{
                                            position: 'absolute', bottom: 0, left: 0, right: 0, height: '48px',
                                            zIndex: 10, cursor: 'not-allowed'
                                        }} />
                                    )}

                                    {/* BUG-H FIX: Autoplay-blocked overlay for ReactPlayer (archive + direct).
                                        Previously only shown for the GDrive native <video> path. */}
                                    {autoplayBlocked && !isPrivileged && (
                                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
                                            <div className="flex flex-col items-center p-6 border border-white/20 bg-black/90 rounded-2xl shadow-2xl">
                                                <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 cursor-pointer hover:scale-105 transition-all"
                                                    style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}
                                                    onClick={() => {
                                                        const internal = playerRef.current?.getInternalPlayer?.();
                                                        if (internal instanceof HTMLVideoElement) {
                                                            internal.play().then(() => setAutoplayBlocked(false)).catch(console.error);
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

                            {/* ── Error overlay ───────────────────────────────────── */}
                            {playerError && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90 px-6">
                                    <AlertCircle size={36} className="text-red-400 mb-3" />
                                    <p className="text-gray-200 text-sm text-center font-medium mb-3">{playerError}</p>
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
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default VideoPlayer;
