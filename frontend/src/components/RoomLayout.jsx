import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Check,
    ChevronDown,
    ChevronUp,
    Clapperboard,
    Copy,
    Hash,
    LogOut,
    MessageSquare,
    MonitorUp,
    PhoneCall,
    Settings,
    Users,
    Wifi,
    WifiOff,
} from 'lucide-react';
import ChatUI from './ChatUI';
import UserQueueSidebar from './UserQueueSidebar';
import VoiceRoom from './VoiceRoom';
import VideoPlayer from './VideoPlayer';
import TheaterIconButton from './TheaterIconButton';
import ReadinessPanel from './player/ReadinessPanel';
import ScreenShareAdapter from './player/ScreenShareAdapter';
import { useRoom } from '../context/RoomContext';
import { useAuth } from '../context/AuthContext';
import useRoomPanelDismiss from '../hooks/useRoomPanelDismiss';
import { useTheme } from '../context/ThemeContext';
import { architecturalLight } from '../utils/appearanceSettings';
import AppearancePanel from './AppearancePanel';
import { BackgroundLayers } from './BackgroundLayers';
import toast from 'react-hot-toast';
import { NETWORK_QUALITY_META, formatPing } from '../utils/networkQuality';
import './room-theater.css';
import CinemaLuxeScene from './CinemaLuxeScene';
import './cinema-luxe.css';
import './appearance-panel.css';
import './classic-desktop.css';
import './room-panels.css';

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

