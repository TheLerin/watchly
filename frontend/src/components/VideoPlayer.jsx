import React, { useRef, useEffect, useState, useCallback } from 'react';
import ReactPlayer from 'react-player/lazy';
import { useRoom } from '../context/RoomContext';
import { Play, Link as LinkIcon, Lock, AlertCircle, Plus, ChevronDown, Mic, Subtitles as SubtitlesIcon, FolderOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// How often the host reports playback position (ms)
const SYNC_INTERVAL_MS = 2000;
// Max drift before a viewer auto-corrects during normal playback
const DRIFT_THRESHOLD = 2;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

function rewriteGDriveUrl(url) {
    if (!url || !url.includes('drive.google.com')) return url;
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

// ── BUG-23: Sub-components defined OUTSIDE VideoPlayer so they never remount ──

const SubtitleMenu = ({ activeSubtitle, setActiveSubtitle, subtitleTracks, showSubMenu, setShowSubMenu, setShowAudioMenu }) => (
    <div className="relative">
        <button onClick={() => { setShowSubMenu(p => !p); setShowAudioMenu(false); }}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-lg hover:bg-purple-500/20 transition-colors">
            <SubtitlesIcon size={13} />
            {activeSubtitle === -1 ? 'Subs Off' : (subtitleTracks.find(t => t.index === activeSubtitle)?.label || `Track ${activeSubtitle + 1}`)}
            <ChevronDown size={11} />
        </button>
        <AnimatePresence>
            {showSubMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden min-w-40">
                    <button onClick={() => { setActiveSubtitle(-1); setShowSubMenu(false); }}
                        className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeSubtitle === -1 ? 'text-purple-400' : 'text-gray-300'}`}>Off</button>
                    {subtitleTracks.map(t => (
                        <button key={t.index} onClick={() => { setActiveSubtitle(t.index); setShowSubMenu(false); }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeSubtitle === t.index ? 'text-purple-400' : 'text-gray-300'}`}>
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
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg hover:bg-blue-500/20 transition-colors">
            <Mic size={13} />
            {audioTracks.find(t => t.index === activeAudio)?.label || `Audio ${activeAudio + 1}`}
            <ChevronDown size={11} />
        </button>
        <AnimatePresence>
            {showAudioMenu && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute top-full left-0 mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden min-w-40">
                    {audioTracks.map(t => (
                        <button key={t.index} onClick={() => { setActiveAudio(t.index); setShowAudioMenu(false); }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-white/5 ${activeAudio === t.index ? 'text-blue-400' : 'text-gray-300'}`}>
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
    const playerRef        = useRef(null);   // ReactPlayer ref
    const nativeVideoRef   = useRef(null);   // <video> ref for GDrive
    const subtitleInputRef = useRef(null);
    const syncIntervalRef  = useRef(null);

    // Seek guard: block play/pause emission while user is scrubbing
    const isSeekingRef     = useRef(false);
    const seekEndTimerRef  = useRef(null);
    // Debounce play/pause so scrubbing doesn't fire rapid events
    const playDebounceRef  = useRef(null);
    const pauseDebounceRef = useRef(null);
    // Track last synced position to avoid spamming syncProgress
    const lastSyncedPosRef = useRef(0);

    // BUG-05: Two separate seek-version trackers — one per player type (ReactPlayer vs GDrive)
    const prevSeekVersionReactPlayerRef = useRef(0);
    const prevSeekVersionGDriveRef      = useRef(0);

    // BUG-04: Instead of capturing videoState.playedSeconds in handleReady's closure,
    // keep a ref that is always current — makes handleReady stable (no dep array churn)
    const videoStateRef = useRef(videoState);
    useEffect(() => { videoStateRef.current = videoState; }, [videoState]);

    // ── State ─────────────────────────────────────────────────────────────────
    const [inputUrl, setInputUrl] = useState('');
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const [playerError, setPlayerError] = useState(null);
    const [subtitleTracks, setSubtitleTracks] = useState([]);
    const [audioTracks, setAudioTracks]       = useState([]);
    const [activeSubtitle, setActiveSubtitle] = useState(-1);
    const [activeAudio, setActiveAudio]       = useState(0);
    const [showSubMenu, setShowSubMenu]       = useState(false);
    const [showAudioMenu, setShowAudioMenu]   = useState(false);

    // ── Derived values ────────────────────────────────────────────────────────
    const isPrivileged = currentUser?.role === 'Host' || currentUser?.role === 'Moderator';
    const rawUrl       = videoState.url || null;
    const playerUrl    = rewriteGDriveUrl(rawUrl);
    const isGDriveProxy = !!(playerUrl && playerUrl.includes('/api/proxy/gdrive'));
    const hasContent   = !!(videoState.url || videoState.magnetURI);

    // Detect YouTube URLs to conditionally apply controls
    const isYouTube = !!(playerUrl && (playerUrl.includes('youtube.com') || playerUrl.includes('youtu.be')));

    // ── 1. Reset on URL change ────────────────────────────────────────────────
    useEffect(() => {
        setIsPlayerReady(false);
        setPlayerError(null);
        setSubtitleTracks([]);
        setAudioTracks([]);
        setActiveSubtitle(-1);
        setActiveAudio(0);
        lastSyncedPosRef.current = 0;
        // BUG-05: Reset both seek-version refs when URL changes
        prevSeekVersionReactPlayerRef.current = videoState.seekVersion ?? 0;
        prevSeekVersionGDriveRef.current      = videoState.seekVersion ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoState.url, videoState.magnetURI]);

    // ISSUE-30: Revoke uploaded subtitle Object URLs when tracks change or unmount
    // to prevent memory leaks on long watch sessions.
    useEffect(() => {
        return () => {
            subtitleTracks.forEach(t => {
                if (t.src && !t.isNative) {
                    try { URL.revokeObjectURL(t.src); } catch (_) { /* ignore */ }
                }
            });
        };
    }, [subtitleTracks]);


    // ── 2. Drift correction – ReactPlayer viewers ─────────────────────────────
    useEffect(() => {
        if (isPrivileged || !isPlayerReady || !playerRef.current || isGDriveProxy) return;
        const stateTime    = videoState.playedSeconds || 0;
        const internalTime = playerRef.current.getCurrentTime() || 0;
        const seekVer      = videoState.seekVersion ?? 0;
        const isForcedSeek = seekVer !== prevSeekVersionReactPlayerRef.current;
        prevSeekVersionReactPlayerRef.current = seekVer;
        
        // Prevent auto-correction if explicitly forced seek isn't happening and we are drastically out of sync 
        // due to buffering loops. 
        if (isForcedSeek || Math.abs(internalTime - stateTime) > DRIFT_THRESHOLD) {
            playerRef.current.seekTo(stateTime, 'seconds');
        }
    }, [videoState.playedSeconds, videoState.seekVersion, isPlayerReady, isPrivileged, isGDriveProxy]);

    // ── 3. Drift correction – GDrive native video viewers ────────────────────
    useEffect(() => {
        if (!isGDriveProxy || isPrivileged || !nativeVideoRef.current) return;
        const stateTime   = videoState.playedSeconds || 0;
        const currentTime = nativeVideoRef.current.currentTime || 0;
        const seekVer     = videoState.seekVersion ?? 0;
        const isForcedSeek = seekVer !== prevSeekVersionGDriveRef.current;
        prevSeekVersionGDriveRef.current = seekVer;
        
        // If it's a forced seek (host clicked timeline), always seek.
        // If it's just drift, ONLY correct if the video has actually buffered enough data to play (readyState >= 3).
        // If readyState < 3, it's buffering. Seeking now will abort the download and cause frame-by-frame stuttering.
        if (isForcedSeek || (nativeVideoRef.current.readyState >= 3 && Math.abs(currentTime - stateTime) > DRIFT_THRESHOLD)) {
            nativeVideoRef.current.currentTime = stateTime;
        }
    }, [videoState.playedSeconds, videoState.seekVersion, isGDriveProxy, isPrivileged]);

    // ── 4. GDrive play / pause control ────────────────────────────────────────
    useEffect(() => {
        if (!isGDriveProxy || !nativeVideoRef.current || !isPlayerReady) return;
        if (videoState.isPlaying) {
            nativeVideoRef.current.play().catch(() => {});
        } else {
            nativeVideoRef.current.pause();
        }
    }, [videoState.isPlaying, isGDriveProxy, isPlayerReady]);

    // ── 5. ReactPlayer onReady ────────────────────────────────────────────────
    // BUG-04: Stable callback — reads from videoStateRef instead of closing over videoState
    const handleReady = useCallback(() => {
        setIsPlayerReady(true);
        setPlayerError(null);
        const stateTime = videoStateRef.current.playedSeconds || 0;
        if (stateTime > 2 && playerRef.current) {
            playerRef.current.seekTo(stateTime, 'seconds');
        }
        // Detect embedded subtitle / audio tracks (file player only)
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
    }, []); // BUG-04: no deps — reads state via ref

    // ── 6. Host progress sync interval (ReactPlayer only) ────────────────────
    useEffect(() => {
        if (!isPrivileged || isGDriveProxy) return;
        syncIntervalRef.current = setInterval(() => {
            if (isSeekingRef.current || !playerRef.current) return;
            const t = playerRef.current.getCurrentTime?.() || 0;
            if (t > 0) syncProgress(t);
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
    const debouncePlay = () => {
        clearTimeout(pauseDebounceRef.current);
        clearTimeout(playDebounceRef.current);
        playDebounceRef.current = setTimeout(() => {
            if (!isSeekingRef.current) playVideo();
        }, 200);
    };

    const debouncePause = (getTime) => {
        clearTimeout(playDebounceRef.current);
        clearTimeout(pauseDebounceRef.current);
        pauseDebounceRef.current = setTimeout(() => {
            if (!isSeekingRef.current) pauseVideo(getTime());
        }, 200);
    };

    const startSeekGuard = () => {
        clearTimeout(playDebounceRef.current);
        clearTimeout(pauseDebounceRef.current);
        isSeekingRef.current = true;
    };

    const endSeekGuard = (getTime) => {
        clearTimeout(seekEndTimerRef.current);
        seekEndTimerRef.current = setTimeout(() => {
            isSeekingRef.current = false;
            const t = getTime();
            lastSyncedPosRef.current = t;
            seekVideo(t);
        }, 300);
    };

    const handleLoad = (e) => {
        e.preventDefault();
        if (!isPrivileged || !inputUrl.trim()) return;
        setPlayerError(null);
        loadVideo(inputUrl.trim());
        setInputUrl('');
    };

    const handleSubtitleUpload = (e) => {
        const files = [...e.target.files];
        if (!files.length) return;
        e.target.value = '';
        // BUG-24: Use Date.now() + index for stable unique index to avoid collisions
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
                    <form onSubmit={handleLoad} className="flex gap-2 flex-1">
                        <div className="relative flex-1">
                            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                            <input
                                type="text"
                                value={inputUrl}
                                onChange={e => setInputUrl(e.target.value)}
                                placeholder="YouTube, Vimeo, Google Drive link, or direct video URL..."
                                className="w-full rounded-xl py-2 pl-10 pr-4 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                                style={{ background: 'var(--panel-bg)', border: '1px solid var(--border-color)', color: 'var(--text-color)' }}
                            />
                        </div>
                        <button type="submit" disabled={!inputUrl.trim()}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-xl text-sm font-medium transition-colors">
                            Load
                        </button>
                        <button type="button" disabled={!inputUrl.trim()}
                            onClick={() => { addToQueue(inputUrl.trim(), '', inputUrl.trim()); toast.success('Added to queue'); setInputUrl(''); }}
                            className="px-3 py-2 text-gray-300 border border-white/10 rounded-xl text-sm font-medium flex items-center gap-1.5 hover:bg-white/5 transition-colors"
                            style={{ background: 'var(--panel-bg)' }}>
                            <Plus size={14} /> Queue
                        </button>
                    </form>
                    {/* Dynamic source badge — shows what type of content is active */}
                    {(() => {
                        if (isGDriveProxy) return (
                            <div className="flex items-center gap-1.5 px-3 py-2 border border-blue-500/30 bg-blue-500/10 rounded-xl text-xs text-blue-300 shrink-0" title="Streaming via Google Drive proxy">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPlayerReady ? 'bg-blue-400 animate-pulse' : 'bg-blue-600'}`} />
                                <FolderOpen size={13} />
                                <span className="hidden sm:inline font-medium">{isPlayerReady ? 'G-Drive · Live' : 'G-Drive · Loading'}</span>
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
                            activeSubtitle={activeSubtitle}
                            setActiveSubtitle={setActiveSubtitle}
                            subtitleTracks={subtitleTracks}
                            showSubMenu={showSubMenu}
                            setShowSubMenu={setShowSubMenu}
                            setShowAudioMenu={setShowAudioMenu}
                        />
                    )}
                    {audioTracks.length > 0 && (
                        <AudioMenu
                            activeAudio={activeAudio}
                            setActiveAudio={setActiveAudio}
                            audioTracks={audioTracks}
                            showAudioMenu={showAudioMenu}
                            setShowAudioMenu={setShowAudioMenu}
                            setShowSubMenu={setShowSubMenu}
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
            <div className="flex-1 rounded-2xl overflow-hidden border border-white/10 relative group min-h-0" style={{ background: '#000' }}>
                <AnimatePresence mode="wait">
                    {!hasContent ? (
                        <motion.div key="empty"
                            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                            <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 ring-4 ring-white/5 animate-pulse">
                                <Play size={32} className="text-gray-400 ml-2" />
                            </div>
                            <h2 className="text-xl font-semibold mb-2 text-gray-200">No Video Playing</h2>
                            <p className="text-gray-400 max-w-sm text-sm">
                                {isPrivileged
                                    ? 'Paste a YouTube, Vimeo, or Google Drive link and click Load.'
                                    : 'Waiting for the host to start a video.'}
                            </p>
                        </motion.div>
                    ) : (
                        <motion.div key="player"
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                            className="absolute inset-0 w-full h-full">

                            {/* ── Google Drive: native <video> ───────────────────── */}
                            {isGDriveProxy && (
                                <video
                                    ref={nativeVideoRef}
                                    key={playerUrl}
                                    src={playerUrl}
                                    controls={isPrivileged}
                                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                    crossOrigin="anonymous"
                                    onCanPlay={() => {
                                        setIsPlayerReady(true);
                                        setPlayerError(null);
                                        const stateTime = videoStateRef.current.playedSeconds || 0;
                                        if (stateTime > 2 && nativeVideoRef.current) {
                                            nativeVideoRef.current.currentTime = stateTime;
                                        }
                                        if (videoStateRef.current.isPlaying && nativeVideoRef.current) {
                                            nativeVideoRef.current.play().catch(() => {});
                                        }
                                    }}
                                    onPlay={() => {
                                        if (!isPrivileged) return;
                                        debouncePlay();
                                    }}
                                    onPause={() => {
                                        if (!isPrivileged) return;
                                        debouncePause(() => nativeVideoRef.current?.currentTime || 0);
                                    }}
                                    onSeeking={() => {
                                        if (!isPrivileged) return;
                                        startSeekGuard();
                                    }}
                                    onSeeked={() => {
                                        if (!isPrivileged) return;
                                        endSeekGuard(() => nativeVideoRef.current?.currentTime || 0);
                                    }}
                                    // BUG-19: Fixed threshold: compare elapsed since last sync using SYNC_INTERVAL_MS in seconds
                                    onTimeUpdate={() => {
                                        if (!isPrivileged || !nativeVideoRef.current || isSeekingRef.current) return;
                                        const t = nativeVideoRef.current.currentTime || 0;
                                        if (t > 0 && Math.abs(t - lastSyncedPosRef.current) >= SYNC_INTERVAL_MS / 1000) {
                                            lastSyncedPosRef.current = t;
                                            syncProgress(t);
                                        }
                                    }}
                                    onError={() => setPlayerError('Could not load Google Drive video. Ensure the file is shared as "Anyone with the link".')}
                                />
                            )}

                            {/* ── YouTube / Vimeo / direct URL: ReactPlayer ──────── */}
                            {!isGDriveProxy && playerUrl && (
                                <ReactPlayer
                                    ref={playerRef}
                                    key={playerUrl}
                                    url={playerUrl}
                                    playing={videoState.isPlaying}
                                    // BUG-10: Viewers get no controls on non-YouTube players
                                    // YouTube iframes always show their own controls regardless; for
                                    // direct files/Vimeo we hide controls for viewers to prevent
                                    // unauthorized seeking.
                                    controls={isPrivileged || isYouTube}
                                    width="100%"
                                    height="100%"
                                    onReady={handleReady}
                                    onPlay={() => {
                                        if (!isPrivileged) return;
                                        debouncePlay();
                                    }}
                                    onPause={() => {
                                        if (!isPrivileged) return;
                                        debouncePause(() => playerRef.current?.getCurrentTime() || 0);
                                    }}
                                    onSeek={() => {
                                        if (!isPrivileged) {
                                            // Snap viewer back to host position immediately
                                            playerRef.current?.seekTo(videoState.playedSeconds, 'seconds');
                                            return;
                                        }
                                        startSeekGuard();
                                        endSeekGuard(() => playerRef.current?.getCurrentTime?.() || 0);
                                    }}
                                    onError={() => setPlayerError('Could not load video.')}
                                    progressInterval={1000}
                                    onProgress={(p) => {
                                        if (!isPrivileged || isSeekingRef.current) return;
                                        // BUG-19: Use >= instead of > and correct threshold (SYNC_INTERVAL_MS/1000)
                                        if (Math.abs(p.playedSeconds - lastSyncedPosRef.current) >= SYNC_INTERVAL_MS / 1000) {
                                            lastSyncedPosRef.current = p.playedSeconds;
                                            syncProgress(p.playedSeconds);
                                        }
                                    }}
                                    config={{
                                        youtube: {
                                            playerVars: { disablekb: isPrivileged ? 0 : 1, modestbranding: 1 }
                                        },
                                        file: {
                                            attributes: { preload: 'auto', crossOrigin: 'anonymous' },
                                            tracks: subtitleTracks
                                                .filter(t => !t.isNative)
                                                .map(t => ({ kind: 'subtitles', src: t.src, srcLang: t.srcLang, label: t.label, default: t.default }))
                                        }
                                    }}
                                />
                            )}

                            {/* ── Error overlay ───────────────────────────────────── */}
                            {playerError && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/90">
                                    <AlertCircle size={40} className="text-red-400 mb-4" />
                                    <p className="text-gray-300 text-sm text-center px-6">{playerError}</p>
                                </div>
                            )}

                            {/* ── Viewer indicator ────────────────────────────────── */}
                            {!isPrivileged && (
                                <div className="absolute top-3 right-3 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none">
                                    <Lock size={12} className="text-gray-400" />
                                    <span className="text-xs text-gray-300">Synced to host</span>
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default VideoPlayer;
