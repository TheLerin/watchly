import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Play, Settings, Copy, Users, ChevronDown, ChevronUp, MessageSquare, X, GripHorizontal, Check, Menu } from 'lucide-react';
import ChatUI from './ChatUI';
import UserQueueSidebar from './UserQueueSidebar';
import VideoPlayer from './VideoPlayer';
import { useRoom } from '../context/RoomContext';
import { useTheme, THEME_META } from '../context/ThemeContext';
import { BackgroundLayers } from './LandingPage';
import toast from 'react-hot-toast';

function useOrientation() {
    const [isPortrait, setIsPortrait] = useState(() => window.innerHeight > window.innerWidth);
    useEffect(() => {
        const u = () => setIsPortrait(window.innerHeight > window.innerWidth);
        window.addEventListener('resize', u, { passive: true });
        window.addEventListener('orientationchange', u);
        return () => { window.removeEventListener('resize', u); window.removeEventListener('orientationchange', u); };
    }, []);
    return isPortrait;
}

function useIsDesktop() {
    const [v, setV] = useState(() => window.innerWidth >= 1024);
    useEffect(() => {
        const u = () => setV(window.innerWidth >= 1024);
        window.addEventListener('resize', u, { passive: true });
        return () => window.removeEventListener('resize', u);
    }, []);
    return v;
}