function useSupportsTheater() {
    const [supportsTheater, setSupportsTheater] = useState(() =>
        window.matchMedia('(min-width: 1180px) and (min-height: 650px)').matches);
    useEffect(() => {
        const media = window.matchMedia('(min-width: 1180px) and (min-height: 650px)');
        const update = () => setSupportsTheater(media.matches);
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return supportsTheater;
}

const panelClass = 'rounded-3xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30 backdrop-blur-xl';

const Header = ({ roomId, roomAppearance, supportsTheater, leaveRoom, navigate, isConnected, connectionPhase, retryConnection, networkPingMs, networkQuality, measurePing, currentUser, users, activePanel, togglePanel, panelRef, panelEvents, settingsTriggerRef }) => {
    const showSettings = activePanel === 'settings';
    const [showRoomInfo, setShowRoomInfo] = useState(false);
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
    const [copied, setCopied] = useState(false);
    const roomInfoRef = useRef(null);
    const leaveRef = useRef(null);

    useEffect(() => {
        const close = (e) => {
            if (roomInfoRef.current && !roomInfoRef.current.contains(e.target)) setShowRoomInfo(false);
            if (leaveRef.current && !leaveRef.current.contains(e.target)) setShowLeaveConfirm(false);
        };
        document.addEventListener('pointerdown', close);
        const escape = event => {
            if (event.key === 'Escape') { setShowRoomInfo(false); setShowLeaveConfirm(false); }
        };
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', escape);
        };
    }, []);

    const copyCode = () => {
        navigator.clipboard.writeText(roomId);
        setCopied(true);
        toast.success('Room code copied!', { icon: 'Copy' });
        setTimeout(() => setCopied(false), 2000);
    };

    const qualityKey = isConnected ? networkQuality : 'offline';
    const qualityMeta = NETWORK_QUALITY_META[qualityKey] || NETWORK_QUALITY_META.checking;
    const connectionLabel = { connected: 'Synced', reconnecting: 'Reconnecting…', resyncing: 'Resyncing…', offline: 'Offline', failed: 'Sync failed' }[connectionPhase] || 'Offline';
    const connectionDetail = connectionPhase === 'connected' ? `Synced · Ping ${formatPing(networkPingMs)} · ${qualityMeta.label}`
        : connectionPhase === 'offline' ? 'Still offline. Watchly will reconnect automatically. Click to retry now.'
            : connectionPhase === 'failed' ? 'Playback could not resync. Click to retry with fresh room state.' : connectionLabel;

    return (
        <header className="room-header relative z-40 h-16 flex-none border-b border-white/10 bg-black/75 backdrop-blur-xl">
            <div className="mx-auto flex h-full max-w-[1800px] items-center justify-between px-3 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => navigate('/')} className="room-brand flex shrink-0 items-center gap-2.5" title="Watchly home" aria-label="Watchly home">
                        <img src="/logo.png" alt="Watchly Logo" className="h-10 w-auto theme-invert" />
                        <span className="hidden text-sm font-bold tracking-tight text-white sm:block">Watchly</span>
                    </button>

                    {roomAppearance === 'cinematic' ? (
                        <div className="relative" ref={roomInfoRef}>
                            <TheaterIconButton
                                icon={<Hash size={19} />}
                                label="Room details"
                                active={showRoomInfo}
                                controls="watchly-room-details"
                                className="room-code-button"
                                onClick={() => setShowRoomInfo(value => !value)}
                            />
                            {showRoomInfo && (
                                <div id="watchly-room-details" className="room-header-popover room-info-popover">
                                    <p className="room-header-popover-label">Room code</p>
                                    <div className="room-info-code-row">
                                        <code>{roomId}</code>
                                        <button type="button" onClick={copyCode} aria-label="Copy room code" title="Copy room code">
                                            {copied ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                    <p className="room-info-meta">{users.length} online · {currentUser?.role || 'Viewer'} · {connectionLabel}</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={copyCode}
                                className="room-code-button flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:border-white/25 hover:bg-white/[0.06]"
                                title={`Copy room code ${roomId}`}
                                aria-label="Copy room code"
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
                            <div className="room-presence hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400 md:flex" title={`${users.length} online · ${currentUser?.role || 'Viewer'}`}>
                                <Users size={13} />
                                <span>{users.length} online</span>
                                <span className="h-1 w-1 rounded-full bg-zinc-700" />
                                <span>{currentUser?.role || 'Viewer'}</span>
                            </div>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => connectionPhase === 'connected' ? measurePing?.() : retryConnection?.()}
                        disabled={connectionPhase === 'resyncing'}
                        className="room-ping-button flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed"
                        aria-label={connectionDetail}
                        data-connection-phase={connectionPhase}
                        style={roomAppearance === 'cinematic' ? undefined : { background: qualityMeta.bg, color: qualityMeta.color, border: `1px solid ${qualityMeta.border}` }}
                        title={connectionDetail}
                    >
                        {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                        <span role="status" aria-live="polite">{connectionLabel}</span>
                    </button>

                    <div className="room-settings-anchor relative" data-open={showSettings}>
                        <button
                            ref={settingsTriggerRef}
                            onClick={() => togglePanel('settings')}
                            className="room-settings-button flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-400 transition hover:border-white/25 hover:text-white"
                            title="Room settings"
                            aria-label="Room settings"
                            aria-expanded={showSettings}
                            aria-controls="watchly-appearance"
                        >
                            <Settings size={16} />
                        </button>
                        <AnimatePresence>
                            {showSettings && (
                                <AppearancePanel supportsTheater={supportsTheater} panelRef={panelRef} panelEvents={panelEvents} />
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="relative" ref={leaveRef}>
                        <button
                            onClick={() => {
                                if (roomAppearance === 'cinematic') setShowLeaveConfirm(value => !value);
                                else { leaveRoom(); navigate('/'); }
                            }}
                            className="room-leave-button flex h-9 items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 text-sm font-semibold text-red-300 transition hover:bg-red-500/15"
                            title="Leave room"
                            aria-label="Leave room"
                            aria-expanded={roomAppearance === 'cinematic' ? showLeaveConfirm : undefined}
                        >
                            <LogOut size={14} />
                            <span className="hidden sm:inline">Leave</span>
                        </button>
                        {showLeaveConfirm && roomAppearance === 'cinematic' && (
                            <div className="room-header-popover room-leave-popover">
                                <p>Leave this room?</p>
                                <button type="button" onClick={() => { leaveRoom(); navigate('/'); }}>Leave room</button>
                            </div>
                        )}
                    </div>
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

const roomTabs = [
    { id: 'watch', label: 'Watch', icon: <Clapperboard size={19} />, controls: 'watchly-left-panel' },
    { id: 'room', label: 'Room', icon: <Users size={19} />, controls: 'classic-room-panel' },
    { id: 'call', label: 'Call', icon: <PhoneCall size={19} />, controls: 'classic-call-panel classic-share-panel' },
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={19} />, controls: 'classic-chat-panel' },
];

const RoomTabs = ({ activeTab, onChange, onSelect = onChange, desktop = false, triggerRef }) => (
    <nav ref={triggerRef} className={desktop ? 'classic-desktop-tabs' : 'mobile-classic-tabs'}
        aria-label={desktop ? 'Room sections' : 'Mobile room sections'} role={desktop ? 'tablist' : undefined}>
        {roomTabs.map(({ id, label, icon, controls }, index) => (
            <button type="button" key={id} data-active={activeTab === id}
                id={desktop ? `classic-${id}-tab` : undefined}
                role={desktop ? 'tab' : undefined}
                aria-selected={desktop ? activeTab === id : undefined}
                aria-controls={desktop ? controls : undefined}
                aria-current={!desktop && activeTab === id ? 'page' : undefined}
                tabIndex={desktop ? (activeTab === id || (!activeTab && index === 0) ? 0 : -1) : undefined}
                onClick={() => onChange(id)}
                onKeyDown={desktop ? event => {
                    const next = event.key === 'ArrowRight' ? (index + 1) % roomTabs.length
                        : event.key === 'ArrowLeft' ? (index + roomTabs.length - 1) % roomTabs.length
                            : event.key === 'Home' ? 0 : event.key === 'End' ? roomTabs.length - 1 : null;
                    if (next === null) return;
                    event.preventDefault();
                    onSelect(roomTabs[next].id);
                    event.currentTarget.parentElement.children[next].focus();
                } : undefined}>
                {icon}<span>{label}</span>
            </button>
        ))}
    </nav>
);

const RoomLayout = () => {
    const { user: accountUser, profile: accountProfile, isProfileLoading } = useAuth();
    const { roomId } = useParams();
    const navigate = useNavigate();
    const {
        currentUser,
        leaveRoom,
        users,
        isRestoringSession,
        isConnected,
        connectionPhase,
        connectionError,
        retryConnection,
        networkPingMs,
        networkQuality,
        measurePing,
        joinRoom,
        createRoom,
    } = useRoom();
    const { theme, roomAppearance: preferredRoomAppearance, appearanceSettings } = useTheme();
    const ambientTargetRef = useRef(null);
    const [showUsersPanel, setShowUsersPanel] = useState(true);
    const [activePanel, setActivePanel] = useState(() => preferredRoomAppearance === 'cinematic' ? null : 'watch');
    const mobileTab = ({ members: 'room', voice: 'call', watch: 'watch', chat: 'chat' })[activePanel] || '';
    const selectTab = useCallback(tab => setActivePanel(({ room: 'members', call: 'voice' })[tab] || tab), []);
    const togglePanel = useCallback(panel => setActivePanel(current => current === panel ? null : panel), []);
    const toggleTab = useCallback(tab => togglePanel(({ room: 'members', call: 'voice' })[tab] || tab), [togglePanel]);
    const closePanel = useCallback(() => setActivePanel(null), []);
    const settingsPanelRef = useRef(null), leftPanelRef = useRef(null), rightPanelRef = useRef(null), mobilePanelRef = useRef(null);
    const settingsTriggerRef = useRef(null), leftDockRef = useRef(null), rightDockRef = useRef(null), tabsRef = useRef(null);
    const triggerRefs = useMemo(() => [settingsTriggerRef, leftDockRef, rightDockRef, tabsRef], []);
    const [joinNickname, setJoinNickname] = useState('');
    const effectiveJoinNickname = accountProfile?.display_name || joinNickname;
    const needsProfile = Boolean(accountUser && !accountProfile && !isProfileLoading);
    const [joinError, setJoinError] = useState('');
    const [joinErrorCode, setJoinErrorCode] = useState('');
    const [isJoining, setIsJoining] = useState(false);
    const isPortrait = useOrientation();
    const isDesktop = useIsDesktop();
    const supportsTheater = useSupportsTheater();
    const cinemaLuxe = preferredRoomAppearance === 'cinematic';
    const roomAppearance = supportsTheater ? preferredRoomAppearance : 'classic';
    // Appearance can animate out while another panel opens; its departing ref
    // must not clear the newly opened panel's boundary.
    const panelRef = activePanel === 'settings' ? settingsPanelRef : !isDesktop ? mobilePanelRef
        : ['watch', 'info', 'tracks'].includes(activePanel) ? leftPanelRef : rightPanelRef;
    const dismissiblePanel = isDesktop || activePanel === 'settings' || ['members', 'voice', 'chat'].includes(activePanel) ? activePanel : null;
    const panelEvents = useRoomPanelDismiss({ activePanel: dismissiblePanel, onClose: closePanel, panelRef, triggerRefs });

    if (isRestoringSession) {
        return (
            <div className="relative flex h-[100dvh] w-full items-center justify-center overflow-hidden bg-black">
                <BackgroundLayers />
                <div className={`${panelClass} relative z-10 flex flex-col items-center gap-5 p-10`}>
                    <div className="h-12 w-12 rounded-full border-4 border-white/10 border-t-white" style={{ animation: 'spin 0.9s linear infinite' }} />
                    <p className="text-sm font-semibold text-white">{connectionPhase === 'offline' ? 'Still offline' : 'Reconnecting to your room…'}</p>
                    <p className="max-w-xs text-center text-xs text-zinc-500">Watchly will reconnect automatically and restore the room when the server is available.</p>
                    <button type="button" className="rounded-xl border border-white/10 px-4 py-2 text-xs text-zinc-300" onClick={retryConnection}>Retry now</button>
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
                    if (needsProfile) { navigate(`/setup-profile?returnTo=${encodeURIComponent(`/room/${roomId.toUpperCase()}`)}`); return; }
                    setJoinError('');
                    setJoinErrorCode('');
                    setIsJoining(true);
                    try { await joinRoom(roomId.toUpperCase(), effectiveJoinNickname.trim()); }
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
                    value={effectiveJoinNickname}
                    readOnly={Boolean(accountProfile)}
                    onChange={event => setJoinNickname(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-white/30"
                    placeholder="Your nickname"
                />
                {joinError && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{joinError}</p>}
                {connectionError && !joinError && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{connectionError}</p>}
                {needsProfile && <button type="button" className="mt-3 w-full rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 font-bold text-white" onClick={() => navigate(`/setup-profile?returnTo=${encodeURIComponent(`/room/${roomId.toUpperCase()}`)}`)}>Finish profile to join</button>}
                {!accountUser && connectionError && <button type="button" className="mt-3 w-full rounded-xl border border-white/15 bg-white/[0.05] px-4 py-3 font-bold text-white" onClick={() => navigate(`/auth?returnTo=${encodeURIComponent(`/room/${roomId.toUpperCase()}`)}`)}>Sign in to your account</button>}
                {joinErrorCode === 'ROOM_NOT_FOUND' && (
                    <button
                        type="button"
                        disabled={!effectiveJoinNickname.trim() || isJoining}
                        onClick={async () => {
                            setJoinError('');
                            setJoinErrorCode('');
                            setIsJoining(true);
                            try {
                                const created = await createRoom(effectiveJoinNickname.trim());
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
                <button disabled={!effectiveJoinNickname.trim() || isJoining || needsProfile || isProfileLoading} className="mt-5 w-full rounded-xl bg-white px-4 py-3 font-bold text-black disabled:opacity-40">
                    {isJoining ? 'Starting room server…' : 'Join room'}
                </button>
                <button type="button" onClick={() => navigate('/')} className="mt-3 w-full text-sm text-zinc-500 hover:text-white">Back home</button>
            </form>
        </div>
    );

    return (
        <div
            ref={ambientTargetRef}
            className="room-shell relative h-[100dvh] w-full overflow-hidden bg-black text-white"
            data-room-appearance={roomAppearance}
            data-theme={cinemaLuxe ? 'cinema-luxe' : theme}
            data-ui-theme={theme}
            data-cinema-preset={cinemaLuxe ? appearanceSettings.cinemaPreset : undefined}
            data-cinema-ambient-enabled={String(appearanceSettings.ambientLighting)}
            data-cinema-aisle={String(appearanceSettings.aisleLights)}
            data-cinema-sofa={String(appearanceSettings.sofa)}
            data-cinema-wall-details={String(appearanceSettings.wallDetails)}
            data-cinema-dim={String(appearanceSettings.dimWhilePlaying)}
            data-cinema-expansion={String(appearanceSettings.screenExpansion)}
            data-cinema-reduce-motion={String(appearanceSettings.reduceMotion)}
            data-classic-tab={mobileTab}
            style={{ '--cinema-room-light': architecturalLight(appearanceSettings.roomBrightness) }}
        >
            {cinemaLuxe && <CinemaLuxeScene />}
            <div className="classic-room-background"><BackgroundLayers /></div>
            <div className="cinematic-room-environment" aria-hidden="true">
                <div className="theater-back-wall" />
                <div className="theater-side-wall theater-wall-left" />
                <div className="theater-side-wall theater-wall-right" />
                <div className="theater-floor" />
            </div>
            <div className="relative z-10 flex h-full w-full flex-col">
                <Header
                    roomId={roomId}
                    roomAppearance={roomAppearance}
                    supportsTheater={supportsTheater}
                    leaveRoom={leaveRoom}
                    navigate={navigate}
                    isConnected={isConnected}
                    connectionPhase={connectionPhase}
                    retryConnection={retryConnection}
                    networkPingMs={networkPingMs}
                    networkQuality={networkQuality}
                    measurePing={measurePing}
                    currentUser={currentUser}
                    users={users}
                    activePanel={activePanel} togglePanel={togglePanel} panelRef={panelRef} panelEvents={panelEvents} settingsTriggerRef={settingsTriggerRef}
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
                                <div className="video-ambient-light" aria-hidden="true">
                                    <span className="video-ambient-top" />
                                    <span className="video-ambient-left" />
                                    <span className="video-ambient-right" />
                                    <span className="video-ambient-bottom" />
                                </div>
                                <VideoPlayer ambientTargetRef={ambientTargetRef} appearance={roomAppearance} cinemaLuxe={cinemaLuxe}
                                    activeTheaterTool={['watch', 'info', 'tracks'].includes(activePanel) ? activePanel : null}
                                    onTheaterToolChange={togglePanel} closeTheaterTool={closePanel} dockRef={leftDockRef}
                                    panelRef={['watch', 'info', 'tracks'].includes(activePanel) ? panelRef : undefined} panelEvents={panelEvents}
                                    controlsTabLabel={roomAppearance === 'classic' ? 'classic-watch-tab' : undefined} />
                                {!cinemaLuxe && <div className="cinematic-sofa" aria-hidden="true">
                                    <picture>
                                        <source srcSet="/assets/sofa-couple.webp" type="image/webp" />
                                        <img src="/assets/sofa-couple.png" alt="" />
                                    </picture>
                                </div>}
                            </div>
                        </main>

                        <aside id="watchly-right-panel" className="room-right-rail flex min-h-0 flex-col gap-3" data-open-tool={activePanel || ''}
                            ref={roomAppearance === 'classic' && ['members', 'voice', 'chat'].includes(activePanel) ? panelRef : undefined} {...(roomAppearance === 'classic' ? panelEvents : {})}>
                            {roomAppearance === 'classic' && <RoomTabs desktop triggerRef={tabsRef} activeTab={mobileTab} onChange={toggleTab} onSelect={selectTab} />}
                            <nav ref={rightDockRef} className="theater-right-dock" aria-label="Room tools">
                                {[
                                    { id: 'members', label: 'Members and queue', icon: <Users size={21} /> },
                                    { id: 'voice', label: 'Voice call', icon: <PhoneCall size={21} /> },
                                    { id: 'share', label: 'Share screen', icon: <MonitorUp size={21} /> },
                                    { id: 'chat', label: 'Live chat', icon: <MessageSquare size={21} /> },
                                ].map(tool => (
                                    <TheaterIconButton
                                        key={tool.id}
                                        icon={tool.icon}
                                        label={tool.label}
                                        active={activePanel === tool.id}
                                        controls="watchly-right-panel"
                                        onClick={() => togglePanel(tool.id)}
                                    />
                                ))}
                            </nav>
                            <section className={`room-members-group ${panelClass} overflow-hidden`} data-expanded={showUsersPanel}
                                {...panelEvents}
                                ref={roomAppearance === 'cinematic' && activePanel === 'members' ? panelRef : undefined}
                                id={roomAppearance === 'classic' ? 'classic-room-panel' : undefined}
                                role={roomAppearance === 'classic' ? 'tabpanel' : undefined}
                                aria-labelledby={roomAppearance === 'classic' ? 'classic-room-tab' : undefined}>
                                <PanelHeader
                                    icon={<Users size={15} className="text-zinc-400" />}
                                    title="Members & Queue"
                                    count={users.length}
                                    open={showUsersPanel}
                                    onToggle={() => setShowUsersPanel(v => !v)}
                                />
                                <AnimatePresence initial={false}>
                                    {(showUsersPanel || roomAppearance === 'classic') && (
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

                            <section className="room-voice-group" id={roomAppearance === 'classic' ? 'classic-call-panel' : undefined}
                                {...panelEvents}
                                ref={roomAppearance === 'cinematic' && activePanel === 'voice' ? panelRef : undefined}
                                role={roomAppearance === 'classic' ? 'tabpanel' : undefined}
                                aria-labelledby={roomAppearance === 'classic' ? 'classic-call-tab' : undefined}>
                                <VoiceRoom variant={roomAppearance} />
                            </section>
                            <section className="room-share-group" id={roomAppearance === 'classic' ? 'classic-share-panel' : undefined}
                                {...panelEvents}
                                ref={roomAppearance === 'cinematic' && activePanel === 'share' ? panelRef : undefined}
                                role={roomAppearance === 'classic' ? 'tabpanel' : undefined}
                                aria-labelledby={roomAppearance === 'classic' ? 'classic-call-tab' : undefined}>
                                <ScreenShareAdapter variant={roomAppearance} />
                            </section>
                            <div className="room-chat-group min-h-0 flex-1" id={roomAppearance === 'classic' ? 'classic-chat-panel' : undefined}
                                {...panelEvents}
                                ref={roomAppearance === 'cinematic' && activePanel === 'chat' ? panelRef : undefined}
                                role={roomAppearance === 'classic' ? 'tabpanel' : undefined}
                                aria-labelledby={roomAppearance === 'classic' ? 'classic-chat-tab' : undefined}>
                                <ChatUI variant={roomAppearance} hideHeader={roomAppearance === 'classic'}
                                    visible={roomAppearance !== 'classic' || mobileTab === 'chat'} />
                            </div>
                        </aside>
                    </div>
                ) : (
                    <div className="room-mobile-workspace" data-orientation={isPortrait ? 'portrait' : 'landscape'} data-mobile-tab={mobileTab || 'watch'}>
                        <div className="room-mobile-player">
                            <div className="room-mobile-player-inner">
                                <VideoPlayer ambientTargetRef={ambientTargetRef} appearance="classic" ambientEnabled={false} cinemaLuxe={cinemaLuxe} />
                            </div>
                        </div>

                        <div className="mobile-classic-panels" hidden={!['room', 'call', 'chat'].includes(mobileTab)}
                            ref={['room', 'call', 'chat'].includes(mobileTab) ? panelRef : undefined} {...panelEvents}>
                            <section className="mobile-classic-panel mobile-classic-room" hidden={mobileTab !== 'room'} aria-label="Members and queue">
                                <div className="mobile-classic-panel-heading">
                                    <div><span>YOUR ROOM</span><h2>Members & Queue</h2></div>
                                    <small>{users.length} online</small>
                                </div>
                                <div className="mobile-classic-card">
                                    <UserQueueSidebar compact variant="classic" />
                                    <ReadinessPanel variant="classic" />
                                </div>
                            </section>
                            <section className="mobile-classic-panel mobile-classic-call" hidden={mobileTab !== 'call'} aria-label="Voice and screen share">
                                <div className="mobile-classic-panel-heading">
                                    <div><span>CONNECT</span><h2>Voice & Share</h2></div>
                                </div>
                                <VoiceRoom variant="classic" />
                                <ScreenShareAdapter variant="classic" />
                            </section>
                            <section className="mobile-classic-panel mobile-classic-chat" hidden={mobileTab !== 'chat'} aria-label="Live chat">
                                <ChatUI hideHeader variant="classic" className="mobile-classic-chat-ui" visible={mobileTab === 'chat'} />
                            </section>
                        </div>

                        <RoomTabs triggerRef={tabsRef} activeTab={mobileTab || 'watch'} onChange={toggleTab} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default RoomLayout;
