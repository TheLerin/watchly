import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Users, Zap, HardDrive, MonitorPlay, ChevronRight, User, Hash, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { useTheme } from '../context/ThemeContext';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion';

/* ── Background orbs + noise (rendered globally behind everything) ── */
export const BackgroundLayers = () => {
    const spotRef = useRef(null);
    const { isDark } = useTheme();

    useEffect(() => {
        const move = (e) => {
            if (spotRef.current) {
                spotRef.current.style.left = e.clientX + 'px';
                spotRef.current.style.top  = e.clientY + 'px';
            }
        };
        window.addEventListener('mousemove', move, { passive: true });
        return () => window.removeEventListener('mousemove', move);
    }, []);

    return (
        <>
            <div className="bg-base-layer" />
            <div className="orb-field">
                <div className="orb orb-1" />
                <div className="orb orb-2" />
                <div className="orb orb-3" />
                <div className="orb orb-4" />
            </div>
            <div className="noise-overlay" />
            {isDark && <div className="cursor-spotlight" ref={spotRef} />}
        </>
    );
};

/* ── Magnetic button hook ─────────────────────────────────────────── */
function useMagnet(strength = 0.35) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onMove = (e) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width  / 2;
            const cy = r.top  + r.height / 2;
            const dx = e.clientX - cx, dy = e.clientY - cy;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 80) {
                const pull = (1 - dist/80) * strength;
                el.style.transform = `translate(${dx*pull}px,${dy*pull}px)`;
            } else {
                el.style.transform = '';
            }
        };
        const onLeave = () => {
            el.style.transition = 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)';
            el.style.transform = '';
            setTimeout(() => { if (el) el.style.transition = ''; }, 500);
        };
        document.addEventListener('mousemove', onMove, { passive: true });
        el.addEventListener('mouseleave', onLeave);
        return () => {
            document.removeEventListener('mousemove', onMove);
            el?.removeEventListener('mouseleave', onLeave);
        };
    }, [strength]);
    return ref;
}

/* ── 3D tilt card hook ────────────────────────────────────────────── */
function use3DTilt(strength = 8) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onMove = (e) => {
            const r = el.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width  - 0.5;
            const y = (e.clientY - r.top)  / r.height - 0.5;
            el.style.transform = `perspective(1000px) rotateY(${x*strength}deg) rotateX(${-y*strength*0.75}deg) scale(1.02)`;
        };
        const onLeave = () => {
            el.style.transition = 'transform 0.6s cubic-bezier(0.34,1.56,0.64,1)';
            el.style.transform = '';
            setTimeout(() => { if (el) el.style.transition = ''; }, 600);
        };
        el.addEventListener('mousemove', onMove);
        el.addEventListener('mouseleave', onLeave);
        return () => {
            el?.removeEventListener('mousemove', onMove);
            el?.removeEventListener('mouseleave', onLeave);
        };
    }, [strength]);
    return ref;
}

/* ── Stagger animation helper ─────────────────────────────────────── */
const fadeUp = (delay = 0, y = 24) => ({
    initial:    { opacity: 0, y },
    animate:    { opacity: 1, y: 0 },
    transition: { duration: 0.65, ease: [0.22,1,0.36,1], delay },
});

const FEATURES = [
    { icon: <Zap size={22}/>, title: 'Instant Sync', desc: 'Play, pause, seek — mirrored to every viewer in under a second.', gradient: 'from-yellow-500 to-orange-500', glow: 'rgba(234,179,8,0.20)' },
    { icon: <HardDrive size={22}/>, title: 'Google Drive', desc: 'Our proxy streams your private Drive files to the whole room.', gradient: 'from-blue-500 to-cyan-500', glow: 'rgba(59,130,246,0.18)' },
    { icon: <MonitorPlay size={22}/>, title: 'Any Platform', desc: 'YouTube, Vimeo, MP4, Archive.org — if it plays, we sync it.', gradient: 'from-violet-500 to-purple-500', glow: 'rgba(139,92,246,0.18)' },
];

