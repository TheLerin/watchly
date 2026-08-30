import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Check,
    ChevronDown,
    ChevronUp,
    Copy,
    GripHorizontal,
    LogOut,
    Menu,
    MessageSquare,
    Settings,
    Users,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import ChatUI from './ChatUI';
import UserQueueSidebar from './UserQueueSidebar';
import VoiceRoom from './VoiceRoom';
import VideoPlayer from './VideoPlayer';
import ReadinessPanel from './player/ReadinessPanel';
import ScreenShareAdapter from './player/ScreenShareAdapter';
import { useRoom } from '../context/RoomContext';
import { useTheme, THEME_META, ROOM_APPEARANCE_META } from '../context/ThemeContext';
import { BackgroundLayers } from './LandingPage';
import toast from 'react-hot-toast';
import { NETWORK_QUALITY_META, formatPing } from '../utils/networkQuality';
import './room-theater.css';

const MotionDiv = motion.div;
const MotionSpan = motion.span;

function useOrientation() {
    const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth);
    useEffect(() => {
        const update = () => setIsPortrait(window.innerHeight > window.innerWidth);
        window.addEventListener('resize', update, { passive: true });
        window.addEventListener('orientationchange', update);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
        };
    }, []);
    return isPortrait;
}

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1180);
    useEffect(() => {
        const update = () => setIsDesktop(window.innerWidth >= 1180);
        window.addEventListener('resize', update, { passive: true });
        return () => window.removeEventListener('resize', update);
    }, []);
    return isDesktop;
}

function useDragResize(def = 45) {
    const [pct, setPct] = useState(def);
    const startY = useRef(null);
    const startPct = useRef(null);
    const pctRef = useRef(def);

    useEffect(() => {
        pctRef.current = pct;
    }, [pct]);

    const onDragStart = useCallback((e) => {
        const y0 = e.touches ? e.touches[0].clientY : e.clientY;
        startY.current = y0;
        startPct.current = pctRef.current;

        const onMove = (ev) => {
            const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
            setPct(Math.min(85, Math.max(28, startPct.current + ((startY.current - y) / window.innerHeight) * 100)));
        };
        const onEnd = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
        };

        document.addEventListener('mousemove', onMove, { passive: true });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
    }, []);

    return { heightPct: pct, onDragStart };
}

const panelClass = 'rounded-3xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30 backdrop-blur-xl';

const ThemePicker = ({ theme, setTheme, roomAppearance, setRoomAppearance }) => (
    <MotionDiv
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ type: 'spring', damping: 22, stiffness: 320 }}
        className="room-settings-popover absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-white/10 bg-black p-3 shadow-2xl shadow-black/60"
    >
        <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Room appearance</p>
        <div className="mb-4 grid grid-cols-2 gap-2">
            {Object.entries(ROOM_APPEARANCE_META).map(([id, meta]) => (
                <button
                    type="button"
                    key={id}
                    aria-pressed={roomAppearance === id}
                    onClick={(e) => {
                        e.stopPropagation();
                        setRoomAppearance(id);
                    }}
                    className="rounded-xl border p-2.5 text-left transition hover:bg-white/[0.06]"
                    style={{
                        background: roomAppearance === id ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.02)',
                        borderColor: roomAppearance === id ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)',
                    }}
                >
                    <span className="flex items-center justify-between text-xs font-bold text-zinc-100">
                        {meta.label}
                        {roomAppearance === id && <Check size={12} className="text-emerald-400" />}
                    </span>
                    <span className="mt-1 block text-[10px] leading-4 text-zinc-500">{meta.description}</span>
                </button>
            ))}
        </div>

        <p className="mb-3 border-t border-white/10 px-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Color theme</p>
        <div className="grid grid-cols-2 gap-2">
            {Object.entries(THEME_META).map(([id, meta]) => (
                <button
                    key={id}
                    onClick={(e) => {
                        e.stopPropagation();
                        setTheme(id);
                    }}
                    className="flex flex-col items-center gap-2 rounded-xl border p-2.5 transition hover:bg-white/[0.04]"
                    style={{
                        background: theme === id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                        borderColor: theme === id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.10)',
                    }}
                >
                    <div
                        className="relative h-8 w-8 rounded-full"
                        style={{ background: `radial-gradient(circle at 40% 40%,${meta.orb[0]},${meta.orb[1]})` }}
                    >
                        {theme === id && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Check size={12} className="text-white" />
                            </div>
                        )}
                    </div>
                    <span className="text-[11px] font-semibold leading-tight text-zinc-300">{meta.label}</span>
                </button>
            ))}
        </div>
    </MotionDiv>
);