function useDragResize(def = 52) {
    const [pct, setPct] = useState(def);
    const sY = useRef(null), sP = useRef(null), pRef = useRef(def);
    useEffect(() => { pRef.current = pct; }, [pct]);
    const onDragStart = useCallback((e) => {
        const y0 = e.touches ? e.touches[0].clientY : e.clientY;
        sY.current = y0; sP.current = pRef.current;
        const onMove = (ev) => {
            const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
            setPct(Math.min(85, Math.max(28, sP.current + (sY.current - y) / window.innerHeight * 100)));
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

const ThemePicker = ({ theme, setTheme, onClose }) => (
    <motion.div
        initial={{ opacity:0, scale:0.92, y:-8 }} animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.92, y:-8 }} transition={{ type:'spring', damping:22, stiffness:320 }}
        className="glass-card absolute top-full right-0 mt-2 w-56 z-50 p-3" style={{ borderRadius:18 }}>
        <p className="text-[10px] font-bold uppercase tracking-wider mb-3 px-1" style={{ color:'var(--text-muted)' }}>Theme</p>
        <div className="grid grid-cols-2 gap-2">
            {Object.entries(THEME_META).map(([id, meta]) => (
                <button key={id} onClick={(e) => { e.stopPropagation(); setTheme(id); onClose(); }}
                    className="flex flex-col items-center gap-2 p-2.5 rounded-xl transition-all"
                    style={{ background: theme===id ? 'var(--accent-soft)' : 'var(--glass-bg)', border:`1px solid ${theme===id ? 'var(--accent-border)' : 'var(--glass-border)'}` }}>
                    <div className="relative w-8 h-8 rounded-full"
                         style={{ background:`radial-gradient(circle at 40% 40%,${meta.orb[0]},${meta.orb[1]})` }}>
                        {theme===id && <div className="absolute inset-0 flex items-center justify-center"><Check size={12} className="text-white" /></div>}
                    </div>
                    <span className="text-[11px] font-semibold leading-tight" style={{ color: theme===id ? 'var(--accent)' : 'var(--text-sub)' }}>
                        {meta.emoji} {meta.label}
                    </span>
                </button>
            ))}
        </div>
    </motion.div>
);

const Header = ({ roomId, theme, setTheme, leaveRoom, navigate }) => {
    const [showSettings, setShowSettings] = useState(false);
    const [copied, setCopied] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setShowSettings(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);
    const copyCode = () => {
        navigator.clipboard.writeText(roomId);
        setCopied(true);
        toast.success('Room code copied!', { icon:'📋' });
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <header className="glass-header flex-none h-14 flex items-center justify-between px-4 sm:px-6 z-40 relative">
            <div className="flex items-center gap-3">
                <button onClick={() => navigate('/')} className="flex items-center gap-2.5 shrink-0">
                    <img src="/logo.png" alt="WatchSync Logo" className="w-8 h-auto theme-invert transition-all" />
                    <span className="syne font-bold text-base hidden sm:block" style={{ color:'var(--text)' }}>WatchSync</span>
                </button>
                <div className="hidden sm:block w-px h-5" style={{ background:'var(--glass-border)' }} />
                <button onClick={copyCode} className="flex items-center gap-1.5 glass-panel px-3 py-1.5 transition-all" style={{ borderRadius:50 }}>
                    <span className="text-[10px] font-medium hidden sm:inline" style={{ color:'var(--text-muted)' }}>ROOM</span>
                    <span className="font-mono font-bold text-xs" style={{ color:'var(--accent)' }}>{roomId}</span>
                    <AnimatePresence mode="wait">
                        {copied
                            ? <motion.span key="c" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}><Check size={10} style={{ color:'#22c55e' }}/></motion.span>
                            : <motion.span key="d" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}><Copy size={10} style={{ color:'var(--text-muted)' }}/></motion.span>}
                    </AnimatePresence>
                </button>
            </div>
            <div className="flex items-center gap-2">
                <div className="relative" ref={ref}>
                    <button onClick={() => setShowSettings(s=>!s)} className="p-2 rounded-lg transition-all"
                        style={showSettings ? { background:'var(--glass-hover)', color:'var(--text)', border:'1px solid var(--glass-border)' } : { color:'var(--text-sub)' }}>
                        <Settings size={17} />
                    </button>
                    <AnimatePresence>
                        {showSettings && <ThemePicker theme={theme} setTheme={setTheme} onClose={() => setShowSettings(false)} />}
                    </AnimatePresence>
                </div>
                <button onClick={() => { leaveRoom(); navigate('/'); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                    style={{ background:'rgba(239,68,68,0.08)', color:'#f87171', border:'1px solid rgba(239,68,68,0.18)' }}>
                    <LogOut size={14}/><span className="hidden sm:inline">Leave</span>
                </button>
            </div>
        </header>
    );
};

const RoomLayout = () => {
    const { roomId }   = useParams();
    const navigate     = useNavigate();
    const { currentUser, leaveRoom, users, isRestoringSession } = useRoom();
    const { theme, setTheme } = useTheme();
    const [showUsersPanel, setShowUsersPanel] = useState(false);
    const [showMobileChat, setShowMobileChat] = useState(false);
    const isPortrait  = useOrientation();
    const isDesktop   = useIsDesktop();
    const { heightPct, onDragStart } = useDragResize(52);

    useEffect(() => {
        if (!currentUser && !isRestoringSession) navigate('/', { replace: true });
    }, [currentUser, isRestoringSession, navigate]);

    if (isRestoringSession) return (
        <>
            <BackgroundLayers />
            <div className="h-[100dvh] w-full flex items-center justify-center relative z-10">
                <div className="glass-card p-10 flex flex-col items-center gap-5" style={{ borderRadius:24 }}>
                    <div className="w-12 h-12 rounded-full border-4 border-t-transparent"
                         style={{ borderColor:'var(--accent-soft)', borderTopColor:'var(--accent)', animation:'spin 0.9s linear infinite' }} />
                    <p className="syne font-semibold" style={{ color:'var(--text)' }}>Restoring session…</p>
                </div>
            </div>
        </>
    );
    if (!currentUser) return null;

    const videoH = showMobileChat ? 100 - heightPct : 100;

    return (
        <div className="h-[100dvh] w-full flex flex-col overflow-hidden" style={{ background:'var(--bg-base)' }}>
            <BackgroundLayers />
            <div className="relative z-10 flex flex-col h-full w-full max-w-[1800px] mx-auto">
                <Header roomId={roomId} theme={theme} setTheme={setTheme} leaveRoom={leaveRoom} navigate={navigate} />
                <div className={`flex-1 min-h-0 ${isDesktop ? 'flex' : isPortrait ? 'relative flex flex-col overflow-hidden' : 'flex flex-col'}`}>

                    {/* Video */}
                    <div className={isDesktop ? 'flex-1 min-h-0 min-w-0 p-3 flex flex-col' : isPortrait ? 'relative flex-shrink-0' : 'w-full shrink-0'}
                         style={isDesktop ? {} : isPortrait ? { height:`${videoH}%`, background:'#000' } : { height:'55vw', maxHeight:'60vh' }}>
                        <div className={isDesktop ? 'flex-1 min-h-0 relative overflow-hidden video-pulse-border' : 'absolute inset-0 w-full h-full'}
                             style={isDesktop ? { borderRadius:20, border:'1px solid var(--glass-border)', background:'#000' } : {}}>
                            <VideoPlayer />
                            {!isDesktop && isPortrait && (
                                <div className="absolute right-3 bottom-10 flex flex-col gap-3 z-20">
                                    {[{ icon:<Menu size={19}/>, label:'Members', fn:() => setShowUsersPanel(true) },
                                      { icon:<MessageSquare size={19}/>, label:'Chat', fn:() => setShowMobileChat(true) }].map(b => (
                                        <button key={b.label} onClick={b.fn} className="flex flex-col items-center gap-1">
                                            <div className="w-11 h-11 rounded-full flex items-center justify-center text-white"
                                                 style={{ background:'rgba(0,0,0,0.60)', border:'1px solid rgba(255,255,255,0.20)', backdropFilter:'blur(10px)' }}>{b.icon}</div>
                                            <span className="text-white text-[10px] font-medium" style={{ textShadow:'0 1px 4px rgba(0,0,0,0.9)' }}>{b.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Desktop sidebar */}
                    {isDesktop && (
                        <aside className="w-80 xl:w-96 shrink-0 flex flex-col p-3 pl-0">
                            <div className="mb-2 glass-panel rounded-2xl overflow-hidden">
                                <button onClick={() => setShowUsersPanel(v=>!v)}
                                    className="flex items-center justify-between w-full px-4 py-3 hover:brightness-110 transition-all">
                                    <span className="flex items-center gap-2 text-sm font-semibold syne" style={{ color:'var(--text)' }}>
                                        <Users size={14} style={{ color:'var(--accent)' }}/>
                                        Users &amp; Queue
                                        <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background:'var(--accent-soft)', color:'var(--accent)', border:'1px solid var(--accent-border)' }}>{users.length}</span>
                                    </span>
                                    {showUsersPanel ? <ChevronUp size={13} style={{ color:'var(--text-muted)' }}/> : <ChevronDown size={13} style={{ color:'var(--text-muted)' }}/>}
                                </button>
                                <AnimatePresence initial={false}>
                                    {showUsersPanel && (
                                        <motion.div key="up" initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
                                            exit={{ height:0, opacity:0 }} transition={{ duration:0.22 }}
                                            className="overflow-hidden" style={{ borderTop:'1px solid var(--glass-border)' }}>
                                            <div className="max-h-60 overflow-y-auto"><UserQueueSidebar compact /></div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="flex-1 min-h-0"><ChatUI /></div>
                        </aside>
                    )}

                    {/* Mobile portrait overlays */}
                    {!isDesktop && isPortrait && (
                        <>
                            <AnimatePresence>
                                {showMobileChat && (
                                    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                                        className="absolute bottom-0 inset-x-0 flex flex-col z-30"
                                        style={{ height:`${heightPct}%`, background:'var(--bg-base)', borderTop:'1px solid var(--glass-border)' }}>
                                        <div className="flex items-center justify-between px-4 py-2 cursor-row-resize select-none shrink-0"
                                             style={{ background:'var(--glass-bg)', borderBottom:'1px solid var(--glass-border)' }}
                                             onMouseDown={onDragStart} onTouchStart={onDragStart}>
                                            <div className="flex items-center gap-2">
                                                <GripHorizontal size={14} style={{ color:'var(--text-muted)' }}/>
                                                <span className="text-sm font-semibold syne" style={{ color:'var(--text)' }}>Live Chat</span>
                                            </div>
                                            <button onClick={() => setShowMobileChat(false)} style={{ color:'var(--text-sub)' }}><X size={17}/></button>
                                        </div>
                                        <div className="flex-1 min-h-0"><ChatUI hideHeader /></div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <AnimatePresence>
                                {showUsersPanel && (
                                    <>
                                        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                                            className="absolute inset-0 z-30"
                                            style={{ background:'rgba(0,0,0,0.60)', backdropFilter:'blur(6px)' }}
                                            onClick={() => setShowUsersPanel(false)} />
                                        <motion.div initial={{ y:'100%' }} animate={{ y:0 }} exit={{ y:'100%' }}
                                            transition={{ type:'spring', damping:28, stiffness:300 }}
                                            className="absolute inset-x-0 bottom-0 z-40 flex flex-col glass-card"
                                            style={{ maxHeight:'72vh', borderRadius:'24px 24px 0 0' }}>
                                            <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom:'1px solid var(--glass-border)' }}>
                                                <h2 className="syne font-bold flex items-center gap-2" style={{ color:'var(--text)' }}>
                                                    <Users size={15} style={{ color:'var(--accent)' }}/> Members
                                                    <span className="text-xs px-1.5 rounded-full" style={{ background:'var(--accent-soft)', color:'var(--accent)' }}>{users.length}</span>
                                                </h2>
                                                <button onClick={() => setShowUsersPanel(false)} style={{ color:'var(--text-sub)' }}><X size={19}/></button>
                                            </div>
                                            <div className="flex-1 min-h-0 overflow-y-auto"><UserQueueSidebar compact /></div>
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </>
                    )}

                    {/* Mobile landscape */}
                    {!isDesktop && !isPortrait && (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <button onClick={() => setShowUsersPanel(v=>!v)}
                                className="flex items-center gap-2 text-xs px-3 py-2 shrink-0"
                                style={{ background:'var(--glass-bg)', borderBottom:'1px solid var(--glass-border)', color:'var(--text-sub)' }}>
                                <Users size={12} style={{ color:'var(--accent)' }}/>
                                <span className="font-medium">{users.length} Members</span>
                                {showUsersPanel ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                            </button>
                            <AnimatePresence initial={false}>
                                {showUsersPanel && (
                                    <motion.div initial={{ height:0 }} animate={{ height:'auto' }} exit={{ height:0 }}
                                        className="overflow-hidden shrink-0" style={{ borderBottom:'1px solid var(--glass-border)' }}>
                                        <div className="max-h-28 overflow-y-auto"><UserQueueSidebar compact /></div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            <div className="flex-1 min-h-0"><ChatUI /></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default RoomLayout;
