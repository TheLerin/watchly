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
            <div className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
                <video autoPlay loop muted playsInline className="absolute min-w-full min-h-full object-cover" style={{ opacity: isDark ? 0.35 : 0.15 }}>
                    <source src="/bg-video.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0" style={{ background: isDark ? 'radial-gradient(circle at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.8) 100%)' : 'radial-gradient(circle at center, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.9) 100%)' }} />
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
    { icon: <Zap size={22}/>, title: 'Instant Sync', desc: 'Play, pause, seek — mirrored to every viewer in under a second.', gradient: 'from-zinc-500 to-zinc-700', glow: 'var(--glow-sm)' },
    { icon: <HardDrive size={22}/>, title: 'Google Drive', desc: 'Our proxy streams your private Drive files to the whole room.', gradient: 'from-gray-500 to-gray-700', glow: 'var(--glow-sm)' },
    { icon: <MonitorPlay size={22}/>, title: 'Any Platform', desc: 'YouTube, Vimeo, MP4, Archive.org — if it plays, we sync it.', gradient: 'from-slate-500 to-slate-700', glow: 'var(--glow-sm)' },
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
                    <img src="/logo.png" alt="WatchSync Logo" className="w-10 h-auto theme-invert transition-all" />
                    <span className="syne font-bold text-xl tracking-tight" style={{ color: 'var(--text)' }}>WatchSync</span>
                </div>
                <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium glass-panel"
                     style={{ color: 'var(--text-sub)', borderRadius: 50 }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    Live sync ready
                </div>
            </motion.nav>

            {/* ── Hero ──────────────────────────────────────────────── */}
            <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center lg:justify-between gap-8 sm:gap-12 lg:gap-16 px-5 sm:px-8 lg:px-12 py-8 sm:py-12 lg:py-14 max-w-[1400px] mx-auto w-full min-h-[100dvh]">

                {/* Left: Action Card */}
                <div className="w-full lg:w-1/2 flex justify-center lg:justify-start order-2 lg:order-1">
                    <motion.div {...fadeUp(0.45)} className="glass-card p-6 sm:p-8 lg:p-10 flex flex-col gap-5 sm:gap-6 lg:gap-8 w-full max-w-sm sm:max-w-md lg:max-w-[540px]"
                                style={{ borderRadius: 24 }}>

                        {/* Tab switcher */}
                        <div className="relative flex rounded-xl overflow-hidden p-1.5 gap-1.5"
                             style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)' }}>
                            {[{ id:'create', label:'Create Room' }, { id:'join', label:'Join Room' }].map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className="relative flex-1 py-3 sm:py-4 text-sm sm:text-base font-bold rounded-xl z-10 transition-colors"
                                    style={{ color: activeTab === tab.id ? '#fff' : 'var(--text-sub)' }}>
                                    {activeTab === tab.id && (
                                        <motion.div layoutId="tab-pill" className="absolute inset-0 rounded-xl z-[-1]"
                                            style={{ background: 'linear-gradient(135deg,var(--accent),var(--accent-2))', boxShadow: '0 4px 16px var(--accent-glow)' }}
                                            transition={{ type:'spring', bounce:0.2, duration:0.4 }} />
                                    )}
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Nickname */}
                        <div className="relative">
                            <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            <input id="nickname-input" type="text" placeholder="Your nickname…"
                                value={nickname} maxLength={24}
                                onChange={e => setNickname(e.target.value)} onKeyDown={handleKey}
                                className="glass-input w-full rounded-xl py-4 pl-12 pr-4 text-base font-medium" />
                        </div>

                        {/* Room code */}
                        <AnimatePresence>
                            {activeTab === 'join' && (
                                <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
                                    exit={{ opacity:0, height:0 }} transition={{ duration:0.22 }} className="overflow-hidden">
                                    <div className="relative">
                                        <Hash size={18} className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                                        <input id="room-code-input" type="text" placeholder="ROOM CODE"
                                            value={joinCode} maxLength={10}
                                            onChange={e => setJoinCode(e.target.value.toUpperCase())} onKeyDown={handleKey}
                                            className="glass-input w-full rounded-xl py-4 pl-12 pr-4 text-base font-mono font-bold tracking-widest uppercase" />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* CTA */}
                        <button ref={magnetRef}
                            id={activeTab === 'create' ? 'create-room-btn' : 'join-room-btn'}
                            onClick={activeTab === 'create' ? handleCreate : handleJoin}
                            disabled={!canSubmit}
                            className="btn-primary relative flex items-center justify-center gap-3 py-4 sm:py-5 w-full text-base sm:text-lg font-bold"
                            style={{ borderRadius: 16 }}>
                            {activeTab === 'create'
                                ? <><Play size={18} style={{ fill: 'var(--btn-text)', color: 'var(--btn-text)' }} /> <span>Create Room</span></>
                                : <><Users size={18} /> <span>Join Room</span></>}
                            <ChevronRight size={18} className="absolute right-5 opacity-60" />
                        </button>

                        <p className="text-center text-xs sm:text-sm" style={{ color: 'var(--text-muted)' }}>
                            No signup · No downloads · Plays anywhere
                        </p>
                    </motion.div>
                </div>

                {/* Right: Text Content */}
                <div className="w-full lg:w-1/2 flex flex-col items-center lg:items-start text-center lg:text-left order-1 lg:order-2 lg:pl-10">
                    <motion.div {...fadeUp(0.2)} className="flex flex-col items-center lg:items-start">
                        <span className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold rounded-full px-4 sm:px-5 py-1.5 sm:py-2 mb-5 sm:mb-8 shimmer-pill"
                              style={{ color: 'var(--accent)', border: '1px solid var(--accent-border)', borderRadius: 50 }}>
                            <Zap size={12} fill="currentColor" />
                            Free · No account required · Open source
                        </span>
                        <h1 className="syne text-5xl sm:text-6xl lg:text-[5.5rem] xl:text-[6rem] font-extrabold leading-[1.05] tracking-tight" style={{ color: 'var(--text)' }}>
                            Watch.<br />
                            <span className="text-gradient-animated">Together.</span><br />
                            In Sync.
                        </h1>
                    </motion.div>

                    <motion.p {...fadeUp(0.35)}
                        className="text-base sm:text-lg lg:text-xl leading-relaxed max-w-md sm:max-w-xl mt-5 sm:mt-8 lg:mx-0 mx-auto" style={{ color: 'var(--text-sub)' }}>
                        Create a room, share the code, and enjoy perfectly synchronized playback with
                        friends anywhere — YouTube, Vimeo, Google Drive, and more.
                    </motion.p>
                </div>
            </main>

            {/* ── Stats bar ─────────────────────────────────────────── */}
            <motion.section {...fadeUp(0.6)} className="relative z-10 px-4 sm:px-6 lg:px-10 pb-8 sm:pb-12">
                <div className="max-w-4xl mx-auto glass-panel rounded-2xl px-4 sm:px-6 py-4 sm:py-5 grid grid-cols-2 sm:flex sm:justify-around gap-4 sm:gap-6">
                    {STATS.map(s => (
                        <div key={s.label} className="text-center">
                            <div className="syne text-xl sm:text-2xl font-bold text-gradient">{s.value}</div>
                            <div className="text-[10px] sm:text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{s.label}</div>
                        </div>
                    ))}
                </div>
            </motion.section>

            {/* ── Features ──────────────────────────────────────────── */}
            <section className="relative z-10 pb-8 sm:pb-12 px-4 sm:px-10">
                <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                    {FEATURES.map((f,i) => (
                        <motion.div key={f.title} {...fadeUp(0.65 + i*0.10)}
                            className="glass-interactive p-4 sm:p-6 flex flex-row sm:flex-col gap-4">
                            <div className={`w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl sm:rounded-2xl flex items-center justify-center bg-gradient-to-br ${f.gradient} text-white`}
                                 style={{ boxShadow: `0 4px 20px ${f.glow}` }}>
                                {f.icon}
                            </div>
                            <div>
                                <p className="syne font-semibold text-sm sm:text-base mb-1" style={{ color: 'var(--text)' }}>{f.title}</p>
                                <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-sub)' }}>{f.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ── How it works ──────────────────────────────────────── */}
            <section className="relative z-10 pb-12 sm:pb-16 px-4 sm:px-10">
                <motion.h2 {...fadeUp(0.7)} className="syne text-2xl sm:text-3xl font-bold text-center mb-6 sm:mb-10" style={{ color: 'var(--text)' }}>
                    How It Works
                </motion.h2>
                <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-stretch gap-3 sm:gap-0">
                    {STEPS.map((s, i) => (
                        <React.Fragment key={s.n}>
                            <motion.div {...fadeUp(0.75 + i*0.1)}
                                className="glass-card flex-1 p-5 sm:p-6 flex flex-col gap-3"
                                style={{ borderRadius: 20 }}>
                                <div className="flex items-center gap-3">
                                    <span className="text-xl sm:text-2xl">{s.icon}</span>
                                    <span className="syne text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)' }}>{s.n}</span>
                                </div>
                                <p className="syne font-bold text-sm sm:text-base" style={{ color: 'var(--text)' }}>{s.title}</p>
                                <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--text-sub)' }}>{s.desc}</p>
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