const STEPS = [
    { n: '01', icon: '🚀', title: 'Create a Room', desc: 'Pick a nickname and generate your instant room code — no account required.' },
    { n: '02', icon: '🔗', title: 'Share the Code', desc: 'Send the 7-character code to anyone in the world. They join instantly.' },
    { n: '03', icon: '🎬', title: 'Watch Together', desc: 'Every play, pause, and seek syncs to all viewers in real time.' },
];

const STATS = [
    { value: '∞',    label: 'Videos Synced' },
    { value: '0ms',  label: 'Added Lag' },
    { value: '100%', label: 'Free Forever' },
    { value: '5+',   label: 'Platforms' },
];

/* ── Fake chat messages cycling in the preview card ──────────────── */
const FAKE_MSGS = ['this is so good 🔥', 'omg the twist!!', 'pause here 😭', '10/10 movie fr'];

const LandingPage = () => {
    const navigate  = useNavigate();
    const { joinRoom, currentUser, roomId } = useRoom();
    const [nickname,   setNickname]   = useState('');
    const [joinCode,   setJoinCode]   = useState('');
    const [activeTab,  setActiveTab]  = useState('create');
    const [chatIdx,    setChatIdx]    = useState(0);
    const magnetRef = useMagnet(0.30);
    const tiltRef   = use3DTilt(8);

    useEffect(() => {
        if (currentUser && roomId) navigate(`/room/${roomId}`);
    }, [currentUser, roomId, navigate]);

    // Cycle fake chat messages
    useEffect(() => {
        const t = setInterval(() => setChatIdx(i => (i+1) % FAKE_MSGS.length), 2800);
        return () => clearInterval(t);
    }, []);

    const handleCreate = () => {
        if (!nickname.trim()) return;
        joinRoom(Math.random().toString(36).substring(2,9).toUpperCase(), nickname.trim());
    };
    const handleJoin = () => {
        if (!nickname.trim() || !joinCode.trim()) return;
        joinRoom(joinCode.trim().toUpperCase(), nickname.trim());
    };
    const handleKey = (e) => {
        if (e.key !== 'Enter') return;
        activeTab === 'create' ? handleCreate() : handleJoin();
    };
    const canSubmit = nickname.trim() && (activeTab === 'create' || joinCode.trim());

    return (
        <div className="min-h-screen flex flex-col relative" style={{ isolation: 'isolate' }}>
            <BackgroundLayers />

            {/* ── Navbar ────────────────────────────────────────────── */}
            <motion.nav {...fadeUp(0.1)}
                className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5 glass-header"
                style={{ borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}>
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                         style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-2))', boxShadow: 'var(--glow-sm-purple)' }}>
                        <Play fill="white" size={14} className="ml-0.5" />
                    </div>
                    <span className="syne font-bold text-xl tracking-tight" style={{ color: 'var(--text)' }}>WatchSync</span>
                </div>
                <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium glass-panel"
                     style={{ color: 'var(--text-sub)', borderRadius: 50 }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    Live sync ready
                </div>
            </motion.nav>

            {/* ── Hero ──────────────────────────────────────────────── */}
            <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center gap-16 px-6 sm:px-10 py-14 max-w-7xl mx-auto w-full">

                {/* Left */}
                <div className="flex-1 flex flex-col gap-7 text-center lg:text-left max-w-2xl">
                    <motion.div {...fadeUp(0.2)}>
                        <span className="inline-flex items-center gap-2 text-xs font-semibold rounded-full px-4 py-1.5 mb-5 shimmer-pill"
                              style={{ color: 'var(--accent)', border: '1px solid var(--accent-border)', borderRadius: 50 }}>
                            <Zap size={11} fill="currentColor" />
                            Free · No account required · Open source
                        </span>
                        <h1 className="syne text-6xl sm:text-7xl lg:text-8xl font-extrabold leading-[1.02] tracking-tight" style={{ color: 'var(--text)' }}>
                            Watch.<br />
                            <span className="text-gradient-animated">Together.</span><br />
                            In Sync.
                        </h1>
                    </motion.div>

                    <motion.p {...fadeUp(0.35)}
                        className="text-lg leading-relaxed max-w-lg" style={{ color: 'var(--text-sub)' }}>
                        Create a room, share the code, and enjoy perfectly synchronized playback with
                        friends anywhere — YouTube, Vimeo, Google Drive, and more.
                    </motion.p>

                    {/* Action Card */}
                    <motion.div {...fadeUp(0.45)} className="glass-card p-6 flex flex-col gap-5"
                                style={{ borderRadius: 20 }}>

                        {/* Tab switcher with layoutId pill */}
                        <div className="relative flex rounded-xl overflow-hidden p-1 gap-1"
                             style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                            {[{ id:'create', label:'Create Room' }, { id:'join', label:'Join Room' }].map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className="relative flex-1 py-2.5 text-sm font-semibold rounded-lg z-10 transition-colors"
                                    style={{ color: activeTab === tab.id ? '#fff' : 'var(--text-sub)' }}>
                                    {activeTab === tab.id && (
                                        <motion.div layoutId="tab-pill" className="absolute inset-0 rounded-lg z-[-1]"
                                            style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-2))', boxShadow: '0 4px 16px var(--accent-glow)' }}
                                            transition={{ type:'spring', bounce:0.2, duration:0.4 }} />
                                    )}
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Nickname */}
                        <div className="relative">
                            <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input id="nickname-input" type="text" placeholder="Your nickname…"
                                value={nickname} maxLength={24}
                                onChange={e => setNickname(e.target.value)} onKeyDown={handleKey}
                                className="glass-input w-full rounded-xl py-3.5 pl-10 pr-4 text-sm font-medium" />
                        </div>

                        {/* Room code */}
                        <AnimatePresence>
                            {activeTab === 'join' && (
                                <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
                                    exit={{ opacity:0, height:0 }} transition={{ duration:0.22 }} className="overflow-hidden">
                                    <div className="relative pt-1">
                                        <Hash size={15} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                        <input id="room-code-input" type="text" placeholder="ROOM CODE"
                                            value={joinCode} maxLength={10}
                                            onChange={e => setJoinCode(e.target.value.toUpperCase())} onKeyDown={handleKey}
                                            className="glass-input w-full rounded-xl py-3.5 pl-10 pr-4 text-sm font-mono font-bold tracking-widest uppercase" />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* CTA */}
                        <button ref={magnetRef}
                            id={activeTab === 'create' ? 'create-room-btn' : 'join-room-btn'}
                            onClick={activeTab === 'create' ? handleCreate : handleJoin}
                            disabled={!canSubmit}
                            className="btn-primary flex items-center justify-center gap-2.5 py-4 w-full text-base font-bold"
                            style={{ borderRadius: 14, fontSize: 15 }}>
                            {activeTab === 'create'
                                ? <><Play size={17} fill="white" /> Create Room</>
                                : <><Users size={17} /> Join Room</>}
                            <ChevronRight size={16} className="ml-auto opacity-60" />
                        </button>

                        <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                            No signup · No downloads · Plays anywhere
                        </p>
                    </motion.div>
                </div>

                {/* Right — floating 3D tilt preview card */}
                <motion.div {...fadeUp(0.55)}
                    className="flex-1 w-full max-w-md hidden lg:block animate-float">
                    <div ref={tiltRef} className="glass-card p-5 aspect-video flex flex-col gap-3"
                         style={{ borderRadius: 20, transformOrigin: 'center center' }}>
                        {/* Title bar */}
                        <div className="flex items-center justify-between">
                            <div className="flex gap-1.5">
                                {['#ef4444','#f59e0b','#22c55e'].map((c,i) => (
                                    <div key={i} className="w-3 h-3 rounded-full" style={{ background: c }} />
                                ))}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] font-mono font-medium" style={{ color: 'var(--text-muted)' }}>
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> 3 watching
                            </div>
                            <div className="flex -space-x-2">
                                {[['A','#7c3aed'],['B','#4f46e5'],['C','#2563eb']].map(([l,bg],i) => (
                                    <div key={i} className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold text-white"
                                         style={{ background: bg, borderColor: 'var(--bg-base)' }}>{l}</div>
                                ))}
                            </div>
                        </div>
                        {/* Fake player */}
                        <div className="flex-1 rounded-2xl relative overflow-hidden flex items-center justify-center"
                             style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid var(--glass-border)' }}>
                            <div className="absolute inset-0 opacity-30"
                                 style={{ background: 'linear-gradient(135deg,var(--accent) 0%,#1d4ed8 100%)' }} />
                            <div className="relative z-10 w-14 h-14 rounded-full flex items-center justify-center"
                                 style={{ background:'rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.25)', backdropFilter:'blur(8px)' }}>
                                <Play fill="white" size={22} className="ml-1" />
                            </div>
                        </div>
                        {/* Scrubber */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                                <span>12:34</span><span>1:45:00</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--glass-border)' }}>
                                <motion.div className="h-full rounded-full"
                                    style={{ background: 'linear-gradient(90deg,var(--accent),#3b82f6)' }}
                                    initial={{ width:'15%' }} animate={{ width:'46%' }}
                                    transition={{ duration:9, ease:'linear', repeat:Infinity, repeatType:'reverse' }} />
                            </div>
                        </div>
                        {/* Animated chat message */}
                        <div className="flex gap-2 items-center text-[11px]">
                            <span className="font-bold" style={{ color: '#a78bfa' }}>Alex:</span>
                            <AnimatePresence mode="wait">
                                <motion.span key={chatIdx}
                                    initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-6 }}
                                    transition={{ duration:0.3 }}
                                    style={{ color: 'var(--text-sub)' }}>
                                    {FAKE_MSGS[chatIdx]}
                                </motion.span>
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            </main>

            {/* ── Stats bar ─────────────────────────────────────────── */}
            <motion.section {...fadeUp(0.6)} className="relative z-10 px-6 sm:px-10 pb-12">
                <div className="max-w-4xl mx-auto glass-panel rounded-2xl px-6 py-4 flex items-center justify-around gap-4 flex-wrap">
                    {STATS.map(s => (
                        <div key={s.label} className="text-center">
                            <div className="syne text-2xl font-bold text-gradient">{s.value}</div>
                            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            </motion.section>

            {/* ── Features ──────────────────────────────────────────── */}
            <section className="relative z-10 pb-12 px-6 sm:px-10">
                <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {FEATURES.map((f,i) => (
                        <motion.div key={f.title} {...fadeUp(0.65 + i*0.10)}
                            className="glass-interactive p-6 flex flex-col gap-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br ${f.gradient} text-white`}
                                 style={{ boxShadow: `0 4px 20px ${f.glow}` }}>
                                {f.icon}
                            </div>
                            <div>
                                <p className="syne font-semibold text-base mb-1.5" style={{ color: 'var(--text)' }}>{f.title}</p>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-sub)' }}>{f.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ── How it works ──────────────────────────────────────── */}
            <section className="relative z-10 pb-16 px-6 sm:px-10">
                <motion.h2 {...fadeUp(0.7)} className="syne text-3xl font-bold text-center mb-10" style={{ color: 'var(--text)' }}>
                    How It Works
                </motion.h2>
                <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-stretch gap-4 sm:gap-0">
                    {STEPS.map((s, i) => (
                        <React.Fragment key={s.n}>
                            <motion.div {...fadeUp(0.75 + i*0.1)}
                                className="glass-card flex-1 p-6 flex flex-col gap-3"
                                style={{ borderRadius: 20 }}>
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl">{s.icon}</span>
                                    <span className="syne text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>{s.n}</span>
                                </div>
                                <p className="syne font-bold text-base" style={{ color: 'var(--text)' }}>{s.title}</p>
                                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-sub)' }}>{s.desc}</p>
                            </motion.div>
                            {i < 2 && (
                                <div className="hidden sm:flex items-center justify-center px-2 shrink-0">
                                    <ArrowRight size={16} style={{ color: 'var(--accent-border)' }} />
                                </div>
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </section>

            {/* ── Footer ────────────────────────────────────────────── */}
            <footer className="relative z-10 glass-header text-center py-5 px-6"
                    style={{ borderTop: '1px solid var(--glass-border)', borderBottom: 'none', borderLeft: 'none', borderRight: 'none' }}>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    WatchSync &copy; {new Date().getFullYear()} — Free, open, and forever in sync.
                </p>
            </footer>
        </div>
    );
};

export default LandingPage;
