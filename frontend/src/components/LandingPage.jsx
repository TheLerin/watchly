import React, { useState, useEffect } from 'react';
import { Play, Users, Zap, HardDrive, ChevronRight, User, Hash, MonitorPlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { motion } from 'framer-motion';

const FEATURES = [
    {
        icon: <Zap size={20} className="text-yellow-400" />,
        title: 'Instant Sync',
        desc: 'Play, pause, and seek together with sub-second precision across all viewers.',
        color: 'from-yellow-500/10 to-orange-500/5',
        border: 'border-yellow-500/20',
    },
    {
        icon: <HardDrive size={20} className="text-blue-400" />,
        title: 'Google Drive',
        desc: 'Upload your video to Drive, paste the link — our proxy streams it to everyone.',
        color: 'from-blue-500/10 to-cyan-500/5',
        border: 'border-blue-500/20',
    },
    {
        icon: <MonitorPlay size={20} className="text-purple-400" />,
        title: 'Any Platform',
        desc: 'YouTube, Vimeo, direct MP4, Google Drive — if it plays, we sync it.',
        color: 'from-purple-500/10 to-pink-500/5',
        border: 'border-purple-500/20',
    },
];

const FADE_UP = (delay = 0) => ({
    initial: { opacity: 0, y: 24 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: 'easeOut', delay },
});

const LandingPage = () => {
    const navigate = useNavigate();
    const { joinRoom, currentUser, roomId } = useRoom();
    const [nickname, setNickname] = useState('');
    const [joinCode, setJoinCode] = useState('');
    const [activeTab, setActiveTab] = useState('create'); // 'create' | 'join'

    useEffect(() => {
        if (currentUser && roomId) {
            navigate(`/room/${roomId}`);
        }
    }, [currentUser, roomId, navigate]);

    const handleCreateRoom = () => {
        if (!nickname.trim()) return;
        const randomId = Math.random().toString(36).substring(2, 9).toUpperCase();
        joinRoom(randomId, nickname);
    };

    const handleJoinRoom = () => {
        if (!nickname.trim() || !joinCode.trim()) return;
        joinRoom(joinCode.trim().toUpperCase(), nickname);
    };

    const handleKeyDown = (e) => {
        if (e.key !== 'Enter') return;
        if (activeTab === 'create') handleCreateRoom();
        else handleJoinRoom();
    };

    return (
        <div className="min-h-screen flex flex-col relative overflow-hidden" style={{ background: 'var(--bg-color)' }}>

            {/* ── Atmospheric background glows ───────────────────────────────── */}
            <div className="pointer-events-none fixed inset-0 z-0">
                <div className="absolute top-[-15%] left-[-10%] w-[600px] h-[600px] rounded-full animate-glow-pulse"
                    style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)' }} />
                <div className="absolute bottom-[-15%] right-[-10%] w-[600px] h-[600px] rounded-full animate-glow-pulse"
                    style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)', animationDelay: '2.5s' }} />
                <div className="absolute top-[40%] right-[25%] w-[300px] h-[300px] rounded-full animate-glow-pulse"
                    style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)', animationDelay: '1.2s' }} />
            </div>

            {/* ── Navbar ──────────────────────────────────────────────────────── */}
            <nav className="relative z-10 flex items-center justify-between px-6 sm:px-10 py-5">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg shadow-purple-600/30"
                        style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
                        <Play fill="white" size={14} className="ml-0.5 text-white" />
                    </div>
                    <span className="font-bold text-xl tracking-tight text-white">WatchSync</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    Live sync ready
                </div>
            </nav>

            {/* ── Main hero ───────────────────────────────────────────────────── */}
            <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center gap-12 px-6 sm:px-10 py-10 max-w-6xl mx-auto w-full">

                {/* Left: Copy */}
                <div className="flex-1 flex flex-col gap-6 text-center lg:text-left max-w-xl">
                    <motion.div {...FADE_UP(0)}>
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-full px-4 py-1.5 mb-4">
                            <Zap size={12} fill="currentColor" />
                            Free & No account required
                        </span>
                        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] tracking-tight text-white">
                            Watch.<br />
                            <span className="text-gradient">Together.</span><br />
                            In Sync.
                        </h1>
                    </motion.div>

                    <motion.p {...FADE_UP(0.15)} className="text-base sm:text-lg text-zinc-400 leading-relaxed">
                        Create a room, share the code, and enjoy perfectly synchronized playback
                        with friends anywhere in the world — YouTube, Vimeo, Google Drive, and more.
                    </motion.p>

                    {/* ── Card ── */}
                    <motion.div {...FADE_UP(0.25)} className="glass-card p-6 flex flex-col gap-4">

                        {/* Tab switcher */}
                        <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/5 p-1 gap-1">
                            {[
                                { id: 'create', label: 'Create Room' },
                                { id: 'join', label: 'Join Room' },
                            ].map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200
                                        ${activeTab === tab.id
                                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                                            : 'text-zinc-400 hover:text-white'}`}>
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* Nickname */}
                        <div className="relative">
                            <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
                            <input
                                id="nickname-input"
                                type="text"
                                placeholder="Your nickname..."
                                value={nickname}
                                maxLength={24}
                                onChange={e => setNickname(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-zinc-500 text-sm font-medium focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/30 transition-all"
                            />
                        </div>

                        {/* Room code (join only) */}
                        {activeTab === 'join' && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="relative">
                                <Hash size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 font-bold" />
                                <input
                                    id="room-code-input"
                                    type="text"
                                    placeholder="ROOM CODE"
                                    value={joinCode}
                                    maxLength={10}
                                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                                    onKeyDown={handleKeyDown}
                                    className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder-zinc-500 text-sm font-mono font-bold tracking-widest uppercase focus:outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/30 transition-all"
                                />
                            </motion.div>
                        )}

                        {/* CTA */}
                        <button
                            id={activeTab === 'create' ? 'create-room-btn' : 'join-room-btn'}
                            onClick={activeTab === 'create' ? handleCreateRoom : handleJoinRoom}
                            disabled={!nickname.trim() || (activeTab === 'join' && !joinCode.trim())}
                            className="btn-primary flex items-center justify-center gap-2 py-3.5 w-full text-base">
                            {activeTab === 'create' ? (
                                <><Play size={18} fill="white" /> Create Room</>
                            ) : (
                                <><Users size={18} /> Join Room</>
                            )}
                            <ChevronRight size={16} className="ml-auto opacity-70" />
                        </button>

                        <p className="text-center text-xs text-zinc-600">No signup, no downloads, no hassle.</p>
                    </motion.div>
                </div>

                {/* Right: Preview card */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.92, x: 30 }}
                    animate={{ opacity: 1, scale: 1, x: 0 }}
                    transition={{ duration: 0.8, delay: 0.3, ease: 'easeOut' }}
                    className="flex-1 w-full max-w-md animate-float hidden lg:block"
                >
                    <div className="glass-card p-5 aspect-video flex flex-col gap-3">
                        {/* Fake title bar */}
                        <div className="flex items-center justify-between">
                            <div className="flex gap-1.5">
                                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                                <div className="w-3 h-3 rounded-full bg-green-500/80" />
                            </div>
                            <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                                3 watching
                            </div>
                            <div className="flex -space-x-2">
                                {['A', 'B', 'C'].map((l, i) => (
                                    <div key={i}
                                        className="w-7 h-7 rounded-full border-2 border-zinc-900 flex items-center justify-center text-[10px] font-bold text-white"
                                        style={{ background: ['#7c3aed', '#4f46e5', '#2563eb'][i] }}>
                                        {l}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Fake player area */}
                        <div className="flex-1 rounded-xl bg-black/50 border border-white/5 flex items-center justify-center relative overflow-hidden">
                            <div className="absolute inset-0 opacity-20"
                                style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #1d4ed8 100%)' }} />
                            <div className="relative z-10 w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center backdrop-blur-sm">
                                <Play fill="white" size={22} className="ml-1 text-white" />
                            </div>
                        </div>

                        {/* Fake scrubber */}
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[10px] text-zinc-600 font-mono">
                                <span>12:34</span>
                                <span>1:45:00</span>
                            </div>
                            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full rounded-full"
                                    style={{ background: 'linear-gradient(90deg, #7c3aed, #3b82f6)' }}
                                    initial={{ width: '15%' }}
                                    animate={{ width: '45%' }}
                                    transition={{ duration: 8, ease: 'linear', repeat: Infinity, repeatType: 'reverse' }}
                                />
                            </div>
                        </div>

                        {/* Fake chat row */}
                        <div className="flex gap-2 text-[10px] text-zinc-500">
                            <span className="text-purple-400 font-semibold">Alex:</span>
                            <span>this scene is so good 🔥</span>
                        </div>
                    </div>
                </motion.div>
            </main>

            {/* ── Feature highlights ──────────────────────────────────────────── */}
            <section className="relative z-10 pb-16 px-6 sm:px-10">
                <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {FEATURES.map((f, i) => (
                        <motion.div
                            key={f.title}
                            {...FADE_UP(0.4 + i * 0.1)}
                            className={`glass-hover p-5 flex flex-col gap-3 bg-gradient-to-br ${f.color} ${f.border}`}>
                            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 border border-white/10">
                                {f.icon}
                            </div>
                            <div>
                                <p className="font-semibold text-sm text-white mb-1">{f.title}</p>
                                <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </section>
        </div>
    );
};

export default LandingPage;