const Header = ({ roomId, theme, setTheme, roomAppearance, setRoomAppearance, leaveRoom, navigate, isConnected, networkPingMs, networkQuality, measurePing, currentUser, users }) => {
    const [showSettings, setShowSettings] = useState(false);
    const [copied, setCopied] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const close = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setShowSettings(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const copyCode = () => {
        navigator.clipboard.writeText(roomId);
        setCopied(true);
        toast.success('Room code copied!', { icon: 'Copy' });
        setTimeout(() => setCopied(false), 2000);
    };

    const qualityKey = isConnected ? networkQuality : 'offline';
    const qualityMeta = NETWORK_QUALITY_META[qualityKey] || NETWORK_QUALITY_META.checking;
    const connectionLabel = isConnected ? formatPing(networkPingMs) : 'Offline';

    return (
        <header className="room-header relative z-40 h-16 flex-none border-b border-white/10 bg-black/75 backdrop-blur-xl">
            <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between px-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => navigate('/')} className="flex shrink-0 items-center gap-2.5">
                        <img src="/logo.png" alt="Watchly Logo" className="h-10 w-auto theme-invert" />
                        <span className="hidden text-sm font-bold tracking-tight text-white sm:block">Watchly</span>
                    </button>

                    <button
                        onClick={copyCode}
                        className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:border-white/25 hover:bg-white/[0.06]"
                        title="Copy room code"
                    >
                        <span className="hidden text-[10px] font-bold uppercase tracking-wider text-zinc-600 sm:inline">Room</span>
                        <span className="truncate font-mono text-xs font-bold text-white">{roomId}</span>
                        <AnimatePresence mode="wait">
                            {copied ? (
                                <MotionSpan key="copied" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                    <Check size={12} className="text-emerald-400" />
                                </MotionSpan>
                            ) : (
                                <MotionSpan key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                    <Copy size={12} className="text-zinc-500" />
                                </MotionSpan>
                            )}
                        </AnimatePresence>
                    </button>

                    <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 md:flex">
                        <Users size={13} />
                        <span>{users.length} online</span>
                        <span className="h-1 w-1 rounded-full bg-zinc-700" />
                        <span>{currentUser?.role || 'Viewer'}</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => isConnected && measurePing?.()}
                        disabled={!isConnected}
                        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed"
                        style={{ background: qualityMeta.bg, color: qualityMeta.color, border: `1px solid ${qualityMeta.border}` }}
                        title={isConnected ? `Ping ${connectionLabel} - ${qualityMeta.label}` : 'Reconnecting...'}
                    >
                        {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                        <span className="hidden sm:inline">{connectionLabel}</span>
                    </button>

                    <div className="relative" ref={ref}>
                        <button
                            onClick={() => setShowSettings(s => !s)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-400 transition hover:border-white/25 hover:text-white"
                            title="Room settings"
                        >
                            <Settings size={16} />
                        </button>
                        <AnimatePresence>
                            {showSettings && (
                                <ThemePicker
                                    theme={theme}
                                    setTheme={setTheme}
                                    roomAppearance={roomAppearance}
                                    setRoomAppearance={setRoomAppearance}
                                />
                            )}
                        </AnimatePresence>
                    </div>

                    <button
                        onClick={() => {
                            leaveRoom();
                            navigate('/');
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/15"
                    >
                        <LogOut size={14} />
                        <span className="hidden sm:inline">Leave</span>
                    </button>
                </div>
            </div>
        </header>
    );
};

const PanelHeader = ({ icon, title, count, open, onToggle }) => (
    <button
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-white/10 px-4 py-3 text-left transition hover:bg-white/[0.03]"
    >
        <span className="flex items-center gap-2 text-sm font-bold text-white">
            {icon}
            {title}
            {count !== undefined && (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                    {count}
                </span>
            )}
        </span>
        {open ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
    </button>
);

const RoomLayout = () => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const {
        currentUser,
        leaveRoom,
        users,
        isRestoringSession,
        isConnected,
        networkPingMs,
        networkQuality,
        measurePing,
        joinRoom,
        createRoom,
    } = useRoom();
    const { theme, setTheme, roomAppearance, setRoomAppearance } = useTheme();
    const ambientTargetRef = useRef(null);
    const [showUsersPanel, setShowUsersPanel] = useState(true);
    const [showMobileMembers, setShowMobileMembers] = useState(false);
    const [showMobileChat, setShowMobileChat] = useState(false);
    const [joinNickname, setJoinNickname] = useState('');
    const [joinError, setJoinError] = useState('');
    const [joinErrorCode, setJoinErrorCode] = useState('');
    const [isJoining, setIsJoining] = useState(false);
    const isPortrait = useOrientation();
    const isDesktop = useIsDesktop();
    const { heightPct, onDragStart } = useDragResize(52);

    if (isRestoringSession) {
        return (
            <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-black">
                <BackgroundLayers />
                <div className={`${panelClass} relative z-10 flex flex-col items-center gap-5 p-10`}>
                    <div className="h-12 w-12 rounded-full border-4 border-white/10 border-t-white" style={{ animation: 'spin 0.9s linear infinite' }} />
                    <p className="text-sm font-semibold text-white">Starting room server…</p>
                    <p className="max-w-xs text-center text-xs text-zinc-500">A sleeping room server can take about a minute. Watchly will keep retrying for up to 90 seconds.</p>
                </div>
            </div>
        );
    }

    if (!currentUser) return (
        <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-black px-4">
            <BackgroundLayers />
            <form
                className={`${panelClass} relative z-10 w-full max-w-md p-7`}
                onSubmit={async event => {
                    event.preventDefault();
                    setJoinError('');
                    setJoinErrorCode('');
                    setIsJoining(true);
                    try { await joinRoom(roomId.toUpperCase(), joinNickname.trim()); }
                    catch (error) { setJoinError(error.message); setJoinErrorCode(error.code || ''); }
                    finally { setIsJoining(false); }
                }}
            >
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Shared room</p>
                <h1 className="mt-2 text-2xl font-bold text-white">Join {roomId.toUpperCase()}</h1>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Choose how your name appears. If this temporary room expired, we’ll tell you instead of creating a different room.</p>
                <label className="mt-6 block text-xs font-semibold text-zinc-300" htmlFor="deep-link-nickname">Nickname</label>
                <input
                    id="deep-link-nickname"
                    autoFocus
                    maxLength={24}
                    value={joinNickname}
                    onChange={event => setJoinNickname(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-white/30"
                    placeholder="Your nickname"
                />
                {joinError && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{joinError}</p>}
                {joinErrorCode === 'ROOM_NOT_FOUND' && (
                    <button
                        type="button"
                        disabled={!joinNickname.trim() || isJoining}
                        onClick={async () => {
                            setJoinError('');
                            setJoinErrorCode('');
                            setIsJoining(true);
                            try {
                                const created = await createRoom(joinNickname.trim());
                                navigate(`/room/${created.roomId}`, { replace: true });
                            } catch (error) {
                                setJoinError(error.message);
                                setJoinErrorCode(error.code || '');
                            } finally {
                                setIsJoining(false);
                            }
                        }}
                        className="mt-3 w-full rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 font-bold text-white disabled:opacity-40"
                    >
                        Create a new temporary room
                    </button>
                )}
                <button disabled={!joinNickname.trim() || isJoining} className="mt-5 w-full rounded-xl bg-white px-4 py-3 font-bold text-black disabled:opacity-40">
                    {isJoining ? 'Starting room server…' : 'Join room'}
                </button>
                <button type="button" onClick={() => navigate('/')} className="mt-3 w-full text-sm text-zinc-500 hover:text-white">Back home</button>
            </form>
        </div>
    );

    const videoH = showMobileChat ? 100 - heightPct : 100;

    return (
        <div
            ref={ambientTargetRef}
            className="room-shell relative h-[100dvh] w-full overflow-hidden bg-black text-white"
            data-room-appearance={roomAppearance}
        >
            <div className="classic-room-background"><BackgroundLayers /></div>
            <div className="cinematic-room-environment" aria-hidden="true">
                <div className="cinematic-ceiling">
                    <i /><i /><i /><i /><i />
                </div>
                <div className="cinematic-wall cinematic-wall-left" />
                <div className="cinematic-wall cinematic-wall-right" />
                <div className="cinematic-back-wall" />
                <div className="cinematic-floor" />
                <div className="cinematic-ambient-wash" />
            </div>
            <div className="relative z-10 flex h-full w-full flex-col">
                <Header
                    roomId={roomId}
                    theme={theme}
                    setTheme={setTheme}
                    roomAppearance={roomAppearance}
                    setRoomAppearance={setRoomAppearance}
                    leaveRoom={leaveRoom}
                    navigate={navigate}
                    isConnected={isConnected}
                    networkPingMs={networkPingMs}
                    networkQuality={networkQuality}
                    measurePing={measurePing}
                    currentUser={currentUser}
                    users={users}
                />

                {isDesktop ? (
                    <div className="room-desktop-workspace mx-auto grid h-[calc(100dvh-64px)] w-full max-w-[1800px] gap-3 p-3 xl:gap-4 xl:p-4">
                        <main className={`room-player-zone ${panelClass} min-h-0 overflow-hidden p-3 xl:p-4`}>
                            <div className="classic-player-heading mb-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">Now watching</p>
                                    <h1 className="truncate text-base font-semibold text-white">Shared room playback</h1>
                                </div>
                                <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400 sm:flex">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                    Synced
                                </div>
                            </div>
                            <div className="room-video-stage h-[calc(100%-52px)] min-h-0">
                                <VideoPlayer ambientTargetRef={ambientTargetRef} appearance={roomAppearance} />
                                <div className="cinematic-screen-reflection" aria-hidden="true" />
                                <div className="cinematic-sofa" aria-hidden="true">
                                    <img src="/assets/sofa-couple.png" alt="" />
                                </div>
                            </div>
                        </main>

                        <aside className="room-right-rail flex min-h-0 flex-col gap-3">
                            <section className={`room-members-group ${panelClass} overflow-hidden`}>
                                <PanelHeader
                                    icon={<Users size={15} className="text-zinc-400" />}
                                    title="Members & Queue"
                                    count={users.length}
                                    open={showUsersPanel}
                                    onToggle={() => setShowUsersPanel(v => !v)}
                                />
                                <AnimatePresence initial={false}>
                                    {showUsersPanel && (
                                        <MotionDiv
                                            key="members-queue"
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.22 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="max-h-[34vh] overflow-y-auto">
                                                <UserQueueSidebar compact variant={roomAppearance} />
                                                <ReadinessPanel variant={roomAppearance} />
                                            </div>
                                        </MotionDiv>
                                    )}
                                </AnimatePresence>
                            </section>

                            <section className="room-voice-share-group">
                                <VoiceRoom variant={roomAppearance} />
                                <ScreenShareAdapter variant={roomAppearance} />
                            </section>
                            <div className="room-chat-group min-h-0 flex-1">
                                <ChatUI variant={roomAppearance} />
                            </div>
                        </aside>
                    </div>
                ) : (
                    <div className={isPortrait ? 'relative flex flex-1 flex-col overflow-hidden p-2' : 'flex flex-1 flex-col overflow-hidden'}>
                        <div
                            className={isPortrait ? `${panelClass} relative flex-shrink-0 overflow-hidden p-2` : 'relative w-full shrink-0 p-2'}
                            style={isPortrait ? { height: `${videoH}%` } : { height: '55vw', maxHeight: '60vh' }}
                        >
                            <div className="absolute inset-2">
                                <VideoPlayer ambientTargetRef={ambientTargetRef} appearance={roomAppearance} />
                            </div>

                            {isPortrait && (
                                <div className="absolute right-4 z-20 flex flex-col gap-3" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
                                    {[
                                        { icon: <Menu size={19} />, label: 'Room', fn: () => setShowMobileMembers(true) },
                                        { icon: <MessageSquare size={19} />, label: 'Chat', fn: () => setShowMobileChat(true) },
                                    ].map(item => (
                                        <button key={item.label} onClick={item.fn} className="flex flex-col items-center gap-1">
                                            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white shadow-xl backdrop-blur-xl">
                                                {item.icon}
                                            </div>
                                            <span className="text-[10px] font-bold text-white" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{item.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {!isPortrait && (
                            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 pt-0">
                                <section className={`${panelClass} overflow-hidden`}>
                                    <PanelHeader
                                        icon={<Users size={14} className="text-zinc-400" />}
                                        title="Room"
                                        count={users.length}
                                        open={showUsersPanel}
                                        onToggle={() => setShowUsersPanel(v => !v)}
                                    />
                                    <AnimatePresence initial={false}>
                                        {showUsersPanel && (
                                            <MotionDiv initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                                                <div className="max-h-32 overflow-y-auto">
                                                    <UserQueueSidebar compact variant={roomAppearance} />
                                                </div>
                                            </MotionDiv>
                                        )}
                                    </AnimatePresence>
                                </section>
                                <VoiceRoom variant={roomAppearance} />
                                <div className="min-h-0 flex-1">
                                    <ChatUI variant={roomAppearance} />
                                </div>
                            </div>
                        )}

                        <AnimatePresence>
                            {showMobileChat && isPortrait && (
                                <MotionDiv
                                    initial={{ opacity: 0, y: '100%' }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: '100%' }}
                                    transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                                    className="absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl border-t border-white/10 bg-black/95 shadow-2xl shadow-black backdrop-blur-xl"
                                    style={{ height: `${heightPct}%`, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                                >
                                    <div
                                        className="flex shrink-0 cursor-row-resize select-none items-center justify-between border-b border-white/10 px-4 py-3"
                                        onMouseDown={onDragStart}
                                        onTouchStart={onDragStart}
                                    >
                                        <div className="flex items-center gap-2">
                                            <GripHorizontal size={15} className="text-zinc-600" />
                                            <span className="text-sm font-bold text-white">Live Chat</span>
                                        </div>
                                        <button onClick={() => setShowMobileChat(false)} className="text-zinc-400">
                                            <X size={18} />
                                        </button>
                                    </div>
                                    <div className="min-h-0 flex-1">
                                        <ChatUI hideHeader variant={roomAppearance} />
                                    </div>
                                </MotionDiv>
                            )}
                        </AnimatePresence>

                        <AnimatePresence>
                            {showMobileMembers && isPortrait && (
                                <>
                                    <MotionDiv
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm"
                                        onClick={() => setShowMobileMembers(false)}
                                    />
                                    <MotionDiv
                                        initial={{ y: '100%' }}
                                        animate={{ y: 0 }}
                                        exit={{ y: '100%' }}
                                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                                        className="absolute inset-x-0 bottom-0 z-40 flex max-h-[76vh] flex-col rounded-t-3xl border-t border-white/10 bg-black/95 shadow-2xl shadow-black backdrop-blur-xl"
                                        style={{ height: '68vh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
                                    >
                                        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                                            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                                                <Users size={15} className="text-zinc-400" />
                                                Members & Queue
                                                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-zinc-500">{users.length}</span>
                                            </h2>
                                            <button onClick={() => setShowMobileMembers(false)} className="text-zinc-400">
                                                <X size={19} />
                                            </button>
                                        </div>
                                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                                            <VoiceRoom variant={roomAppearance} />
                                            <UserQueueSidebar compact variant={roomAppearance} />
                                        </div>
                                    </MotionDiv>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RoomLayout;
